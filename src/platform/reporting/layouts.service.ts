import { createHash } from 'node:crypto';
import PizZip from 'pizzip';
import { z } from 'zod';
import { isoSql, nowSql, type Database } from '../database/index.ts';
import { abort, validation } from '../http/index.ts';
import { unknownTags } from './catalog.ts';
import { layoutTags, paperOf, type Paper } from './docx.ts';
import { languages, type DocumentReport, type Language } from './report.ts';

// Layout sebuah laporan untuk satu legal entity: layout bawaan dari kode ditambah unggahan legal entity itu, dan satu
// pilihan bawaan per laporan (Report Layout Selection BC). Pilihan bawaan dibaca ulang setiap kali, jadi pilihan yang
// menunjuk unggahan terhapus atau layout bawaan yang sudah tidak ada jatuh ke layout bawaan pertama tanpa perlu diselaraskan.

export type LayoutChoice = {
    ref: string;
    name: string;
    language: Language;
    paper: Paper | null;
    source: 'builtin' | 'upload';
    is_default: boolean;
    uploaded_by: string | null;
    uploaded_at: string | null;
};

export type ResolvedLayout = {
    ref: string;
    name: string;
    language: Language;
    document: Uint8Array;
};

const builtinPrefix = 'builtin:';
const maxBytes = 2 * 1024 * 1024;
const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const uploadRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    bahasa: z.enum(languages),
    kertas_lebar_mm: z.number().nullable(),
    kertas_tinggi_mm: z.number().nullable(),
    uploaded_by: z.string().nullable(),
    uploaded_at: z.string().nullable(),
});

export class ReportLayouts {
    constructor(
        private readonly db: Database,
        private readonly scope: { tenantId: string; legalEntityId: string },
        private readonly report: DocumentReport,
    ) {}

    private async uploads() {
        return this.db.rows(
            uploadRowSchema,
            `select l.id, l.name, l.bahasa, l.kertas_lebar_mm, l.kertas_tinggi_mm, u.name as uploaded_by,
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
            language: layout.language,
            paper: paperOf(layout.document()),
            source: 'builtin' as const,
            uploaded_by: null,
            uploaded_at: null,
        }));
        const uploaded = uploads.map((row) => ({
            ref: row.id,
            name: row.name,
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
            if (layout)
                return {
                    ref: wanted,
                    name: layout.name,
                    language: layout.language,
                    document: layout.document(),
                };
        } else if (wanted && uuidPattern.test(wanted)) {
            const row = await this.db.one(
                z.object({
                    name: z.string(),
                    bahasa: z.enum(languages),
                    isi: z.instanceof(Uint8Array),
                }),
                `select name, bahasa, isi from report_layouts
                 where tenant_id = $1 and legal_entity_id = $2 and report_code = $3 and id = $4
                   and isi is not null and deleted_at is null`,
                [
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    this.report.code,
                    wanted,
                ],
            );
            if (row)
                return {
                    ref: wanted,
                    name: row.name,
                    language: row.bahasa,
                    document: new Uint8Array(row.isi),
                };
        }
        if (ref) validation({ layout: 'Layout cetak ini sudah tidak ada.' });
        const [first] = this.report.layouts;
        return {
            ref: `${builtinPrefix}${first.key}`,
            name: first.name,
            language: first.language,
            document: first.document(),
        };
    }

    // Unggahan diperiksa sebelum disimpan: berkas Word tanpa makro, ukurannya wajar, sintaks tag-nya utuh, dan setiap
    // tag dikenal laporan ini. Tag yang tidak dikenal ditolak, karena di kertas ia tercetak kosong tanpa ada yang tahu.
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
            errors.file = 'Pilih berkas Word (.docx) yang akan diunggah.';
        else if (input.file.size > maxBytes)
            errors.file = 'Berkas layout paling besar 2 MB.';
        if (Object.keys(errors).length || !(input.file instanceof Blob))
            validation(errors);
        const bytes = new Uint8Array(await input.file.arrayBuffer());
        const paper = inspectLayout(this.report, bytes);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const stamp = nowSql();
        const id = Bun.randomUUIDv7();
        const inserted = await this.db.execute(
            `insert into report_layouts (id, tenant_id, legal_entity_id, report_code, name, format, file_size, isi,
                                         sha256, bahasa, kertas_lebar_mm, kertas_tinggi_mm, created_by_user_id,
                                         created_at, updated_at)
             values ($1, $2, $3, $4, $5, 'docx', $6, $7, $8, $9, $10, $11, $12, $13, $13)
             on conflict (tenant_id, legal_entity_id, report_code, sha256)
                 where deleted_at is null and sha256 is not null do nothing`,
            [
                id,
                this.scope.tenantId,
                this.scope.legalEntityId,
                this.report.code,
                name,
                bytes.length,
                bytes,
                sha256,
                language.data ?? 'id',
                paper.widthMm,
                paper.heightMm,
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

// Pemeriksaan unggahan, juga dipakai test. Mengembalikan ukuran kertasnya.
export function inspectLayout(
    report: DocumentReport,
    bytes: Uint8Array,
): Paper {
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
