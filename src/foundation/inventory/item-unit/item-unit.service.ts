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
import {
    decimalInput,
    quantityHint,
    fromNumeric,
    quantityScale,
    toNumeric,
} from '../quantity.ts';
import { itemUnitInputSchema, itemUnitRowSchema } from './item-unit.schema.ts';

// Satuan dasar ditulis sebagai baris pertama dengan isi 1. Satuan kemasan yang kebetulan sama dengan satuan dasar
// (satuan dasar barang diganti sesudahnya) tidak ditampilkan, supaya satu satuan hanya punya satu isi.
const unitsOf = (items: string) => `select * from (
                      select s.id, null::uuid as entry_id, b.id as item_id, s.kode as code, s.nama as name,
                             1::numeric as conversion, '1' as quantity_per_unit, true as is_base, 0 as version
                      from gd_m_barang b
                      join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
                      where b.tenant_id = $1 and b.legal_entity_id = $2 and b.id ${items} and b.deleted_at is null
                      union all
                      select s.id, k.id, k.barang_id, s.kode, s.nama, k.konversi, trim_scale(k.konversi)::text,
                             false, k.version
                      from gd_m_barang_satuan k
                      join gd_m_barang b on b.tenant_id = k.tenant_id and b.id = k.barang_id and b.deleted_at is null
                      join gd_m_satuan s on s.tenant_id = k.tenant_id and s.id = k.satuan_id
                      where k.tenant_id = $1 and k.legal_entity_id = $2 and k.barang_id ${items} and k.deleted_at is null
                        and k.satuan_id <> b.satuan_dasar_id) units
                  where true`;
const unitsSql = unitsOf('= $3');

const messages = {
    item_id: 'Pilih barang dari daftar.',
    unit_id: 'Pilih satuan dari daftar.',
    quantity_per_unit: 'Isi jumlah satuan dasar dalam satu satuan ini.',
};

const storedSchema = z.object({
    id: z.string(),
    item_id: z.string(),
    unit_id: z.string(),
    version: z.number(),
});

const unitUses = ['purchase', 'sales'] as const;
export type UnitUse = (typeof unitUses)[number];
const defaultUnitColumns: Record<UnitUse, string> = {
    purchase: 'satuan_beli_id',
    sales: 'satuan_jual_id',
};
const useLabels: Record<UnitUse, string> = {
    purchase: 'satuan beli',
    sales: 'satuan jual',
};

// Isi satuan baris dokumen: satuan dasar barang berisi 1, satuan kemasan aktif berisi konversinya. Barang yang tidak
// ada atau satuan yang bukan milik barang itu dijawab null.
export async function unitConversion(
    db: Database,
    scope: { tenantId: string; legalEntityId: string },
    itemId: string,
    unitId: string,
): Promise<bigint | null> {
    if (!lookupId(itemId) || !lookupId(unitId)) return null;
    const found = await db.one(
        z.object({ conversion: z.string() }),
        `select '1' as conversion from gd_m_barang
         where tenant_id = $1 and legal_entity_id = $2 and id = $3 and satuan_dasar_id = $4 and deleted_at is null
         union all
         select k.konversi::text from gd_m_barang_satuan k
         join gd_m_barang b on b.tenant_id = k.tenant_id and b.id = k.barang_id and b.deleted_at is null
         where k.tenant_id = $1 and k.legal_entity_id = $2 and k.barang_id = $3 and k.satuan_id = $4
           and k.deleted_at is null
         limit 1`,
        [scope.tenantId, scope.legalEntityId, itemId, unitId],
    );
    return found ? fromNumeric(found.conversion, quantityScale) : null;
}

