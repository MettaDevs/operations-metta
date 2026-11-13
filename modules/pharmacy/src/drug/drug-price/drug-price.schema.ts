import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Satu baris grading harga obat (SIMmGradingHargaObat sistem lama). Angka sebagai teks desimal; grading_group kosong
// berarti semua barang. ktp_patient adalah KTP sistem lama: baris untuk pasien yang memegang KTP setempat atau yang
// tidak.
export const drugPriceRowSchema = z.object({
    id: z.string(),
    price_group: z.object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
    }),
    grading_group: z.object({ id: z.string(), name: z.string() }).nullable(),
    ktp_patient: z.boolean(),
    price_from: z.string(),
    price_to: z.string(),
    markup_percent: z.string(),
    discount_percent: z.string(),
    effective_from: z.string(),
    version: z.number(),
});

export const drugPriceListQuerySchema = listParametersSchema.extend({
    price_group_id: z.string().max(100).optional(),
});

const amount = z.union([z.number(), z.string()]);

// discount_percent yang tidak dikirim berarti 0. ktp_patient yang tidak dikirim berarti KTP pada baris baru dan tidak
// diubah pada baris tersimpan.
export const drugPriceInputSchema = z.object({
    price_group_id: z.string(),
    grading_group_id: z.string().nullable(),
    ktp_patient: z.boolean().optional(),
    price_from: amount,
    price_to: amount,
    markup_percent: amount,
    discount_percent: amount.optional(),
    effective_from: z.string(),
    version: z.number().optional(),
});
