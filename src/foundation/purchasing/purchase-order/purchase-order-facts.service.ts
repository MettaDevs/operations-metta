import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import type { Database } from '../../../platform/database/index.ts';
import { Decimal } from '../../../platform/money/index.ts';
import { Currency, localCurrencyCode } from '../../currency/index.ts';
import { activeLegalEntity } from '../../inventory/index.ts';
import { documentTotals } from '../purchase-line.amounts.ts';
import { pricedLinesSchema } from '../purchase-line.service.ts';
import { PurchaseOrders } from './purchase-order.service.ts';

const vendorFiguresSchema = z.object({
    remaining: z.string(),
    overdue: z.string(),
    last_payment_date: z.string().nullable(),
    orders: z.number(),
    receipts: z.number(),
    invoices: z.number(),
    credit_memos: z.number(),
});

const pricedDocumentsSchema = z.array(
    z.object({ priced_lines: pricedLinesSchema }),
);

// Sisa yang belum datang di order terbuka dan dirilis, dan yang sudah diterima tetapi belum difakturkan, masing-masing
// dihitung per dokumen dengan rumus total dokumen pembelian yang sama.
const outstandingOrdersSql = `
    select coalesce(json_agg(json_build_object(
               'quantity', (d.jumlah - d.jumlah_diterima)::text, 'unit_cost', d.harga_satuan::text,
               'discount_percent', d.diskon_persen::text, 'vat_percent', d.tarif_ppn::text)), '[]'::json)
           as priced_lines
    from bl_tr_order h
    join bl_tr_order_detail d on d.tenant_id = h.tenant_id and d.order_id = h.id and d.deleted_at is null
    where h.tenant_id = $1 and h.legal_entity_id = $2 and h.vendor_id = $3 and h.deleted_at is null
      and h.status in ('terbuka', 'dirilis') and d.jumlah > d.jumlah_diterima
    group by h.id`;

const receivedNotInvoicedSql = `
    select coalesce(json_agg(json_build_object(
               'quantity', (d.jumlah - d.jumlah_difaktur)::text, 'unit_cost', d.harga_satuan::text,
               'discount_percent', d.diskon_persen::text, 'vat_percent', d.tarif_ppn::text)), '[]'::json)
           as priced_lines
    from bl_tr_penerimaan h
    join bl_tr_penerimaan_detail d on d.tenant_id = h.tenant_id and d.penerimaan_id = h.id and d.deleted_at is null
    where h.tenant_id = $1 and h.legal_entity_id = $2 and h.vendor_id = $3 and h.status = 'diposting'
      and d.jumlah > d.jumlah_difaktur
    group by h.id`;

// FactBox purchase order seperti page 50 BC: Vendor Statistics (9094), Buy-from Vendor History (9095), dan Purchase
// Line Details (9100) untuk baris yang dipilih. Bagian yang izinnya tidak dimiliki pengguna dikosongkan.
export class PurchaseOrderFacts {
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

    private can(permission: string) {
        return this.workspace.permissions.has(`core.${permission}`);
    }

    async show(orderId: string, lineId: string | null) {
        const { data: order } = await new PurchaseOrders(
            this.db,
            this.workspace,
        ).show(orderId);
        const line = order.lines.find((candidate) => candidate.id === lineId);
        return {
            data: {
                vendor: this.can('purchase-invoice.read')
                    ? await this.vendor(order.vendor.id)
                    : null,
                line:
                    line && this.can('inventory-stock.read')
                        ? await this.line(line.item.id, order.location.id)
                        : null,
            },
        };
    }

    private async vendor(vendorId: string) {
        const bindings = [
            this.scope.tenantId,
            this.scope.legalEntityId,
            vendorId,
        ];
        const figures = await this.db.one(
            vendorFiguresSchema,
            `select
                 (select coalesce(trim_scale(sum(e.sisa)), 0)::text from ap_tr_entri_utang e
                  where e.tenant_id = $1 and e.legal_entity_id = $2 and e.vendor_id = $3) as remaining,
                 (select coalesce(trim_scale(sum(e.sisa)), 0)::text from ap_tr_entri_utang e
                  where e.tenant_id = $1 and e.legal_entity_id = $2 and e.vendor_id = $3
                    and e.jatuh_tempo < current_date) as overdue,
                 (select max(p.tanggal)::text from ap_tr_pembayaran p
                  where p.tenant_id = $1 and p.legal_entity_id = $2 and p.vendor_id = $3
                    and p.status = 'diposting') as last_payment_date,
                 (select count(*)::int from bl_tr_order h
                  where h.tenant_id = $1 and h.legal_entity_id = $2 and h.vendor_id = $3
                    and h.deleted_at is null) as orders,
                 (select count(*)::int from bl_tr_penerimaan h
                  where h.tenant_id = $1 and h.legal_entity_id = $2 and h.vendor_id = $3
                    and h.status = 'diposting') as receipts,
                 (select count(*)::int from ap_tr_faktur h
                  where h.tenant_id = $1 and h.legal_entity_id = $2 and h.vendor_id = $3
                    and h.status = 'diposting') as invoices,
                 (select count(*)::int from ap_tr_nota_kredit h
                  where h.tenant_id = $1 and h.legal_entity_id = $2 and h.vendor_id = $3
                    and h.status = 'diposting') as credit_memos`,
            bindings,
        );
        if (!figures) throw new Error('Vendor figures query returned nothing.');
        const { amount_decimals: decimals } = await new Currency(
            this.db,
            this.scope.tenantId,
        ).precision(localCurrencyCode);
        const total = async (query: string) =>
            (await this.db.rows(pricedDocumentsSchema.element, query, bindings))
                .reduce((sum, document) => {
                    const { subtotal, vat } = documentTotals(
                        document.priced_lines,
                        decimals,
                    );
                    return sum.plus(subtotal).plus(vat);
                }, Decimal.of('0'))
                .normalized();
        return {
            ...figures,
            outstanding_orders: await total(outstandingOrdersSql),
            received_not_invoiced: await total(receivedNotInvoicedSql),
        };
    }

    private async line(itemId: string, locationId: string) {
        return this.db.one(
            z.object({
                base_unit: z.string(),
                inventory: z.string(),
                on_order: z.string(),
            }),
            `select u.kode as base_unit,
                    coalesce((select trim_scale(sum(g.jumlah)) from gd_tr_kartu_gudang g
                              where g.tenant_id = b.tenant_id and g.legal_entity_id = $2
                                and g.barang_id = b.id and g.lokasi_id = $4), 0)::text as inventory,
                    coalesce((select trim_scale(sum((d.jumlah - d.jumlah_diterima) * d.konversi))
                              from bl_tr_order_detail d
                              join bl_tr_order o on o.tenant_id = d.tenant_id and o.id = d.order_id
                              where d.tenant_id = b.tenant_id and d.legal_entity_id = $2 and d.barang_id = b.id
                                and o.lokasi_id = $4 and o.status in ('terbuka', 'dirilis')
                                and o.deleted_at is null and d.deleted_at is null), 0)::text as on_order
             from gd_m_barang b
             join gd_m_satuan u on u.tenant_id = b.tenant_id and u.id = b.satuan_dasar_id
             where b.tenant_id = $1 and b.id = $3`,
            [this.scope.tenantId, this.scope.legalEntityId, itemId, locationId],
        );
    }
}
