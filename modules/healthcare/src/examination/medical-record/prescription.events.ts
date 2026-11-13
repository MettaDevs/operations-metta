import { z } from 'zod';
import type { Database } from '@core/platform/database/index.ts';
import { publishEvent } from '@core/platform/events/index.ts';
import { moduleId } from '../../module.ts';

// Resep yang dikirim ke farmasi, sebagai event untuk module farmasi. Farmasi tidak membaca tabel module ini, jadi isinya
// potret lengkap saat resep dikirim: nomor, kunjungan, pasien beserta Patient KTP kunjungan, dokter, section asal,
// kelompok harga pembeli, dan baris beserta barang Core-nya.
// Legal entity dan unit kunjungan ada di envelope. Kontraknya ditulis tangan di
// contracts/events/healthcare.prescription.issued.v1.yaml; mengubah isinya berarti versi baru.
export const prescriptionIssued = `${moduleId}.prescription.issued.v1` as const;

const headerSchema = z.object({
    number: z.string(),
    notes: z.string().nullable(),
    registration_number: z.string(),
    legal_entity_id: z.string(),
    operating_unit_id: z.string(),
    patient_id: z.string(),
    medical_record_number: z.string(),
    patient_name: z.string(),
    birth_date: z.string().nullable(),
    ktp_patient: z.boolean(),
    doctor_id: z.string().nullable(),
    doctor_name: z.string().nullable(),
    section_id: z.string(),
    section_name: z.string(),
    price_group_id: z.string().nullable(),
    price_group_code: z.string().nullable(),
    price_group_name: z.string().nullable(),
});

const lineSchema = z.object({
    id: z.string(),
    order: z.number(),
    compound: z.number().nullable(),
    quantity: z.string().nullable(),
    requested_quantity: z.string().nullable(),
    signa: z.string().nullable(),
    usage_instruction: z.string().nullable(),
    notes: z.string().nullable(),
    item_id: z.string().nullable(),
    item_code: z.string().nullable(),
    item_name: z.string().nullable(),
    unit_id: z.string().nullable(),
    unit_code: z.string().nullable(),
    unit_name: z.string().nullable(),
    quantity_per_unit: z.string().nullable(),
    base_unit_id: z.string().nullable(),
    base_unit_code: z.string().nullable(),
    base_unit_name: z.string().nullable(),
    base_quantity: z.string().nullable(),
});

const reference = (
    id: string | null,
    code: string | null,
    name: string | null,
) => (id === null ? null : { id, code, name });

// Dipanggil di transaksi yang mengubah resep dari draf menjadi dikirim, sesudah nomor dan dokternya ditulis.
export async function publishPrescriptionIssued(
    db: Database,
    tenantId: string,
    prescriptionId: string,
    issuedAt: string,
): Promise<void> {
    const header = await db.one(
        headerSchema,
        `select r.nomor as number, r.catatan as notes, g.no_reg as registration_number, g.legal_entity_id,
                g.operating_unit_id, k.id as patient_id, k.nrm as medical_record_number, pp.name as patient_name,
                pp.birth_date::text as birth_date, g.pasien_ktp as ktp_patient, r.dokter_id as doctor_id,
                dp.name as doctor_name,
                t.section_id, s.nama as section_name, kh.id as price_group_id, kh.kode as price_group_code,
                kh.nama as price_group_name
         from sim_tr_resep r
         join sim_tr_pemeriksaan e on e.tenant_id = r.tenant_id and e.id = r.pemeriksaan_id
         join sim_tr_registrasi_tujuan t on t.tenant_id = e.tenant_id and t.id = e.tujuan_id
         join sim_tr_registrasi g on g.tenant_id = e.tenant_id and g.id = e.registrasi_id
         join sim_m_pasien k on k.tenant_id = g.tenant_id and k.id = g.pasien_id
         join parties pp on pp.tenant_id = k.tenant_id and pp.id = k.party_id
         join sim_m_section s on s.tenant_id = t.tenant_id and s.id = t.section_id
         join sim_m_tipe_pasien tp on tp.tenant_id = g.tenant_id and tp.id = g.tipe_pasien_id
         left join kelompok_harga kh on kh.tenant_id = tp.tenant_id and kh.id = tp.kelompok_harga_id
         left join sim_m_nakes dn on dn.tenant_id = r.tenant_id and dn.id = r.dokter_id
         left join parties dp on dp.tenant_id = dn.tenant_id and dp.id = dn.party_id
         where r.tenant_id = $1 and r.id = $2`,
        [tenantId, prescriptionId],
    );
    if (!header)
        throw new Error(`Prescription ${prescriptionId} was not found.`);
    const lines = await db.rows(
        lineSchema,
        `select d.id, d.urutan as "order", d.racikan_ke as compound, trim_scale(d.jumlah)::text as quantity,
                trim_scale(d.jumlah_permintaan)::text as requested_quantity, d.signa, a.nama as usage_instruction,
                d.keterangan as notes, b.id as item_id, b.kode as item_code, b.nama as item_name, u.id as unit_id,
                u.kode as unit_code, u.nama as unit_name, trim_scale(d.konversi)::text as quantity_per_unit,
                bu.id as base_unit_id, bu.kode as base_unit_code, bu.nama as base_unit_name,
                trim_scale(d.jumlah * d.konversi)::text as base_quantity
         from sim_tr_resep_detail d
         left join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.obat_id
         left join gd_m_satuan u on u.tenant_id = d.tenant_id and u.id = d.satuan_id
         left join gd_m_satuan bu on bu.tenant_id = b.tenant_id and bu.id = b.satuan_dasar_id
         left join sim_m_aturan_pakai a on a.tenant_id = d.tenant_id and a.id = d.aturan_pakai_id
         where d.tenant_id = $1 and d.resep_id = $2 and d.deleted_at is null
         order by d.urutan, d.id`,
        [tenantId, prescriptionId],
    );
    await publishEvent(db, {
        type: prescriptionIssued,
        tenantId,
        legalEntityId: header.legal_entity_id,
        orgUnitId: header.operating_unit_id,
        data: {
            prescription_id: prescriptionId,
            prescription_number: header.number,
            registration_number: header.registration_number,
            issued_at: `${issuedAt.replace(' ', 'T')}Z`,
            notes: header.notes,
            patient: {
                id: header.patient_id,
                medical_record_number: header.medical_record_number,
                name: header.patient_name,
                birth_date: header.birth_date,
                // Nilai kunjungan, bukan nilai pasien sekarang; farmasi memilih baris grading harga obat dengannya.
                ktp: header.ktp_patient,
            },
            doctor:
                header.doctor_id === null
                    ? null
                    : { id: header.doctor_id, name: header.doctor_name },
            section: { id: header.section_id, name: header.section_name },
            // Kelompok harga tipe pasien kunjungan saat resep dikirim; farmasi menghitung harga obat dengannya.
            price_group: reference(
                header.price_group_id,
                header.price_group_code,
                header.price_group_name,
            ),
            lines: lines.map((line) => ({
                id: line.id,
                order: line.order,
                item: reference(line.item_id, line.item_code, line.item_name),
                compound: line.compound,
                quantity: line.quantity,
                unit: reference(line.unit_id, line.unit_code, line.unit_name),
                quantity_per_unit: line.quantity_per_unit,
                base_unit: reference(
                    line.base_unit_id,
                    line.base_unit_code,
                    line.base_unit_name,
                ),
                base_quantity: line.base_quantity,
                requested_quantity: line.requested_quantity,
                signa: line.signa,
                usage_instruction: line.usage_instruction,
                notes: line.notes,
            })),
        },
    });
}
