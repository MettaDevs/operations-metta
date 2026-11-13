import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import type { Bind, Database } from '../../../platform/database/index.ts';
import {
    dateSchema,
    lookupId,
    validation,
} from '../../../platform/http/index.ts';
import {
    activeLegalEntity,
    categoryTreeSql,
    exists,
} from '../inventory.service.ts';
import {
    amountScale,
    display,
    fromNumeric,
    quantityScale,
} from '../quantity.ts';
import {
    expiryFilters,
    stockByLocationLineSchema,
    stockByLocationSchema,
} from './stock-by-location.schema.ts';
import { Currency, localCurrencyCode } from '../../currency/index.ts';

const itemSchema = stockByLocationSchema.shape.items.element.shape.item;
const lineSchema = stockByLocationLineSchema.extend({ item: itemSchema });
type Group = {
    item: z.infer<typeof itemSchema>;
    quantity: bigint;
    value: bigint;
    lines: z.infer<typeof stockByLocationLineSchema>[];
};

// Stok per lokasi per tanggal (Inventory - Availability di BC): jumlah kartu gudang sampai tanggal itu per barang,
// lokasi, dan batch, beserta nilainya. Lokasi transit tidak ikut kecuali dipilih sebagai saringan lokasi. Bila stok
// minus pernah diizinkan, kekurangan yang belum tertutup tercatat tanpa batch, jadi baris batch dan baris tanpa batch
// bisa berlawanan tanda; total barangnya tetap benar.
export class StockByLocation {
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

    async report(parameters: URLSearchParams) {
        this.workspace.guard('inventory-report', 'read');
        const bindings: Bind[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        const bind = (value: Bind) => `$${bindings.push(value)}`;
        const errors: Record<string, string> = {};
        const asOf = parameters.get('as_of') ?? '';
        if (!dateSchema.safeParse(asOf).success)
            errors.as_of = 'Isi tanggal stok yang benar.';
        let filter = '';
        const locationId = parameters.get('location_id') ?? '';
        if (locationId) {
            if (
                !lookupId(locationId) ||
                !(await this.db.one(
                    z.object({ found: z.number() }),
                    `select 1 as found from gd_m_lokasi
                     where tenant_id = $1 and legal_entity_id = $2 and id = $3`,
                    [this.scope.tenantId, this.scope.legalEntityId, locationId],
                ))
            )
                errors.location_id = 'Pilih lokasi dari daftar.';
            filter += ` and k.lokasi_id = ${bind(locationId)}`;
        } else filter += ' and not l.transit';
        const itemId = parameters.get('item_id') ?? '';
        if (itemId) {
            if (!(await exists(this.db, 'gd_m_barang', this.scope, itemId)))
                errors.item_id = 'Pilih barang dari daftar.';
            filter += ` and k.barang_id = ${bind(itemId)}`;
        }
        const categoryId = parameters.get('category_id') ?? '';
        if (
            categoryId &&
            !(await exists(this.db, 'gd_m_kategori', this.scope, categoryId))
        )
            errors.category_id = 'Pilih kategori dari daftar.';
        const parsedExpiry = z
            .enum(expiryFilters)
            .optional()
            .safeParse(parameters.get('expiry') ?? undefined);
        if (!parsedExpiry.success)
            errors.expiry = 'Pilih saringan kedaluwarsa dari daftar.';
        const expiry = parsedExpiry.success ? parsedExpiry.data : undefined;
        const days = Number(parameters.get('days') ?? '');
        if (
            expiry === 'expiring' &&
            !(Number.isInteger(days) && days >= 1 && days <= 3650)
        )
            errors.days = 'Isi jumlah hari antara 1 dan 3650.';
        if (Object.keys(errors).length) validation(errors);

        const asOfAt = bind(asOf);
        let batchFilter = '';
        switch (expiry) {
            case undefined:
                break;
            case 'expired':
                batchFilter = ` and t.kedaluwarsa < ${asOfAt}::date`;
                break;
            case 'expiring':
                batchFilter = ` and t.kedaluwarsa >= ${asOfAt}::date
                                and t.kedaluwarsa <= ${asOfAt}::date + ${bind(days)}::integer`;
                break;
            default: {
                const unknown: never = expiry;
                throw new Error(`Unknown expiry filter: ${String(unknown)}`);
            }
        }
        const category = categoryId
            ? ` and b.kategori_id in (select id from kategori)`
            : '';
        const lines = await this.db.rows(
            lineSchema,
            `with recursive ${categoryId ? `${categoryTreeSql(bind(categoryId))},` : ''}
                 posisi as (
                     select k.barang_id, k.lokasi_id, k.batch_id, sum(k.jumlah) as jumlah, sum(k.nilai) as nilai
                     from gd_tr_kartu_gudang k
                     join gd_m_lokasi l on l.tenant_id = k.tenant_id and l.id = k.lokasi_id
                     where k.tenant_id = $1 and k.legal_entity_id = $2 and k.tanggal_posting <= ${asOfAt}::date${filter}
                     group by k.barang_id, k.lokasi_id, k.batch_id
                     having sum(k.jumlah) <> 0
                 )
             select json_build_object('id', b.id, 'code', b.kode, 'name', b.nama, 'unit', s.kode) as item,
                    json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
                    case when t.id is null then null else json_build_object(
                        'id', t.id, 'batch_number', t.no_batch, 'expiry_date', t.kedaluwarsa) end as batch,
                    trim_scale(p.jumlah)::text as quantity, trim_scale(p.nilai)::text as value
             from posisi p
             join gd_m_barang b on b.tenant_id = $1 and b.id = p.barang_id
             join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
             join gd_m_lokasi l on l.tenant_id = $1 and l.id = p.lokasi_id
             left join gd_m_batch t on t.tenant_id = $1 and t.id = p.batch_id
             where true${category}${batchFilter}
             order by b.kode, b.id, l.kode, l.id, t.kedaluwarsa nulls last, t.no_batch nulls last`,
            bindings,
        );

        const groups = new Map<string, Group>();
        for (const { item, ...line } of lines) {
            let group = groups.get(item.id);
            if (!group) {
                group = { item, quantity: 0n, value: 0n, lines: [] };
                groups.set(item.id, group);
            }
            group.lines.push(line);
            group.quantity += fromNumeric(line.quantity, quantityScale);
            group.value += fromNumeric(line.value, amountScale);
        }
        return stockByLocationSchema.parse({
            amount_decimals: (
                await new Currency(this.db, this.workspace.tenantId).precision(
                    localCurrencyCode,
                )
            ).amount_decimals,
            items: [...groups.values()].map((group) => ({
                ...group,
                quantity: display(group.quantity, quantityScale),
                value: display(group.value, amountScale),
            })),
        });
    }
}
