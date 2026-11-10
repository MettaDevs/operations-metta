import { z } from 'zod';
import { listParametersSchema } from '../http/index.ts';

const text = z.string().nullable();

// Satu baris party seperti yang dikirim daftar, detail, dan jawaban simpan. Tipenya sampai ke layar lewat klien oRPC.
export const partyRowSchema = z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    search_name: z.string(),
    status: z.string(),
    version: z.number(),
    deleted_at: text,
    tax_number: text,
    known_as: text,
    language: text,
    personal_title: text,
    personal_suffix: text,
    first_name: text,
    middle_name: text,
    last_name: text,
    initials: text,
    professional_title: text,
    professional_suffix: text,
    gender: text,
    marital_status: text,
    organization_number: text,
    duns_number: text,
    abc_code: text,
    birth_date: text,
    anniversary_date: text,
    number_of_children: z.number().nullable(),
    number_of_employees: z.number().nullable(),
    interests: text,
    memo: text,
    nationality_country_code: text,
    birth_place: text,
    religion: text,
    education: text,
    occupation_id: text,
    occupation_name: text,
    city: text,
    address: text,
});

// Query string daftar dan pilihan party. Handler membaca URL-nya sendiri; skema ini memberi tipe bagi pemanggil di
// layar.
export const partyListQuerySchema = listParametersSchema.extend({
    type: z.string().optional(),
    status: z.string().optional(),
    role: z.string().optional(),
    archived: z.literal('only').optional(),
});
export const partyOptionsQuerySchema = z.object({ q: z.string().optional() });
