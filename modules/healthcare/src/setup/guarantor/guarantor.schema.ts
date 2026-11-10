import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Penjamin: party organisasi berperan penjamin untuk satu tipe pasien (SIMdCustomerKerjasama sistem lama), misalnya
// BPJS Kesehatan untuk tipe BPJS. Nama penjamin adalah nama party-nya.
export const guarantorRowSchema = z.object({
    id: z.string(),
    party_id: z.string(),
    name: z.string(),
    patient_type_id: z.string(),
    patient_type_name: z.string(),
    is_active: z.boolean(),
    version: z.number(),
});

export const guarantorListQuerySchema = listParametersSchema.extend({
    patient_type_id: z.string().optional(),
    active: z.literal('1').optional(),
});

// Penjamin baru memakai party organisasi yang sudah ada (party_id) atau membuat party organisasi baru (name).
export const guarantorInputSchema = z.object({
    party_id: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    patient_type_id: z.string(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
