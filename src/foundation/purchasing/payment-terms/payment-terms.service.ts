import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    dateSchema,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import {
    activeLegalEntity,
    codeAndName,
    codeAndNameMessages,
    inUse,
    parseInput,
    violates,
} from '../../inventory/index.ts';
import {
    paymentTermsInputSchema,
    paymentTermsRowSchema,
} from './payment-terms.schema.ts';

const rowSql = `select * from (
                    select t.id, t.kode as code, t.keterangan as name, t.jumlah_hari as due_days, t.version
                    from termin_pembayaran t
                    where t.tenant_id = $1 and t.legal_entity_id = $2 and t.deleted_at is null) terms
                where true`;

const label = 'termin';
const dueDaysMessage = 'Isi jumlah hari 0 sampai 3650.';

export const paymentTermsJson = (alias: string) =>
    `case when ${alias}.id is null then null else json_build_object(
         'id', ${alias}.id, 'code', ${alias}.kode, 'name', ${alias}.keterangan, 'due_days', ${alias}.jumlah_hari) end`;

// Jatuh tempo = tanggal dokumen + jumlah hari termin (Due Date = CalcDate("Due Date Calculation", "Document Date")).
// Tanpa termin, jatuh tempo sama dengan tanggal dokumen, seperti BC yang mengisi Due Date dengan Document Date.
export function dueDate(documentDate: string, dueDays: number | null): string {
    if (!dateSchema.safeParse(documentDate).success) return documentDate;
    const date = new Date(`${documentDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + (dueDays ?? 0));
    return date.toISOString().slice(0, 10);
}

// Termin milik legal entity: undefined bila id kosong, null bila id diisi tetapi tidak ditemukan.
export async function paymentTermsOf(
    db: Database,
    scope: { tenantId: string; legalEntityId: string },
    id: string | null | undefined,
) {
    if (!id) return undefined;
    if (!lookupId(id)) return null;
    return (
        (await db.one(
            z.object({ id: z.string(), due_days: z.number() }),
            `select id, jumlah_hari as due_days from termin_pembayaran
             where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
            [scope.tenantId, scope.legalEntityId, id],
        )) ?? null
    );
}

// Termin pembayaran (Payment Terms di BC) per legal entity. Kodenya pendek dan diketik pengguna, seperti Code di BC,
// tanpa number sequence.
export class PaymentTerms {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get bindings() {
        return [this.workspace.tenantId, activeLegalEntity(this.workspace)];
    }

    private checked(body: unknown) {
        const data = parseInput(paymentTermsInputSchema, body, {
            ...codeAndNameMessages(label),
            due_days: dueDaysMessage,
        });
        const errors: Record<string, string> = {};
        const values = codeAndName(data, errors, label, {
            code: 10,
            name: 100,
        });
        const raw =
            typeof data.due_days === 'number'
                ? String(data.due_days)
                : data.due_days.trim();
        const days = /^\d{1,4}$/.test(raw) ? Number(raw) : -1;
        if (days < 0 || days > 3650) errors.due_days = dueDaysMessage;
        if (Object.keys(errors).length) validation(errors);
        return { ...values, dueDays: days };
    }

    private codeTaken(error: unknown): void {
        if (violates(error, 'termin_pembayaran_kode_unique'))
            validation({ code: 'Kode ini sudah dipakai termin lain.' });
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('payment-terms', 'read');
        const batch = await incrementalList(this.db, {
            query: rowSql,
            bindings: this.bindings,
            parameters,
            columns: { code: 'code', name: 'name', due_days: 'due_days' },
            searchColumns: ['code', 'name'],
            numericColumns: ['due_days'],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => paymentTermsRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.payment-terms.update',
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  paymentTermsRowSchema,
                  `${rowSql} and terms.id = $3`,
                  [...this.bindings, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('payment-terms', 'update');
        const data = this.checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('termin_pembayaran', {
                id,
                tenant_id: this.workspace.tenantId,
                legal_entity_id: activeLegalEntity(this.workspace),
                kode: data.code,
                keterangan: data.name,
                jumlah_hari: data.dueDays,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            this.codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    // Jatuh tempo dokumen yang sudah ada tidak ikut berubah, karena dokumen menyimpan tanggalnya sendiri.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('payment-terms', 'update');
        const current = await this.row(id);
        const data = this.checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update termin_pembayaran set kode = $1, keterangan = $2, jumlah_hari = $3, updated_at = $4
                 where tenant_id = $5 and id = $6 and version = $7 and deleted_at is null`,
                [
                    data.code,
                    data.name,
                    data.dueDays,
                    nowSql(),
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            this.codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('payment-terms', 'update');
        const current = await this.row(id);
        await inUse(
            this.db,
            [
                {
                    sql: 'select 1 as found from vendors where tenant_id = $1 and termin_pembayaran_id = $2 limit 1',
                    message:
                        'Termin ini masih menjadi termin bawaan vendor. Ganti termin di kartu vendor itu lebih dulu.',
                },
                {
                    sql: 'select 1 as found from bl_tr_order where tenant_id = $1 and termin_pembayaran_id = $2 and deleted_at is null limit 1',
                    message:
                        'Termin ini sudah dipakai purchase order, jadi tidak bisa dihapus.',
                },
            ],
            [this.workspace.tenantId, current.id],
        );
        const deleted = await this.db.execute(
            `update termin_pembayaran set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [
                nowSql(),
                this.workspace.tenantId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
