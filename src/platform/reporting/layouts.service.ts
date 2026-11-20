import { createHash } from 'node:crypto';
import PizZip from 'pizzip';
import { z } from 'zod';
import { isoSql, nowSql, type Database } from '../database/index.ts';
import { abort, validation } from '../http/index.ts';
import { reportShape, unknownTags } from './catalog.ts';
import { layoutTags, paperOf, type Paper } from './docx.ts';
import {
    languages,
    layoutFormats,
    type BuiltinLayout,
    type Language,
    type LayoutFormat,
    type Report,
} from './report.ts';
import type { WorkbookShape } from './workbook.ts';
import {
    excelWorkbook,
    inspectWorkbook,
    type CellFormats,
    type WorkbookRefusal,
} from './xlsx.ts';

// Layout sebuah laporan untuk satu legal entity: layout bawaan dari kode ditambah unggahan legal entity itu, dan satu
// pilihan bawaan per laporan (Report Layout Selection BC). Pilihan bawaan dibaca ulang setiap kali, jadi pilihan yang
// menunjuk unggahan terhapus atau layout bawaan yang sudah tidak ada jatuh ke layout bawaan pertama tanpa perlu diselaraskan.

export type LayoutChoice = {
    ref: string;
    name: string;
    format: LayoutFormat;
    language: Language;
    // Ukuran kertas layout Word; layout Excel tidak punya.
    paper: Paper | null;
    source: 'builtin' | 'upload';
    is_default: boolean;
    uploaded_by: string | null;
    uploaded_at: string | null;
};

// Layout yang dipakai satu cetak. Workbook bawaan ditulis per cetak dengan bentuk laporan dan format angka tenant,
// karena format angka pivot tidak mengikuti sel sumbernya; unggahan mengembalikan berkas tersimpannya.
export type ResolvedLayout =
    | {
          format: 'docx';
          ref: string;
          name: string;
          language: Language;
          document: Uint8Array;
      }
    | {
          format: 'xlsx';
          ref: string;
          name: string;
          language: Language;
          workbook: (shape: WorkbookShape, formats: CellFormats) => Uint8Array;
      };

const builtinPrefix = 'builtin:';
const maxBytes = 2 * 1024 * 1024;
const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const uploadRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    format: z.enum(layoutFormats),
    bahasa: z.enum(languages),
    kertas_lebar_mm: z.number().nullable(),
    kertas_tinggi_mm: z.number().nullable(),
    uploaded_by: z.string().nullable(),
    uploaded_at: z.string().nullable(),
});

function resolvedBuiltin(ref: string, layout: BuiltinLayout): ResolvedLayout {
    const common = { ref, name: layout.name, language: layout.language };
    switch (layout.format) {
        case 'docx':
            return { ...common, format: 'docx', document: layout.document() };
        case 'xlsx':
            return {
                ...common,
                format: 'xlsx',
                workbook: (shape, formats) =>
                    excelWorkbook(shape, formats, layout.workbook),
            };
        default: {
            const unknown: never = layout;
            throw new Error(
                `Format layout tidak dikenal: ${JSON.stringify(unknown)}`,
            );
        }
    }
}

export class ReportLayouts {
    constructor(
        private readonly db: Database,
        private readonly scope: { tenantId: string; legalEntityId: string },
        private readonly report: Report,
    ) {}

    private async uploads() {
        return this.db.rows(
            uploadRowSchema,
            `select l.id, l.name, l.format, l.bahasa, l.kertas_lebar_mm, l.kertas_tinggi_mm, u.name as uploaded_by,
                    ${isoSql('l.created_at')} as uploaded_at
             from report_layouts l left join users u on u.id = l.created_by_user_id
             where l.tenant_id = $1 and l.legal_entity_id = $2 and l.report_code = $3 and l.isi is not null
               and l.deleted_at is null
             order by l.created_at desc, l.id`,
            [this.scope.tenantId, this.scope.legalEntityId, this.report.code],
        );
    }

    private async chosen(): Promise<string | null> {
        const row = await this.db.one(
            z.object({ layout_ref: z.string() }),
            `select layout_ref from report_layout_defaults
             where tenant_id = $1 and report_code = $2 and scope_key = $3`,
            [this.scope.tenantId, this.report.code, this.scope.legalEntityId],
        );
        return row?.layout_ref ?? null;
    }

