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
import { transferOrderLayouts } from './transfer-order.layout.ts';

// Permintaan barang (amprah), padanan report Transfer Order Business Central: lokasi peminta meminta barang ke lokasi
// pemasok. Dicetak dari amprah dalam keadaan apa pun; draf dan amprah batal ditandai di kertas. Jumlah dalam satuan
// baris, beserta yang sudah dikirim dan diterima, supaya cetak ulang menunjukkan keadaan amprah sekarang.
export const transferOrderFields = {
    number: field.text('Nomor amprah'),
    posting_date: field.date('Tanggal'),
    is_draft: field.flag('Masih draf'),
    is_cancelled: field.flag('Dibatalkan'),
    is_closed: field.flag('Selesai'),
    requesting_location_code: field.text('Kode lokasi peminta'),
    requesting_location: field.text('Lokasi peminta'),
    supplying_location_code: field.text('Kode lokasi pemasok'),
    supplying_location: field.text('Lokasi pemasok'),
    transit_location: field.text('Lokasi transit'),
    description: field.text('Keterangan'),
    submitted_at: field.datetime('Waktu diajukan'),
    requested_by: field.text('Peminta (pengguna yang mengajukan)'),
    lines: field.lines('Barang', {
        item_code: field.text('Kode barang'),
        item_name: field.text('Nama barang'),
        unit: field.text('Satuan'),
        quantity: field.quantity('Jumlah diminta'),
        quantity_shipped: field.quantity('Jumlah dikirim'),
        quantity_received: field.quantity('Jumlah diterima'),
        quantity_outstanding: field.quantity('Belum dikirim'),
    }),
};

const lineSchema = z.object({
    item_code: z.string(),
    item_name: z.string(),
    unit: z.string(),
    quantity: z.string(),
    quantity_shipped: z.string(),
    quantity_received: z.string(),
    quantity_outstanding: z.string(),
});

const orderSchema = z.object({
    operating_unit_id: z.string(),
    number: z.string(),
    posting_date: z.string(),
    is_draft: z.boolean(),
    is_cancelled: z.boolean(),
    is_closed: z.boolean(),
    requesting_location_code: z.string(),
    requesting_location: z.string(),
    supplying_location_code: z.string(),
    supplying_location: z.string(),
    transit_location: z.string().nullable(),
    description: z.string().nullable(),
    submitted_at: z.string().nullable(),
    requested_by: z.string().nullable(),
    lines: z.array(lineSchema),
});

// Kop dan penanda tangan ikut unit kerja lokasi peminta, karena peminta yang menerbitkan amprah.
async function transferOrder(
    db: Database,
    workspace: Workspace,
    orderId: string,
) {
    workspace.guard('inventory-transfer', 'read');
    if (!lookupId(orderId) || !workspace.legalEntityId) return null;
    const row = await db.one(
        orderSchema,
        `select peminta.operating_unit_id, a.nomor as number, a.tanggal::text as posting_date,
                a.status = 'draf' as is_draft, a.status = 'dibatalkan' as is_cancelled,
                a.status = 'selesai' as is_closed,
                peminta.kode as requesting_location_code, peminta.nama as requesting_location,
                pemasok.kode as supplying_location_code, pemasok.nama as supplying_location,
                transit.nama as transit_location, a.keterangan as description,
                ${isoSql('a.diajukan_pada')} as submitted_at,
                coalesce(diajukan.name, pembuat.name) as requested_by,
                coalesce((select json_agg(json_build_object(
                                 'item_code', b.kode, 'item_name', b.nama, 'unit', s.kode,
                                 'quantity', trim_scale(d.jumlah_diminta)::text,
                                 'quantity_shipped', trim_scale(d.jumlah_dikirim)::text,
                                 'quantity_received', trim_scale(d.jumlah_diterima)::text,
                                 'quantity_outstanding', trim_scale(d.jumlah_diminta - d.jumlah_dikirim)::text)
                                 order by d.urutan)
                          from gd_tr_amprahan_detail d
                          join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
                          join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id
                          where d.tenant_id = a.tenant_id and d.amprahan_id = a.id and d.deleted_at is null),
                         '[]'::json) as lines
         from gd_tr_amprahan a
         join gd_m_lokasi peminta on peminta.tenant_id = a.tenant_id and peminta.id = a.lokasi_peminta_id
         join gd_m_lokasi pemasok on pemasok.tenant_id = a.tenant_id and pemasok.id = a.lokasi_pemasok_id
         left join gd_m_lokasi transit on transit.tenant_id = a.tenant_id and transit.id = a.lokasi_transit_id
         left join users diajukan on diajukan.id = a.diajukan_oleh_user_id
         left join users pembuat on pembuat.id = a.created_by_user_id
         where a.tenant_id = $1 and a.legal_entity_id = $2 and a.id = $3 and a.deleted_at is null`,
        [workspace.tenantId, workspace.legalEntityId, orderId],
    );
    if (!row) return null;
    const { operating_unit_id, ...values } = row;
    return {
        legalEntityId: workspace.legalEntityId,
        operatingUnitId: operating_unit_id,
        fileName: `Amprah ${values.number}`,
        values,
    };
}

const sample: Values<typeof transferOrderFields> = {
    number: 'AMP-00000007',
    posting_date: '2026-11-17',
    is_draft: false,
    is_cancelled: false,
    is_closed: false,
    requesting_location_code: 'PUSLING',
    requesting_location: 'Puskesmas Keliling',
    supplying_location_code: 'GUDANG',
    supplying_location: 'Gudang Farmasi',
    transit_location: null,
    description: 'Kebutuhan kunjungan minggu ketiga',
    submitted_at: '2026-11-17T01:30:00.000000Z',
    requested_by: 'Petugas Contoh',
    lines: [
        {
            item_code: 'PCT-500',
            item_name: 'Parasetamol 500 mg',
            unit: 'TAB',
            quantity: '200',
            quantity_shipped: '0',
            quantity_received: '0',
            quantity_outstanding: '200',
        },
        {
            item_code: 'ORS',
            item_name: 'Oralit',
            unit: 'SACH',
            quantity: '50',
            quantity_shipped: '0',
            quantity_received: '0',
            quantity_outstanding: '50',
        },
    ],
};

export const transferOrderReport = defineReport({
    code: 'core.transfer-order',
    name: 'Permintaan barang (amprah)',
    moduleId: 'core',
    permission: 'core.inventory-transfer.read',
    workspace: (context) => coreWorkspace(context),
    fields: transferOrderFields,
    sample: {
        legalEntityId: '00000000-0000-0000-0000-000000000000',
        operatingUnitId: null,
        fileName: 'Amprah AMP-00000007',
        values: sample,
    },
    layouts: transferOrderLayouts,
    load: transferOrder,
});
