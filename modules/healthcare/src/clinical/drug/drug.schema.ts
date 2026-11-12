import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Obat milik tenant (mBarang sistem lama), sekecil yang dibutuhkan baris E-Resep pemeriksaan.
export const drugRowSchema = z.object({
    id: z.string(),
    code: z.string().nullable(),
    name: z.string(),
    unit_id: z.string(),
    unit_name: z.string(),
    dosage_form_id: z.string().nullable(),
    dosage_form_name: z.string().nullable(),
    is_active: z.boolean(),
    version: z.number(),
});

export const drugListQuerySchema = listParametersSchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
});

export const drugInputSchema = z.object({
    code: z.string().nullable().optional(),
    name: z.string(),
    unit_id: z.string().nullable().optional(),
    dosage_form_id: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