    async list(): Promise<LayoutChoice[]> {
        const uploads = await this.uploads();
        const builtins = this.report.layouts.map((layout) => ({
            ref: `${builtinPrefix}${layout.key}`,
            name: layout.name,
            format: layout.format,
            language: layout.language,
            paper: layout.format === 'docx' ? paperOf(layout.document()) : null,
            source: 'builtin' as const,
            uploaded_by: null,
            uploaded_at: null,
        }));
        const uploaded = uploads.map((row) => ({
            ref: row.id,
            name: row.name,
            format: row.format,
            language: row.bahasa,
            paper:
                row.kertas_lebar_mm && row.kertas_tinggi_mm
                    ? {
                          widthMm: row.kertas_lebar_mm,
                          heightMm: row.kertas_tinggi_mm,
                      }
                    : null,
            source: 'upload' as const,
            uploaded_by: row.uploaded_by,
            uploaded_at: row.uploaded_at,
        }));
        const all = [...builtins, ...uploaded];
        const chosen = await this.chosen();
        const effective = all.some((layout) => layout.ref === chosen)
            ? chosen
            : builtins[0]?.ref;
        return all.map((layout) => ({
            ...layout,
            is_default: layout.ref === effective,
        }));
    }

    // Layout yang dipakai cetak: yang diminta, atau pilihan bawaan legal entity, atau layout bawaan pertama.
    async resolve(ref: string | null): Promise<ResolvedLayout> {
        const wanted = ref ?? (await this.chosen());
        const builtin = (key: string) =>
            this.report.layouts.find((layout) => layout.key === key);
        if (wanted?.startsWith(builtinPrefix)) {
            const layout = builtin(wanted.slice(builtinPrefix.length));
            if (layout) return resolvedBuiltin(wanted, layout);
        } else if (wanted && uuidPattern.test(wanted)) {
            const row = await this.db.one(
                z.object({
                    name: z.string(),
                    format: z.enum(layoutFormats),
                    bahasa: z.enum(languages),
                    isi: z.instanceof(Uint8Array),
                }),
                `select name, format, bahasa, isi from report_layouts
                 where tenant_id = $1 and legal_entity_id = $2 and report_code = $3 and id = $4
                   and isi is not null and deleted_at is null`,
                [
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    this.report.code,
                    wanted,
                ],
            );
            if (row) {
                const stored = new Uint8Array(row.isi);
                const common = {
                    ref: wanted,
                    name: row.name,
                    language: row.bahasa,
                };
                switch (row.format) {
                    case 'docx':
                        return { ...common, format: 'docx', document: stored };
                    case 'xlsx':
                        return {
                            ...common,
                            format: 'xlsx',
                            workbook: () => stored,
                        };
                    default: {
                        const unknown: never = row.format;
                        throw new Error(
                            `Format layout tidak dikenal: ${String(unknown)}`,
                        );
                    }
                }
            }
        }
        if (ref) validation({ layout: 'Layout cetak ini sudah tidak ada.' });
        const [first] = this.report.layouts;
        return resolvedBuiltin(`${builtinPrefix}${first.key}`, first);
    }

    // Unggahan diperiksa sebelum disimpan, Word maupun Excel: tanpa makro, ukurannya wajar, dan setiap tag, nama, atau
    // kolom yang dipakainya dikenal laporan ini. Yang tidak dikenal ditolak, karena di kertas atau di sel ia tampil
    // kosong tanpa ada yang tahu. Format dibaca dari isi berkas, bukan dari nama berkasnya.
    async upload(input: {
        file: unknown;
        name: unknown;
        language: unknown;
        userId: string;
    }): Promise<LayoutChoice> {
        const errors: Record<string, string> = {};
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (!name || name.length > 120)
            errors.name = 'Isi nama layout, paling banyak 120 karakter.';
        const language = z.enum(languages).safeParse(input.language);
        if (!language.success)
            errors.language = 'Pilih bahasa layout: Indonesia atau Inggris.';
        if (!(input.file instanceof Blob))
            errors.file =
                'Pilih berkas Word (.docx) atau Excel (.xlsx) yang akan diunggah.';
        else if (input.file.size > maxBytes)
            errors.file = 'Berkas layout paling besar 2 MB.';
        if (Object.keys(errors).length || !(input.file instanceof Blob))
            validation(errors);
        const bytes = new Uint8Array(await input.file.arrayBuffer());
        const { format, paper } = inspectLayout(this.report, bytes);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const stamp = nowSql();
        const id = Bun.randomUUIDv7();
        const inserted = await this.db.execute(
            `insert into report_layouts (id, tenant_id, legal_entity_id, report_code, name, format, file_size, isi,
                                         sha256, bahasa, kertas_lebar_mm, kertas_tinggi_mm, created_by_user_id,
                                         created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
             on conflict (tenant_id, legal_entity_id, report_code, sha256)
                 where deleted_at is null and sha256 is not null do nothing`,
            [
                id,
                this.scope.tenantId,
                this.scope.legalEntityId,
                this.report.code,
                name,
                format,
                bytes.length,
                bytes,
                sha256,
                language.data ?? 'id',
                paper?.widthMm ?? null,
                paper?.heightMm ?? null,
                input.userId,
                stamp,
            ],
        );
        const stored = inserted
            ? id
            : (
                  await this.db.one(
                      z.object({ id: z.string() }),
                      `select id from report_layouts
                       where tenant_id = $1 and legal_entity_id = $2 and report_code = $3 and sha256 = $4
                         and deleted_at is null`,
                      [
                          this.scope.tenantId,
                          this.scope.legalEntityId,
                          this.report.code,
                          sha256,
                      ],
                  )
              )?.id;
        const layout = (await this.list()).find((item) => item.ref === stored);
        if (!layout)
            throw new Error('Layout yang baru diunggah tidak ditemukan.');
        return layout;
    }

