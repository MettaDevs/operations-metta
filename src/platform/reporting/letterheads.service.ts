import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import { nowSql, type Database } from '../database/index.ts';
import { abort, lookupId, validation } from '../http/index.ts';
import type { ReportCatalog } from './catalog.ts';

// Kop surat per organisasi (identitas cetak), Sys Admin › Kop surat. Yang tersimpan hanya yang khas cetakan: nama
// tampil, baris induk, NPWP, nomor izin, dan catatan kaki. Alamat dan telepon tetap dibaca dari buku alamat
// organisasinya saat mencetak, jadi tidak ada dua tempat yang perlu diselaraskan. Penanda tangan dokumen disimpan di
// kartu yang sama, karena keduanya identitas organisasi di kertas.

const signerSchema = z.object({
    id: z.string(),
    title: z.string(),
    name: z.string(),
    id_number: z.string().nullable(),
    report_code: z.string().nullable(),
});

const rowSchema = z.object({
    organization_id: z.string(),
    organization_name: z.string(),
    classification: z.enum(['legal_entity', 'operating_unit']),
    display_name: z.string().nullable(),
    parent_lines: z.array(z.string()).nullable(),
    tax_id: z.string().nullable(),
    registration_id: z.string().nullable(),
    footer_text: z.string().nullable(),
    signers: z.array(signerSchema),
});

const signerInputSchema = z.object({
    id: z.string().nullable().optional(),
    title: z.string().trim().min(1).max(150),
    name: z.string().trim().min(1).max(200),
    id_number: z.string().trim().max(60).nullable().optional(),
    report_code: z.string().max(160).nullable().optional(),
});

const inputSchema = z.object({
    display_name: z.string().trim().max(200).nullable().optional(),
    parent_lines: z.string().max(1000).nullable().optional(),
    tax_id: z.string().trim().max(60).nullable().optional(),
    registration_id: z.string().trim().max(60).nullable().optional(),
    footer_text: z.string().trim().max(1000).nullable().optional(),
    // Daftar lengkap penanda tangan organisasi ini; yang tidak dikirim dihapus. Tidak dikirim berarti tidak berubah.
    signers: z.array(signerInputSchema).max(20).optional(),
});
export type LetterheadInput = z.input<typeof inputSchema>;

const empty = (value: string | null | undefined) =>
    value === undefined || value === null || value.trim() === ''
        ? null
        : value.trim();

