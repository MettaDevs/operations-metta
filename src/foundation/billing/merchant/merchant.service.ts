import type { Workspace } from '../../../platform/access/index.ts';
import {
    isReferenced,
    nowSql,
    sqlErrorCode,
    type Database,
} from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import { activeLegalEntity } from '../../inventory/index.ts';
import { decimalText } from '../billing.service.ts';
import { merchantInputSchema, merchantRowSchema } from './merchant.schema.ts';

const rowSql = `select * from (
                    select m.id, m.kode as code, m.nama as name,
                           trim_scale(m.add_charge_debet)::text as debit_surcharge_percent,
                           trim_scale(m.add_charge_kredit)::text as credit_surcharge_percent,
                           trim_scale(m.diskon)::text as discount_percent, m.aktif as is_active, m.version
                    from merchan m
                    where m.tenant_id = $1 and m.legal_entity_id = $2 and m.deleted_at is null) merchants
                where true`;

// Isian persen form Merchan sistem lama, dengan kolom merchan-nya.
const percentFields = [
    { field: 'debit_surcharge_percent', column: 'add_charge_debet' },
    { field: 'credit_surcharge_percent', column: 'add_charge_kredit' },
    { field: 'discount_percent', column: 'diskon' },
] as const;

function checked(body: unknown) {
    const parsed = merchantInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim().toUpperCase() ?? '';
    const name = data?.name.trim() ?? '';
    if (!code) errors.code = 'Isi kode merchan.';
    else if (code.length > 20)
        errors.code = 'Kode merchan paling banyak 20 karakter.';
    if (!name) errors.name = 'Isi nama merchan.';
    else if (name.length > 100)
        errors.name = 'Nama merchan paling banyak 100 karakter.';
    const percents: Record<string, string> = {};
    for (const { field, column } of percentFields) {
        const value = decimalText(data?.[field] ?? 0, 2, '0', '100');
        if (value === null)
            errors[field] =
                'Isi persen 0 sampai 100, paling banyak dua angka di belakang koma.';
        else percents[column] = value;
    }
    if (Object.keys(errors).length || !data) validation(errors);
    return {
        kode: code,
        nama: name,
        ...percents,
        aktif: data.is_active ?? true,
    };
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('merchan_kode_unique')
    )
        validation({ code: 'Kode ini sudah dipakai merchan lain.' });
}

export class Merchants {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Dibaca sesudah izin diperiksa, supaya anggota tanpa izin mendapat 403, bukan permintaan memilih legal entity.
    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    // `active=1` hanya merchan yang aktif.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('merchant', 'read');
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${parameters.get('active') === '1' ? ' and is_active' : ''}`,
            bindings: [this.scope.tenantId, this.scope.legalEntityId],
            parameters,
            columns: { code: 'code', name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => merchantRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has('core.merchant.update'),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  merchantRowSchema,
                  `${rowSql} and merchants.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('merchant', 'update');
        const data = checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('merchan', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                ...data,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('merchant', 'update');
        const current = await this.row(id);
        const data = checked(body);
        let updated = 0;
        try {
            const columns = Object.entries(data);
            updated = await this.db.execute(
                `update merchan
                 set ${columns.map(([column], index) => `${column} = $${index + 1}`).join(', ')},
                     updated_at = $${columns.length + 1}
                 where tenant_id = $${columns.length + 2} and legal_entity_id = $${columns.length + 3}
                   and id = $${columns.length + 4} and version = $${columns.length + 5} and deleted_at is null`,
                [
                    ...columns.map(([, value]) => value),
                    nowSql(),
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('merchant', 'update');
        const current = await this.row(id);
        if (
            await isReferenced(this.db, 'merchan', {
                tenantId: this.scope.tenantId,
                id: current.id,
            })
        )
            validation({
                _form: 'Merchan ini sudah dipakai, jadi tidak bisa dihapus. Nonaktifkan saja supaya tidak dipilih lagi.',
            });
        const deleted = await this.db.execute(
            `update merchan set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and legal_entity_id = $3 and id = $4 and version = $5 and deleted_at is null`,
            [
                nowSql(),
                this.scope.tenantId,
                this.scope.legalEntityId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