    // Pilihan bawaan legal entity. Kembali ke bawaan berarti memilih layout bawaan.
    async choose(ref: unknown): Promise<LayoutChoice[]> {
        const layouts = await this.list();
        if (
            !layouts.some((layout) => layout.ref === ref) ||
            typeof ref !== 'string'
        )
            validation({ layout: 'Pilih layout yang ada di daftar.' });
        const stamp = nowSql();
        await this.db.execute(
            `insert into report_layout_defaults (id, tenant_id, legal_entity_id, scope_key, report_code, layout_ref,
                                                 created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $7)
             on conflict (tenant_id, report_code, scope_key)
                 do update set layout_ref = excluded.layout_ref, updated_at = excluded.updated_at`,
            [
                Bun.randomUUIDv7(),
                this.scope.tenantId,
                this.scope.legalEntityId,
                this.scope.legalEntityId,
                this.report.code,
                ref,
                stamp,
            ],
        );
        return this.list();
    }

    // Hapus lunak. Layout yang sedang dipakai boleh dihapus; cetak lalu kembali ke layout bawaan.
    async remove(id: string): Promise<LayoutChoice[]> {
        const removed = uuidPattern.test(id)
            ? await this.db.execute(
                  `update report_layouts set deleted_at = $5, updated_at = $5
                   where tenant_id = $1 and legal_entity_id = $2 and report_code = $3 and id = $4
                     and isi is not null and deleted_at is null`,
                  [
                      this.scope.tenantId,
                      this.scope.legalEntityId,
                      this.report.code,
                      id,
                      nowSql(),
                  ],
              )
            : 0;
        if (!removed) abort(404, 'Layout tidak ditemukan.');
        return this.list();
    }
}

// Format sebuah berkas unggahan dari jenis bagian utamanya. Berkas bermakro ikut dikenali, supaya penolakannya menyebut
// makro, bukan format.
function packageFormat(bytes: Uint8Array): LayoutFormat | null {
    let types: string;
    try {
        types = new PizZip(bytes).file('[Content_Types].xml')?.asText() ?? '';
    } catch {
        return null;
    }
    if (/wordprocessingml|ms-word/.test(types)) return 'docx';
    if (/spreadsheetml|ms-excel/.test(types)) return 'xlsx';
    return null;
}

// Pemeriksaan unggahan, juga dipakai test. Mengembalikan format dan, untuk Word, ukuran kertasnya.
export function inspectLayout(
    report: Report,
    bytes: Uint8Array,
): { format: LayoutFormat; paper: Paper | null } {
    const format = packageFormat(bytes);
    switch (format) {
        case 'docx':
            return { format, paper: inspectWordLayout(report, bytes) };
        case 'xlsx': {
            const refusal = inspectWorkbook(bytes, reportShape(report.fields));
            if (refusal) validation({ file: refusalMessage(report, refusal) });
            return { format, paper: null };
        }
        case null:
            return validation({
                file: 'Berkas ini bukan dokumen Word (.docx) atau workbook Excel (.xlsx).',
            });
        default: {
            const unknown: never = format;
            throw new Error(`Format layout tidak dikenal: ${String(unknown)}`);
        }
    }
}

