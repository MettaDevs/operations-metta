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
    exists,
    parseInput,
    violates,
} from '../inventory.service.ts';
import { decimalInput, quantityScale, toNumeric } from '../quantity.ts';
import {
    stockkeepingUnitInputSchema,
    stockkeepingUnitRowSchema,
} from './stockkeeping-unit.schema.ts';

const rowSql = `select * from (
                    select k.id, k.barang_id as item_id,
                           json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
                           trim_scale(k.stok_minimum)::text as minimum_quantity,
                           trim_scale(k.stok_maksimum)::text as maximum_quantity, k.version,
                           l.kode as location_code
                    from gd_m_barang_lokasi k
                    join gd_m_lokasi l on l.tenant_id = k.tenant_id and l.id = k.lokasi_id
                    where k.tenant_id = $1 and k.legal_entity_id = $2 and k.barang_id = $3 and k.deleted_at is null
                ) units
                where true`;

const messages = {
    item_id: 'Pilih barang dari daftar.',
    location_id: 'Pilih lokasi dari daftar.',
    minimum_quantity:
        'Isi stok minimum 0 atau lebih, paling banyak empat angka di belakang koma.',
    maximum_quantity:
        'Isi stok maksimum 0 atau lebih, paling banyak empat angka di belakang koma.',
};

const storedSchema = z.object({ id: z.string(), item_id: z.string() });

// Isian kosong berarti tidak ditetapkan; isian yang bukan angka 0 atau lebih ditolak.
function level(raw: unknown): bigint | null | 'invalid' {
    if (raw === null || raw === undefined || raw === '') return null;
    const value = decimalInput(raw);
    return value === null || value < 0n ? 'invalid' : value;
}

const numeric = (value: bigint | null) =>
    value === null ? null : toNumeric(value, quantityScale);

export class StockkeepingUnits {
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
        this.workspace.guard('inventory-item', 'read');
        const itemId = parameters.get('item_id') ?? '';
        if (!(await exists(this.db, 'gd_m_barang', this.scope, itemId)))
            validation({ item_id: messages.item_id });
        const batch = await incrementalList(this.db, {
            query: rowSql,
            bindings: [this.scope.tenantId, this.scope.legalEntityId, itemId],
            parameters,
            columns: { location: 'location_code' },
            searchColumns: ['location_code'],
            numericColumns: [],
            defaultSort: 'location',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => stockkeepingUnitRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.inventory-item.update',
            ),
        };
    }

    private async stored(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  storedSchema,
                  `select id, barang_id as item_id from gd_m_barang_lokasi
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async row(id: string) {
        const stored = await this.stored(id);
        const found = await this.db.one(
            stockkeepingUnitRowSchema,
            `${rowSql} and units.id = $4`,
            [
                this.scope.tenantId,
                this.scope.legalEntityId,
                stored.item_id,
                stored.id,
            ],
        );
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async checked(body: unknown, itemId: string | null) {
        const data = parseInput(stockkeepingUnitInputSchema, body, messages);
        const errors: Record<string, string> = {};
        if (itemId !== null && data.item_id !== itemId)
            errors.item_id =
                'Barang setelan ini tidak bisa diganti. Hapus setelan ini, lalu buat di barang yang benar.';
        else if (
            !(await exists(this.db, 'gd_m_barang', this.scope, data.item_id))
        )
            errors.item_id = messages.item_id;
        const location = lookupId(data.location_id)
            ? await this.db.one(
                  z.object({ transit: z.boolean() }),
                  `select transit from gd_m_lokasi
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                  [
                      this.scope.tenantId,
                      this.scope.legalEntityId,
                      data.location_id,
                  ],
              )
            : undefined;
        if (!location) errors.location_id = messages.location_id;
        else if (location.transit)
            errors.location_id =
                'Pilih lokasi yang bukan lokasi transit. Lokasi transit hanya dipakai mutasi.';
        const minimum = level(data.minimum_quantity);
        const maximum = level(data.maximum_quantity);
        if (minimum === 'invalid')
            errors.minimum_quantity = messages.minimum_quantity;
        if (maximum === 'invalid')
            errors.maximum_quantity = messages.maximum_quantity;
        if (minimum === null && maximum === null)
            errors.minimum_quantity =
                'Isi stok minimum, stok maksimum, atau keduanya.';
        if (
            typeof minimum === 'bigint' &&
            typeof maximum === 'bigint' &&
            maximum < minimum
        )
            errors.maximum_quantity =
                'Stok maksimum tidak boleh lebih kecil dari stok minimum.';
        if (
            Object.keys(errors).length ||
            minimum === 'invalid' ||
            maximum === 'invalid'
        )
            validation(errors);
        return {
            itemId: data.item_id,
            locationId: data.location_id,
            minimum: numeric(minimum),
            maximum: numeric(maximum),
        };
    }

    private locationTaken(error: unknown): void {
        if (violates(error, 'gd_m_barang_lokasi_unique'))
            validation({
                location_id:
                    'Lokasi ini sudah punya stok minimum dan maksimum untuk barang ini.',
            });
    }

    async create(body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const data = await this.checked(body, null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('gd_m_barang_lokasi', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                barang_id: data.itemId,
                lokasi_id: data.locationId,
                stok_minimum: data.minimum,
                stok_maksimum: data.maximum,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            this.locationTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const current = await this.stored(id);
        const data = await this.checked(body, current.item_id);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update gd_m_barang_lokasi set lokasi_id = $1, stok_minimum = $2, stok_maksimum = $3, updated_at = $4
                 where tenant_id = $5 and id = $6 and version = $7 and deleted_at is null`,
                [
                    data.locationId,
                    data.minimum,
                    data.maximum,
                    nowSql(),
                    this.scope.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            this.locationTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const current = await this.stored(id);
        const deleted = await this.db.execute(
            `update gd_m_barang_lokasi set deleted_at = $1, updated_at = $1
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