export class Letterheads {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
        private readonly catalog: ReportCatalog,
    ) {}

    async list() {
        this.workspace.guard('report-layout', 'read');
        const rows = await this.db.rows(
            rowSchema,
            `select o.id as organization_id, o.name as organization_name, o.classification, p.display_name,
                    p.parent_lines::jsonb as parent_lines, p.tax_id, p.registration_id, p.footer_text,
                    coalesce((select json_agg(json_build_object('id', s.id, 'title', s.jabatan, 'name', s.nama,
                                                                'id_number', s.nomor_induk,
                                                                'report_code', s.kode_laporan)
                                              order by s.urutan)
                              from penanda_tangan_cetak s
                              where s.tenant_id = o.tenant_id and s.organization_id = o.id
                                and s.deleted_at is null), '[]'::json) as signers
             from organizations o
             left join print_identities p on p.tenant_id = o.tenant_id and p.organization_id = o.id
             where o.tenant_id = $1 and o.classification in ('legal_entity', 'operating_unit')
               and o.status = 'active'
             order by o.classification, o.name`,
            [this.workspace.tenantId],
        );
        // Dokumen yang boleh dipilih untuk seorang penanda tangan: laporan yang dokumennya boleh dibaca pengguna ini.
        const reports = [...this.catalog.values()];
        const held = await this.workspace.holds(
            this.db,
            reports.map((report) => report.permission),
        );
        return {
            data: rows.map(({ parent_lines, ...row }) => ({
                ...row,
                parent_lines: parent_lines ?? [],
            })),
            reports: reports
                .filter((report) => held.has(report.permission))
                .map((report) => ({ code: report.code, name: report.name })),
            can_manage: this.workspace.permissions.has(
                'core.report-layout.update',
            ),
        };
    }

    async save(organizationId: string, body: unknown) {
        this.workspace.guard('report-layout', 'update');
        const parsed = inputSchema.safeParse(body);
        if (!parsed.success)
            validation(
                Object.fromEntries(
                    parsed.error.issues.map((issue) => [
                        issue.path.join('.') || 'form',
                        issue.code === 'too_small'
                            ? 'Wajib diisi.'
                            : 'Isian terlalu panjang atau tidak berupa teks.',
                    ]),
                ),
            );
        const found = await this.db.one(
            z.object({ id: z.string() }),
            `select id from organizations
             where tenant_id = $1 and id = $2 and classification in ('legal_entity', 'operating_unit')`,
            [this.workspace.tenantId, organizationId],
        );
        if (!found) abort(404, 'Organisasi tidak ditemukan.');
        const input = parsed.data;
        const unknownReports = Object.fromEntries(
            (input.signers ?? []).flatMap((signer, index) =>
                signer.report_code && !this.catalog.has(signer.report_code)
                    ? [
                          [
                              `signers.${index}.report_code`,
                              'Dokumen ini tidak dikenal.',
                          ],
                      ]
                    : [],
            ),
        );
        if (Object.keys(unknownReports).length) validation(unknownReports);
        const lines = (input.parent_lines ?? '')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        const stamp = nowSql();
        await this.db.execute(
            `insert into print_identities (id, tenant_id, organization_id, display_name, parent_lines, tax_id,
                                           registration_id, footer_text, logos, created_at, updated_at)
             values ($1, $2, $3, $4, $5::text::json, $6, $7, $8, '[]', $9, $9)
             on conflict (organization_id) do update
                 set display_name = excluded.display_name, parent_lines = excluded.parent_lines,
                     tax_id = excluded.tax_id, registration_id = excluded.registration_id,
                     footer_text = excluded.footer_text, updated_at = excluded.updated_at`,
            [
                Bun.randomUUIDv7(),
                this.workspace.tenantId,
                organizationId,
                empty(input.display_name),
                JSON.stringify(lines),
                empty(input.tax_id),
                empty(input.registration_id),
                empty(input.footer_text),
                stamp,
            ],
        );
        if (input.signers)
            await this.saveSigners(organizationId, input.signers, stamp);
        return { ...(await this.list()), message: 'Kop surat disimpan.' };
    }

    // Baris yang tidak dikirim lagi diarsipkan; urutan cetak mengikuti urutan daftar di layar.
    private async saveSigners(
        organizationId: string,
        list: z.output<typeof signerInputSchema>[],
        stamp: string,
    ) {
        const kept = list.flatMap((signer) =>
            signer.id && lookupId(signer.id) ? [signer.id] : [],
        );
        await this.db.execute(
            `update penanda_tangan_cetak set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and organization_id = $3 and deleted_at is null and not (id = any($4::uuid[]))`,
            [
                stamp,
                this.workspace.tenantId,
                organizationId,
                `{${kept.join(',')}}`,
            ],
        );
        for (const [index, signer] of list.entries()) {
            const values = [
                this.workspace.tenantId,
                organizationId,
                signer.report_code ?? null,
                signer.title,
                signer.name,
                empty(signer.id_number),
                index + 1,
                stamp,
            ];
            const updated =
                signer.id && lookupId(signer.id)
                    ? await this.db.one(
                          z.object({ id: z.string() }),
                          `update penanda_tangan_cetak
                           set kode_laporan = $3, jabatan = $4, nama = $5, nomor_induk = $6, urutan = $7,
                               updated_at = $8
                           where tenant_id = $1 and organization_id = $2 and id = $9 and deleted_at is null
                           returning id`,
                          [...values, signer.id],
                      )
                    : undefined;
            if (!updated)
                await this.db.execute(
                    `insert into penanda_tangan_cetak (id, tenant_id, organization_id, kode_laporan, jabatan, nama,
                                                       nomor_induk, urutan, created_at, updated_at)
                     values ($9, $1, $2, $3, $4, $5, $6, $7, $8, $8)`,
                    [...values, Bun.randomUUIDv7()],
                );
        }
    }
}
