import { z } from 'zod';

// Golongan obat milik legal entity, misalnya Narkotika atau Obat bebas. Kode diketik pengguna, seperti field Code BC.
export const drugClassRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    version: z.number(),
});

export const drugClassInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    version: z.number().optional(),
});
