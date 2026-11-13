import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Kategori tindakan (SIMmKategoriBiaya sistem lama): subkelompok di bawah satu kelompok tindakan.
export const procedureCategoryRowSchema = z.object({
    id: z.string(),
    group_id: z.string(),
    group_name: z.string(),
    code: z.string(),
    name: z.string(),
    international_name: z.string().nullable(),
    is_active: z.boolean(),
    version: z.number(),
});

export const procedureCategoryListQuerySchema = listParametersSchema.extend({
    group: z.string().optional(),
    active: z.literal('1').optional(),
});

export const procedureCategoryInputSchema = z.object({
    group_id: z.string().nullable(),
    code: z.string(),
    name: z.string(),
    international_name: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
