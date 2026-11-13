import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

// Kelompok harga (Customer Price Group di BC): kunci harga yang ditunjuk tipe pasien dan pembeli farmasi.
export const priceGroupRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    is_active: z.boolean(),
    version: z.number(),
});

export const priceGroupListQuerySchema = listParametersSchema.extend({
    active: z.literal('1').optional(),
});

export const priceGroupInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
