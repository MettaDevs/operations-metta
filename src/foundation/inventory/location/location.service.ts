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
    codeAndName,
    codeAndNameMessages,
    inUse,
    parseInput,
    violates,
} from '../inventory.service.ts';
import {
    locationInputSchema,
    locationRowSchema,
    operatingUnitRowSchema,
} from './location.schema.ts';

const rowSql = `select * from (
                    select l.id, l.kode as code, l.nama as name, l.transit as is_transit,
                           l.metode_pengambilan as picking_method, l.cara_mutasi as transfer_mode, l.version,
                           l.operating_unit_id, o.name as operating_unit_name,
                           json_build_object('id', o.id, 'name', o.name) as operating_unit
                    from gd_m_lokasi l
                    join organizations o on o.tenant_id = l.tenant_id and o.id = l.operating_unit_id
                    where l.tenant_id = $1 and l.legal_entity_id = $2 and l.deleted_at is null) locations
                where true`;

function codeTaken(error: unknown): void {
    if (violates(error, 'gd_m_lokasi_kode_unique'))
        validation({ code: 'Kode ini sudah dipakai lokasi lain.' });
}

export class Locations {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(parameters: URLSearchParams) {
        this.workspace.guard('inventory-location', 'read');
        const bindings: string[] = [
            this.workspace.tenantId,
            activeLegalEntity(this.workspace),
        ];
        let filter = '';
        const unit = lookupId(parameters.get('operating_unit_id') ?? '');
        if (unit) filter += ` and operating_unit_id = $${bindings.push(unit)}`;
        const transit = parameters.get('transit');
        if (transit === 'true' || transit === 'false')
            filter += ` and is_transit = ${transit}`;
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                code: 'code',
                name: 'name',
                operating_unit: 'operating_unit_name',
            },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => locationRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.inventory-location.update',
            ),
        };
    }

    // Pilihan operating unit di kartu lokasi: operating unit aktif tenant ini, sama dengan yang diterima saat menyimpan.
    async operatingUnits(parameters: URLSearchParams) {
        this.workspace.guard('inventory-location', 'read');
        const batch = await incrementalList(this.db, {
            query: `select * from (
                        select o.id, o.name, u.number
                        from organizations o
                        left join operating_units u on u.tenant_id = o.tenant_id and u.organization_id = o.id
                        where o.tenant_id = $1 and o.classification = 'operating_unit' and o.status = 'active'
                    ) units where true`,
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { name: 'name', number: 'number' },
            searchColumns: ['name', 'number'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => operatingUnitRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  locationRowSchema,
                  `${rowSql} and locations.id = $3`,
                  [
                      this.workspace.tenantId,
                      activeLegalEntity(this.workspace),
                      id,
                  ],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async checked(body: unknown) {
        const data = parseInput(locationInputSchema, body, {
            ...codeAndNameMessages('lokasi'),
            operating_unit_id: 'Pilih operating unit dari daftar.',
            picking_method:
                'Pilih cara pengambilan: FEFO, FIFO, atau pilih batch manual.',
            transfer_mode:
                'Pilih cara mutasi: langsung, atau kirim lalu terima.',
        });
        const errors: Record<string, string> = {};
        const { code, name } = codeAndName(data, errors, 'lokasi', {
            code: 20,
            name: 150,
        });
        const unitId = data.operating_unit_id;
        const unit = lookupId(unitId)
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  `select id from organizations
                   where tenant_id = $1 and id = $2 and classification = 'operating_unit' and status = 'active'`,
                  [this.workspace.tenantId, unitId],
              )
            : undefined;
        if (!unit)
            errors.operating_unit_id = 'Pilih operating unit dari daftar.';
        if (Object.keys(errors).length || !unit) validation(errors);
        return {
            code,
            name,
            operatingUnitId: unit.id,
            isTransit: data.is_transit ?? false,
            picking: data.picking_method ?? null,
            transferMode: data.transfer_mode ?? null,
        };
    }

    async create(body: unknown) {
        this.workspace.guard('inventory-location', 'update');
        const legalEntityId = activeLegalEntity(this.workspace);
        const data = await this.checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('gd_m_lokasi', {
                id,
                tenant_id: this.workspace.tenantId,
                legal_entity_id: legalEntityId,
                operating_unit_id: data.operatingUnitId,
                kode: data.code,
                nama: data.name,
                transit: data.isTransit,
                metode_pengambilan: data.picking,
                cara_mutasi: data.transferMode,
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
        this.workspace.guard('inventory-location', 'update');
        const current = await this.row(id);
        const data = await this.checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update gd_m_lokasi set kode = $1, nama = $2, operating_unit_id = $3, transit = $4,
                        metode_pengambilan = $5, cara_mutasi = $6, updated_at = $7
                 where tenant_id = $8 and id = $9 and version = $10 and deleted_at is null`,
                [
                    data.code,
                    data.name,
                    data.operatingUnitId,
                    data.isTransit,
                    data.picking,
                    data.transferMode,
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
        this.workspace.guard('inventory-location', 'update');
        const current = await this.row(id);
        await inUse(
            this.db,
            [
                {
                    sql: 'select 1 as found from gd_tr_kartu_gudang where tenant_id = $1 and lokasi_id = $2 limit 1',
                    message:
                        'Lokasi ini sudah punya gerak stok, jadi tidak bisa dihapus.',
                },
                {
                    sql: 'select 1 as found from gd_tr_penyesuaian where tenant_id = $1 and lokasi_id = $2 and deleted_at is null limit 1',
                    message:
                        'Lokasi ini dipakai dokumen penyesuaian, jadi tidak bisa dihapus.',
                },
            ],
            [this.workspace.tenantId, current.id],
        );
        const deleted = await this.db.execute(
            `update gd_m_lokasi set deleted_at = $1, updated_at = $1
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
