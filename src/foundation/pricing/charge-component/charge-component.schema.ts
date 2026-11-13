import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

// Komponen biaya (SIMmKomponenBiaya sistem lama): bagian yang menyusun satu tarif, misalnya jasa sarana dan jasa
// pelayanan. Urutan menentukan urutan isian komponen di kartu tarif.
export const chargeComponentRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    sort_order: z.number(),
    is_active: z.boolean(),
    version: z.number(),
});

export const chargeComponentListQuerySchema = listParametersSchema.extend({
    active: z.literal('1').optional(),
});

export const chargeComponentInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    // Layar mengirim isian teks apa adanya; service yang memeriksa bilangan bulatnya.
    sort_order: z.union([z.number(), z.string()]).optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
