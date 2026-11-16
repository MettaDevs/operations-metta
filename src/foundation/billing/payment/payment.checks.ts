import { z } from 'zod';
import type { Database } from '../../../platform/database/index.ts';

// Pemeriksaan sebelum Simpan pembayaran yang dipegang module, seperti integration event OnBeforePostSalesDoc di BC:
// module menjawab kalimat penolakan untuk kasir, atau null bila kunjungan boleh dibayar. Core tidak meng-import module,
// jadi module mendaftarkannya dari fungsi pendaftaran yang dipanggil berkas proses. Pemeriksaan hanya berjalan untuk
// module yang terpasang di tenant itu, karena tabel yang dibacanya hanya ada sesudah module terpasang.
export type PaymentCheck = (
    db: Database,
    visit: { tenantId: string; visitId: string },
) => Promise<string | null>;

const checks: { moduleId: string; check: PaymentCheck }[] = [];

export function onBeforePayment(moduleId: string, check: PaymentCheck): void {
    checks.push({ moduleId, check });
}

export async function paymentRefusal(
    db: Database,
    visit: { tenantId: string; visitId: string },
): Promise<string | null> {
    if (!checks.length) return null;
    const installed = new Set(
        (
            await db.rows(
                z.object({ module_id: z.string() }),
                "select module_id from core_module_installations where tenant_id = $1 and status = 'installed'",
                [visit.tenantId],
            )
        ).map((row) => row.module_id),
    );
    for (const { moduleId, check } of checks) {
        if (!installed.has(moduleId)) continue;
        const refusal = await check(db, visit);
        if (refusal) return refusal;
    }
    return null;
}
