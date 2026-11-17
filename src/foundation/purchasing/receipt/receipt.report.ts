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
import { receiptLayouts } from './receipt.layout.ts';
import { lineAmountSql } from './receipt.service.ts';

// Penerimaan barang dari vendor, padanan Purchase - Receipt Business Central dengan harga seperti form penerimaan
// puskesmas: vendor dan nomor dokumennya, lokasi, batch dan kedaluwarsa per baris, sumber dana, diskon, PPN, dan total
// dengan terbilang. Nilai baris dan PPN dihitung dengan rumus yang sama dengan layar penerimaan.
export const receiptFields = {
    number: field.text('Nomor penerimaan'),
    posting_date: field.date('Tanggal terima'),
    is_draft: field.flag('Masih draf'),
    is_cancelled: field.flag('Posting dibatalkan'),
    vendor_number: field.text('Nomor vendor'),
    vendor_name: field.text('Vendor'),
    vendor_document_number: field.text(
        'Nomor dokumen vendor (faktur atau surat jalan)',
    ),
    location_code: field.text('Kode lokasi'),
    location: field.text('Lokasi penerima'),
    description: field.text('Keterangan'),
    prices_including_vat: field.flag('Harga vendor sudah termasuk PPN'),
    posted_at: field.datetime('Waktu posting'),
    received_by: field.text('Penerima (pengguna yang memposting)'),
    lines: field.lines('Barang', {
        item_code: field.text('Kode barang'),
        item_name: field.text('Nama barang'),
        batch_number: field.text('Nomor batch'),
        expiry_date: field.date('Kedaluwarsa'),
        quantity: field.quantity('Jumlah'),
        unit: field.text('Satuan'),
        unit_cost: field.unitAmount('Harga satuan'),
        discount_percent: field.quantity('Diskon (%)'),
        vat_percent: field.quantity('PPN (%)'),
        amount: field.money('Nilai'),
        funding_source: field.text('Sumber dana'),
        procurement_program: field.text('Program pengadaan'),
        budget_year: field.text('Tahun anggaran'),
    }),
    subtotal: field.money('Jumlah sebelum PPN'),
    vat_amount: field.money('PPN'),
    total: field.money('Total', { words: true }),
};

const lineSchema = z.object({
    item_code: z.string(),
    item_name: z.string(),
    batch_number: z.string().nullable(),
    expiry_date: z.string().nullable(),
    quantity: z.string(),
    unit: z.string(),
    unit_cost: z.string(),
    discount_percent: z.string(),
    vat_percent: z.string(),
    amount: z.string(),
    funding_source: z.string().nullable(),
    procurement_program: z.string().nullable(),
    budget_year: z.string().nullable(),
});

const receiptSchema = z.object({
    operating_unit_id: z.string(),
    number: z.string(),
    posting_date: z.string(),
    is_draft: z.boolean(),
    is_cancelled: z.boolean(),
    vendor_number: z.string(),
    vendor_name: z.string(),
    vendor_document_number: z.string().nullable(),
    location_code: z.string(),
    location: z.string(),
    description: z.string().nullable(),
    prices_including_vat: z.boolean(),
    posted_at: z.string().nullable(),
    received_by: z.string().nullable(),
    lines: z.array(lineSchema),
    subtotal: z.string(),
    vat_amount: z.string(),
    total: z.string(),
});

