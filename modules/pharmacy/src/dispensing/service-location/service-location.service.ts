import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Bind,
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
    lookupRowSchema,
    sectionRowSchema,
    serviceLocationInputSchema,
    serviceLocationRowSchema,
} from './service-location.schema.ts';

// Section yang dikenal farmasi: section asal resep yang sudah diterima, dengan nama dari resep terbarunya. Module ini
// tidak membaca tabel section layanan kesehatan.
const knownSectionsSql = `select distinct on (r.section_id, r.operating_unit_id) r.section_id as id,
                                 r.nama_section as name, r.operating_unit_id, u.name as operating_unit_name
                          from far_tr_resep r
                          join organizations u on u.tenant_id = r.tenant_id and u.id = r.operating_unit_id
                          where r.tenant_id = $1 and r.legal_entity_id = $2 and r.deleted_at is null
                          order by r.section_id, r.operating_unit_id, r.diterima_pada desc`;

const rowSql = `select * from (
                    select m.id, m.version, u.name as operating_unit_name, l.kode as location_code,
                           coalesce(s.name, '') as section_name,
                           json_build_object('id', u.id, 'name', u.name) as operating_unit,
                           case when m.section_id is null then null
                                else json_build_object('id', m.section_id, 'name', coalesce(s.name, '')) end as section,
                           json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location
                    from far_m_lokasi_layanan m
                    join organizations u on u.tenant_id = m.tenant_id and u.id = m.operating_unit_id
                    join gd_m_lokasi l on l.tenant_id = m.tenant_id and l.id = m.lokasi_id
                    left join (${knownSectionsSql}) s on s.id = m.section_id and s.operating_unit_id = m.operating_unit_id
                    where m.tenant_id = $1 and m.legal_entity_id = $2 and m.deleted_at is null) service_locations
                where true`;

const messages = {
    operating_unit_id: 'Pilih operating unit dari daftar.',
    section_id: 'Pilih section dari daftar.',
    location_id: 'Pilih lokasi dari daftar.',
};

// Lokasi stok mana yang melayani resep dari satu operating unit, dan dari section tertentu di unit itu. Dipakai antrean
// dan penyerahan lewat servingLocationSql; tidak ada section atau lokasi yang ditulis di kode.
export class ServiceLocations {
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

    // Pilihan lokasi dibaca layar setelan ini dan layar antrean resep.
    private guardLookup() {
        if (
            !this.workspace.permissions.has('pharmacy.service-location.read') &&
            !this.workspace.permissions.has('pharmacy.prescription.read')
        )
            abort(403, 'Tidak diizinkan.');
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('service-location', 'read');
        const scope = this.scope;
        const batch = await incrementalList(this.db, {
            query: rowSql,
            bindings: [scope.tenantId, scope.legalEntityId],
            parameters,
            columns: {
                operating_unit: 'operating_unit_name',
                section: 'section_name',
                location: 'location_code',
            },
            searchColumns: [
                'operating_unit_name',
                'section_name',
                'location_code',
                "location->>'name'",
            ],
            numericColumns: [],
            defaultSort: 'operating_unit',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => serviceLocationRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'pharmacy.service-location.update',
            ),
        };
    }

