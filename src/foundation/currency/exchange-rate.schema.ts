import { z } from 'zod';

// Kurs satu mata uang asing sejak satu tanggal (Currency Exchange Rate BC): rate adalah nilai satu satuan mata uang itu
// dalam mata uang lokal tenant.
export const exchangeRateRowSchema = z.object({
    id: z.string(),
    currency_code: z.string(),
    starting_date: z.string(),
    rate: z.string(),
    version: z.number(),
});

export const exchangeRateInputSchema = z.object({
    currency_code: z.string(),
    starting_date: z.string(),
    // Layar mengirim isian teks apa adanya; service yang memeriksa angkanya.
    rate: z.union([z.number(), z.string()]),
    version: z.number().optional(),
});
