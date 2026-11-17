import { z } from 'zod';
import { allowedLocationsSql } from '../warehouse-employee/location-access.ts';
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
import { adjustmentLayouts } from './adjustment.layout.ts';
import { sourceType } from './adjustment.service.ts';

// Penyesuaian stok (Item Journal BC dengan Reason Code): stok masuk atau keluar beralasan, termasuk pemakaian sendiri,
// pemusnahan, dan obat kedaluwarsa. Dokumen yang sudah diposting dicetak dari baris kartu gudangnya, karena batch stok
// keluar baru ditentukan saat posting; draf dicetak dari barisnya.
export const adjustmentFields = {
    number: field.text('Nomor penyesuaian'),
    posting_date: field.date('Tanggal'),
    is_inbound: field.flag('Stok masuk (kosong berarti stok keluar)'),
    is_draft: field.flag('Masih draf'),
    is_cancelled: field.flag('Posting dibatalkan'),
    reason_code: field.text('Kode alasan'),
    reason: field.text('Alasan'),
    location_code: field.text('Kode lokasi'),
    location: field.text('Lokasi'),
    posted_at: field.datetime('Waktu posting'),
    posted_by: field.text('Petugas (pengguna yang memposting)'),
    lines: field.lines('Barang', {
        item_code: field.text('Kode barang'),
        item_name: field.text('Nama barang'),
        batch_number: field.text('Nomor batch'),
        expiry_date: field.date('Kedaluwarsa'),
        quantity: field.quantity('Jumlah'),
        unit: field.text('Satuan dasar'),
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
    unit_cost: z.string().nullable(),
    amount: z.string().nullable(),
});

const adjustmentSchema = z.object({
    operating_unit_id: z.string(),
    number: z.string(),
    posting_date: z.string(),
    is_inbound: z.boolean(),
    is_draft: z.boolean(),
    is_cancelled: z.boolean(),
    reason_code: z.string(),
    reason: z.string(),
    location_code: z.string(),
    location: z.string(),
    posted_at: z.string().nullable(),
    posted_by: z.string().nullable(),
    lines: z.array(lineSchema),
    total_amount: z.string(),
});

async function adjustment(
    db: Database,
    workspace: Workspace,
    adjustmentId: string,
) {
    workspace.guard('inventory-adjustment', 'read');
    if (!lookupId(adjustmentId) || !workspace.legalEntityId) return null;
    const bindings = [
        workspace.tenantId,
        workspace.legalEntityId,
        adjustmentId,
        sourceType,
    ];
    const row = await db.one(
        adjustmentSchema,
        `select h.operating_unit_id, h.nomor as number, h.tanggal::text as posting_date,
                h.arah = 'masuk' as is_inbound, h.status = 'draf' as is_draft,
                h.status = 'dibatalkan' as is_cancelled, a.kode as reason_code, a.nama as reason,
                l.kode as location_code, l.nama as location, ${isoSql('h.diposting_pada')} as posted_at,
                coalesce(poster.name, creator.name) as posted_by,
                coalesce(t.lines, '[]'::json) as lines, trim_scale(coalesce(t.total, 0))::text as total_amount
         from gd_tr_penyesuaian h
         join gd_m_alasan a on a.tenant_id = h.tenant_id and a.id = h.alasan_id
         join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
         left join users poster on poster.id = h.diposting_oleh_user_id
         left join users creator on creator.id = h.created_by_user_id
         left join lateral (
             select json_agg(json_build_object(
                        'item_code', b.kode, 'item_name', b.nama, 'batch_number', e.batch_number,
                        'expiry_date', e.expiry_date::text, 'quantity', trim_scale(e.quantity)::text, 'unit', s.kode,
                        'unit_cost', trim_scale(round(e.amount / e.quantity, 4))::text,
                        'amount', trim_scale(e.amount)::text)
                        order by e.line_no, e.entry_order) as lines,
                    sum(e.amount) as total
             from (
                 select d.urutan as line_no, k.id::text as entry_order, k.barang_id, batch.no_batch as batch_number,
                        k.kedaluwarsa as expiry_date, abs(k.jumlah) as quantity, abs(k.nilai) as amount
                 from gd_tr_kartu_gudang k
                 join gd_tr_penyesuaian_detail d on d.tenant_id = k.tenant_id and d.id = k.sumber_baris_id
                 left join gd_m_batch batch on batch.tenant_id = k.tenant_id and batch.id = k.batch_id
                 where h.status <> 'draf' and k.tenant_id = h.tenant_id and k.sumber_jenis = $4
                   and k.sumber_id = h.id and k.dibalik_dari is null
                 union all
                 select d.urutan, '', d.barang_id, coalesce(batch.no_batch, d.no_batch),
                        coalesce(batch.kedaluwarsa, d.kedaluwarsa), d.jumlah, d.jumlah * d.harga_satuan
                 from gd_tr_penyesuaian_detail d
                 left join gd_m_batch batch on batch.tenant_id = d.tenant_id and batch.id = d.batch_id
                 where h.status = 'draf' and d.tenant_id = h.tenant_id and d.penyesuaian_id = h.id
                   and d.deleted_at is null) e
             join gd_m_barang b on b.tenant_id = h.tenant_id and b.id = e.barang_id
             join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id) t on true
         where h.tenant_id = $1 and h.legal_entity_id = $2 and h.id = $3 and h.deleted_at is null and ${allowedLocationsSql(workspace, bindings, ['h.lokasi_id'])}`,
        bindings,
    );
    if (!row) return null;
    const { operating_unit_id, ...values } = row;
    return {
        legalEntityId: workspace.legalEntityId,
        operatingUnitId: operating_unit_id,
        fileName: `Penyesuaian ${values.number}`,
        values,
    };
}

const sample: Values<typeof adjustmentFields> = {
    number: 'ADJ-00000009',
    posting_date: '2026-11-25',
    is_inbound: false,
    is_draft: false,
    is_cancelled: false,
    reason_code: 'PEMUSNAHAN',
    reason: 'Pemusnahan obat rusak',
    location_code: 'GUDANG-ED',
    location: 'Gudang obat kedaluwarsa',
    posted_at: '2026-11-25T04:00:00.000000Z',
    posted_by: 'Petugas Gudang Contoh',
    lines: [
        {
            item_code: 'AMX-500',
            item_name: 'Amoksisilin 500 mg',
            batch_number: 'A2401',
            expiry_date: '2026-10-31',
            quantity: '35',
            unit: 'TAB',
            unit_cost: '420',
            amount: '14700',
        },
    ],
    total_amount: '14700',
};

export const adjustmentReport = defineReport({
    code: 'core.inventory-adjustment',
    name: 'Penyesuaian stok',
    moduleId: 'core',
    permission: 'core.inventory-adjustment.read',
    workspace: (context) => coreWorkspace(context),
    fields: adjustmentFields,
    sample: {
        legalEntityId: '00000000-0000-0000-0000-000000000000',
        operatingUnitId: null,
        fileName: 'Penyesuaian ADJ-00000009',
        values: sample,
    },
    layouts: adjustmentLayouts,
    load: adjustment,
});
