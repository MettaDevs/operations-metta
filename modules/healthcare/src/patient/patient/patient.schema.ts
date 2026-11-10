import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

const text = z.string().nullable().optional();

// Alamat pada kartu pasien: alamat KTP dan alamat domisili form lama. Disimpan sebagai alamat party (kegunaan
// identity_card dan domicile), dengan wilayah Indonesia dari master wilayah Core.
export const patientAddressInputSchema = z.object({
    country_region_code: text,
    province_id: text,
    regency_id: text,
    district_id: text,
    village_id: text,
    postal_code_id: text,
    group_of_houses_id: text,
    group_of_houses: text,
    street: text,
    rt: text,
    rw: text,
});

export const paymentMethodInputSchema = z.object({
    patient_type_id: z.string(),
    guarantor_id: text,
    card_number: text,
    class: text,
    is_primary: z.boolean().optional(),
});

// Isian kartu pasien. Isian identitas memakai nama field party Core. Nomor identitas yang tidak dikirim tidak diubah,
// supaya nomor yang tampil tersamar tidak pernah tertulis balik.
export const patientInputSchema = z.object({
    version: z.number().optional(),
    name: text,
    nationality_country_code: text,
    nik: text,
    family_card_number: text,
    passport_number: text,
    gender: text,
    birth_date: text,
    birth_place: text,
    religion: text,
    education: text,
    marital_status: text,
    anniversary_date: text,
    occupation_id: text,
    phone: text,
    email: text,
    identity_address: patientAddressInputSchema.nullable().optional(),
    domicile_address: patientAddressInputSchema.nullable().optional(),
    is_active: z.boolean().optional(),
    document_number: text,
    old_number: text,
    blood_type: text,
    family_status: text,
    institution: text,
    father_name: text,
    mother_name: text,
    mother_nik: text,
    payment_methods: z.array(paymentMethodInputSchema).optional(),
});
export type PatientInput = z.infer<typeof patientInputSchema>;
export type PatientAddressInput = z.infer<typeof patientAddressInputSchema>;

export const partyLookupInputSchema = z.object({ nik: z.string() });

// Query string daftar pasien. Handler membaca URL-nya sendiri; skema ini memberi tipe bagi pemanggil di layar.
export const patientListQuerySchema = listParametersSchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
    patient_type_id: z.string().optional(),
    org_unit_id: z.string().optional(),
});

const nullable = z.string().nullable();

export const patientListRowSchema = z.object({
    id: z.string(),
    nrm: z.string(),
    name: z.string(),
    nik: nullable,
    card_number: nullable,
    patient_type_name: nullable,
    guarantor_name: nullable,
    document_number: nullable,
    old_number: nullable,
    gender: nullable,
    birth_place: nullable,
    birth_date: nullable,
    address: nullable,
    phone: nullable,
    is_active: z.boolean(),
    org_unit_id: z.string(),
    org_unit_name: z.string(),
});

export const patientAddressSchema = z.object({
    id: z.string(),
    country_region_code: nullable,
    province_id: nullable,
    regency_id: nullable,
    district_id: nullable,
    village_id: nullable,
    postal_code_id: nullable,
    group_of_houses_id: nullable,
    province: nullable,
    city: nullable,
    district: nullable,
    village: nullable,
    group_of_houses: nullable,
    postal_code: nullable,
    rt: nullable,
    rw: nullable,
    street: nullable,
    formatted: z.string(),
});

export const paymentMethodSchema = z.object({
    id: z.string(),
    patient_type_id: z.string(),
    patient_type_name: z.string(),
    behaviors: z.array(z.string()),
    guarantor_id: nullable,
    guarantor_name: nullable,
    card_number: nullable,
    class: nullable,
    is_primary: z.boolean(),
});
