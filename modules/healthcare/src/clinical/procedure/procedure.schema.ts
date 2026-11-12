import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Tindakan milik tenant (SIMmListJasa sistem lama), dipilih di baris Biaya Tindakan pemeriksaan.
export const procedureRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    group_id: z.string().nullable(),
    group_name: z.string().nullable(),
    is_active: z.boolean(),
    version: z.number(),
});

export const procedureListQuerySchema = listParametersSchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
    group: z.string().optional(),
});

export const procedureInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    group_id: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
