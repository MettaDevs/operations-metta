import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Tipe pasien (JenisKerjasama sistem lama), master kecil per tenant dengan kode pendek yang diketik pengguna.
export const patientTypeRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    // Kode perilaku dari katalog (patient-type.behaviors.ts) yang dinyalakan tipe ini.
    behaviors: z.array(z.string()),
    is_active: z.boolean(),
    version: z.number(),
});

export const patientTypeListQuerySchema = listParametersSchema.extend({
    active: z.literal('1').optional(),
});

export const patientTypeInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    behaviors: z.array(z.string()).optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
