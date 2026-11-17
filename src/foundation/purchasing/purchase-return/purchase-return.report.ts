import { z } from 'zod';
import {
    coreWorkspace,
    type Workspace,
} from '../../../platform/access/index.ts';
import { isoSql, type Database } from '../../../platform/database/index.ts';
import { lookupId } from '../../../platform/http/index.ts';
import {
    defineReport,
    field,
    type Values,
} from '../../../platform/reporting/index.ts';
import { Currency, localCurrencyCode } from '../../currency/index.ts';
import { purchaseReturnLayouts } from './purchase-return.layout.ts';

// Retur ke vendor, padanan Return Shipment Business Central: surat yang ikut barang kembali ke PBF. Setiap baris
// membawa batch dan kedaluwarsa dari baris penerimaannya, dan nilainya dari harga beli sesudah diskon di penerimaan itu,
// dasar nota kredit dari vendor.
export const purchaseReturnFields = {
    number: field.text('Nomor retur'),
    posting_date: field.date('Tanggal retur'),
    is_cancelled: field.flag('Retur dibatalkan'),
    reason: field.text('Alasan retur'),
    receipt_number: field.text('Nomor penerimaan'),
    receipt_date: field.date('Tanggal penerimaan'),
    vendor_number: field.text('Nomor vendor'),
    vendor_name: field.text('Vendor'),
    vendor_document_number: field.text('Nomor dokumen vendor pada penerimaan'),
    location: field.text('Lokasi asal barang'),
    posted_at: field.datetime('Waktu posting'),
    returned_by: field.text('Petugas (pengguna yang memposting retur)'),
    lines: field.lines('Barang', {
        item_code: field.text('Kode barang'),
        item_name: field.text('Nama barang'),
        batch_number: field.text('Nomor batch'),
        expiry_date: field.date('Kedaluwarsa'),
        quantity: field.quantity('Jumlah'),
        unit: field.text('Satuan'),
        unit_cost: field.unitAmount('Harga satuan sesudah diskon'),
        amount: field.money('Nilai'),
    }),
    total: field.money('Total nilai', { words: true }),
};

const lineSchema = z.object({
    item_code: z.string(),
    item_name: z.string(),
    batch_number: z.string().nullable(),
    expiry_date: z.string().nullable(),
    quantity: z.string(),
    unit: z.string(),
    unit_cost: z.string(),
    amount: z.string(),
});

const returnSchema = z.object({
    operating_unit_id: z.string(),
    number: z.string(),
    posting_date: z.string(),
    is_cancelled: z.boolean(),
    reason: z.string(),
    receipt_number: z.string(),
    receipt_date: z.string(),
    vendor_number: z.string(),
    vendor_name: z.string(),
    vendor_document_number: z.string().nullable(),
    location: z.string(),
    posted_at: z.string(),
    returned_by: z.string().nullable(),
    lines: z.array(lineSchema),
    total: z.string(),
});

async function purchaseReturn(
    db: Database,
    workspace: Workspace,
    returnId: string,
) {
    workspace.guard('purchase-receipt', 'read');
    if (!lookupId(returnId) || !workspace.legalEntityId) return null;
    const { amount_decimals: decimals } = await new Currency(
        db,
        workspace.tenantId,
    ).precision(localCurrencyCode);
    const row = await db.one(
        returnSchema,
        `select h.operating_unit_id, h.nomor as number, h.tanggal::text as posting_date,
                h.status = 'dibatalkan' as is_cancelled, h.alasan as reason,
                r.nomor as receipt_number, r.tanggal::text as receipt_date,
                v.number as vendor_number, p.name as vendor_name, r.no_dokumen_vendor as vendor_document_number,
                l.nama as location, ${isoSql('h.diposting_pada')} as posted_at, poster.name as returned_by,
                coalesce(t.lines, '[]'::json) as lines, trim_scale(coalesce(t.total, 0))::text as total
         from bl_tr_retur h
         join bl_tr_penerimaan r on r.tenant_id = h.tenant_id and r.id = h.penerimaan_id
         join vendors v on v.tenant_id = r.tenant_id and v.id = r.vendor_id
         join parties p on p.tenant_id = v.tenant_id and p.id = v.party_id
         join gd_m_lokasi l on l.tenant_id = r.tenant_id and l.id = r.lokasi_id
         left join users poster on poster.id = h.diposting_oleh_user_id
         left join lateral (
             select json_agg(json_build_object(
                        'item_code', b.kode, 'item_name', b.nama, 'batch_number', d.no_batch,
                        'expiry_date', d.kedaluwarsa::text, 'quantity', trim_scale(d.jumlah)::text, 'unit', s.kode,
                        'unit_cost', trim_scale(round(d.unit_cost, 4))::text, 'amount', trim_scale(d.amount)::text)
                        order by d.urutan) as lines,
                    sum(d.amount) as total
             from (select x.urutan, x.tenant_id, x.barang_id, x.satuan_id, x.jumlah, y.no_batch, y.kedaluwarsa,
                          y.harga_satuan * (100 - y.diskon_persen) / 100 * x.konversi / y.konversi as unit_cost,
                          round(x.jumlah * y.harga_satuan * (100 - y.diskon_persen) / 100 * x.konversi / y.konversi,
                                ${decimals}) as amount
                   from bl_tr_retur_detail x
                   join bl_tr_penerimaan_detail y on y.tenant_id = x.tenant_id and y.id = x.penerimaan_detail_id
                   where x.tenant_id = h.tenant_id and x.retur_id = h.id and x.deleted_at is null) d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id) t on true
         where h.tenant_id = $1 and h.legal_entity_id = $2 and h.id = $3 and h.deleted_at is null`,
        [workspace.tenantId, workspace.legalEntityId, returnId],
    );
    if (!row) return null;
    const { operating_unit_id, ...values } = row;
    return {
        legalEntityId: workspace.legalEntityId,
        operatingUnitId: operating_unit_id,
        fileName: `Retur ${values.number}`,
        values,
    };
}

const sample: Values<typeof purchaseReturnFields> = {
    number: 'RPB-00000002',
    posting_date: '2026-11-20',
    is_cancelled: false,
    reason: 'Kemasan rusak saat diterima',
    receipt_number: 'RC-00000011',
    receipt_date: '2026-11-17',
    vendor_number: 'V-0001',
    vendor_name: 'PBF Contoh',
    vendor_document_number: 'FJ-2611-044',
    location: 'Gudang Farmasi',
    posted_at: '2026-11-20T02:00:00.000000Z',
    returned_by: 'Petugas Gudang Contoh',
    lines: [
        {
            item_code: 'PCT-500',
            item_name: 'Parasetamol 500 mg',
            batch_number: 'B2611A',
            expiry_date: '2028-03-31',
            quantity: '2',
            unit: 'BOX',
            unit_cost: '15000',
            amount: '30000',
        },
    ],
    total: '30000',
};

export const purchaseReturnReport = defineReport({
    code: 'core.purchase-return',
    name: 'Retur ke vendor',
    moduleId: 'core',
    permission: 'core.purchase-receipt.read',
    workspace: (context) => coreWorkspace(context),
    fields: purchaseReturnFields,
    sample: {
        legalEntityId: '00000000-0000-0000-0000-000000000000',
        operatingUnitId: null,
        fileName: 'Retur RPB-00000002',
        values: sample,
    },
    layouts: purchaseReturnLayouts,
    load: purchaseReturn,
});
