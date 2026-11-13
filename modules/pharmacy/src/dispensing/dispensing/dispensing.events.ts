import { z } from 'zod';
import type { Database } from '@core/platform/database/index.ts';
import { publishEvent } from '@core/platform/events/index.ts';
import {
    fromNumeric,
    issuedSlices,
    quantityScale,
    toNumeric,
} from '@core/foundation/inventory/index.ts';
import { moduleId } from '../../module.ts';

// Obat resep sudah diserahkan, sebagai event untuk layanan kesehatan (E-Resep menampilkan yang diserahkan). Isinya
// potret saat diserahkan; kontraknya ditulis tangan di contracts/events/pharmacy.prescription.dispensed.v1.yaml, dan
// mengubah isinya berarti versi baru. unit dan quantity adalah satuan dan jumlah yang diserahkan, prescribed_unit dan
// prescribed_quantity seperti yang ditulis dokter, dan batch dalam satuan dasar seperti stok.
export const prescriptionDispensed =
    `${moduleId}.prescription.dispensed.v1` as const;

const text = (value: bigint) =>
    toNumeric(value, quantityScale).replace(/\.?0+$/, '');
const person = z.object({ id: z.string(), name: z.string() }).nullable();
const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

// Dipanggil di transaksi Serahkan, sesudah penyerahan ditandai diserahkan.
export async function publishPrescriptionDispensed(
    db: Database,
    scope: { tenantId: string; legalEntityId: string },
    dispensingId: string,
): Promise<void> {
    const header = await db.one(
        z.object({
            number: z.string(),
            dispensed_at: z.string(),
            prescription_id: z.string(),
            prescription_number: z.string(),
            operating_unit_id: z.string(),
            location: reference,
            pharmacist: person,
            assistant: person,
        }),
        `select h.nomor as number, to_char(h.diserahkan_pada, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as dispensed_at,
                r.resep_sumber_id as prescription_id, r.nomor_resep as prescription_number,
                r.operating_unit_id,
                json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
                (select json_build_object('id', u.id, 'name', u.name) from users u where u.id = h.apoteker_user_id)
                    as pharmacist,
                (select json_build_object('id', u.id, 'name', u.name) from users u where u.id = h.asisten_user_id)
                    as assistant
         from bill_farmasi h
         join far_tr_resep r on r.tenant_id = h.tenant_id and r.id = h.resep_id
         join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
         where h.tenant_id = $1 and h.legal_entity_id = $2 and h.id = $3`,
        [scope.tenantId, scope.legalEntityId, dispensingId],
    );
    if (!header) throw new Error(`Dispensing ${dispensingId} was not found.`);
    const lines = await db.rows(
        z.object({
            id: z.string(),
            prescription_line_id: z.string(),
            item: reference,
            unit: reference,
            quantity_per_unit: z.string(),
            base_unit: reference,
            base_quantity: z.string(),
            prescribed_unit: reference,
            prescribed_quantity: z.string(),
            quantity: z.string(),
            reason: z.string().nullable(),
        }),
        `select d.id, rd.baris_sumber_id as prescription_line_id,
                json_build_object('id', b.id, 'code', b.kode, 'name', b.nama) as item,
                json_build_object('id', s.id, 'code', s.kode, 'name', s.nama) as unit,
                trim_scale(d.konversi)::text as quantity_per_unit,
                json_build_object('id', bs.id, 'code', bs.kode, 'name', bs.nama) as base_unit,
                trim_scale(d.jumlah * d.konversi)::text as base_quantity,
                case when rd.satuan_id is null
                     then json_build_object('id', bs.id, 'code', bs.kode, 'name', bs.nama)
                     else json_build_object('id', rd.satuan_id, 'code', rd.kode_satuan, 'name', rd.nama_satuan)
                end as prescribed_unit,
                rd.jumlah::text as prescribed_quantity, d.jumlah::text as quantity, d.alasan as reason
         from bill_farmasi_detail d
         join far_tr_resep_detail rd on rd.tenant_id = d.tenant_id and rd.id = d.resep_detail_id
         join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
         join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id
         join gd_m_satuan bs on bs.tenant_id = b.tenant_id and bs.id = b.satuan_dasar_id
         where d.tenant_id = $1 and d.bill_farmasi_id = $2 and d.deleted_at is null
         order by d.urutan, d.id`,
        [scope.tenantId, dispensingId],
    );
    const slices = await issuedSlices(db, scope, {
        type: 'bill_farmasi',
        id: dispensingId,
    });
    await publishEvent(db, {
        type: prescriptionDispensed,
        tenantId: scope.tenantId,
        legalEntityId: scope.legalEntityId,
        orgUnitId: header.operating_unit_id,
        data: {
            dispensing_id: dispensingId,
            dispensing_number: header.number,
            prescription_id: header.prescription_id,
            prescription_number: header.prescription_number,
            dispensed_at: header.dispensed_at,
            location: header.location,
            pharmacist: header.pharmacist,
            assistant: header.assistant,
            lines: lines.map((line) => {
                const batches = new Map<
                    string,
                    {
                        batch_number: string | null;
                        expiry_date: string | null;
                        quantity: bigint;
                    }
                >();
                for (const slice of slices) {
                    if (slice.sourceLineId !== line.id) continue;
                    const key = JSON.stringify([
                        slice.batch?.number ?? null,
                        slice.batch?.expiry ?? null,
                    ]);
                    const batch = batches.get(key) ?? {
                        batch_number: slice.batch?.number ?? null,
                        expiry_date: slice.batch?.expiry ?? null,
                        quantity: 0n,
                    };
                    batch.quantity += slice.quantity;
                    batches.set(key, batch);
                }
                return {
                    prescription_line_id: line.prescription_line_id,
                    item: line.item,
                    unit: line.unit,
                    quantity_per_unit: line.quantity_per_unit,
                    base_unit: line.base_unit,
                    base_quantity: line.base_quantity,
                    prescribed_unit: line.prescribed_unit,
                    prescribed_quantity: text(
                        fromNumeric(line.prescribed_quantity, quantityScale),
                    ),
                    quantity: text(fromNumeric(line.quantity, quantityScale)),
                    reason: line.reason,
                    batches: [...batches.values()].map((batch) => ({
                        ...batch,
                        quantity: text(batch.quantity),
                    })),
                };
            }),
        },
    });
}
