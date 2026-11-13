import { z } from 'zod';
import type { Database } from '@core/platform/database/index.ts';
import { publishEvent } from '@core/platform/events/index.ts';
import { moduleId } from '../../module.ts';

// Biaya pemeriksaan ke kasir. Setiap Simpan rekam medis yang membawa Biaya Tindakan menerbitkan potret penuh baris
// tindakan pemeriksaan itu beserta tarif dan komponen yang dibekukan saat baris pertama kali disimpan, seperti sistem
// lama yang menulis ulang SIMtrRJTransaksi setiap kali poli menyimpan. Kasir mengganti baris terbuka pemeriksaan itu
// dengan potret ini, jadi Simpan yang diulang tidak menggandakan baris. Kontraknya
// contracts/events/healthcare.examination.charges-replaced.v1.yaml.
export const chargesReplaced =
    `${moduleId}.examination.charges-replaced.v1` as const;

const lineSchema = z.object({
    line_id: z.string(),
    procedure_id: z.string(),
    procedure_code: z.string(),
    procedure_name: z.string(),
    service_group_id: z.string().nullable(),
    service_group_name: z.string().nullable(),
    service_group_order: z.number().nullable(),
    category_name: z.string().nullable(),
    quantity: z.string(),
    tariff: z.string(),
    doctor_id: z.string().nullable(),
    doctor_name: z.string().nullable(),
    section_id: z.string(),
    section_name: z.string(),
    date: z.string(),
    components: z.array(
        z.object({ charge_component_id: z.string(), value: z.string() }),
    ),
});

const headerSchema = z.object({
    examination_id: z.string(),
    visit_id: z.string(),
    registration_number: z.string(),
    legal_entity_id: z.string(),
    operating_unit_id: z.string().nullable(),
});

export async function publishExaminationCharges(
    db: Database,
    tenantId: string,
    examinationId: string,
): Promise<void> {
    const header = await db.one(
        headerSchema,
        `select p.id as examination_id, r.id as visit_id, r.no_reg as registration_number, r.legal_entity_id,
                r.operating_unit_id
         from sim_tr_pemeriksaan p join sim_tr_registrasi r on r.tenant_id = p.tenant_id and r.id = p.registrasi_id
         where p.tenant_id = $1 and p.id = $2`,
        [tenantId, examinationId],
    );
    if (!header) throw new Error(`Pemeriksaan ${examinationId} tidak ada.`);
    const lines = await db.rows(
        lineSchema,
        `select t.id as line_id, m.id as procedure_id, m.kode as procedure_code, m.nama as procedure_name,
                g.id as service_group_id, g.nama as service_group_name, g.urutan as service_group_order,
                k.nama as category_name, trim_scale(t.jumlah::numeric)::text as quantity,
                trim_scale(t.tarif)::text as tariff, t.dokter_id as doctor_id, dp.name as doctor_name,
                s.id as section_id, s.nama as section_name, r.tanggal::text as date,
                coalesce((select json_agg(json_build_object('charge_component_id', c.komponen_biaya_id,
                                                            'value', trim_scale(c.harga)::text)
                                          order by c.komponen_biaya_id)
                          from sim_tr_pemeriksaan_tindakan_komponen c
                          where c.tenant_id = t.tenant_id and c.pemeriksaan_tindakan_id = t.id
                            and c.deleted_at is null), '[]'::json) as components
         from sim_tr_pemeriksaan_tindakan t
         join sim_tr_pemeriksaan p on p.tenant_id = t.tenant_id and p.id = t.pemeriksaan_id
         join sim_tr_registrasi r on r.tenant_id = p.tenant_id and r.id = p.registrasi_id
         join sim_tr_registrasi_tujuan d on d.tenant_id = p.tenant_id and d.id = p.tujuan_id
         join sim_m_section s on s.tenant_id = d.tenant_id and s.id = d.section_id
         join sim_m_tindakan m on m.tenant_id = t.tenant_id and m.id = t.tindakan_id
         left join sim_m_tindakan_kelompok g on g.tenant_id = m.tenant_id and g.id = m.kelompok_id
         left join sim_m_tindakan_kategori k on k.tenant_id = m.tenant_id and k.id = m.kategori_id
         left join sim_m_nakes n on n.tenant_id = t.tenant_id and n.id = t.dokter_id
         left join parties dp on dp.id = n.party_id
         where t.tenant_id = $1 and t.pemeriksaan_id = $2 and t.deleted_at is null
         order by t.urutan, t.id`,
        [tenantId, examinationId],
    );
    await publishEvent(db, {
        type: chargesReplaced,
        tenantId,
        legalEntityId: header.legal_entity_id,
        ...(header.operating_unit_id
            ? { orgUnitId: header.operating_unit_id }
            : {}),
        data: {
            examination_id: header.examination_id,
            visit_id: header.visit_id,
            registration_number: header.registration_number,
            lines,
        },
    });
}
