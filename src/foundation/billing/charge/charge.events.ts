import { z } from 'zod';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    alreadyProcessed,
    type EventEnvelope,
} from '../../../platform/events/index.ts';

// Penerima event biaya dan kunjungan dari module. Core tidak meng-import module, jadi nama event dan bentuk datanya
// ditulis di sini sesuai kontraknya (contracts/events/). Isi yang tidak cocok dicatat ke log lalu dilewati, karena
// penerima tidak boleh membatalkan transaksi penerbit karena aturannya sendiri.

const source = 'healthcare';
export const chargesReplaced =
    'healthcare.examination.charges-replaced.v1' as const;
export const visitCompleted = 'healthcare.visit.completed.v1' as const;
export const visitCancelled = 'healthcare.visit.cancelled.v1' as const;
export const visitReopened = 'healthcare.visit.reopened.v1' as const;
const processedTable = 'kasir_event_diproses';

const chargesSchema = z.object({
    examination_id: z.string(),
    visit_id: z.string(),
    lines: z.array(
        z.object({
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
                z.object({
                    charge_component_id: z.string(),
                    value: z.string(),
                }),
            ),
        }),
    ),
});

const visitSchema = z.object({
    visit_id: z.string(),
    registration_number: z.string(),
    date: z.string(),
    registered_at: z.string(),
    patient: z.object({
        id: z.string(),
        medical_record_number: z.string(),
        name: z.string(),
    }),
    patient_type: z.object({ id: z.string(), name: z.string() }),
    guarantor: z.object({ id: z.string(), name: z.string() }).nullable(),
    card_number: z.string().nullable(),
    sections: z.array(z.object({ id: z.string(), name: z.string() })),
});

const visitIdSchema = z.object({ visit_id: z.string() });

function parsed<S extends z.ZodType>(
    schema: S,
    envelope: EventEnvelope,
): z.output<S> | null {
    const result = schema.safeParse(envelope.data);
    if (result.success && envelope.legal_entity_id) return result.data;
    process.stderr.write(
        JSON.stringify({
            event: 'billing-event-skipped',
            type: envelope.type,
            event_id: envelope.id,
            tenant_id: envelope.tenant_id,
            fields: result.error?.issues.map((issue) =>
                issue.path.join('.'),
            ) ?? ['legal_entity_id'],
        }) + '\n',
    );
    return null;
}

// Potret penuh baris biaya satu pemeriksaan. Baris terbuka diubah di tempat, baris baru ditambah, dan baris terbuka
// yang tidak ada lagi di potret dihapus lunak. Baris yang sudah ditagih tidak disentuh: module menolak mengubahnya
// sebelum event ini terbit.
export async function receiveCharges(
    db: Database,
    envelope: EventEnvelope,
): Promise<void> {
    const data = parsed(chargesSchema, envelope);
    if (!data || !envelope.legal_entity_id) return;
    if (await alreadyProcessed(db, processedTable, envelope)) return;
    const tenantId = envelope.tenant_id;
    const stamp = nowSql();
    const kept = data.lines.map((line) => line.line_id);
    const retired = await db.rows(
        z.object({ id: z.string() }),
        `update kunjungan_kasir_detail set deleted_at = $1, updated_at = $1
         where tenant_id = $2 and sumber_module = $3 and sumber_dokumen_id = $4 and status = 'terbuka'
           and deleted_at is null and not (sumber_baris_id = any($5::uuid[]))
         returning id`,
        [stamp, tenantId, source, data.examination_id, `{${kept.join(',')}}`],
    );
    for (const row of retired)
        await retireComponents(db, tenantId, row.id, stamp);
    for (const line of data.lines) {
        const values = {
            kelompok_jasa_id: line.service_group_id,
            kelompok_jasa_nama: line.service_group_name,
            kelompok_jasa_urutan: line.service_group_order,
            kategori_nama: line.category_name,
            jenis_biaya_id: line.procedure_id,
            jenis_biaya_kode: line.procedure_code,
            jenis_biaya_nama: line.procedure_name,
            qty: line.quantity,
            nilai: line.tariff,
            harga_orig: line.tariff,
            section_id: line.section_id,
            section_nama: line.section_name,
            dokter_id: line.doctor_id,
            dokter_nama: line.doctor_name,
            tanggal: line.date,
        };
        const existing = await db.one(
            z.object({ id: z.string(), status: z.string() }),
            `select id, status from kunjungan_kasir_detail
             where tenant_id = $1 and sumber_module = $2 and sumber_baris_id = $3 and deleted_at is null`,
            [tenantId, source, line.line_id],
        );
        if (existing?.status === 'ditagih') continue;
        let id = existing?.id;
        if (id) {
            const columns = Object.entries(values);
            await db.execute(
                `update kunjungan_kasir_detail
                 set ${columns.map(([column], index) => `${column} = $${index + 1}`).join(', ')},
                     updated_at = $${columns.length + 1}
                 where tenant_id = $${columns.length + 2} and id = $${columns.length + 3}`,
                [...columns.map(([, value]) => value), stamp, tenantId, id],
            );
            await retireComponents(db, tenantId, id, stamp);
        } else {
            id = Bun.randomUUIDv7();
            await db.insert('kunjungan_kasir_detail', {
                id,
                tenant_id: tenantId,
                legal_entity_id: envelope.legal_entity_id,
                sumber_module: source,
                sumber_dokumen_id: data.examination_id,
                sumber_baris_id: line.line_id,
                kunjungan_id: data.visit_id,
                group_biaya: 'PERAWATAN',
                ...values,
                created_at: stamp,
                updated_at: stamp,
            });
        }
        for (const component of line.components)
            await db.insert('kunjungan_kasir_detail_komponen', {
                id: Bun.randomUUIDv7(),
                tenant_id: tenantId,
                kunjungan_kasir_detail_id: id,
                komponen_biaya_id: component.charge_component_id,
                nilai: component.value,
                created_at: stamp,
                updated_at: stamp,
            });
    }
}

