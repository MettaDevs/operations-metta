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
import { roomInputSchema, roomRowSchema } from './room.schema.ts';

const rowSql = `select * from (
                    select r.id, r.operating_unit_id, o.name as operating_unit_name, r.kode as code, r.lantai as floor,
                           r.nama as name, r.nama_tampilan as display_name, r.urutan as sort_order,
                           r.aktif as is_active, r.version
                    from sim_m_ruangan r
                    join organizations o on o.tenant_id = r.tenant_id and o.id = r.operating_unit_id
                    where r.tenant_id = $1 and r.deleted_at is null) rooms
                where true`;

// Operating unit aktif tenant, pilihan unit section dan ruangan. Module membacanya langsung dari tabel Core, karena
// daftar Core dijaga izin organisasi yang tidak dipegang admin layanan.
export async function operatingUnits(db: Database, tenantId: string) {
    return db.rows(
        z.object({ id: z.string(), name: z.string() }),
        `select o.id, o.name from organizations o
         join operating_units u on u.organization_id = o.id and u.tenant_id = o.tenant_id
         where o.tenant_id = $1 and o.status = 'active' order by o.name`,
        [tenantId],
    );
}

export async function activeOperatingUnit(
    db: Database,
    tenantId: string,
    id: string,
): Promise<string> {
    const found = lookupId(id)
        ? await db.one(
              z.object({ id: z.string() }),
              `select o.id from organizations o
               join operating_units u on u.organization_id = o.id and u.tenant_id = o.tenant_id
               where o.tenant_id = $1 and o.id = $2 and o.status = 'active'`,
              [tenantId, id],
          )
        : undefined;
    if (!found) validation({ operating_unit_id: 'Pilih unit dari daftar.' });
    return found.id;
}

const optional = (value: string | null | undefined) => value?.trim() || null;

function checked(body: unknown) {
    const parsed = roomInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim() ?? '';
    const name = data?.name.trim() ?? '';
    const floor = optional(data?.floor);
    const displayName = optional(data?.display_name);
    if (!code) errors.code = 'Isi kode ruangan.';
    else if (code.length > 20) errors.code = 'Paling panjang 20 karakter.';
    if (!name) errors.name = 'Isi nama ruangan.';
    else if (name.length > 100) errors.name = 'Paling panjang 100 karakter.';
    if (floor && floor.length > 50)
        errors.floor = 'Paling panjang 50 karakter.';
    if (displayName && displayName.length > 100)
        errors.display_name = 'Paling panjang 100 karakter.';
    if (Object.keys(errors).length || !data) validation(errors);
    return {
        operatingUnitId: data.operating_unit_id,
        code,
        floor,
        name,
        displayName,
        sortOrder: data.sort_order ?? 0,
        isActive: data.is_active ?? true,
    };
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_ruangan_kode_unique')
    )
        validation({
            code: 'Kode ini sudah dipakai ruangan lain di unit yang sama.',
        });
}

// Ruangan milik tenant, diisi admin di Setup. Seperti section, bukan data yang dibatasi per unit.
export class Rooms {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async metadata() {
        this.workspace.guard('room', 'read');
        return {
            operating_units: await operatingUnits(
                this.db,
                this.workspace.tenantId,
            ),
            permissions: {
                create: this.workspace.permissions.has(
                    'healthcare.room.create',
                ),
                update: this.workspace.permissions.has(
                    'healthcare.room.update',
                ),
                delete: this.workspace.permissions.has(
                    'healthcare.room.delete',
                ),
            },
        };
    }

    // Daftar bertahap. Saring per unit (`operating_unit_id`) dan status (`active`/`inactive`).
    async list(parameters: URLSearchParams) {
        this.workspace.guard('room', 'read');
        const bindings: (string | boolean)[] = [this.workspace.tenantId];
        const bind = (value: string | boolean) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const filters: string[] = [];
        const unit = lookupId(parameters.get('operating_unit_id') ?? '');
        if (unit) filters.push(`operating_unit_id = ${bind(unit)}`);
        const status = parameters.get('status');
        if (status === 'active' || status === 'inactive')
            filters.push(`is_active = ${bind(status === 'active')}`);
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filters.map((filter) => ` and ${filter}`).join('')}`,
            bindings,
            parameters,
            columns: {
                code: 'code',
                name: 'name',
                operating_unit_name: 'operating_unit_name',
                sort_order: 'sort_order',
            },
            searchColumns: ['code', 'name', 'floor', 'display_name'],
            numericColumns: ['sort_order'],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => roomRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(roomRowSchema, `${rowSql} and rooms.id = $2`, [
                  this.workspace.tenantId,
                  id,
              ])
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('room', 'create');
        const data = checked(body);
        const operatingUnitId = await activeOperatingUnit(
            this.db,
            this.workspace.tenantId,
            data.operatingUnitId,
        );
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('sim_m_ruangan', {
                id,
                tenant_id: this.workspace.tenantId,
                operating_unit_id: operatingUnitId,
                kode: data.code,
                lantai: data.floor,
                nama: data.name,
                nama_tampilan: data.displayName,
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

    // Unit ruangan tidak berubah selama section masih memakainya, karena section dan ruangannya harus satu unit.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('room', 'update');
        const current = await this.row(id);
        const data = checked(body);
        let operatingUnitId = current.operating_unit_id;
        if (data.operatingUnitId !== current.operating_unit_id) {
            operatingUnitId = await activeOperatingUnit(
                this.db,
                this.workspace.tenantId,
                data.operatingUnitId,
            );
            const [used] = await this.db.rows(
                z.object({ id: z.string() }),
                'select id from sim_m_section_ruangan where tenant_id = $1 and ruangan_id = $2 and deleted_at is null limit 1',
                [this.workspace.tenantId, current.id],
            );
            if (used)
                validation({
                    operating_unit_id:
                        'Ruangan ini masih dipakai section di unitnya. Lepaskan dari section itu dulu.',
                });
        }
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update sim_m_ruangan set operating_unit_id = $1, kode = $2, lantai = $3, nama = $4, nama_tampilan = $5,
                        urutan = $6, aktif = $7, updated_at = $8
                 where tenant_id = $9 and id = $10 and version = $11 and deleted_at is null`,
                [
                    operatingUnitId,
                    data.code,
                    data.floor,
                    data.name,
                    data.displayName,
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

    // Ruangan yang dihapus ikut lepas dari section yang memakainya.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('room', 'delete');
        const current = await this.row(id);
        const stamp = nowSql();
        let deleted = 0;
        await this.db.transaction(async () => {
            deleted = await this.db.execute(
                'update sim_m_ruangan set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
                [
                    stamp,
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
            if (deleted)
                await this.db.execute(
                    'update sim_m_section_ruangan set deleted_at = $1, updated_at = $1 where tenant_id = $2 and ruangan_id = $3 and deleted_at is null',
                    [stamp, this.workspace.tenantId, current.id],
                );
        });
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
