import { z } from 'zod';
import { nowSql, type Database } from '@core/platform/database/index.ts';
import {
    alreadyProcessed,
    type EventEnvelope,
} from '@core/platform/events/index.ts';
import { issuedPrescriptionSchema } from './prescription.schema.ts';

export const prescriptionIssued = 'healthcare.prescription.issued.v1' as const;

const sqlTimestamp = (iso: string) =>
    iso.replace('T', ' ').replace(/(\.\d+)?Z$/, '');

function skip(envelope: EventEnvelope, reason: string, fields: string[] = []) {
    process.stderr.write(
        JSON.stringify({
            event: 'pharmacy-event-skipped',
            type: envelope.type,
            event_id: envelope.id,
            tenant_id: envelope.tenant_id,
            reason,
            fields,
        }) + '\n',
    );
}

// Resep yang dikirim dokter masuk antrean farmasi. Handler ini berjalan di transaksi Kirim ke farmasi, jadi ia hanya
// menyalin potret resep: tidak ada pekerjaan stok, dan isi yang tidak cocok dicatat ke log lalu dilewati, tidak
// dilempar, karena lemparan membatalkan resep dokter.
export async function receivePrescription(
    db: Database,
    envelope: EventEnvelope,
): Promise<void> {
    const parsed = issuedPrescriptionSchema.safeParse({
        legal_entity_id: envelope.legal_entity_id,
        org_unit_id: envelope.org_unit_id,
        data: envelope.data,
    });
    if (!parsed.success) {
        skip(
            envelope,
            'invalid-payload',
            parsed.error.issues.map((issue) => issue.path.join('.')),
        );
        return;
    }
    const { legal_entity_id: legalEntityId, data } = parsed.data;
    const tenantId = envelope.tenant_id;
    const itemIds = [
        ...new Set(
            data.lines.flatMap((line) => (line.item ? [line.item.id] : [])),
        ),
    ];
    const known = await db.rows(
        z.object({ id: z.string() }),
        `select id from gd_m_barang where tenant_id = $1 and legal_entity_id = $2
           and id in (${itemIds.map((_, index) => `$${index + 3}`).join(',')})`,
        [tenantId, legalEntityId, ...itemIds],
    );
    if (known.length !== itemIds.length) {
        skip(envelope, 'unknown-items');
        return;
    }
    if (await alreadyProcessed(db, 'far_processed_events', envelope)) return;
    const id = Bun.randomUUIDv7();
    const stamp = nowSql();
    const inserted = await db.execute(
        `insert into far_tr_resep (id, tenant_id, legal_entity_id, operating_unit_id, event_id, resep_sumber_id,
                                   nomor_resep, no_reg, diterbitkan_pada, diterima_pada, catatan, pasien_id, nrm,
                                   nama_pasien, tanggal_lahir, dokter_id, nama_dokter, section_id, nama_section,
                                   kelompok_harga_id, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $10, $10)
         on conflict (tenant_id, resep_sumber_id) do nothing`,
        [
            id,
            tenantId,
            legalEntityId,
            parsed.data.org_unit_id,
            envelope.id,
            data.prescription_id,
            data.prescription_number,
            data.registration_number,
            sqlTimestamp(data.issued_at),
            stamp,
            data.notes,
            data.patient.id,
            data.patient.medical_record_number,
            data.patient.name,
            data.patient.birth_date,
            data.doctor?.id ?? null,
            data.doctor?.name ?? null,
            data.section.id,
            data.section.name,
            data.price_group?.id ?? null,
        ],
    );
    if (!inserted) {
        skip(envelope, 'prescription-already-queued');
        return;
    }
    for (const line of data.lines)
        await db.insert('far_tr_resep_detail', {
            id: Bun.randomUUIDv7(),
            tenant_id: tenantId,
            legal_entity_id: legalEntityId,
            resep_id: id,
            baris_sumber_id: line.id,
            urutan: line.order,
            barang_id: line.item?.id ?? null,
            kode_barang: line.item?.code ?? null,
            nama_barang: line.item?.name ?? null,
            racikan_ke: line.compound,
            jumlah: line.quantity,
            konversi: line.item ? (line.quantity_per_unit ?? '1') : null,
            satuan_id: line.unit?.id ?? null,
            kode_satuan: line.unit?.code ?? null,
            nama_satuan: line.unit?.name ?? null,
            jumlah_permintaan: line.requested_quantity,
            signa: line.signa,
            aturan_pakai: line.usage_instruction,
            keterangan: line.notes,
            created_at: stamp,
            updated_at: stamp,
        });
}
