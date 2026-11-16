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
    otcSaleLocationInputSchema,
    otcSaleLocationRowSchema,
    priceGroupRowSchema,
} from './otc-sale-location.schema.ts';

type Scope = { tenantId: string; legalEntityId: string };

const rowSql = `select * from (
                    select m.id, m.version, l.kode as location_code, coalesce(g.kode, '') as price_group_code,
                           json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
                           case when g.id is null then null
                                else json_build_object('id', g.id, 'code', g.kode, 'name', g.nama) end as price_group
                    from far_m_lokasi_penjualan m
                    join gd_m_lokasi l on l.tenant_id = m.tenant_id and l.id = m.lokasi_id
                    left join kelompok_harga g on g.tenant_id = m.tenant_id and g.id = m.kelompok_harga_id
                    where m.tenant_id = $1 and m.legal_entity_id = $2 and m.deleted_at is null
                      and l.deleted_at is null) otc_sale_locations
                where true`;

const saleLocationSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    operating_unit_id: z.string(),
    price_group: z
        .object({ id: z.string(), code: z.string(), name: z.string() })
        .nullable(),
});
export type SaleLocation = z.infer<typeof saleLocationSchema>;

// Lokasi yang boleh menjual obat bebas beserta kelompok harga bawaannya, untuk loket. Lokasi yang dihapus atau
// dijadikan transit sesudah diatur tidak lagi menjual.
export async function saleLocations(
    db: Database,
    scope: Scope,
    locationId?: string,
): Promise<SaleLocation[]> {
    return db.rows(
        saleLocationSchema,
        `select l.id, l.kode as code, l.nama as name, l.operating_unit_id,
                case when g.id is null then null
                     else json_build_object('id', g.id, 'code', g.kode, 'name', g.nama) end as price_group
         from far_m_lokasi_penjualan m
         join gd_m_lokasi l on l.tenant_id = m.tenant_id and l.id = m.lokasi_id
              and l.deleted_at is null and not l.transit
         left join kelompok_harga g on g.tenant_id = m.tenant_id and g.id = m.kelompok_harga_id
         where m.tenant_id = $1 and m.legal_entity_id = $2 and m.deleted_at is null
           and ($3::uuid is null or m.lokasi_id = $3::uuid)
         order by l.kode`,
        [scope.tenantId, scope.legalEntityId, locationId ?? null],
    );
}

// Kelompok harga aktif milik Core yang bisa dipilih. currentId tetap sah walau sudah nonaktif, supaya baris yang
// memegangnya bisa disimpan tanpa diganti.
export async function priceGroupAvailable(
    db: Database,
    tenantId: string,
    priceGroupId: string,
    currentId: string | null = null,
): Promise<boolean> {
    return (
        lookupId(priceGroupId) !== null &&
        (await db.one(
            z.object({ id: z.string() }),
            `select id from kelompok_harga
             where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3::uuid)`,
            [tenantId, priceGroupId, currentId],
        )) !== undefined
    );
}

const messages = {
    location_id: 'Pilih lokasi dari daftar.',
    price_group_id: 'Pilih kelompok harga dari daftar.',
};

// Setelan Lokasi penjualan obat bebas: lokasi stok mana yang boleh menjual obat bebas di loket, dan kelompok harga
// bawaannya. Lokasi adalah identitas baris; lokasi lain berarti baris baru.
export class OtcSaleLocations {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope(): Scope {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('otc-sale-location', 'read');
        const scope = this.scope;
        const batch = await incrementalList(this.db, {
            query: rowSql,
            bindings: [scope.tenantId, scope.legalEntityId],
            parameters,
            columns: {
                location: 'location_code',
                price_group: 'price_group_code',
            },
            searchColumns: [
                'location_code',
                "location->>'name'",
                'price_group_code',
            ],
            numericColumns: [],
            defaultSort: 'location',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => otcSaleLocationRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'pharmacy.otc-sale-location.update',
            ),
        };
    }

    // Kelompok harga Core, dibaca setelan ini dan loket penjualan.
    async priceGroups(parameters: URLSearchParams) {
        if (
            !this.workspace.permissions.has(
                'pharmacy.otc-sale-location.read',
            ) &&
            !this.workspace.permissions.has('pharmacy.otc-sale.read')
        )
            abort(403, 'Tidak diizinkan.');
        const batch = await incrementalList(this.db, {
            query: `select * from (select id, kode as code, nama as name from kelompok_harga
                                   where tenant_id = $1 and deleted_at is null and aktif) price_groups
                    where true`,
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { code: 'code' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => priceGroupRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const scope = this.scope;
        const found = lookupId(id)
            ? await this.db.one(
                  otcSaleLocationRowSchema,
                  `${rowSql} and otc_sale_locations.id = $3`,
                  [scope.tenantId, scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async checked(body: unknown, currentPriceGroupId: string | null) {
        const data = parseInput(otcSaleLocationInputSchema, body, messages);
        const scope = this.scope;
        const errors: Record<string, string> = {};
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
        const priceGroupId = data.price_group_id || null;
        if (
            priceGroupId !== null &&
            !(await priceGroupAvailable(
                this.db,
                scope.tenantId,
                priceGroupId,
                currentPriceGroupId,
            ))
        )
            errors.price_group_id = messages.price_group_id;
        if (Object.keys(errors).length) validation(errors);
        return { locationId: data.location_id, priceGroupId };
    }

    private taken(error: unknown): never {
        if (
            sqlErrorCode(error) === '23505' &&
            error instanceof Error &&
            error.message.includes('far_m_lokasi_penjualan_lokasi_unique')
        )
            validation({
                location_id:
                    'Lokasi ini sudah boleh menjual obat bebas. Ubah baris yang ada.',
            });
        throw error;
    }

    async create(body: unknown) {
        this.workspace.guard('otc-sale-location', 'update');
        const data = await this.checked(body, null);
        const scope = this.scope;
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('far_m_lokasi_penjualan', {
                id,
                tenant_id: scope.tenantId,
                legal_entity_id: scope.legalEntityId,
                lokasi_id: data.locationId,
                kelompok_harga_id: data.priceGroupId,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            this.taken(error);
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('otc-sale-location', 'update');
        const current = await this.row(id);
        const data = await this.checked(
            {
                ...(typeof body === 'object' ? body : {}),
                location_id: current.location.id,
            },
            current.price_group?.id ?? null,
        );
        const version = expectedVersion(request, body);
        const updated = await this.db.execute(
            `update far_m_lokasi_penjualan set kelompok_harga_id = $1, updated_at = $2
             where tenant_id = $3 and id = $4 and version = $5 and deleted_at is null`,
            [
                data.priceGroupId,
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

    // Menghapus baris berarti lokasi itu tidak lagi menjual obat bebas. Penjualan yang sudah terjadi tetap tercatat.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('otc-sale-location', 'update');
        const current = await this.row(id);
        const version = expectedVersion(request, body);
        const stamp = nowSql();
        const deleted = await this.db.execute(
            `update far_m_lokasi_penjualan set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [stamp, this.scope.tenantId, current.id, version],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