async function receipt(db: Database, workspace: Workspace, receiptId: string) {
    workspace.guard('purchase-receipt', 'read');
    if (!lookupId(receiptId) || !workspace.legalEntityId) return null;
    const { amount_decimals: decimals } = await new Currency(
        db,
        workspace.tenantId,
    ).precision(localCurrencyCode);
    const row = await db.one(
        receiptSchema,
        `select h.operating_unit_id, h.nomor as number, h.tanggal::text as posting_date,
                h.status = 'draf' as is_draft, h.status = 'dibatalkan' as is_cancelled,
                v.number as vendor_number, p.name as vendor_name, h.no_dokumen_vendor as vendor_document_number,
                l.kode as location_code, l.nama as location, h.keterangan as description,
                h.termasuk_ppn as prices_including_vat, ${isoSql('h.diposting_pada')} as posted_at,
                coalesce(poster.name, creator.name) as received_by,
                coalesce(t.lines, '[]'::json) as lines,
                trim_scale(coalesce(t.subtotal, 0))::text as subtotal,
                trim_scale(coalesce(t.vat, 0))::text as vat_amount,
                trim_scale(coalesce(t.subtotal, 0) + coalesce(t.vat, 0))::text as total
         from bl_tr_penerimaan h
         join vendors v on v.tenant_id = h.tenant_id and v.id = h.vendor_id
         join parties p on p.tenant_id = v.tenant_id and p.id = v.party_id
         join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
         left join users poster on poster.id = h.diposting_oleh_user_id
         left join users creator on creator.id = h.created_by_user_id
         left join lateral (
             select json_agg(json_build_object(
                        'item_code', b.kode, 'item_name', b.nama, 'batch_number', d.no_batch,
                        'expiry_date', d.kedaluwarsa::text, 'quantity', trim_scale(d.jumlah)::text, 'unit', s.kode,
                        'unit_cost', trim_scale(d.harga_satuan)::text,
                        'discount_percent', trim_scale(d.diskon_persen)::text,
                        'vat_percent', trim_scale(d.tarif_ppn)::text, 'amount', trim_scale(d.amount)::text,
                        'funding_source', dana.nama, 'procurement_program', program.nama,
                        'budget_year', d.tahun_anggaran::text) order by d.urutan) as lines,
                    sum(d.amount) as subtotal, round(sum(d.amount * d.tarif_ppn / 100), ${decimals}) as vat
             from (select x.*, ${lineAmountSql('x', decimals)} as amount from bl_tr_penerimaan_detail x
                   where x.tenant_id = h.tenant_id and x.penerimaan_id = h.id and x.deleted_at is null) d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id
             left join gd_m_sumber_dana dana on dana.tenant_id = d.tenant_id and dana.id = d.sumber_dana_id
             left join gd_m_program_pengadaan program
                    on program.tenant_id = d.tenant_id and program.id = d.program_pengadaan_id) t on true
         where h.tenant_id = $1 and h.legal_entity_id = $2 and h.id = $3 and h.deleted_at is null`,
        [workspace.tenantId, workspace.legalEntityId, receiptId],
    );
    if (!row) return null;
    const { operating_unit_id, ...values } = row;
    return {
        legalEntityId: workspace.legalEntityId,
        operatingUnitId: operating_unit_id,
        fileName: `Penerimaan ${values.number}`,
        values,
    };
}

const sample: Values<typeof receiptFields> = {
    number: 'RC-00000011',
    posting_date: '2026-11-17',
    is_draft: false,
    is_cancelled: false,
    vendor_number: 'V-0001',
    vendor_name: 'PBF Contoh',
    vendor_document_number: 'FJ-2611-044',
    location_code: 'GUDANG',
    location: 'Gudang Farmasi',
    description: null,
    prices_including_vat: false,
    posted_at: '2026-11-17T03:00:00.000000Z',
    received_by: 'Petugas Gudang Contoh',
    lines: [
        {
            item_code: 'PCT-500',
            item_name: 'Parasetamol 500 mg',
            batch_number: 'B2611A',
            expiry_date: '2028-03-31',
            quantity: '10',
            unit: 'BOX',
            unit_cost: '15000',
            discount_percent: '0',
            vat_percent: '11',
            amount: '150000',
            funding_source: 'APBD',
            procurement_program: null,
            budget_year: '2026',
        },
    ],
    subtotal: '150000',
    vat_amount: '16500',
    total: '166500',
};

export const receiptReport = defineReport({
    code: 'core.purchase-receipt',
    name: 'Penerimaan barang',
    moduleId: 'core',
    permission: 'core.purchase-receipt.read',
    workspace: (context) => coreWorkspace(context),
    fields: receiptFields,
    sample: {
        legalEntityId: '00000000-0000-0000-0000-000000000000',
        operatingUnitId: null,
        fileName: 'Penerimaan RC-00000011',
        values: sample,
    },
    layouts: receiptLayouts,
    load: receipt,
});
