import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Tenaga kesehatan: party orang berperan nakes, dengan profesi, SIP, dan kode dokter BPJS. Nama adalah nama party-nya.
export const practitionerRowSchema = z.object({
    id: z.string(),
    party_id: z.string(),
    name: z.string(),
    // Kode dari katalog practitioner.professions.ts.
    profession: z.string(),
    specialization: z.string().nullable(),
    license_number: z.string().nullable(),
    license_valid_until: z.string().nullable(),
    bpjs_doctor_code: z.string().nullable(),
    user_id: z.string().nullable(),
    user_name: z.string().nullable(),
    is_active: z.boolean(),
    version: z.number(),
});

export const practitionerListQuerySchema = listParametersSchema.extend({
    profession: z.string().optional(),
    status: z.enum(['active', 'inactive']).optional(),
});

export const practitionerUserQuerySchema = listParametersSchema;

// Nakes baru memakai party orang yang sudah ada (party_id) atau membuat party orang baru dari nama, NIK, jenis
// kelamin, dan nomor HP. Isian identitas itu hanya dipakai saat membuat party; sesudahnya diubah di buku alamat.
export const practitionerInputSchema = z.object({
    party_id: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    nik: z.string().nullable().optional(),
    gender: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    profession: z.string().nullable().optional(),
    specialization: z.string().nullable().optional(),
    license_number: z.string().nullable().optional(),
    license_valid_until: z.string().nullable().optional(),
    bpjs_doctor_code: z.string().nullable().optional(),
    user_id: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
export type PractitionerInput = z.infer<typeof practitionerInputSchema>;
