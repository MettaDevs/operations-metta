import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Kode ICD-10 milik tenant (mICD sistem lama), dipilih di baris diagnosa pemeriksaan.
export const icd10RowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    is_active: z.boolean(),
    version: z.number(),
});

export const icd10ListQuerySchema = listParametersSchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
});

export const icd10InputSchema = z.object({
    code: z.string(),
    name: z.string(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
