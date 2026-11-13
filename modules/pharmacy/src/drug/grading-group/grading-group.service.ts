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
import {
    activeLegalEntity,
    parseInput,
} from '@core/foundation/inventory/index.ts';
import {
    gradingGroupInputSchema,
    gradingGroupRowSchema,
} from './grading-group.schema.ts';

const rowSql = `select * from (
                    select id, nama as name, aktif as is_active, version
                    from far_m_kelompok_grading
                    where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null) grading_groups
                where true`;

// Kelompok grading per legal entity. Yang nonaktif tidak bisa dipilih lagi di data obat dan grading harga, tetapi obat
// dan baris grading yang sudah memegangnya tetap berlaku.
export class GradingGroups {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('drug-price', 'read');
        const scope = this.scope;
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${parameters.get('active') === '1' ? ' and is_active' : ''}`,
            bindings: [scope.tenantId, scope.legalEntityId],
            parameters,
            columns: { name: 'name' },
            searchColumns: ['name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => gradingGroupRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'pharmacy.drug-price.update',
            ),
        };
    }

    private async row(id: string) {
        const scope = this.scope;
        const found = lookupId(id)
            ? await this.db.one(
                  gradingGroupRowSchema,
                  `${rowSql} and grading_groups.id = $3`,
                  [scope.tenantId, scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private checked(body: unknown) {
        const data = parseInput(gradingGroupInputSchema, body, {
            name: 'Isi nama kelompok grading.',
            is_active: 'Pilih aktif atau tidak.',
        });
        const name = data.name.trim();
        if (!name) validation({ name: 'Isi nama kelompok grading.' });
        if (name.length > 100)
            validation({
                name: 'Nama kelompok grading paling banyak 100 karakter.',
            });
        return { name, isActive: data.is_active ?? true };
    }

    private taken(error: unknown): never {
        if (
            sqlErrorCode(error) === '23505' &&
            error instanceof Error &&
            error.message.includes('far_m_kelompok_grading_nama_unique')
        )
            validation({
                name: 'Nama ini sudah dipakai kelompok grading lain.',
            });
        throw error;
    }

    async create(body: unknown) {
        this.workspace.guard('drug-price', 'update');
        const data = this.checked(body);
        const scope = this.scope;
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('far_m_kelompok_grading', {
                id,
                tenant_id: scope.tenantId,
                legal_entity_id: scope.legalEntityId,
                nama: data.name,
                aktif: data.isActive,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            this.taken(error);
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('drug-price', 'update');
        const current = await this.row(id);
        const data = this.checked(body);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update far_m_kelompok_grading set nama = $1, aktif = $2, updated_at = $3
                 where tenant_id = $4 and id = $5 and version = $6 and deleted_at is null`,
                [
                    data.name,
                    data.isActive,
                    nowSql(),
                    this.scope.tenantId,
                    current.id,
                    version,
                ],
            );
        } catch (error) {
            this.taken(error);
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return {
            status: 200,
            headers: {},
            body: { data: await this.row(current.id) },
        };
    }

    // Kelompok yang masih dipegang data obat atau baris grading tidak dihapus, supaya harga obat itu tidak berubah
    // diam-diam.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('drug-price', 'update');
        const current = await this.row(id);
        const version = expectedVersion(request, body);
        const used = await this.db.one(
            z.object({ found: z.number() }),
            `select 1 as found from far_m_obat
             where tenant_id = $1 and kelompok_grading_id = $2 and deleted_at is null
             union all
             select 1 from far_m_grading_harga
             where tenant_id = $1 and kelompok_grading_id = $2 and deleted_at is null
             limit 1`,
            [this.scope.tenantId, current.id],
        );
        if (used)
            validation({
                _form: 'Kelompok ini masih dipakai data obat atau grading harga, jadi tidak bisa dihapus. Nonaktifkan saja supaya tidak dipilih lagi.',
            });
        const deleted = await this.db.execute(
            `update far_m_kelompok_grading set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [nowSql(), this.scope.tenantId, current.id, version],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
