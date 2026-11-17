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
import {
    transferReceiptLayouts,
    transferShipmentLayouts,
} from './posted-transfer.layout.ts';
import type { PostedTransferKind } from './posted-transfer.service.ts';

// Mutasi (Transfer Shipment BC, dokumen distribusi barang) dan penerimaan mutasi (Transfer Receipt BC). Satu baris per
// batch dan sumber dana yang berpindah, dengan kedaluwarsanya, karena barang farmasi diperiksa per batch saat serah
// terima. Jumlah dalam satuan baris amprah, nilai dari harga pokok kartu gudang.
export const postedTransferFields = {
    number: field.text('Nomor dokumen'),
    posting_date: field.date('Tanggal'),
    is_cancelled: field.flag('Posting dibatalkan'),
    two_step: field.flag('Lewat lokasi transit'),
    transfer_order_number: field.text('Nomor amprah'),
    transfer_order_date: field.date('Tanggal amprah'),
    from_location_code: field.text('Kode lokasi asal'),
    from_location: field.text('Lokasi asal'),
    to_location_code: field.text('Kode lokasi tujuan'),
    to_location: field.text('Lokasi tujuan'),
    transit_location: field.text('Lokasi transit'),
    posted_at: field.datetime('Waktu posting'),
    shipped_by: field.text('Pengirim (pengguna yang memposting kirim)'),
    received_by: field.text('Penerima (pengguna yang memposting terima)'),
    lines: field.lines('Barang', {
        item_code: field.text('Kode barang'),
        item_name: field.text('Nama barang'),
        batch_number: field.text('Nomor batch'),
        expiry_date: field.date('Kedaluwarsa'),
        quantity: field.quantity('Jumlah'),
        unit: field.text('Satuan'),
        quantity_base: field.quantity('Jumlah dalam satuan dasar'),
        base_unit: field.text('Satuan dasar'),
        funding_source: field.text('Sumber dana'),
        procurement_program: field.text('Program pengadaan'),
        budget_year: field.text('Tahun anggaran'),
        unit_cost: field.unitAmount('Harga satuan'),
        amount: field.money('Nilai'),
    }),
    total_amount: field.money('Total nilai', { words: true }),
};

const lineSchema = z.object({
    item_code: z.string(),
    item_name: z.string(),
    batch_number: z.string().nullable(),
    expiry_date: z.string().nullable(),
    quantity: z.string(),
    unit: z.string(),
    quantity_base: z.string(),
    base_unit: z.string(),
    funding_source: z.string().nullable(),
    procurement_program: z.string().nullable(),
    budget_year: z.string().nullable(),
    unit_cost: z.string(),
    amount: z.string(),
});

const documentSchema = z.object({
    operating_unit_id: z.string(),
    number: z.string(),
    posting_date: z.string(),
    is_cancelled: z.boolean(),
    two_step: z.boolean(),
    transfer_order_number: z.string(),
    transfer_order_date: z.string(),
    from_location_code: z.string(),
    from_location: z.string(),
    to_location_code: z.string(),
    to_location: z.string(),
    transit_location: z.string().nullable(),
    posted_at: z.string(),
    shipped_by: z.string().nullable(),
    received_by: z.string().nullable(),
    lines: z.array(lineSchema),
    total_amount: z.string(),
});

// Pengirim dan penerima dibaca dari pengguna yang memposting. Pada mutasi langsung pengirim juga yang menerimakan,
// jadi penerima kosong dan ditulis tangan. Pada penerimaan, pengirimnya adalah pemosting mutasi amprah yang sama.
// Kop ikut unit kerja lokasi yang menerbitkan: lokasi asal untuk mutasi, lokasi tujuan untuk penerimaan.
const kinds = {
    shipment: {
        header: 'gd_tr_mutasi',
        detail: 'gd_tr_mutasi_detail',
        parent: 'mutasi_id',
        from: 'h.lokasi_asal_id',
        twoStep: `h.cara_mutasi = 'kirim_terima'`,
        issuer: 'asal',
        shippedBy: 'poster.name',
        receivedBy: 'null::text',
    },
    receipt: {
        header: 'gd_tr_mutasi_terima',
        detail: 'gd_tr_mutasi_terima_detail',
        parent: 'mutasi_terima_id',
        from: 'h.lokasi_transit_id',
        twoStep: 'true',
        issuer: 'tujuan',
        shippedBy: `(select string_agg(distinct u.name, ', ')
                     from gd_tr_mutasi m join users u on u.id = m.diposting_oleh_user_id
                     where m.tenant_id = h.tenant_id and m.amprahan_id = h.amprahan_id and m.status = 'diposting')`,
        receivedBy: 'poster.name',
    },
} as const satisfies Record<PostedTransferKind, unknown>;

