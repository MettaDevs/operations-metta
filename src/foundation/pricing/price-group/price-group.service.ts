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
    priceGroupInputSchema,
    priceGroupRowSchema,
} from './price-group.schema.ts';

const rowSql = `select * from (
                    select g.id, g.kode as code, g.nama as name, g.aktif as is_active, g.version
                    from kelompok_harga g where g.tenant_id = $1 and g.deleted_at is null) price_groups
                where true`;

// Kode pendek yang diketik pengguna, seperti field Code di BC: disimpan huruf besar tanpa spasi di ujungnya.
function checked(body: unknown) {
    const parsed = priceGroupInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim().toUpperCase() ?? '';
    const name = data?.name.trim() ?? '';
    if (!code) errors.code = 'Isi kode kelompok harga.';
    else if (code.length > 20)
        errors.code = 'Kode kelompok harga paling banyak 20 karakter.';
    if (!name) errors.name = 'Isi nama kelompok harga.';
    else if (name.length > 100)
        errors.name = 'Nama kelompok harga paling banyak 100 karakter.';
    if (Object.keys(errors).length || !data) validation(errors);
    return { code, name, isActive: data.is_active ?? true };
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('kelompok_harga_kode_unique')
    )
        validation({ code: 'Kode ini sudah dipakai kelompok harga lain.' });
}

// Kelompok harga milik tenant. Yang nonaktif tidak bisa dipilih lagi, tetapi tetap terbaca di data yang memakainya.
export class PriceGroups {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // `active=1` hanya kelompok yang aktif.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('price-group', 'read');
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${parameters.get('active') === '1' ? ' and is_active' : ''}`,
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { code: 'code', name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => priceGroupRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.price-group.update',
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  priceGroupRowSchema,
                  `${rowSql} and price_groups.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('price-group', 'update');
        const data = checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('kelompok_harga', {
                id,
                tenant_id: this.workspace.tenantId,
                kode: data.code,
                nama: data.name,
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
        this.workspace.guard('price-group', 'update');
        const current = await this.row(id);
        const data = checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update kelompok_harga set kode = $1, nama = $2, aktif = $3, updated_at = $4
                 where tenant_id = $5 and id = $6 and version = $7 and deleted_at is null`,
                [
                    data.code,
                    data.name,
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
        this.workspace.guard('price-group', 'update');
        const current = await this.row(id);
        await refuseWhileReferenced(
            this.db,
            'kelompok_harga',
            { tenantId: this.workspace.tenantId, id: current.id },
            'Kelompok harga ini masih dipakai, jadi tidak bisa dihapus. Nonaktifkan saja supaya tidak dipilih lagi.',
        );
        const deleted = await this.db.execute(
            `update kelompok_harga set deleted_at = $1, updated_at = $1
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
