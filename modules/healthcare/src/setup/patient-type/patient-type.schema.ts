import { z } from 'zod';

// Tipe pasien (JenisKerjasama sistem lama), master kecil per tenant dengan kode pendek yang diketik pengguna.
export const patientTypeRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    uses_guarantor: z.boolean(),
    is_active: z.boolean(),
    version: z.number(),
});

export const patientTypeInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    uses_guarantor: z.boolean().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
