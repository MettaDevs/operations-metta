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
    type BuiltinLayout,
    type Values,
} from '../../../platform/reporting/index.ts';
import {
    stockCountResultLayouts,
    stockCountSheetLayouts,
} from './stock-count.layout.ts';
import { sourceType } from './stock-count.posting.ts';

// Satu dataset opname untuk dua dokumen Business Central: lembar hitung (Phys. Inventory List, dibawa petugas ke rak
// dengan kolom hitung kosong) dan hasil opname (Posted Phys. Invt. Order Diff, selisih dan nilainya). Keduanya laporan
// terpisah, supaya masing-masing punya layout bawaan sendiri per legal entity. Jumlah dalam satuan dasar barang.
export const stockCountFields = {
    number: field.text('Nomor opname'),
    count_date: field.date('Tanggal hitung'),
    posting_date: field.date('Tanggal posting'),
    is_draft: field.flag('Masih draf'),
    is_counted: field.flag('Selesai dihitung, belum diposting'),
    is_posted: field.flag('Sudah diposting'),
    is_cancelled: field.flag('Dibatalkan'),
    location_code: field.text('Kode lokasi'),
    location: field.text('Lokasi'),
    description: field.text('Keterangan'),
    counted_at: field.datetime('Waktu selesai hitung'),
    counted_by: field.text('Penghitung (pengguna yang menyelesaikan hitung)'),
    posted_at: field.datetime('Waktu posting'),
    posted_by: field.text('Pengguna yang memposting'),
    lines: field.lines('Barang', {
        item_code: field.text('Kode barang'),
        item_name: field.text('Nama barang'),
        batch_number: field.text('Nomor batch'),
        expiry_date: field.date('Kedaluwarsa'),
        unit: field.text('Satuan dasar'),
        quantity_recorded: field.quantity('Stok tercatat'),
        quantity_counted: field.quantity('Stok dihitung'),
        is_counted: field.flag('Sudah dihitung'),
        difference: field.quantity('Selisih (dihitung dikurangi tercatat)'),
        difference_amount: field.money('Nilai selisih'),
        note: field.text('Keterangan baris'),
    }),
    increase_amount: field.money('Nilai selisih lebih'),
    decrease_amount: field.money('Nilai selisih kurang'),
    net_amount: field.money('Nilai selisih bersih'),
};

const lineSchema = z.object({
    item_code: z.string(),
    item_name: z.string(),
    batch_number: z.string().nullable(),
    expiry_date: z.string().nullable(),
    unit: z.string(),
    quantity_recorded: z.string(),
    quantity_counted: z.string().nullable(),
    is_counted: z.boolean(),
    difference: z.string().nullable(),
    difference_amount: z.string().nullable(),
    note: z.string().nullable(),
});

const countSchema = z.object({
    operating_unit_id: z.string(),
    number: z.string(),
    count_date: z.string(),
    posting_date: z.string(),
    is_draft: z.boolean(),
    is_counted: z.boolean(),
    is_posted: z.boolean(),
    is_cancelled: z.boolean(),
    location_code: z.string(),
    location: z.string(),
    description: z.string().nullable(),
    counted_at: z.string().nullable(),
    counted_by: z.string().nullable(),
    posted_at: z.string().nullable(),
    posted_by: z.string().nullable(),
    lines: z.array(lineSchema),
    increase_amount: z.string(),
    decrease_amount: z.string(),
    net_amount: z.string(),
});

