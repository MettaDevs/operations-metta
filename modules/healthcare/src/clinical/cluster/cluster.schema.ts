import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Klaster Integrasi Layanan Primer, misalnya K2 Kesehatan Ibu dan Anak.
export const clusterRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    sort_order: z.number(),
    is_active: z.boolean(),
    version: z.number(),
});

export const clusterListQuerySchema = listParametersSchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
});

export const clusterInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
