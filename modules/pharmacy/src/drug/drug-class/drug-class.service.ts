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
    drugClassInputSchema,
    drugClassRowSchema,
} from './drug-class.schema.ts';

const rowSql = `select * from (
                    select id, kode as code, nama as name, urutan as position, version
                    from far_m_golongan_obat
                    where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null) drug_classes
                where true`;

// Golongan obat (narkotika, psikotropika, obat keras, bebas terbatas, bebas) adalah data acuan per legal entity yang
// diisi migration module ini, bukan daftar di kode. Laporan narkotika dan psikotropika kelak membaca golongan ini.
export class DrugClasses {
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
        this.workspace.guard('drug', 'read');
        const scope = this.scope;
        const batch = await incrementalList(this.db, {
            query: rowSql,
            bindings: [scope.tenantId, scope.legalEntityId],
            parameters,
            columns: { position: 'position', code: 'code', name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: ['position'],
            defaultSort: 'position',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => drugClassRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has('pharmacy.drug.update'),
        };
    }

    private async row(id: string) {
        const scope = this.scope;
        const found = lookupId(id)
            ? await this.db.one(
                  drugClassRowSchema,
                  `${rowSql} and drug_classes.id = $3`,
                  [scope.tenantId, scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private checked(body: unknown) {
        const data = parseInput(drugClassInputSchema, body, {
            code: 'Isi kode golongan obat.',
            name: 'Isi nama golongan obat.',
        });
        const code = data.code.trim().toUpperCase();
        const name = data.name.trim();
        const errors: Record<string, string> = {};
        if (!code) errors.code = 'Isi kode golongan obat.';
        else if (code.length > 20)
            errors.code = 'Kode golongan obat paling banyak 20 karakter.';
        if (!name) errors.name = 'Isi nama golongan obat.';
        else if (name.length > 100)
            errors.name = 'Nama golongan obat paling banyak 100 karakter.';
        if (Object.keys(errors).length) validation(errors);
        return { code, name };
    }

    private taken(error: unknown): never {
        if (
            sqlErrorCode(error) === '23505' &&
            error instanceof Error &&
            error.message.includes('far_m_golongan_obat_kode_unique')
        )
            validation({ code: 'Kode ini sudah dipakai golongan obat lain.' });
        throw error;
    }

    async create(body: unknown) {
        this.workspace.guard('drug', 'update');
        const data = this.checked(body);
        const scope = this.scope;
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.execute(
                `insert into far_m_golongan_obat (id, tenant_id, legal_entity_id, kode, nama, urutan, created_at,
                                                  updated_at)
                 select $1, $2, $3, $4, $5, coalesce(max(urutan), 0) + 1, $6, $6 from far_m_golongan_obat
                 where tenant_id = $2 and legal_entity_id = $3`,
                [
                    id,
                    scope.tenantId,
                    scope.legalEntityId,
                    data.code,
                    data.name,
                    stamp,
                ],
            );
        } catch (error) {
            this.taken(error);
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('drug', 'update');
        const current = await this.row(id);
        const data = this.checked(body);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update far_m_golongan_obat set kode = $1, nama = $2, updated_at = $3
                 where tenant_id = $4 and id = $5 and version = $6 and deleted_at is null`,
                [
                    data.code,
                    data.name,
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

    // Golongan yang masih dipakai data obat tidak dihapus, supaya obat itu tidak kehilangan golongannya diam-diam.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('drug', 'update');
        const current = await this.row(id);
        const version = expectedVersion(request, body);
        const used = await this.db.one(
            z.object({ found: z.number() }),
            `select 1 as found from far_m_obat
             where tenant_id = $1 and golongan_obat_id = $2 and deleted_at is null limit 1`,
            [this.scope.tenantId, current.id],
        );
        if (used)
            validation({
                _form: 'Golongan ini masih dipakai data obat. Ganti golongan obat-obat itu dulu.',
            });
        const stamp = nowSql();
        const deleted = await this.db.execute(
            `update far_m_golongan_obat set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [stamp, this.scope.tenantId, current.id, version],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
