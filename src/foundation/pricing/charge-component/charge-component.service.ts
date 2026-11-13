import type { Workspace } from '../../../platform/access/index.ts';
import {
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
import { refuseWhileReferenced } from '../pricing.service.ts';
import {
    chargeComponentInputSchema,
    chargeComponentRowSchema,
} from './charge-component.schema.ts';

const rowSql = `select * from (
                    select k.id, k.kode as code, k.nama as name, k.urutan as sort_order, k.aktif as is_active,
                           k.version
                    from komponen_biaya k where k.tenant_id = $1 and k.deleted_at is null) components
                where true`;

function checked(body: unknown) {
    const parsed = chargeComponentInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim().toUpperCase() ?? '';
    const name = data?.name.trim() ?? '';
    if (!code) errors.code = 'Isi kode komponen biaya.';
    else if (code.length > 20)
        errors.code = 'Kode komponen biaya paling banyak 20 karakter.';
    if (!name) errors.name = 'Isi nama komponen biaya.';
    else if (name.length > 100)
        errors.name = 'Nama komponen biaya paling banyak 100 karakter.';
    const raw = data?.sort_order;
    // Tanpa isian berarti 0; isian kosong dari layar ditolak, karena Number('') bernilai 0.
    const sortOrder =
        raw === undefined ? 0 : String(raw).trim() ? Number(raw) : Number.NaN;
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999)
        errors.sort_order = 'Isi bilangan bulat 0 sampai 999.';
    if (Object.keys(errors).length || !data) validation(errors);
    return { code, name, sortOrder, isActive: data.is_active ?? true };
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('komponen_biaya_kode_unique')
    )
        validation({ code: 'Kode ini sudah dipakai komponen biaya lain.' });
}

// Komponen biaya milik tenant. Tenant lahir dengan satu komponen bawaan (0033), jadi tarif bisa langsung diisi.
export class ChargeComponents {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // `active=1` hanya komponen yang aktif.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('charge-component', 'read');
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${parameters.get('active') === '1' ? ' and is_active' : ''}`,
            bindings: [this.workspace.tenantId],
            parameters,
            columns: {
                sort_order: 'sort_order',
                code: 'code',
                name: 'name',
            },
            searchColumns: ['code', 'name'],
            numericColumns: ['sort_order'],
            defaultSort: 'sort_order',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => chargeComponentRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.charge-component.update',
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  chargeComponentRowSchema,
                  `${rowSql} and components.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('charge-component', 'update');
        const data = checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('komponen_biaya', {
                id,
                tenant_id: this.workspace.tenantId,
                kode: data.code,
                nama: data.name,
                urutan: data.sortOrder,
                aktif: data.isActive,
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
        this.workspace.guard('charge-component', 'update');
        const current = await this.row(id);
        const data = checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update komponen_biaya set kode = $1, nama = $2, urutan = $3, aktif = $4, updated_at = $5
                 where tenant_id = $6 and id = $7 and version = $8 and deleted_at is null`,
                [
                    data.code,
                    data.name,
                    data.sortOrder,
                    data.isActive,
                    nowSql(),
                    this.workspace.tenantId,
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
        this.workspace.guard('charge-component', 'update');
        const current = await this.row(id);
        await refuseWhileReferenced(
            this.db,
            'komponen_biaya',
            { tenantId: this.workspace.tenantId, id: current.id },
            'Komponen biaya ini sudah dipakai, jadi tidak bisa dihapus. Nonaktifkan saja supaya tidak dipakai di tarif baru.',
        );
        const deleted = await this.db.execute(
            `update komponen_biaya set deleted_at = $1, updated_at = $1
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
