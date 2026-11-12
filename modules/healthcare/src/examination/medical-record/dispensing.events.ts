import { z } from 'zod';
import { nowSql, type Database } from '@core/platform/database/index.ts';
import {
    alreadyProcessed,
    type EventEnvelope,
} from '@core/platform/events/index.ts';
import { idSchema } from '@core/platform/http/index.ts';

// Obat resep yang sudah diserahkan farmasi (pharmacy.prescription.dispensed.v1, kontrak di
// contracts/events/pharmacy.prescription.dispensed.v1.yaml). Module ini tidak meng-import module farmasi, jadi bagian
// isi yang dibacanya ditulis di sini; field lain dilewati.
export const prescriptionDispensed =
    'pharmacy.prescription.dispensed.v1' as const;

const decimalText = z.string().regex(/^[0-9]+(\.[0-9]+)?$/);
const dispensedSchema = z.object({
    prescription_id: idSchema,
    dispensing_number: z.string().min(1).max(50),
    dispensed_at: z.iso.datetime(),
    lines: z.array(
        z.object({ prescription_line_id: idSchema, quantity: decimalText }),
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
        `update sim_tr_resep set diserahkan_pada = $1, nomor_penyerahan = $2, updated_at = $3
         where tenant_id = $4 and id = $5`,
        [
            data.dispensed_at.replace('T', ' ').replace(/(\.\d+)?Z$/, ''),
            data.dispensing_number,
            stamp,
            envelope.tenant_id,
            prescription.id,
        ],
    );
    for (const line of data.lines)
        await db.execute(
            `update sim_tr_resep_detail set jumlah_diserahkan = $1, updated_at = $2
             where tenant_id = $3 and resep_id = $4 and id = $5`,
            [
                line.quantity,
                stamp,
                envelope.tenant_id,
                prescription.id,
                line.prescription_line_id,
            ],
        );
}
