import { z } from 'zod';
import { allowedLocationsSql } from '../../inventory/index.ts';
import {
    coreWorkspace,
    type Workspace,
} from '../../../platform/access/index.ts';
import type { Database } from '../../../platform/database/index.ts';
import { lookupId } from '../../../platform/http/index.ts';
import {
    defineReport,
    field,
    type Values,
} from '../../../platform/reporting/index.ts';
import { Currency, localCurrencyCode } from '../../currency/index.ts';
import { lineAmountSql } from '../purchase-line.service.ts';
import { purchaseOrderLayouts } from './purchase-order.layout.ts';

export const purchaseOrderFields = {
    number: field.text('Nomor order'),
    order_date: field.date('Tanggal order'),
    expected_receipt_date: field.date('Diharapkan datang'),
    is_open: field.flag('Belum dirilis'),
    vendor_number: field.text('Nomor vendor'),
    vendor_name: field.text('Vendor'),
    location_code: field.text('Kode lokasi'),
    location: field.text('Lokasi pengiriman'),
    description: field.text('Keterangan'),
    prices_including_vat: field.flag('Harga sudah termasuk PPN'),
    ordered_by: field.text('Yang memesan (pengguna yang merilis)'),
    lines: field.lines('Barang', {
        item_code: field.text('Kode barang'),
        item_name: field.text('Nama barang'),
        quantity: field.quantity('Jumlah'),
        unit: field.text('Satuan'),
        unit_cost: field.unitAmount('Harga satuan'),
        discount_percent: field.quantity('Diskon (%)'),
        vat_percent: field.quantity('PPN (%)'),
        amount: field.money('Nilai'),
        expected_receipt_date: field.date('Diharapkan datang'),
    }),
    subtotal: field.money('Jumlah sebelum PPN'),
    vat_amount: field.money('PPN'),
    total: field.money('Total', { words: true }),
};

const lineSchema = z.object({
    item_code: z.string(),
    item_name: z.string(),
    quantity: z.string(),
    unit: z.string(),
    unit_cost: z.string(),
    discount_percent: z.string(),
    vat_percent: z.string(),
    amount: z.string(),
    expected_receipt_date: z.string().nullable(),
});

const orderSchema = z.object({
    operating_unit_id: z.string(),
    number: z.string(),
    order_date: z.string(),
    expected_receipt_date: z.string().nullable(),
    is_open: z.boolean(),
    vendor_number: z.string(),
    vendor_name: z.string(),
    location_code: z.string(),
    location: z.string(),
    description: z.string().nullable(),
    prices_including_vat: z.boolean(),
    ordered_by: z.string().nullable(),
    lines: z.array(lineSchema),
    subtotal: z.string(),
    vat_amount: z.string(),
    total: z.string(),
});

async function purchaseOrder(
    db: Database,
    workspace: Workspace,
    orderId: string,
) {
    workspace.guard('purchase-order', 'read');
    if (!lookupId(orderId) || !workspace.legalEntityId) return null;
    const { amount_decimals: decimals } = await new Currency(
        db,
        workspace.tenantId,
    ).precision(localCurrencyCode);
    const bindings = [workspace.tenantId, workspace.legalEntityId, orderId];
    const row = await db.one(
        orderSchema,
        `select h.operating_unit_id, h.nomor as number, h.tanggal::text as order_date,
                h.tanggal_diharapkan::text as expected_receipt_date, h.status = 'terbuka' as is_open,
                v.number as vendor_number, p.name as vendor_name,
                l.kode as location_code, l.nama as location, h.keterangan as description,
                h.termasuk_ppn as prices_including_vat, coalesce(releaser.name, creator.name) as ordered_by,
                coalesce(t.lines, '[]'::json) as lines,
                trim_scale(coalesce(t.subtotal, 0))::text as subtotal,
                trim_scale(coalesce(t.vat, 0))::text as vat_amount,
                trim_scale(coalesce(t.subtotal, 0) + coalesce(t.vat, 0))::text as total
         from bl_tr_order h
         join vendors v on v.tenant_id = h.tenant_id and v.id = h.vendor_id
         join parties p on p.tenant_id = v.tenant_id and p.id = v.party_id
         join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
         left join users releaser on releaser.id = h.dirilis_oleh_user_id
         left join users creator on creator.id = h.created_by_user_id
         left join lateral (
             select json_agg(json_build_object(
                        'item_code', b.kode, 'item_name', b.nama, 'quantity', trim_scale(d.jumlah)::text,
                        'unit', s.kode, 'unit_cost', trim_scale(d.harga_satuan)::text,
                        'discount_percent', trim_scale(d.diskon_persen)::text,
                        'vat_percent', trim_scale(d.tarif_ppn)::text, 'amount', trim_scale(d.amount)::text,
                        'expected_receipt_date', coalesce(d.tanggal_diharapkan, h.tanggal_diharapkan)::text)
                        order by d.urutan) as lines,
                    sum(d.amount) as subtotal, round(sum(d.amount * d.tarif_ppn / 100), ${decimals}) as vat
             from (select x.*, ${lineAmountSql('x', decimals)} as amount from bl_tr_order_detail x
                   where x.tenant_id = h.tenant_id and x.order_id = h.id and x.deleted_at is null) d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id) t on true
         where h.tenant_id = $1 and h.legal_entity_id = $2 and h.id = $3 and h.deleted_at is null and ${allowedLocationsSql(workspace, bindings, ['h.lokasi_id'])}`,
        bindings,
    );
    if (!row) return null;
    const { operating_unit_id, ...values } = row;
    return {
        legalEntityId: workspace.legalEntityId,
        operatingUnitId: operating_unit_id,
        fileName: `Purchase order ${values.number}`,
        values,
    };
}

const sample: Values<typeof purchaseOrderFields> = {
    number: 'PO-00000007',
    order_date: '2026-11-17',
    expected_receipt_date: '2026-11-20',
    is_open: false,
    vendor_number: 'V-0001',
    vendor_name: 'PBF Contoh',
    location_code: 'GUDANG',
    location: 'Gudang Farmasi',
    description: null,
    prices_including_vat: false,
    ordered_by: 'Petugas Pembelian Contoh',
    lines: [
        {
            item_code: 'PCT-500',
            item_name: 'Parasetamol 500 mg',
            quantity: '10',
            unit: 'BOX',
            unit_cost: '15000',
            discount_percent: '0',
            vat_percent: '11',
            amount: '150000',
            expected_receipt_date: '2026-11-20',
        },
    ],
    subtotal: '150000',
    vat_amount: '16500',
    total: '166500',
};

export const purchaseOrderReport = defineReport({
    code: 'core.purchase-order',
    name: 'Purchase order',
    moduleId: 'core',
    permission: 'core.purchase-order.read',
    workspace: (context) => coreWorkspace(context),
    fields: purchaseOrderFields,
    sample: {
        legalEntityId: '00000000-0000-0000-0000-000000000000',
        operatingUnitId: null,
        fileName: 'Purchase order PO-00000007',
        values: sample,
    },
    layouts: purchaseOrderLayouts,
    load: purchaseOrder,
});
