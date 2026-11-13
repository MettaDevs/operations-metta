import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

// Clerk (SIMtrClerk sistem lama): sesi kas satu kasir di legal entity aktif. status `start` sampai Clerk End, lalu
// `end`. Angka ditulis sebagai teks desimal, terisi saat Clerk End.
export const clerkRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    status: z.enum(['start', 'end']),
    user_id: z.string(),
    user_name: z.string(),
    started_at: z.string(),
    ended_at: z.string().nullable(),
    transactions: z.number(),
    system_total: z.string(),
    clerk_total: z.string(),
    difference_total: z.string(),
    version: z.number(),
});

// Satu jenis bayar yang dihitung saat Clerk End. Jumlah sistem dan selisih kosong selama clerk berjalan, karena kasir
// mengisi jumlah fisik tanpa melihat jumlah sistem, seperti layar Clerk End sistem lama.
export const clerkLineSchema = z.object({
    payment_method_id: z.string(),
    code: z.string(),
    name: z.string(),
    system_amount: z.string().nullable(),
    counted_amount: z.string().nullable(),
    difference: z.string().nullable(),
});

export const clerkListQuerySchema = listParametersSchema;

export const clerkStartInputSchema = z.object({
    password: z.string().optional(),
});

export const clerkEndInputSchema = z.object({
    password: z.string().optional(),
    // Jumlah fisik per id jenis bayar, seperti f[JenisBayarID] sistem lama. Jenis bayar yang tidak diisi berarti 0.
    counts: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
    version: z.number().optional(),
});
