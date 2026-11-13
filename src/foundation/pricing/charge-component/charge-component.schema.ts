import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

// Komponen biaya (SIMmKomponenBiaya sistem lama): bagian yang menyusun satu tarif, misalnya jasa sarana dan jasa
// pelayanan. Urutan menentukan urutan isian komponen di kartu tarif.
export const chargeComponentRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    sort_order: z.number(),
    // Kode dari katalog charge-component.options.ts.
    account_group: z.string(),
    posting_to: z.string(),
    payable_to: z.string(),
    service_group: z.string(),
    includes_incentive: z.boolean(),
    excludes_hospital_cost: z.boolean(),
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
    account_group: z.string().optional(),
    posting_to: z.string().optional(),
    payable_to: z.string().optional(),
    service_group: z.string().optional(),
    includes_incentive: z.boolean().optional(),
    excludes_hospital_cost: z.boolean().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
