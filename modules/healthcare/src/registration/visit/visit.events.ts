import { z } from 'zod';
import type { Database } from '@core/platform/database/index.ts';
import { publishEvent } from '@core/platform/events/index.ts';
import { moduleId } from '../../module.ts';

// Kunjungan ke kasir. Kunjungan yang selesai (StatusPeriksa = 'CO' sistem lama) masuk Daftar Pembayaran, dengan potret
// pasien, tipe pasien, dan penjaminnya, supaya kasir tidak membaca tabel layanan kesehatan. Potret itu juga membawa
// jenis bayar legal entity kunjungan yang dikhususkan tipe pasien lain, yang ditolak kasir untuk kunjungan ini, dan
// jenis bayar otomatis tipe pasiennya bila tipe itu lunas otomatis di kasir. Kunjungan yang batal keluar dari daftar
// itu, dan kunjungan yang dibuka kembali keluar sampai selesai lagi. Kontraknya di contracts/events/.
export const visitCompleted = `${moduleId}.visit.completed.v1` as const;
export const visitCancelled = `${moduleId}.visit.cancelled.v1` as const;
export const visitReopened = `${moduleId}.visit.reopened.v1` as const;

const visitSchema = z.object({
    visit_id: z.string(),
    registration_number: z.string(),
    date: z.string(),
    registered_at: z.string(),
    legal_entity_id: z.string(),
    operating_unit_id: z.string().nullable(),
    patient: z.object({
        id: z.string(),
        medical_record_number: z.string(),
        name: z.string(),
    }),
    patient_type: z.object({ id: z.string(), name: z.string() }),
    guarantor: z.object({ id: z.string(), name: z.string() }).nullable(),
    card_number: z.string().nullable(),
    sections: z.array(z.object({ id: z.string(), name: z.string() })),
    restricted_payment_method_ids: z.array(z.string()),
    automatic_payment_method_id: z.string().nullable(),
});

async function visit(db: Database, tenantId: string, visitId: string) {
    const found = await db.one(
        visitSchema,
        `select r.id as visit_id, r.no_reg as registration_number, r.tanggal::text as date,
                to_char(r.didaftarkan_pada, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as registered_at,
                r.legal_entity_id, r.operating_unit_id,
                json_build_object('id', p.id, 'medical_record_number', p.nrm, 'name', pp.name) as patient,
                json_build_object('id', t.id, 'name', t.nama) as patient_type,
                case when g.id is null then null else json_build_object('id', g.id, 'name', gp.name) end as guarantor,
                r.no_kartu as card_number,
                coalesce((select json_agg(json_build_object('id', s.id, 'name', s.nama) order by d.urutan)
                          from sim_tr_registrasi_tujuan d
                          join sim_m_section s on s.tenant_id = d.tenant_id and s.id = d.section_id
                          where d.tenant_id = r.tenant_id and d.registrasi_id = r.id and d.deleted_at is null),
                         '[]'::json) as sections,
                coalesce((select json_agg(distinct j.jenis_bayar_id)
                          from sim_m_tipe_pasien_jenis_bayar j
                          join jenis_bayar b on b.tenant_id = j.tenant_id and b.id = j.jenis_bayar_id
                          where j.tenant_id = r.tenant_id and j.deleted_at is null
                            and b.legal_entity_id = r.legal_entity_id
                            and not exists (select 1 from sim_m_tipe_pasien_jenis_bayar k
                                            where k.tenant_id = j.tenant_id and k.jenis_bayar_id = j.jenis_bayar_id
                                              and k.tipe_pasien_id = r.tipe_pasien_id and k.deleted_at is null)),
                         '[]'::json) as restricted_payment_method_ids,
                (select o.jenis_bayar_id
                 from sim_m_tipe_pasien_jenis_bayar_otomatis o
                 join jenis_bayar b on b.tenant_id = o.tenant_id and b.id = o.jenis_bayar_id
                 join sim_m_tipe_pasien_perilaku p on p.tenant_id = o.tenant_id and p.tipe_pasien_id = o.tipe_pasien_id
                                                  and p.perilaku = 'settles_automatically' and p.deleted_at is null
                 where o.tenant_id = r.tenant_id and o.tipe_pasien_id = r.tipe_pasien_id and o.deleted_at is null
                   and b.legal_entity_id = r.legal_entity_id
                 order by o.id
                 limit 1) as automatic_payment_method_id
         from sim_tr_registrasi r
         join sim_m_pasien p on p.tenant_id = r.tenant_id and p.id = r.pasien_id
         join parties pp on pp.id = p.party_id
         join sim_m_tipe_pasien t on t.tenant_id = r.tenant_id and t.id = r.tipe_pasien_id
         left join sim_m_penjamin g on g.tenant_id = r.tenant_id and g.id = r.penjamin_id
         left join parties gp on gp.id = g.party_id
         where r.tenant_id = $1 and r.id = $2`,
        [tenantId, visitId],
    );
    if (!found) throw new Error(`Kunjungan ${visitId} tidak ada.`);
    return found;
}

export async function publishVisitCompleted(
    db: Database,
    tenantId: string,
    visitId: string,
): Promise<void> {
    const { legal_entity_id, operating_unit_id, ...data } = await visit(
        db,
        tenantId,
        visitId,
    );
    await publishEvent(db, {
        type: visitCompleted,
        tenantId,
        legalEntityId: legal_entity_id,
        ...(operating_unit_id ? { orgUnitId: operating_unit_id } : {}),
        data,
    });
}

export async function publishVisitCancelled(
    db: Database,
    tenantId: string,
    visitId: string,
): Promise<void> {
    await publishVisitChange(db, visitCancelled, tenantId, visitId);
}

export async function publishVisitReopened(
    db: Database,
    tenantId: string,
    visitId: string,
): Promise<void> {
    await publishVisitChange(db, visitReopened, tenantId, visitId);
}

async function publishVisitChange(
    db: Database,
    type: typeof visitCancelled | typeof visitReopened,
    tenantId: string,
    visitId: string,
): Promise<void> {
    const found = await visit(db, tenantId, visitId);
    await publishEvent(db, {
        type,
        tenantId,
        legalEntityId: found.legal_entity_id,
        ...(found.operating_unit_id
            ? { orgUnitId: found.operating_unit_id }
            : {}),
        data: {
            visit_id: found.visit_id,
            registration_number: found.registration_number,
        },
    });
}
