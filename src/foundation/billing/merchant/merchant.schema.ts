import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

// Merchan (SIMmMerchan sistem lama): bank atau mesin EDC yang dipilih saat bayar dengan kartu, milik legal entity
// aktif. Persen ditulis sebagai teks desimal dua angka di belakang koma.
export const merchantRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    debit_surcharge_percent: z.string(),
    credit_surcharge_percent: z.string(),
    discount_percent: z.string(),
    is_active: z.boolean(),
    version: z.number(),
});

export const merchantListQuerySchema = listParametersSchema.extend({
    active: z.literal('1').optional(),
});

export const merchantInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    // Layar mengirim isian teks apa adanya; service yang memeriksa angkanya.
    debit_surcharge_percent: z.union([z.number(), z.string()]).optional(),
    credit_surcharge_percent: z.union([z.number(), z.string()]).optional(),
    discount_percent: z.union([z.number(), z.string()]).optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
