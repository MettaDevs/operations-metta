import { z } from 'zod';
import { nowSql, type Database } from '@core/platform/database/index.ts';
import {
    alreadyProcessed,
    type EventEnvelope,
} from '@core/platform/events/index.ts';
import { idSchema } from '@core/platform/http/index.ts';

// Obat resep yang sudah diserahkan farmasi (pharmacy.prescription.dispensed.v1, kontrak di
// contracts/events/pharmacy.prescription.dispensed.v1.yaml). Module ini tidak meng-import module farmasi, jadi bagian
// isi yang dibacanya ditulis di sini; field lain dilewati. Jumlah yang diserahkan dicatat dalam satuan dasar:
// base_quantity, atau quantity pada pesan lama yang belum membawanya, karena pesan itu ditulis dalam satuan dasar.
// Apoteker dan asisten adalah pengguna; nakes-nya dicatat saat event diterima (healthcare 0046).
export const prescriptionDispensed =
    'pharmacy.prescription.dispensed.v1' as const;

const decimalText = z.string().regex(/^[0-9]+(\.[0-9]+)?$/);
const dispensedSchema = z.object({
    prescription_id: idSchema,
    dispensing_number: z.string().min(1).max(50),
    dispensed_at: z.iso.datetime(),
    pharmacist: z.object({ id: idSchema }).nullish(),
    assistant: z.object({ id: idSchema }).nullish(),
    lines: z.array(
        z.object({
            prescription_line_id: idSchema,
            quantity: decimalText,
            base_quantity: decimalText.optional(),
        }),
    ),
});

// Retur yang diposting dan Batal retur membawa isi yang sama. Yang dibaca di sini hanya total retur per baris resep
// dalam satuan dasar, satuan yang sama dengan jumlah yang diserahkan, jadi retur dalam satuan lain (misalnya strip)
// tetap dikurangkan dengan benar.
export const returnPosted = 'pharmacy.return.posted.v1' as const;
export const returnReversed = 'pharmacy.return.reversed.v1' as const;

const returnSchema = z.object({
    prescription_id: idSchema,
    lines: z.array(
        z.object({
            prescription_line_id: idSchema,
            returned_base_quantity: decimalText,
        }),
    ),
});

function skip(envelope: EventEnvelope, reason: string, fields: string[] = []) {
    process.stderr.write(
        JSON.stringify({
            event: 'healthcare-event-skipped',
            type: envelope.type,
            event_id: envelope.id,
            tenant_id: envelope.tenant_id,
            reason,
            fields,
        }) + '\n',
    );
}

// Berjalan di transaksi Serahkan milik farmasi, jadi isi yang tidak cocok dicatat ke log lalu dilewati, tidak dilempar.
export async function receiveDispensing(
    db: Database,
    envelope: EventEnvelope,
): Promise<void> {
    const parsed = dispensedSchema.safeParse(envelope.data);
    if (!parsed.success) {
        skip(
            envelope,
            'invalid-payload',
            parsed.error.issues.map((issue) => issue.path.join('.')),
        );
        return;
    }
    const data = parsed.data;
    const prescription = await db.one(
        z.object({ id: z.string() }),
        `select id from sim_tr_resep
         where tenant_id = $1 and id = $2 and status = 'dikirim' and deleted_at is null`,
        [envelope.tenant_id, data.prescription_id],
    );
    if (!prescription) {
        skip(envelope, 'unknown-prescription');
        return;
    }
    if (await alreadyProcessed(db, 'sim_processed_events', envelope)) return;
    const stamp = nowSql();
    await db.execute(
        `update sim_tr_resep set diserahkan_pada = $1, nomor_penyerahan = $2, updated_at = $3,
                apoteker_nakes_id = sim_nakes_milik_pengguna($4, $6),
                asisten_apoteker_nakes_id = sim_nakes_milik_pengguna($4, $7)
         where tenant_id = $4 and id = $5`,
        [
            data.dispensed_at.replace('T', ' ').replace(/(\.\d+)?Z$/, ''),
            data.dispensing_number,
            stamp,
            envelope.tenant_id,
            prescription.id,
            data.pharmacist?.id ?? null,
            data.assistant?.id ?? null,
        ],
    );
    for (const line of data.lines)
        await db.execute(
            `update sim_tr_resep_detail set jumlah_diserahkan = $1, updated_at = $2
             where tenant_id = $3 and resep_id = $4 and id = $5`,
            [
                line.base_quantity ?? line.quantity,
                stamp,
                envelope.tenant_id,
                prescription.id,
                line.prescription_line_id,
            ],
        );
}

// Yang dipegang pasien adalah jumlah_diserahkan - jumlah_diretur, seperti "Obat Direalisasi" di CPPT sistem lama
// (JmlObat - JmlRetur). Totalnya disalin, bukan ditambah atau dikurangi, jadi retur, Batal retur, dan event yang
// diantar ulang selalu berakhir di angka yang sama.
export async function receiveReturn(
    db: Database,
    envelope: EventEnvelope,
): Promise<void> {
    const parsed = returnSchema.safeParse(envelope.data);
    if (!parsed.success) {
        skip(
            envelope,
            'invalid-payload',
            parsed.error.issues.map((issue) => issue.path.join('.')),
        );
        return;
    }
    const data = parsed.data;
    const prescription = await db.one(
        z.object({ id: z.string() }),
        `select id from sim_tr_resep
         where tenant_id = $1 and id = $2 and status = 'dikirim' and diserahkan_pada is not null
           and deleted_at is null`,
        [envelope.tenant_id, data.prescription_id],
    );
    if (!prescription) {
        skip(envelope, 'unknown-dispensed-prescription');
        return;
    }
    if (await alreadyProcessed(db, 'sim_processed_events', envelope)) return;
    const stamp = nowSql();
    for (const line of data.lines)
        await db.execute(
            `update sim_tr_resep_detail set jumlah_diretur = $1, updated_at = $2
             where tenant_id = $3 and resep_id = $4 and id = $5`,
            [
                line.returned_base_quantity,
                stamp,
                envelope.tenant_id,
                prescription.id,
                line.prescription_line_id,
            ],
        );
}
