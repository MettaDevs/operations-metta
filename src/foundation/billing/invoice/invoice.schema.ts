import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

// Daftar Pembayaran (KC general_payment datatable): tagihan di legal entity aktif, yaitu kunjungan selesai dan penjualan
// tanpa kunjungan (misalnya obat bebas di loket farmasi). id adalah id dokumen sumber tagihan.
export const visitRowSchema = z.object({
    kind: z.literal('visit'),
    id: z.string(),
    registration_number: z.string(),
    date: z.string(),
    registered_at: z.string(),
    patient_medical_record_number: z.string(),
    patient_name: z.string(),
    patient_type_name: z.string(),
    sections: z.string(),
    paid: z.boolean(),
});

// buyer_name kosong berarti pembeli umum.
export const saleRowSchema = z.object({
    kind: z.literal('sale'),
    id: z.string(),
    number: z.string(),
    date: z.string(),
    sold_at: z.string(),
    buyer_name: z.string().nullable(),
    paid: z.boolean(),
});

export const invoiceRowSchema = z.discriminatedUnion('kind', [
    visitRowSchema,
    saleRowSchema,
]);

export const visitListQuerySchema = listParametersSchema.extend({
    from: z.string().optional(),
    to: z.string().optional(),
    status: z.enum(['unpaid', 'paid']).optional(),
});

export const visitHoldsQuerySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
});

// Baris Rincian Biaya. Angka ditulis sebagai teks desimal.
export const chargeRowSchema = z.object({
    id: z.string(),
    charge_group: z.string(),
    service_group_id: z.string().nullable(),
    service_group_name: z.string().nullable(),
    service_group_order: z.number().nullable(),
    category_name: z.string().nullable(),
    code: z.string(),
    name: z.string(),
    quantity: z.string(),
    value: z.string(),
    original_price: z.string(),
    discount_percent: z.string(),
    extra: z.string(),
    section_name: z.string().nullable(),
    doctor_name: z.string().nullable(),
    date: z.string(),
    status: z.string(),
    // Untuk tab Diskon: jasa, dokter, dan nilai per komponen biaya baris ini.
    procedure_id: z.string(),
    doctor_id: z.string().nullable(),
    components: z.array(
        z.object({ charge_component_id: z.string(), value: z.string() }),
    ),
});

export const visitDetailSchema = visitRowSchema.omit({ kind: true }).extend({
    guarantor_name: z.string().nullable(),
    card_number: z.string().nullable(),
    // Jenis bayar yang dikhususkan tipe pasien lain, ditolak untuk kunjungan ini.
    restricted_payment_method_ids: z.array(z.string()),
    // Versi tagihan yang ditampilkan, dikirim lagi saat Simpan pembayaran.
    version: z.number(),
});

export const saleDetailSchema = saleRowSchema
    .omit({ kind: true, paid: true })
    .extend({
        buyer_party_id: z.string().nullable(),
        source_module: z.string(),
        // Versi tagihan yang ditampilkan, dikirim lagi saat Simpan pembayaran.
        version: z.number(),
    });
