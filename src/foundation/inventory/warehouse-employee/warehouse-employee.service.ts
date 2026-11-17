import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import {
    activeLegalEntity,
    parseInput,
    violates,
} from '../inventory.service.ts';
import {
    employeeUserRowSchema,
    warehouseEmployeeInputSchema,
    warehouseEmployeeRowSchema,
} from './warehouse-employee.schema.ts';

// Petugas lokasi (Warehouse Employees di BC): pengguna tenant yang ditugaskan ke lokasi stok legal entity aktif.
// Dikelola pemegang izin lokasi stok.

const rowSql = `select * from (
                    select p.id, p.bawaan as is_default, p.version, p.lokasi_id as location_id,
                           l.kode as location_code, l.nama as location_name, u.name as user_name,
                           u.email as user_email,
                           json_build_object('id', l.id, 'code', l.kode, 'name', l.nama,
                                             'restricted_to_employees', l.khusus_petugas) as location,
                           json_build_object('id', u.id, 'name', u.name, 'email', u.email) as "user"
                    from gd_m_petugas_lokasi p
                    join gd_m_lokasi l on l.tenant_id = p.tenant_id and l.id = p.lokasi_id and l.deleted_at is null
                    join users u on u.id = p.user_id
                    where p.tenant_id = $1 and p.legal_entity_id = $2 and p.deleted_at is null) employees
                where true`;

const locationSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    restricted_to_employees: z.boolean(),
});

function assigned(error: unknown): void {
    if (violates(error, 'gd_m_petugas_lokasi_unique'))
        validation({ user_id: 'Pengguna ini sudah petugas lokasi itu.' });
}

export class WarehouseEmployees {
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

    private async location(id: string) {
        return lookupId(id)
            ? this.db.one(
                  locationSchema,
                  `select id, kode as code, nama as name, khusus_petugas as restricted_to_employees
                   from gd_m_lokasi
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('inventory-location', 'read');
        const bindings: string[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        let filter = '';
        const locationId = parameters.get('location_id') ?? '';
        const location = locationId ? await this.location(locationId) : null;
        if (locationId && !location) abort(404, 'Not Found');
        if (location)
            filter += ` and location_id = $${bindings.push(location.id)}`;
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                location: 'location_code',
                user: 'user_name',
                is_default: 'is_default',
            },
            searchColumns: [
                'location_code',
                'location_name',
                'user_name',
                'user_email',
            ],
            numericColumns: [],
            defaultSort: 'location',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) =>
                warehouseEmployeeRowSchema.parse(row),
            ),
            next_cursor: batch.next_cursor,
            location: location ?? null,
            can_manage: this.workspace.permissions.has(
                'core.inventory-location.update',
            ),
        };
    }

    // Pilihan pengguna: anggota aktif tenant ini.
    async users(parameters: URLSearchParams) {
        this.workspace.guard('inventory-location', 'read');
        const batch = await incrementalList(this.db, {
            query: `select * from (
                        select u.id, u.name, u.email from users u
                        join tenant_memberships m on m.user_id = u.id
                        where m.tenant_id = $1 and m.status = 'active'
                    ) users where true`,
            bindings: [this.scope.tenantId],
            parameters,
            columns: { name: 'name', email: 'email' },
            searchColumns: ['name', 'email'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => employeeUserRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  warehouseEmployeeRowSchema,
                  `${rowSql} and employees.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async checked(body: unknown) {
        const data = parseInput(warehouseEmployeeInputSchema, body, {
            location_id: 'Pilih lokasi dari daftar.',
            user_id: 'Pilih pengguna dari daftar.',
        });
        const errors: Record<string, string> = {};
        const location = await this.location(data.location_id);
        if (!location) errors.location_id = 'Pilih lokasi dari daftar.';
        const user = lookupId(data.user_id)
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  `select u.id from users u
                   join tenant_memberships m on m.user_id = u.id
                   where m.tenant_id = $1 and u.id = $2 and m.status = 'active'`,
                  [this.scope.tenantId, data.user_id],
              )
            : undefined;
        if (!user) errors.user_id = 'Pilih pengguna dari daftar.';
        if (!location || !user) validation(errors);
        return {
            locationId: location.id,
            userId: user.id,
            isDefault: data.is_default ?? false,
        };
    }

    // Satu lokasi bawaan per pengguna per legal entity: menandai bawaan yang baru melepas tanda pada baris lain.
    private async releaseDefault(userId: string, keep: string) {
        await this.db.execute(
            `update gd_m_petugas_lokasi set bawaan = false, updated_at = $1
             where tenant_id = $2 and legal_entity_id = $3 and user_id = $4 and bawaan and id <> $5
               and deleted_at is null`,
            [
                nowSql(),
                this.scope.tenantId,
                this.scope.legalEntityId,
                userId,
                keep,
            ],
        );
    }

    async create(body: unknown) {
        this.workspace.guard('inventory-location', 'update');
        const data = await this.checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.transaction(async () => {
                if (data.isDefault) await this.releaseDefault(data.userId, id);
                await this.db.insert('gd_m_petugas_lokasi', {
                    id,
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    lokasi_id: data.locationId,
                    user_id: data.userId,
                    bawaan: data.isDefault,
                    created_at: stamp,
                    updated_at: stamp,
                });
            });
        } catch (error) {
            assigned(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-location', 'update');
        const current = await this.row(id);
        const data = await this.checked(body);
        let updated = 0;
        try {
            updated = await this.db.transaction(async () => {
                if (data.isDefault)
                    await this.releaseDefault(data.userId, current.id);
                return this.db.execute(
                    `update gd_m_petugas_lokasi set lokasi_id = $1, user_id = $2, bawaan = $3, updated_at = $4
                     where tenant_id = $5 and id = $6 and version = $7 and deleted_at is null`,
                    [
                        data.locationId,
                        data.userId,
                        data.isDefault,
                        nowSql(),
                        this.scope.tenantId,
                        current.id,
                        expectedVersion(request, body),
                    ],
                );
            });
        } catch (error) {
            assigned(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-location', 'update');
        const current = await this.row(id);
        const deleted = await this.db.execute(
            `update gd_m_petugas_lokasi set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [
                nowSql(),
                this.scope.tenantId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