async function retireComponents(
    db: Database,
    tenantId: string,
    chargeId: string,
    stamp: string,
): Promise<void> {
    await db.execute(
        `update kunjungan_kasir_detail_komponen set deleted_at = $1, updated_at = $1
         where tenant_id = $2 and kunjungan_kasir_detail_id = $3 and deleted_at is null`,
        [stamp, tenantId, chargeId],
    );
}

// Kunjungan selesai masuk Daftar Pembayaran. Kunjungan yang dikirim lagi memperbarui potretnya.
export async function receiveVisitCompleted(
    db: Database,
    envelope: EventEnvelope,
): Promise<void> {
    const data = parsed(visitSchema, envelope);
    if (!data || !envelope.legal_entity_id) return;
    if (await alreadyProcessed(db, processedTable, envelope)) return;
    const stamp = nowSql();
    const values = {
        legal_entity_id: envelope.legal_entity_id,
        operating_unit_id: envelope.org_unit_id ?? null,
        no_reg: data.registration_number,
        tanggal: data.date,
        didaftarkan_pada: data.registered_at.slice(0, 19).replace('T', ' '),
        pasien_id: data.patient.id,
        pasien_nrm: data.patient.medical_record_number,
        pasien_nama: data.patient.name,
        tipe_pasien_id: data.patient_type.id,
        tipe_pasien_nama: data.patient_type.name,
        penjamin_id: data.guarantor?.id ?? null,
        penjamin_nama: data.guarantor?.name ?? null,
        no_kartu: data.card_number,
        section_nama: data.sections.map((section) => section.name).join(', '),
        status: 'selesai',
    };
    const columns = Object.entries(values);
    const updated = await db.execute(
        `update kunjungan_kasir
         set ${columns.map(([column], index) => `${column} = $${index + 1}`).join(', ')},
             updated_at = $${columns.length + 1}
         where tenant_id = $${columns.length + 2} and sumber_module = $${columns.length + 3}
           and kunjungan_id = $${columns.length + 4}`,
        [
            ...columns.map(([, value]) => value),
            stamp,
            envelope.tenant_id,
            source,
            data.visit_id,
        ],
    );
    if (!updated)
        await db.insert('kunjungan_kasir', {
            id: Bun.randomUUIDv7(),
            tenant_id: envelope.tenant_id,
            sumber_module: source,
            kunjungan_id: data.visit_id,
            ...values,
            created_at: stamp,
            updated_at: stamp,
        });
}

// Kunjungan batal keluar dari Daftar Pembayaran, dan baris biayanya yang masih terbuka dihapus lunak.
export async function receiveVisitCancelled(
    db: Database,
    envelope: EventEnvelope,
): Promise<void> {
    const data = parsed(visitIdSchema, envelope);
    if (!data) return;
    if (await alreadyProcessed(db, processedTable, envelope)) return;
    const stamp = nowSql();
    await db.execute(
        `update kunjungan_kasir set status = 'batal', updated_at = $1
         where tenant_id = $2 and sumber_module = $3 and kunjungan_id = $4`,
        [stamp, envelope.tenant_id, source, data.visit_id],
    );
    const retired = await db.rows(
        z.object({ id: z.string() }),
        `update kunjungan_kasir_detail set deleted_at = $1, updated_at = $1
         where tenant_id = $2 and sumber_module = $3 and kunjungan_id = $4 and status = 'terbuka'
           and deleted_at is null
         returning id`,
        [stamp, envelope.tenant_id, source, data.visit_id],
    );
    for (const row of retired)
        await retireComponents(db, envelope.tenant_id, row.id, stamp);
}

// Kunjungan yang kembali diperiksa keluar dari Daftar Pembayaran dan tidak bisa dibayar sampai selesai lagi; kunjungan
// selesai berikutnya mengembalikannya ke `selesai`. Baris biayanya tetap terbuka, karena pemeriksaannya masih berlaku.
export async function receiveVisitReopened(
    db: Database,
    envelope: EventEnvelope,
): Promise<void> {
    const data = parsed(visitIdSchema, envelope);
    if (!data) return;
    if (await alreadyProcessed(db, processedTable, envelope)) return;
    await db.execute(
        `update kunjungan_kasir set status = 'dibuka', updated_at = $1
         where tenant_id = $2 and sumber_module = $3 and kunjungan_id = $4 and status = 'selesai'`,
        [nowSql(), envelope.tenant_id, source, data.visit_id],
    );
}
