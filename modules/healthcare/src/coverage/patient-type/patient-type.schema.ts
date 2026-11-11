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
    // Tipe bawaan pasien baru. Paling banyak satu per tenant (sim_m_tipe_pasien_bawaan_unique).
    is_default: z.boolean(),
    // Berapa kali pasien bertipe ini boleh didaftarkan ke poli yang sama dalam satu hari. 0 berarti tanpa batas.
    max_visits_per_section_per_day: z.number(),
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
    is_default: z.boolean().optional(),
    // Layar mengirim isian teks apa adanya; service yang memeriksa bilangan bulatnya.
    max_visits_per_section_per_day: z
        .union([z.number(), z.string()])
        .optional(),
    version: z.number().optional(),
});