// Satuan bawaan barang untuk satu pemakaian beserta isinya dalam satuan dasar, untuk baris dokumen yang tidak memilih
// satuan sendiri. Bawaan kosong berarti satuan dasar. Barang yang tidak ada dijawab null.
export async function defaultUnit(
    db: Database,
    scope: { tenantId: string; legalEntityId: string },
    itemId: string,
    use: UnitUse,
): Promise<{ unitId: string; conversion: bigint } | null> {
    if (!lookupId(itemId)) return null;
    const column = defaultUnitColumns[use];
    const found = await db.one(
        z.object({ unit_id: z.string(), conversion: z.string() }),
        `select coalesce(b.${column}, b.satuan_dasar_id) as unit_id,
                case when coalesce(b.${column}, b.satuan_dasar_id) = b.satuan_dasar_id then '1'
                     else k.konversi::text end as conversion
         from gd_m_barang b
         left join gd_m_barang_satuan k on k.tenant_id = b.tenant_id and k.barang_id = b.id
              and k.satuan_id = b.${column} and k.deleted_at is null
         where b.tenant_id = $1 and b.legal_entity_id = $2 and b.id = $3 and b.deleted_at is null`,
        [scope.tenantId, scope.legalEntityId, itemId],
    );
    return found
        ? {
              unitId: found.unit_id,
              conversion: fromNumeric(found.conversion, quantityScale),
          }
        : null;
}

const itemUnitOptionSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    quantity_per_unit: z.string(),
});
export type ItemUnitOption = z.infer<typeof itemUnitOptionSchema>;

// Pilihan satuan baris dokumen, satuan dasar lebih dulu lalu satuan kemasan menurut isinya. Untuk layar module yang
// penggunanya tidak memegang izin kartu barang.
export async function itemUnits(
    db: Database,
    scope: { tenantId: string; legalEntityId: string },
    itemIds: string[],
): Promise<Map<string, ItemUnitOption[]>> {
    const ids = [...new Set(itemIds.filter((id) => lookupId(id)))];
    const units = new Map<string, ItemUnitOption[]>();
    if (!ids.length) return units;
    const rows = await db.rows(
        itemUnitOptionSchema.extend({ item_id: z.string() }),
        `${unitsOf(`in (${ids.map((_, index) => `$${index + 3}`).join(', ')})`)}
         order by units.item_id, units.is_base desc, units.conversion, units.code`,
        [scope.tenantId, scope.legalEntityId, ...ids],
    );
    for (const { item_id: itemId, ...unit } of rows)
        units.set(itemId, [...(units.get(itemId) ?? []), unit]);
    return units;
}

export class ItemUnits {
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

    private async item(id: string) {
        if (!(await exists(this.db, 'gd_m_barang', this.scope, id)))
            validation({ item_id: messages.item_id });
        return id;
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('inventory-item', 'read');
        const itemId = await this.item(parameters.get('item_id') ?? '');
        const batch = await incrementalList(this.db, {
            query: unitsSql,
            bindings: [this.scope.tenantId, this.scope.legalEntityId, itemId],
            parameters,
            columns: {
                quantity_per_unit: 'conversion',
                code: 'code',
                name: 'name',
            },
            searchColumns: ['code', 'name'],
            numericColumns: ['conversion'],
            defaultSort: 'quantity_per_unit',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => itemUnitRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.inventory-item.update',
            ),
        };
    }