// Teks penolakan layout Excel untuk pengguna. Alasan baru di xlsx.ts gagal dikompilasi sampai diberi teks di sini.
export function refusalMessage(
    report: Report,
    refusal: WorkbookRefusal,
): string {
    switch (refusal.reason) {
        case 'not-workbook':
            return 'Berkas ini bukan workbook Excel (.xlsx) yang bisa dibaca. Buka lalu simpan ulang berkasnya di Excel sebagai .xlsx.';
        case 'macro':
            return 'Layout tidak boleh berisi makro. Simpan ulang sebagai .xlsx biasa.';
        case 'embedded-object':
            return 'Layout tidak boleh berisi objek tertanam atau ActiveX.';
        case 'external-source':
            return 'Layout tidak boleh mengambil data dari luar berkas, misalnya tautan ke workbook lain, koneksi data, atau Power Query.';
        case 'external-function':
            return `Layout tidak boleh memakai fungsi yang menghubungi luar berkas: ${refusal.functions.join(', ')}.`;
        case 'name-taken':
            return `Nama ini dipakai laporan dan tidak boleh dipakai untuk tabel atau nama lain di workbook: ${refusal.names.join(', ')}.`;
        case 'crowded-sheet':
            return `Sheet ${refusal.sheet} diisi ulang setiap kali laporan diunduh, jadi hanya boleh berisi tabel laporannya. Pindahkan isi lainnya ke sheet sendiri.`;
        case 'totals-row':
            return `Tabel ${refusal.table} diisi ulang setiap kali laporan diunduh. Matikan Total Row-nya dan buat total di sheet lain.`;
        case 'unknown-columns':
            return `Kolom ini tidak dikenal tabel ${refusal.table} laporan ${report.name}: ${refusal.columns.join(', ')}. Hapus kolomnya dan buat hitungannya di sheet lain.`;
        case 'unknown-references':
            return `Rumus atau pivot memakai nama atau kolom yang tidak dikenal laporan ${report.name}: ${refusal.references.join(', ')}. Lihat daftar field di layar ini.`;
        case 'sheet-reference':
            return `Rumus atau pivot membaca sel di sheet ${refusal.sheets.join(', ')} langsung, padahal sheet itu diisi ulang setiap kali laporan diunduh. Pakai nama tabel dan kolomnya di rumus, bukan alamat sel.`;
        default: {
            const unknown: never = refusal;
            throw new Error(
                `Penolakan tidak dikenal: ${JSON.stringify(unknown)}`,
            );
        }
    }
}

function inspectWordLayout(report: Report, bytes: Uint8Array): Paper {
    let zip: PizZip;
    try {
        zip = new PizZip(bytes);
    } catch {
        return validation({ file: 'Berkas ini bukan dokumen Word (.docx).' });
    }
    const types = zip.file('[Content_Types].xml')?.asText() ?? '';
    if (!zip.file('word/document.xml') || !types.includes('wordprocessingml'))
        validation({ file: 'Berkas ini bukan dokumen Word (.docx).' });
    if (
        /macroEnabled/i.test(types) ||
        Object.keys(zip.files).some((name) => /vbaProject|activeX/i.test(name))
    )
        validation({
            file: 'Layout tidak boleh berisi makro atau ActiveX. Simpan ulang sebagai .docx biasa.',
        });
    const external = Object.keys(zip.files)
        .filter((name) => name.endsWith('.rels'))
        .some((name) =>
            [
                ...(zip.file(name)?.asText() ?? '').matchAll(
                    /<Relationship\b[^>]*>/g,
                ),
            ].some(
                ([relation]) =>
                    relation.includes('TargetMode="External"') &&
                    !relation.includes('relationships/hyperlink"'),
            ),
        );
    if (external)
        validation({
            file: 'Layout tidak boleh mengambil gambar atau berkas dari luar dokumen. Sisipkan gambarnya langsung.',
        });
    try {
        layoutTags(bytes);
    } catch (error) {
        const explanation: unknown =
            error instanceof Error
                ? Reflect.get(error, 'properties')
                : undefined;
        const detail: unknown =
            explanation !== null && typeof explanation === 'object'
                ? Reflect.get(explanation, 'errors')
                : undefined;
        validation({
            file: `Penulisan tag di layout belum benar, misalnya {#…} yang belum ditutup {/…}. ${describe(detail)}`.trim(),
        });
    }
    const unknown = unknownTags(report.fields, bytes);
    if (unknown.length)
        validation({
            file: `Tag ini tidak dikenal laporan ${report.name}: ${unknown.map((tag) => `{${tag}}`).join(', ')}. Lihat daftar field di layar ini.`,
        });
    const paper = paperOf(bytes);
    if (!paper)
        validation({
            file: 'Ukuran kertas layout tidak terbaca dari dokumen.',
        });
    return paper;
}

function describe(errors: unknown): string {
    if (!Array.isArray(errors)) return '';
    return errors
        .map((item: unknown) => {
            const properties: unknown =
                item !== null && typeof item === 'object'
                    ? Reflect.get(item, 'properties')
                    : undefined;
            const explanation: unknown =
                properties !== null && typeof properties === 'object'
                    ? Reflect.get(properties, 'explanation')
                    : undefined;
            return typeof explanation === 'string' ? explanation : '';
        })
        .filter((text) => text.length > 0)
        .join(' ');
}