function loader(kind: PostedTransferKind, label: string) {
    const {
        header,
        detail,
        parent,
        from,
        twoStep,
        issuer,
        shippedBy,
        receivedBy,
    } = kinds[kind];
    return async (db: Database, workspace: Workspace, id: string) => {
        workspace.guard('inventory-transfer', 'read');
        if (!lookupId(id) || !workspace.legalEntityId) return null;
        const row = await db.one(
            documentSchema,
            `select ${issuer}.operating_unit_id, h.nomor as number, h.tanggal::text as posting_date,
                    h.status = 'dibatalkan' as is_cancelled, ${twoStep} as two_step,
                    a.nomor as transfer_order_number, a.tanggal::text as transfer_order_date,
                    asal.kode as from_location_code, asal.nama as from_location,
                    tujuan.kode as to_location_code, tujuan.nama as to_location, transit.nama as transit_location,
                    ${isoSql('h.diposting_pada')} as posted_at, ${shippedBy} as shipped_by,
                    ${receivedBy} as received_by,
                    coalesce((select json_agg(json_build_object(
                                     'item_code', b.kode, 'item_name', b.nama, 'batch_number', t.no_batch,
                                     'expiry_date', d.kedaluwarsa::text,
                                     'quantity', trim_scale(d.jumlah_dasar / d.konversi)::text, 'unit', s.kode,
                                     'quantity_base', trim_scale(d.jumlah_dasar)::text, 'base_unit', dasar.kode,
                                     'funding_source', dana.nama, 'procurement_program', program.nama,
                                     'budget_year', d.tahun_anggaran::text,
                                     'unit_cost', trim_scale(round(d.nilai * d.konversi / d.jumlah_dasar, 4))::text,
                                     'amount', trim_scale(d.nilai)::text)
                                     order by d.urutan, b.kode, d.kedaluwarsa nulls last)
                              from ${detail} d
                              join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
                              join gd_m_satuan dasar on dasar.tenant_id = b.tenant_id and dasar.id = b.satuan_dasar_id
                              join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id
                              left join gd_m_batch t on t.tenant_id = d.tenant_id and t.id = d.batch_id
                              left join gd_m_sumber_dana dana on dana.tenant_id = d.tenant_id and dana.id = d.sumber_dana_id
                              left join gd_m_program_pengadaan program
                                     on program.tenant_id = d.tenant_id and program.id = d.program_pengadaan_id
                              where d.tenant_id = h.tenant_id and d.${parent} = h.id), '[]'::json) as lines,
                    coalesce((select trim_scale(sum(d.nilai))::text from ${detail} d
                              where d.tenant_id = h.tenant_id and d.${parent} = h.id), '0') as total_amount
             from ${header} h
             join gd_tr_amprahan a on a.tenant_id = h.tenant_id and a.id = h.amprahan_id
             join gd_m_lokasi asal on asal.tenant_id = h.tenant_id and asal.id = ${from}
             join gd_m_lokasi tujuan on tujuan.tenant_id = h.tenant_id and tujuan.id = h.lokasi_tujuan_id
             left join gd_m_lokasi transit on transit.tenant_id = h.tenant_id and transit.id = h.lokasi_transit_id
             left join users poster on poster.id = h.diposting_oleh_user_id
             where h.tenant_id = $1 and h.legal_entity_id = $2 and h.id = $3`,
            [workspace.tenantId, workspace.legalEntityId, id],
        );
        if (!row) return null;
        const { operating_unit_id, ...values } = row;
        return {
            legalEntityId: workspace.legalEntityId,
            operatingUnitId: operating_unit_id,
            fileName: `${label} ${values.number}`,
            values,
        };
    };
}

const sample: Values<typeof postedTransferFields> = {
    number: 'MUT-00000003',
    posting_date: '2026-11-17',
    is_cancelled: false,
    two_step: false,
    transfer_order_number: 'AMP-00000007',
    transfer_order_date: '2026-11-16',
    from_location_code: 'GUDANG',
    from_location: 'Gudang Farmasi',
    to_location_code: 'PUSLING',
    to_location: 'Puskesmas Keliling',
    transit_location: null,
    posted_at: '2026-11-17T02:00:00.000000Z',
    shipped_by: 'Petugas Gudang Contoh',
    received_by: null,
    lines: [
        {
            item_code: 'PCT-500',
            item_name: 'Parasetamol 500 mg',
            batch_number: 'B2611A',
            expiry_date: '2028-03-31',
            quantity: '120',
            unit: 'TAB',
            quantity_base: '120',
            base_unit: 'TAB',
            funding_source: 'APBD',
            procurement_program: null,
            budget_year: '2026',
            unit_cost: '150',
            amount: '18000',
        },
        {
            item_code: 'PCT-500',
            item_name: 'Parasetamol 500 mg',
            batch_number: 'B2612B',
            expiry_date: '2028-06-30',
            quantity: '80',
            unit: 'TAB',
            quantity_base: '80',
            base_unit: 'TAB',
            funding_source: 'APBD',
            procurement_program: null,
            budget_year: '2026',
            unit_cost: '155',
            amount: '12400',
        },
    ],
    total_amount: '30400',
};

const report = (
    kind: PostedTransferKind,
    code: string,
    name: string,
    label: string,
    layouts: typeof transferShipmentLayouts,
) =>
    defineReport({
        code,
        name,
        moduleId: 'core',
        permission: 'core.inventory-transfer.read',
        workspace: (context) => coreWorkspace(context),
        fields: postedTransferFields,
        sample: {
            legalEntityId: '00000000-0000-0000-0000-000000000000',
            operatingUnitId: null,
            fileName: `${label} ${sample.number}`,
            values: sample,
        },
        layouts,
        load: loader(kind, label),
    });

export const transferShipmentReport = report(
    'shipment',
    'core.transfer-shipment',
    'Mutasi barang (kirim)',
    'Mutasi',
    transferShipmentLayouts,
);

export const transferReceiptReport = report(
    'receipt',
    'core.transfer-receipt',
    'Penerimaan mutasi',
    'Penerimaan mutasi',
    transferReceiptLayouts,
);
