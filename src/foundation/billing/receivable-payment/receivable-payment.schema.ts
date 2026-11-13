import { z } from 'zod';

// Piutang terbuka yang dipilih di isian Nomor Invoice: nomor dan tanggal pembayaran asalnya, kunjungan, pihak, jenis
// bayar, nilai, sudah dibayar, dan sisa (Kewajiban).
export const receivableRowSchema = z.object({
    id: z.string(),
    invoice_number: z.string(),
    invoice_date: z.string(),
    registration_number: z.string(),
    patient_medical_record_number: z.string(),
    patient_name: z.string(),
    patient_type_name: z.string(),
    party_name: z.string(),
    payment_method_name: z.string(),
    amount: z.string(),
    paid: z.string(),
    remaining: z.string(),
});

// Daftar Pembayaran Hutang. previously_paid adalah pelunasan piutang yang sama sebelum pelunasan ini (Nilai Akumulasi
// Bayar), jadi Kewajiban = receivable_amount - previously_paid dan Sisa = Kewajiban - amount.
export const receivablePaymentRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    date: z.string(),
    invoice_number: z.string(),
    invoice_date: z.string(),
    registration_number: z.string(),
    patient_medical_record_number: z.string(),
    patient_name: z.string(),
    patient_type_name: z.string(),
    payment_method_name: z.string(),
    merchant_name: z.string().nullable(),
    reference: z.string().nullable(),
    surcharge_percent: z.string(),
    surcharge: z.string(),
    amount: z.string(),
    receivable_amount: z.string(),
    previously_paid: z.string(),
    user_name: z.string(),
    status: z.enum(['diposting', 'batal']),
    cancel_reason: z.string().nullable(),
    version: z.number(),
});

// Simpan pembayaran hutang: satu piutang, satu jenis bayar. Angka dari layar dikirim sebagai teks apa adanya, dan
// service yang memeriksanya.
export const receivablePaymentInputSchema = z.object({
    receivable_id: z.string(),
    payment_method_id: z.string(),
    amount: z.union([z.number(), z.string()]),
    merchant_id: z.string().nullable().optional(),
    reference: z.string().nullable().optional(),
    surcharge_percent: z.union([z.number(), z.string()]).optional(),
});

export const receivablePaymentCancelInputSchema = z.object({
    reason: z.string().optional(),
    version: z.number().optional(),
});
