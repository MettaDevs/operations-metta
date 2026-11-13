import { z } from 'zod';
import type { Database } from '@core/platform/database/index.ts';
import { publishEvent } from '@core/platform/events/index.ts';
import { moduleId } from '../../module.ts';

// Retur yang diposting dan Batal retur, sebagai event untuk layanan kesehatan. Kontraknya ditulis tangan di
// contracts/events/pharmacy.return.posted.v1.yaml dan pharmacy.return.reversed.v1.yaml; mengubah isinya berarti versi
// baru.
export const returnPosted = `${moduleId}.return.posted.v1` as const;
export const returnReversed = `${moduleId}.return.reversed.v1` as const;

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

// Dipanggil di transaksi yang memposting atau membatalkan retur, sesudah statusnya ditulis. returned_base_quantity
// setiap baris adalah total retur yang masih berlaku atas baris resep itu sesudah perubahan ini, dalam satuan dasar,
// jadi penerima cukup menyalinnya dan hasilnya sama walau event diantar ulang. Retur hari ini hanya dalam satuan dasar,
// jadi unit sama dengan base_unit dan quantity sama dengan base_quantity.
export async function publishReturn(
    db: Database,
    scope: { tenantId: string; legalEntityId: string },
    returnId: string,
    type: typeof returnPosted | typeof returnReversed,
): Promise<void> {
    const header = await db.one(
        z.object({
            number: z.string(),
            return_date: z.string(),
            reason: z.string(),
            posted_at: z.string(),
            reversed_at: z.string().nullable(),
            operating_unit_id: z.string(),
            dispensing_id: z.string(),
            dispensing_number: z.string(),
            prescription_id: z.string(),
            prescription_number: z.string(),
            location: reference,
        }),
        `select h.nomor as number, h.tanggal::text as return_date, h.alasan as reason,
                to_char(h.diposting_pada, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as posted_at,
                to_char(h.dibatalkan_pada, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as reversed_at,
                h.operating_unit_id, f.id as dispensing_id, f.nomor as dispensing_number,
                r.resep_sumber_id as prescription_id, r.nomor_resep as prescription_number,
                json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location
         from retur_farmasi h
         join bill_farmasi f on f.tenant_id = h.tenant_id and f.id = h.bill_farmasi_id
         join far_tr_resep r on r.tenant_id = f.tenant_id and r.id = f.resep_id
         join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
         where h.tenant_id = $1 and h.legal_entity_id = $2 and h.id = $3`,
        [scope.tenantId, scope.legalEntityId, returnId],
    );
    if (!header) throw new Error(`Return ${returnId} was not found.`);
    const lines = await db.rows(
        z.object({
            prescription_line_id: z.string(),
            item: reference,
            unit: reference,
            quantity: z.string(),
            base_unit: reference,
            base_quantity: z.string(),
            returned_base_quantity: z.string(),
            batches: z.array(
                z.object({
                    batch_number: z.string().nullable(),
                    expiry_date: z.string().nullable(),
                    quantity: z.string(),
                }),
            ),
        }),
        `select rd.baris_sumber_id as prescription_line_id,
                json_build_object('id', b.id, 'code', b.kode, 'name', b.nama) as item,
                json_build_object('id', s.id, 'code', s.kode, 'name', s.nama) as unit,
                trim_scale(sum(d.jumlah))::text as quantity,
                json_build_object('id', s.id, 'code', s.kode, 'name', s.nama) as base_unit,
                trim_scale(sum(d.jumlah))::text as base_quantity,
                (select trim_scale(coalesce(sum(x.jumlah), 0))::text
                 from retur_farmasi_detail x
                 join retur_farmasi y on y.tenant_id = x.tenant_id and y.id = x.retur_farmasi_id
                 where x.tenant_id = d.tenant_id and x.bill_farmasi_detail_id = d.bill_farmasi_detail_id
                   and x.deleted_at is null and y.status = 'diposting' and y.deleted_at is null)
                    as returned_base_quantity,
                json_agg(json_build_object('batch_number', t.no_batch, 'expiry_date', t.kedaluwarsa,
                                           'quantity', trim_scale(d.jumlah)::text) order by d.urutan) as batches
         from retur_farmasi_detail d
         join bill_farmasi_detail fd on fd.tenant_id = d.tenant_id and fd.id = d.bill_farmasi_detail_id
         join far_tr_resep_detail rd on rd.tenant_id = fd.tenant_id and rd.id = fd.resep_detail_id
         join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
         join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
         left join gd_m_batch t on t.tenant_id = d.tenant_id and t.id = d.batch_id
         where d.tenant_id = $1 and d.retur_farmasi_id = $2 and d.deleted_at is null
         group by d.tenant_id, d.bill_farmasi_detail_id, rd.baris_sumber_id, b.id, s.id
         order by min(d.urutan)`,
        [scope.tenantId, returnId],
    );
    await publishEvent(db, {
        type,
        tenantId: scope.tenantId,
        legalEntityId: scope.legalEntityId,
        orgUnitId: header.operating_unit_id,
        data: {
            return_id: returnId,
            return_number: header.number,
            return_date: header.return_date,
            reason: header.reason,
            posted_at: header.posted_at,
            ...(type === returnReversed
                ? { reversed_at: header.reversed_at }
                : {}),
            dispensing_id: header.dispensing_id,
            dispensing_number: header.dispensing_number,
            prescription_id: header.prescription_id,
            prescription_number: header.prescription_number,
            location: header.location,
            lines,
        },
    });
}