// Jumlah tercatat sesudah posting adalah yang dihitung ulang saat posting; sebelumnya potret saat baris dibuat. Nilai
// selisih dibaca dari baris kartu gudang yang ditulis posting opname, bukan dihitung ulang di sini.
async function stockCount(db: Database, workspace: Workspace, countId: string) {
    workspace.guard('inventory-count', 'read');
    if (!lookupId(countId) || !workspace.legalEntityId) return null;
    const bindings = [
        workspace.tenantId,
        workspace.legalEntityId,
        countId,
        sourceType,
    ];
    const row = await db.one(
        countSchema,
        `select h.operating_unit_id, h.nomor as number, h.tanggal::text as count_date,
                h.tanggal_posting::text as posting_date, h.status = 'draf' as is_draft,
                h.status = 'dihitung' as is_counted, h.status = 'diposting' as is_posted,
                h.status = 'dibatalkan' as is_cancelled, l.kode as location_code, l.nama as location,
                h.keterangan as description, ${isoSql('h.selesai_hitung_pada')} as counted_at,
                counter.name as counted_by, ${isoSql('h.diposting_pada')} as posted_at, poster.name as posted_by,
                coalesce(t.lines, '[]'::json) as lines,
                trim_scale(coalesce(t.increase, 0))::text as increase_amount,
                trim_scale(coalesce(t.decrease, 0))::text as decrease_amount,
                trim_scale(coalesce(t.increase, 0) - coalesce(t.decrease, 0))::text as net_amount
         from gd_tr_opname h
         join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
         left join users counter on counter.id = h.selesai_hitung_oleh_user_id
         left join users poster on poster.id = h.diposting_oleh_user_id
         left join lateral (
             select json_agg(json_build_object(
                        'item_code', d.item_code, 'item_name', d.item_name, 'batch_number', d.batch_number,
                        'expiry_date', d.expiry_date::text, 'unit', d.unit,
                        'quantity_recorded', trim_scale(d.recorded)::text,
                        'quantity_counted', trim_scale(d.counted)::text, 'is_counted', d.counted is not null,
                        'difference', trim_scale(d.counted - d.recorded)::text,
                        'difference_amount', trim_scale(d.amount)::text, 'note', d.note)
                        order by d.urutan) as lines,
                    sum(greatest(d.amount, 0)) as increase, sum(greatest(-d.amount, 0)) as decrease
             from (select x.urutan, b.kode as item_code, b.nama as item_name,
                          coalesce(batch.no_batch, x.no_batch) as batch_number,
                          coalesce(batch.kedaluwarsa, x.kedaluwarsa) as expiry_date, s.kode as unit,
                          case when h.status = 'diposting' then coalesce(x.jumlah_tercatat_posting, x.jumlah_tercatat)
                               else x.jumlah_tercatat end as recorded,
                          x.jumlah_dihitung as counted, x.keterangan as note,
                          (select sum(k.nilai) from gd_tr_kartu_gudang k
                           where k.tenant_id = x.tenant_id and k.sumber_jenis = $4 and k.sumber_id = h.id
                             and k.sumber_baris_id = x.id and k.dibalik_dari is null) as amount
                   from gd_tr_opname_detail x
                   join gd_m_barang b on b.tenant_id = x.tenant_id and b.id = x.barang_id
                   join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
                   left join gd_m_batch batch on batch.tenant_id = x.tenant_id and batch.id = x.batch_id
                   where x.tenant_id = h.tenant_id and x.opname_id = h.id and x.deleted_at is null) d) t on true
         where h.tenant_id = $1 and h.legal_entity_id = $2 and h.id = $3 and ${allowedLocationsSql(workspace, bindings, ['h.lokasi_id'])}`,
        bindings,
    );
    if (!row) return null;
    const { operating_unit_id, ...values } = row;
    return {
        legalEntityId: workspace.legalEntityId,
        operatingUnitId: operating_unit_id,
        fileName: `Opname ${values.number}`,
        values,
    };
}

const sample: Values<typeof stockCountFields> = {
    number: 'OPN-00000004',
    count_date: '2026-11-30',
    posting_date: '2026-11-30',
    is_draft: false,
    is_counted: false,
    is_posted: true,
    is_cancelled: false,
    location_code: 'FARMASI',
    location: 'Apotek',
    description: 'Opname akhir bulan',
    counted_at: '2026-11-30T08:00:00.000000Z',
    counted_by: 'Petugas Hitung Contoh',
    posted_at: '2026-11-30T09:00:00.000000Z',
    posted_by: 'Kepala Gudang Contoh',
    lines: [
        {
            item_code: 'PCT-500',
            item_name: 'Parasetamol 500 mg',
            batch_number: 'B2611A',
            expiry_date: '2028-03-31',
            unit: 'TAB',
            quantity_recorded: '120',
            quantity_counted: '118',
            is_counted: true,
            difference: '-2',
            difference_amount: '-300',
            note: 'Dua tablet rusak',
        },
        {
            item_code: 'ORS',
            item_name: 'Oralit',
            batch_number: null,
            expiry_date: null,
            unit: 'SACH',
            quantity_recorded: '40',
            quantity_counted: '40',
            is_counted: true,
            difference: '0',
            difference_amount: null,
            note: null,
        },
    ],
    increase_amount: '0',
    decrease_amount: '300',
    net_amount: '-300',
};

const report = (
    code: string,
    name: string,
    label: string,
    layouts: [BuiltinLayout, ...BuiltinLayout[]],
) =>
    defineReport({
        code,
        name,
        moduleId: 'core',
        permission: 'core.inventory-count.read',
        workspace: (context) => coreWorkspace(context),
        fields: stockCountFields,
        sample: {
            legalEntityId: '00000000-0000-0000-0000-000000000000',
            operatingUnitId: null,
            fileName: `${label} ${sample.number}`,
            values: sample,
        },
        layouts,
        load: async (db, workspace, id) => {
            const loaded = await stockCount(db, workspace, id);
            return (
                loaded && {
                    ...loaded,
                    fileName: `${label} ${loaded.values.number}`,
                }
            );
        },
    });

export const stockCountSheetReport = report(
    'core.stock-count-sheet',
    'Lembar hitung opname',
    'Lembar hitung',
    stockCountSheetLayouts,
);

export const stockCountResultReport = report(
    'core.stock-count-result',
    'Hasil opname',
    'Hasil opname',
    stockCountResultLayouts,
);