    async locations(parameters: URLSearchParams) {
        this.guardLookup();
        const scope = this.scope;
        const batch = await incrementalList(this.db, {
            query: `select * from (select id, kode as code, nama as name from gd_m_lokasi
                                   where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null
                                     and not transit) locations where true`,
            bindings: [scope.tenantId, scope.legalEntityId],
            parameters,
            columns: { code: 'code' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => lookupRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    async operatingUnits(parameters: URLSearchParams) {
        this.workspace.guard('service-location', 'read');
        const batch = await incrementalList(this.db, {
            query: `select * from (select o.id, coalesce(u.number, '') as code, o.name from organizations o
                                   left join operating_units u on u.tenant_id = o.tenant_id and u.organization_id = o.id
                                   where o.tenant_id = $1 and o.classification = 'operating_unit'
                                     and o.status = 'active') units where true`,
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => lookupRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    async sections(parameters: URLSearchParams) {
        this.workspace.guard('service-location', 'read');
        const scope = this.scope;
        const bindings: Bind[] = [scope.tenantId, scope.legalEntityId];
        const unit = lookupId(parameters.get('operating_unit_id') ?? '');
        const batch = await incrementalList(this.db, {
            query: `select * from (${knownSectionsSql}) sections
                    where ${unit ? `operating_unit_id = $${bindings.push(unit)}` : 'true'}`,
            bindings,
            parameters,
            columns: { name: 'name' },
            searchColumns: ['name', 'operating_unit_name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => sectionRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const scope = this.scope;
        const found = lookupId(id)
            ? await this.db.one(
                  serviceLocationRowSchema,
                  `${rowSql} and service_locations.id = $3`,
                  [scope.tenantId, scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async checked(body: unknown) {
        const data = parseInput(serviceLocationInputSchema, body, messages);
        const scope = this.scope;
        const errors: Record<string, string> = {};
        const unit = lookupId(data.operating_unit_id)
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  `select id from organizations
                   where tenant_id = $1 and id = $2 and classification = 'operating_unit' and status = 'active'`,
                  [scope.tenantId, data.operating_unit_id],
              )
            : undefined;
        if (!unit) errors.operating_unit_id = messages.operating_unit_id;
        const sectionId = data.section_id || null;
        if (
            sectionId !== null &&
            !(
                lookupId(sectionId) &&
                (await this.db.one(
                    z.object({ id: z.string() }),
                    `select section_id as id from far_tr_resep
                     where tenant_id = $1 and legal_entity_id = $2 and section_id = $3 and operating_unit_id = $4
                     limit 1`,
                    [
                        scope.tenantId,
                        scope.legalEntityId,
                        sectionId,
                        lookupId(data.operating_unit_id),
                    ],
                ))
            )
        )
            errors.section_id =
                'Pilih section dari daftar. Section dikenal dari resep unit ini yang sudah diterima farmasi.';
        const location = lookupId(data.location_id)
            ? await this.db.one(
                  z.object({ id: z.string(), transit: z.boolean() }),
                  `select id, transit from gd_m_lokasi
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                  [scope.tenantId, scope.legalEntityId, data.location_id],
              )
            : undefined;
        if (!location) errors.location_id = messages.location_id;
        else if (location.transit)
            errors.location_id =
                'Pilih lokasi yang bukan lokasi transit. Lokasi transit hanya dipakai mutasi.';
        if (Object.keys(errors).length) validation(errors);
        return {
            operatingUnitId: data.operating_unit_id,
            sectionId,
            locationId: data.location_id,
        };
    }

    private taken(error: unknown, sectionId: string | null): never {
        if (
            sqlErrorCode(error) === '23505' &&
            error instanceof Error &&
            error.message.includes('far_m_lokasi_layanan_unique')
        )
            validation(
                sectionId === null
                    ? {
                          operating_unit_id:
                              'Unit ini sudah punya lokasi bawaan. Ubah baris yang ada, atau pilih section.',
                      }
                    : {
                          section_id:
                              'Section ini sudah punya lokasi di unit yang sama. Ubah baris yang ada.',
                      },
            );
        throw error;
    }

    async create(body: unknown) {
        this.workspace.guard('service-location', 'update');
        const data = await this.checked(body);
        const scope = this.scope;
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('far_m_lokasi_layanan', {
                id,
                tenant_id: scope.tenantId,
                legal_entity_id: scope.legalEntityId,
                operating_unit_id: data.operatingUnitId,
                section_id: data.sectionId,
                lokasi_id: data.locationId,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            this.taken(error, data.sectionId);
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    // Unit dan section adalah identitas baris; yang berubah hanya lokasinya. Unit atau section lain berarti baris baru.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('service-location', 'update');
        const current = await this.row(id);
        const data = await this.checked({
            ...(typeof body === 'object' ? body : {}),
            operating_unit_id: current.operating_unit.id,
            section_id: current.section?.id ?? null,
        });
        const version = expectedVersion(request, body);
        const updated = await this.db.execute(
            `update far_m_lokasi_layanan set lokasi_id = $1, updated_at = $2
             where tenant_id = $3 and id = $4 and version = $5 and deleted_at is null`,
            [
                data.locationId,
                nowSql(),
                this.scope.tenantId,
                current.id,
                version,
            ],
        );
        if (!updated) coded(409, 'stale_version', staleMessage);
        return {
            status: 200,
            headers: {},
            body: { data: await this.row(current.id) },
        };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('service-location', 'update');
        const current = await this.row(id);
        const version = expectedVersion(request, body);
        const stamp = nowSql();
        const deleted = await this.db.execute(
            `update far_m_lokasi_layanan set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [stamp, this.scope.tenantId, current.id, version],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
