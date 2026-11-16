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

// Pasangan baca-saja PaymentCheck untuk Daftar Pembayaran dan header Form Pembayaran: hal yang masih ditunggu kunjungan
// sebelum bisa dibayar, satu kalimat pendek per kunjungan, misalnya "2 resep menunggu farmasi". Satu panggilan menjawab
// semua kunjungan yang diminta dengan satu query, dan kunjungan yang tidak menunggu apa pun tidak ada di jawabannya.
export type PaymentHolds = (
    db: Database,
    visits: { tenantId: string; visitIds: string[] },
) => Promise<Map<string, string>>;

const checks: { moduleId: string; check: PaymentCheck }[] = [];
const holdReaders: { moduleId: string; holds: PaymentHolds }[] = [];

export function onBeforePayment(moduleId: string, check: PaymentCheck): void {
    checks.push({ moduleId, check });
}

export function onPaymentHolds(moduleId: string, holds: PaymentHolds): void {
    holdReaders.push({ moduleId, holds });
}

async function installedModules(
    db: Database,
    tenantId: string,
): Promise<Set<string>> {
    return new Set(
        (
            await db.rows(
                z.object({ module_id: z.string() }),
                "select module_id from core_module_installations where tenant_id = $1 and status = 'installed'",
                [tenantId],
            )
        ).map((row) => row.module_id),
    );
}

export async function paymentRefusal(
    db: Database,
    visit: { tenantId: string; visitId: string },
): Promise<string | null> {
    if (!checks.length) return null;
    const installed = await installedModules(db, visit.tenantId);
    for (const { moduleId, check } of checks) {
        if (!installed.has(moduleId)) continue;
        const refusal = await check(db, visit);
        if (refusal) return refusal;
    }
    return null;
}

// Hal yang ditunggu setiap kunjungan, dari semua module terpasang yang mendaftarkannya.
export async function paymentHolds(
    db: Database,
    visits: { tenantId: string; visitIds: string[] },
): Promise<Map<string, string[]>> {
    const held = new Map<string, string[]>();
    if (!holdReaders.length || !visits.visitIds.length) return held;
    const installed = await installedModules(db, visits.tenantId);
    for (const { moduleId, holds } of holdReaders) {
        if (!installed.has(moduleId)) continue;
        for (const [visitId, label] of await holds(db, visits))
            held.set(visitId, [...(held.get(visitId) ?? []), label]);
    }
    return held;
}