    private async row(entryId: string) {
        const stored = await this.stored(entryId);
        const found = await this.db.one(
            itemUnitRowSchema,
            `${unitsSql} and units.entry_id = $4`,
            [
                this.scope.tenantId,
                this.scope.legalEntityId,
                stored.item_id,
                entryId,
            ],
        );
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async stored(entryId: string) {
        const found = lookupId(entryId)
            ? await this.db.one(
                  storedSchema,
                  `select id, barang_id as item_id, satuan_id as unit_id, version from gd_m_barang_satuan
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                  [this.scope.tenantId, this.scope.legalEntityId, entryId],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async checked(body: unknown, itemId: string | null) {
        const data = parseInput(itemUnitInputSchema, body, messages);
        const errors: Record<string, string> = {};
        if (itemId !== null && data.item_id !== itemId)
            errors.item_id =
                'Barang satuan kemasan tidak bisa diganti. Hapus satuan ini, lalu buat di barang yang benar.';
        const item = lookupId(data.item_id)
            ? await this.db.one(
                  z.object({ base_unit_id: z.string() }),
                  `select satuan_dasar_id as base_unit_id from gd_m_barang
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                  [this.scope.tenantId, this.scope.legalEntityId, data.item_id],
              )
            : undefined;
        if (!item) errors.item_id = messages.item_id;
        if (!(await exists(this.db, 'gd_m_satuan', this.scope, data.unit_id)))
            errors.unit_id = messages.unit_id;
        else if (item?.base_unit_id === data.unit_id)
            errors.unit_id =
                'Satuan ini satuan dasar barang, yang isinya selalu 1. Pilih satuan kemasan lain.';
        const conversion = decimalInput(data.quantity_per_unit);
        if (conversion === null || conversion <= 0n)
            errors.quantity_per_unit = `Isi jumlah lebih dari 0, ${quantityHint}.`;
        if (Object.keys(errors).length || conversion === null)
            validation(errors);
        return {
            itemId: data.item_id,
            unitId: data.unit_id,
            conversion: toNumeric(conversion, quantityScale),
        };
    }

    // Padanan TestItemSetup di Item Unit of Measure BC. Baris barang dikunci seperti di updateItem, supaya pemeriksaan
    // satuan bawaan di sana tidak menyalip perubahan ini.
    private async refuseDefaultUnit(
        current: z.infer<typeof storedSchema>,
        message: (uses: string) => string,
    ): Promise<void> {
        const item = await this.db.one(
            z.object({
                purchase: z.string().nullable(),
                sales: z.string().nullable(),
            }),
            `select satuan_beli_id as purchase, satuan_jual_id as sales from gd_m_barang
             where tenant_id = $1 and id = $2 for update`,
            [this.scope.tenantId, current.item_id],
        );
        const uses = unitUses
            .filter((use) => item?.[use] === current.unit_id)
            .map((use) => useLabels[use]);
        if (uses.length) validation({ unit_id: message(uses.join(' dan ')) });
    }

    private unitTaken(error: unknown): void {
        if (violates(error, 'gd_m_barang_satuan_unique'))
            validation({
                unit_id: 'Satuan ini sudah ada di barang ini.',
            });
    }

    async create(body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const data = await this.checked(body, null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('gd_m_barang_satuan', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                barang_id: data.itemId,
                satuan_id: data.unitId,
                konversi: data.conversion,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            this.unitTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    // Baris dokumen menyalin isinya saat disimpan, jadi mengubah isi tidak mengubah dokumen yang sudah ada.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const current = await this.stored(id);
        const data = await this.checked(body, current.item_id);
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                if (data.unitId !== current.unit_id)
                    await this.refuseDefaultUnit(
                        current,
                        (uses) =>
                            `Satuan ini ${uses} barang ini, jadi tidak bisa diganti. Ganti ${uses}nya di kartu barang lebih dulu.`,
                    );
                updated = await this.db.execute(
                    `update gd_m_barang_satuan set satuan_id = $1, konversi = $2, updated_at = $3
                 where tenant_id = $4 and id = $5 and version = $6 and deleted_at is null`,
                    [
                        data.unitId,
                        data.conversion,
                        nowSql(),
                        this.scope.tenantId,
                        current.id,
                        expectedVersion(request, body),
                    ],
                );
            });
        } catch (error) {
            this.unitTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const current = await this.stored(id);
        const deleted = await this.db.transaction(async () => {
            await this.refuseDefaultUnit(
                current,
                (uses) =>
                    `Satuan ini ${uses} barang ini, jadi tidak bisa dihapus. Ganti ${uses}nya di kartu barang lebih dulu.`,
            );
            return this.db.execute(
                `update gd_m_barang_satuan set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
                [
                    nowSql(),
                    this.scope.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        });
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
