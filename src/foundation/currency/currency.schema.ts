import { z } from 'zod';

// Presisi satu mata uang tenant (Currency BC). invoice_rounding_precision 0 berarti total tagihan tidak dibulatkan lagi.
export const currencyRowSchema = z.object({
    id: z.string(),
    currency_code: z.string(),
    amount_decimals: z.number(),
    unit_amount_decimals: z.number(),
    invoice_rounding_precision: z.string(),
    invoice_rounding_type: z.string(),
    version: z.number(),
});

export const currencyInputSchema = z.object({
    currency_code: z.string(),
    amount_decimals: z.number().int(),
    unit_amount_decimals: z.number().int(),
    // Layar mengirim isian teks apa adanya; service yang memeriksa angkanya.
    invoice_rounding_precision: z.union([z.number(), z.string()]),
    invoice_rounding_type: z.string(),
    version: z.number().optional(),
});
