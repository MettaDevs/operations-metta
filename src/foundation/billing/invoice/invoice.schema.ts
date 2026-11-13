import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

// Daftar Pembayaran (KC general_payment datatable): kunjungan selesai di legal entity aktif.
export const visitRowSchema = z.object({
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

export const visitListQuerySchema = listParametersSchema.extend({
    from: z.string().optional(),
    to: z.string().optional(),
    status: z.enum(['unpaid', 'paid']).optional(),
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
});

export const visitDetailSchema = visitRowSchema.extend({
    guarantor_name: z.string().nullable(),
    card_number: z.string().nullable(),
    // Jenis bayar yang dikhususkan tipe pasien lain, ditolak untuk kunjungan ini.
    restricted_payment_method_ids: z.array(z.string()),
});
