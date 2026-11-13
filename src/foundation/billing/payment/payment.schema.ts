import { z } from 'zod';

// Simpan pembayaran. received adalah uang tunai lokal yang diterima (isian TUNAI); lines adalah isian Metode Pembayaran
// Lain, dengan amount dalam mata uang jenis bayarnya; take_remainder adalah centang jenis bayar penampung sisa (Pasien
// BON). Angka dari layar dikirim sebagai teks apa adanya, dan service yang memeriksanya.
export const paymentInputSchema = z.object({
    received: z.union([z.number(), z.string()]).optional(),
    lines: z
        .array(
            z.object({
                payment_method_id: z.string(),
                amount: z.union([z.number(), z.string()]),
                merchant_id: z.string().nullable().optional(),
                reference: z.string().nullable().optional(),
                surcharge_percent: z.union([z.number(), z.string()]).optional(),
                party_id: z.string().nullable().optional(),
                // Kurs untuk jenis bayar bermata uang asing. Kosong berarti kurs Sys Admin › Kurs untuk tanggal
                // pembayaran; kurs lain butuh izin ubah kurs.
                rate: z.union([z.number(), z.string()]).nullable().optional(),
            }),
        )
        .optional(),
    take_remainder: z.boolean().optional(),
});

// Batal pembayaran (modal Batal Pembayaran sistem lama): penyetuju mengetik email dan kata sandinya, lalu alasan batal.
export const paymentCancelInputSchema = z.object({
    approver_email: z.string().optional(),
    approver_password: z.string().optional(),
    reason: z.string().optional(),
    version: z.number().optional(),
});
