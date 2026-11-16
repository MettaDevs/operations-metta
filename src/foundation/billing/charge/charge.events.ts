import { z } from 'zod';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    alreadyProcessed,
    type EventEnvelope,
} from '../../../platform/events/index.ts';
import { lockBill, settleAutomatically } from '../payment/payment.service.ts';

// Penerima event biaya dan kunjungan dari module. Core tidak meng-import module, jadi nama event dan bentuk datanya
// ditulis di sini sesuai kontraknya (contracts/events/). Isi yang tidak cocok dicatat ke log lalu dilewati, karena
// penerima tidak boleh membatalkan transaksi penerbit karena aturannya sendiri.

const source = 'healthcare';
export const chargesReplaced =
    'healthcare.examination.charges-replaced.v1' as const;
export const visitCompleted = 'healthcare.visit.completed.v1' as const;
export const visitCancelled = 'healthcare.visit.cancelled.v1' as const;
export const visitReopened = 'healthcare.visit.reopened.v1' as const;
export const pharmacyChargesReplaced =
    'pharmacy.dispensing.charges-replaced.v1' as const;
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

// Potret baris obat satu penyerahan farmasi. includes_service: obat termasuk jasa (IncludeJasa sistem lama), jadi
// nilainya 0 di tagihan walau harganya tetap tercatat.
const pharmacyChargesSchema = z.object({
    dispensing_id: z.string(),
    visit_id: z.uuid(),
    date: z.string(),
    includes_service: z.boolean(),
    lines: z.array(
        z.object({
            line_id: z.string(),
            item: z.object({
                id: z.string(),
                code: z.string(),
                name: z.string(),
            }),
            quantity: z.string(),
            unit_price: z.string(),
            discount_percent: z.string(),
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
    // Field opsional sejak 14 November 2026, dari pengaturan tipe pasien di layanan kesehatan.
    restricted_payment_method_ids: z.array(z.uuid()).optional(),
    automatic_payment_method_id: z.string().nullable().optional(),
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

type ChargeLine = {
    lineId: string;
    values: Record<string, string | number | null>;
    components: { charge_component_id: string; value: string }[];
};

// Group Biaya Rincian Biaya (GetDetailRincianBiaya sistem lama), sama dengan tagihan_kasir_detail_group_check.
export type ChargeGroup = 'PERAWATAN' | 'OBAT' | 'BHP' | 'MCU';

// Potret penuh baris biaya satu dokumen sumber (pemeriksaan atau penyerahan farmasi). Baris terbuka diubah di tempat,
// baris baru ditambah, dan baris terbuka yang tidak ada lagi di potret dihapus lunak. Baris yang sudah ditagih tidak
// disentuh: module menolak mengubahnya sebelum event ini terbit, kecuali tagihan yang lunas otomatis, yang dibatalkan
// lebih dulu lalu dilunasi ulang di sini. Versi tagihan (tagihan_kasir.version) naik, sehingga Simpan dari Form
// Pembayaran yang dibuka sebelum perubahan ini ditolak. Kunjungan yang belum selesai belum punya baris tagihan_kasir;
// versinya mulai saat selesai.
async function replaceCharges(
    db: Database,
    scope: { tenantId: string; legalEntityId: string },
    document: {
        module: string;
        documentId: string;
        billDocumentId: string;
        group: ChargeGroup;
        lines: ChargeLine[];
    },
): Promise<void> {
    const tenantId = scope.tenantId;
    const stamp = nowSql();
    const kept = document.lines.map((line) => line.lineId);
    const retired = await db.rows(
        z.object({ id: z.string() }),
        `update tagihan_kasir_detail set deleted_at = $1, updated_at = $1
         where tenant_id = $2 and sumber_module = $3 and sumber_dokumen_id = $4 and status = 'terbuka'
           and deleted_at is null and not (sumber_baris_id = any($5::uuid[]))
         returning id`,
        [
            stamp,
            tenantId,
            document.module,
            document.documentId,
            `{${kept.join(',')}}`,
        ],
    );
    for (const row of retired)
        await retireComponents(db, tenantId, row.id, stamp);
    for (const line of document.lines) {
        const existing = await db.one(
            z.object({ id: z.string(), status: z.string() }),
            `select id, status from tagihan_kasir_detail
             where tenant_id = $1 and sumber_module = $2 and sumber_baris_id = $3 and deleted_at is null`,
            [tenantId, document.module, line.lineId],
        );
        if (existing?.status === 'ditagih') continue;
        let id = existing?.id;
        if (id) {
            const columns = Object.entries(line.values);
            await db.execute(
                `update tagihan_kasir_detail
                 set ${columns.map(([column], index) => `${column} = $${index + 1}`).join(', ')},
                     updated_at = $${columns.length + 1}
                 where tenant_id = $${columns.length + 2} and id = $${columns.length + 3}`,
                [...columns.map(([, value]) => value), stamp, tenantId, id],
            );
            await retireComponents(db, tenantId, id, stamp);
        } else {
            id = Bun.randomUUIDv7();
            await db.insert('tagihan_kasir_detail', {
                id,
                tenant_id: tenantId,
                legal_entity_id: scope.legalEntityId,
                sumber_module: document.module,
                sumber_dokumen_id: document.documentId,
                sumber_baris_id: line.lineId,
                tagihan_sumber_dokumen_id: document.billDocumentId,
                group_biaya: document.group,
                ...line.values,
                created_at: stamp,
                updated_at: stamp,
            });
        }
        for (const component of line.components)
            await db.insert('tagihan_kasir_detail_komponen', {
                id: Bun.randomUUIDv7(),
                tenant_id: tenantId,
                tagihan_kasir_detail_id: id,
                komponen_biaya_id: component.charge_component_id,
                nilai: component.value,
                created_at: stamp,
                updated_at: stamp,
            });
    }
    await db.execute(
        `update tagihan_kasir set version = version + 1, updated_at = $1
         where tenant_id = $2 and sumber_dokumen_id = $3`,
        [stamp, tenantId, document.billDocumentId],
    );
    await settleAgain(db, {
        tenantId,
        legalEntityId: scope.legalEntityId,
        visitId: document.billDocumentId,
    });
}

// Kunjungan selesai yang tipe pasiennya lunas otomatis dilunasi lagi dengan jenis bayar otomatisnya sesudah biayanya
// berubah. Kunjungan yang belum selesai menunggu kunjungan selesai.
async function settleAgain(
    db: Database,
    scope: { tenantId: string; legalEntityId: string; visitId: string },
): Promise<void> {
    const visit = await db.one(
        z.object({ method: z.string() }),
        `select jenis_bayar_otomatis_id as method from tagihan_kasir
         where tenant_id = $1 and sumber_dokumen_id = $2 and status = 'selesai' and jenis_bayar_otomatis_id is not null`,
        [scope.tenantId, scope.visitId],
    );
    if (visit)
        await settleAutomatically(db, {
            ...scope,
            paymentMethodId: visit.method,
        });
}

export async function receiveCharges(
    db: Database,
    envelope: EventEnvelope,
): Promise<void> {
    const data = parsed(chargesSchema, envelope);
    const legalEntityId = envelope.legal_entity_id;
    if (!data || !legalEntityId) return;
    if (await alreadyProcessed(db, processedTable, envelope)) return;
    await replaceCharges(
        db,
        { tenantId: envelope.tenant_id, legalEntityId },
        {
            module: source,
            documentId: data.examination_id,
            billDocumentId: data.visit_id,
            group: 'PERAWATAN',
            lines: data.lines.map((line) => ({
                lineId: line.line_id,
                values: {
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
                },
                components: line.components,
            })),
        },
    );
}

// Baris OBAT dari penyerahan farmasi (blok BILLFarmasi GetDetailRincianBiaya): harga satuan dan persen diskon yang
// dibekukan farmasi saat Siapkan, Qty bersih sesudah retur. Obat yang termasuk jasa bernilai 0 dengan harga aslinya
// tetap di harga_orig, seperti Kuta (IncludeJasa = 1).
export async function receivePharmacyCharges(
    db: Database,
    envelope: EventEnvelope,
): Promise<void> {
    const data = parsed(pharmacyChargesSchema, envelope);
    const legalEntityId = envelope.legal_entity_id;
    if (!data || !legalEntityId) return;
    if (await alreadyProcessed(db, processedTable, envelope)) return;
    await replaceCharges(
        db,
        { tenantId: envelope.tenant_id, legalEntityId },
        {
            module: 'pharmacy',
            documentId: data.dispensing_id,
            billDocumentId: data.visit_id,
            group: 'OBAT',
            lines: data.lines.map((line) => ({
                lineId: line.line_id,
                values: {
                    jenis_biaya_id: line.item.id,
                    jenis_biaya_kode: line.item.code,
                    jenis_biaya_nama: line.item.name,
                    qty: line.quantity,
                    nilai: data.includes_service ? '0' : line.unit_price,
                    harga_orig: line.unit_price,
                    disc: line.discount_percent,
                    tanggal: data.date,
                },
                components: [],
            })),
        },
    );
}

async function retireComponents(
    db: Database,
    tenantId: string,
    chargeId: string,
    stamp: string,
): Promise<void> {
    await db.execute(
        `update tagihan_kasir_detail_komponen set deleted_at = $1, updated_at = $1
         where tenant_id = $2 and tagihan_kasir_detail_id = $3 and deleted_at is null`,
        [stamp, tenantId, chargeId],
    );
}

// Kunjungan selesai masuk Daftar Pembayaran. Kunjungan yang dikirim lagi memperbarui potretnya, termasuk jenis bayar
// yang dikhususkan tipe pasien lain. Tipe pasien yang lunas otomatis langsung dibayar dengan jenis bayar otomatisnya.
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
        sumber_nomor: data.registration_number,
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
        jenis_bayar_otomatis_id: data.automatic_payment_method_id ?? null,
        jenis_bayar_dibatasi: `{${(data.restricted_payment_method_ids ?? []).join(',')}}`,
        status: 'selesai',
    };
    const columns = Object.entries(values);
    const updated = await db.execute(
        `update tagihan_kasir
         set ${columns.map(([column], index) => `${column} = $${index + 1}`).join(', ')},
             updated_at = $${columns.length + 1}
         where tenant_id = $${columns.length + 2} and sumber_module = $${columns.length + 3}
           and sumber_dokumen_id = $${columns.length + 4}`,
        [
            ...columns.map(([, value]) => value),
            stamp,
            envelope.tenant_id,
            source,
            data.visit_id,
        ],
    );
    if (!updated)
        await db.insert('tagihan_kasir', {
            id: Bun.randomUUIDv7(),
            tenant_id: envelope.tenant_id,
            sumber_module: source,
            sumber_dokumen_id: data.visit_id,
            jenis: 'kunjungan',
            ...values,
            created_at: stamp,
            updated_at: stamp,
        });
    if (data.automatic_payment_method_id)
        await settleAutomatically(db, {
            tenantId: envelope.tenant_id,
            legalEntityId: envelope.legal_entity_id,
            visitId: data.visit_id,
            paymentMethodId: data.automatic_payment_method_id,
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
        `update tagihan_kasir set status = 'batal', updated_at = $1
         where tenant_id = $2 and sumber_module = $3 and sumber_dokumen_id = $4`,
        [stamp, envelope.tenant_id, source, data.visit_id],
    );
    const retired = await db.rows(
        z.object({ id: z.string() }),
        `update tagihan_kasir_detail set deleted_at = $1, updated_at = $1
         where tenant_id = $2 and tagihan_sumber_dokumen_id = $3 and status = 'terbuka' and deleted_at is null
         returning id`,
        [stamp, envelope.tenant_id, data.visit_id],
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
        `update tagihan_kasir set status = 'dibuka', updated_at = $1
         where tenant_id = $2 and sumber_module = $3 and sumber_dokumen_id = $4 and status = 'selesai'`,
        [nowSql(), envelope.tenant_id, source, data.visit_id],
    );
}

// Tagihan penjualan tanpa kunjungan dari module penjual, misalnya obat bebas di loket farmasi, ditulis di transaksi
// module itu: header jenis `penjualan` dibuat atau potretnya diperbarui, lalu baris biayanya diganti dengan potret penuh
// seperti event biaya. Dokumen penjualan sekaligus dokumen sumber tagihan dan baris biayanya. Menjawab versi tagihan
// sesudahnya untuk payBill di transaksi yang sama.
export type SaleBill = {
    tenantId: string;
    legalEntityId: string;
    operatingUnitId: string | null;
    module: string;
    documentId: string;
    number: string;
    date: string;
    buyer: { partyId: string | null; name: string | null };
    group: ChargeGroup;
    lines: {
        lineId: string;
        item: { id: string; code: string; name: string };
        quantity: string;
        unitPrice: string;
        discountPercent: string;
    }[];
};

export async function replaceSaleBill(
    db: Database,
    sale: SaleBill,
): Promise<{ version: number }> {
    if (!db.inTransaction)
        throw new Error('replaceSaleBill wajib di dalam transaksi.');
    await lockBill(db, sale.tenantId, sale.documentId);
    const stamp = nowSql();
    const values = {
        legal_entity_id: sale.legalEntityId,
        operating_unit_id: sale.operatingUnitId,
        sumber_nomor: sale.number,
        tanggal: sale.date,
        pembeli_pihak_id: sale.buyer.partyId,
        pembeli_nama: sale.buyer.name,
    };
    const columns = Object.entries(values);
    const updated = await db.execute(
        `update tagihan_kasir
         set ${columns.map(([column], index) => `${column} = $${index + 1}`).join(', ')},
             updated_at = $${columns.length + 1}
         where tenant_id = $${columns.length + 2} and sumber_dokumen_id = $${columns.length + 3}
           and jenis = 'penjualan' and sumber_module = $${columns.length + 4}`,
        [
            ...columns.map(([, value]) => value),
            stamp,
            sale.tenantId,
            sale.documentId,
            sale.module,
        ],
    );
    if (!updated)
        await db.insert('tagihan_kasir', {
            id: Bun.randomUUIDv7(),
            tenant_id: sale.tenantId,
            sumber_module: sale.module,
            sumber_dokumen_id: sale.documentId,
            jenis: 'penjualan',
            status: 'selesai',
            ...values,
            created_at: stamp,
            updated_at: stamp,
        });
    await replaceCharges(
        db,
        { tenantId: sale.tenantId, legalEntityId: sale.legalEntityId },
        {
            module: sale.module,
            documentId: sale.documentId,
            billDocumentId: sale.documentId,
            group: sale.group,
            lines: sale.lines.map((line) => ({
                lineId: line.lineId,
                values: {
                    jenis_biaya_id: line.item.id,
                    jenis_biaya_kode: line.item.code,
                    jenis_biaya_nama: line.item.name,
                    qty: line.quantity,
                    nilai: line.unitPrice,
                    harga_orig: line.unitPrice,
                    disc: line.discountPercent,
                    tanggal: sale.date,
                },
                components: [],
            })),
        },
    );
    const bill = await db.one(
        z.object({ version: z.number() }),
        'select version from tagihan_kasir where tenant_id = $1 and sumber_dokumen_id = $2',
        [sale.tenantId, sale.documentId],
    );
    if (!bill) throw new Error(`Tagihan ${sale.documentId} tidak ditemukan.`);
    return bill;
}
