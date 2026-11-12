import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import { clusterInputSchema, clusterRowSchema } from './cluster.schema.ts';

const rowSql = `select * from (
                    select k.id, k.kode as code, k.nama as name, k.urutan as sort_order, k.aktif as is_active, k.version
                    from sim_m_klaster k
                    where k.tenant_id = $1 and k.deleted_at is null) clusters
                where true`;

function checked(body: unknown) {
    const parsed = clusterInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim() ?? '';
    const name = data?.name.trim() ?? '';
    const sortOrder = data?.sort_order ?? 0;
    if (!code) errors.code = 'Isi kode klaster.';
    else if (code.length > 10) errors.code = 'Paling panjang 10 karakter.';
    if (!name) errors.name = 'Isi nama klaster.';
    else if (name.length > 150) errors.name = 'Paling panjang 150 karakter.';
    if (sortOrder < 0 || sortOrder > 999)
        errors.sort_order = 'Isi angka 0 sampai 999.';
    if (Object.keys(errors).length || !data) validation(errors);
    return { code, name, sortOrder, isActive: data.is_active ?? true };
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_klaster_kode_unique')
    )
        validation({ code: 'Kode ini sudah dipakai klaster lain.' });
}

// Klaster ILP milik tenant, diisi admin di Setup. Bawaannya lima klaster Kemenkes dari migration.
export class Clusters {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    metadata() {
        this.workspace.guard('cluster', 'read');
        return {
            permissions: {
                create: this.workspace.permissions.has(
                    'healthcare.cluster.create',
                ),
                update: this.workspace.permissions.has(
                    'healthcare.cluster.update',
                ),
                delete: this.workspace.permissions.has(
                    'healthcare.cluster.delete',
                ),
            },
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('cluster', 'read');
        const bindings: (string | boolean)[] = [this.workspace.tenantId];
        const status = parameters.get('status');
        const filter =
            status === 'active' || status === 'inactive'
                ? ` and is_active = $${bindings.push(status === 'active')}`
                : '';
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: { sort_order: 'sort_order', code: 'code', name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: ['sort_order'],
            defaultSort: 'sort_order',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => clusterRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  clusterRowSchema,
                  `${rowSql} and clusters.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('cluster', 'create');
        const data = checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('sim_m_klaster', {
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
        this.workspace.guard('cluster', 'update');
        const current = await this.row(id);
        const data = checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update sim_m_klaster set kode = $1, nama = $2, urutan = $3, aktif = $4, updated_at = $5
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

    // Klaster yang masih dipakai siklus hidup atau section tidak bisa dihapus. Melepasnya diam-diam dari section akan
    // membuat section itu melayani semua klaster.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('cluster', 'delete');
        const current = await this.row(id);
        const used = await this.db.one(
            z.object({ life_cycle: z.boolean(), section: z.boolean() }),
            `select exists (select 1 from sim_m_siklus_hidup
                            where tenant_id = $1 and klaster_id = $2 and deleted_at is null) as life_cycle,
                    exists (select 1 from sim_m_section_klaster l
                            join sim_m_section s on s.tenant_id = l.tenant_id and s.id = l.section_id
                                                and s.deleted_at is null
                            where l.tenant_id = $1 and l.klaster_id = $2 and l.deleted_at is null) as section`,
            [this.workspace.tenantId, current.id],
        );
        if (used?.life_cycle)
            validation({
                id: 'Klaster ini masih dipakai siklus hidup. Pindahkan atau hapus siklus hidupnya lebih dulu.',
            });
        if (used?.section)
            validation({
                id: 'Klaster ini masih dipilih di section. Lepaskan dari section lebih dulu.',
            });
        const deleted = await this.db.execute(
            'update sim_m_klaster set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
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
