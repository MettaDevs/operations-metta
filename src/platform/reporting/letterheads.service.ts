import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import { nowSql, type Database } from '../database/index.ts';
import { abort, validation } from '../http/index.ts';

// Kop surat per organisasi (identitas cetak), Sys Admin › Kop surat. Yang tersimpan hanya yang khas cetakan: nama
// tampil, baris induk, NPWP, nomor izin, dan catatan kaki. Alamat dan telepon tetap dibaca dari buku alamat
// organisasinya saat mencetak, jadi tidak ada dua tempat yang perlu diselaraskan.

const rowSchema = z.object({
    organization_id: z.string(),
    organization_name: z.string(),
    classification: z.enum(['legal_entity', 'operating_unit']),
    display_name: z.string().nullable(),
    parent_lines: z.array(z.string()).nullable(),
    tax_id: z.string().nullable(),
    registration_id: z.string().nullable(),
    footer_text: z.string().nullable(),
});

const inputSchema = z.object({
    display_name: z.string().trim().max(200).nullable().optional(),
    parent_lines: z.string().max(1000).nullable().optional(),
    tax_id: z.string().trim().max(60).nullable().optional(),
    registration_id: z.string().trim().max(60).nullable().optional(),
    footer_text: z.string().trim().max(1000).nullable().optional(),
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
    ) {}

    async list() {
        this.workspace.guard('report-layout', 'read');
        const rows = await this.db.rows(
            rowSchema,
            `select o.id as organization_id, o.name as organization_name, o.classification, p.display_name,
                    p.parent_lines::jsonb as parent_lines, p.tax_id, p.registration_id, p.footer_text
             from organizations o
             left join print_identities p on p.tenant_id = o.tenant_id and p.organization_id = o.id
             where o.tenant_id = $1 and o.classification in ('legal_entity', 'operating_unit')
               and o.status = 'active'
             order by o.classification, o.name`,
            [this.workspace.tenantId],
        );
        return {
            data: rows.map(({ parent_lines, ...row }) => ({
                ...row,
                parent_lines: parent_lines ?? [],
            })),
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
                        String(issue.path[0] ?? 'form'),
                        'Isian terlalu panjang atau tidak berupa teks.',
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
        return { ...(await this.list()), message: 'Kop surat disimpan.' };
    }
}
