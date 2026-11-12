import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Profesi tenaga kesehatan, misalnya Dokter atau Bidan. Dua centang menentukan peran nakes berprofesi ini di
// pemeriksaan: boleh dipilih sebagai Dokter / Tenaga Medis, sebagai Perawat / Bidan / Nutrisionist / Sanitarian,
// keduanya, atau tidak keduanya.
export const professionRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    fills_medical_staff: z.boolean(),
    fills_nurse: z.boolean(),
    sort_order: z.number(),
    is_active: z.boolean(),
    version: z.number(),
});

export const professionListQuerySchema = listParametersSchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
});

export const professionInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    fills_medical_staff: z.boolean().optional(),
    fills_nurse: z.boolean().optional(),
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
