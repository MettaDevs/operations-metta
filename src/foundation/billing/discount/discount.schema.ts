import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

// Diskon kasir (mDiscount sistem lama), milik legal entity aktif. kind memilih dasar persennya (payment.discount.ts):
// total, komponen biaya, atau kelompok jasa. Kelompok jasa milik layanan kesehatan, jadi id dan namanya diambil dari
// baris biaya yang sudah dikirim ke kasir.
export const discountRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    kind: z.string(),
    charge_component_id: z.string().nullable(),
    charge_component_name: z.string().nullable(),
    service_group_id: z.string().nullable(),
    service_group_name: z.string().nullable(),
    is_active: z.boolean(),
    version: z.number(),
});

export const discountListQuerySchema = listParametersSchema.extend({
    active: z.literal('1').optional(),
});

export const discountInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    kind: z.string(),
    charge_component_id: z.string().nullable().optional(),
    service_group_id: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
