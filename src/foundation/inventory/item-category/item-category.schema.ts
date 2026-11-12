import { z } from 'zod';

const reference = z
    .object({ id: z.string(), code: z.string(), name: z.string() })
    .nullable();

// Profil pelacakan kategori hanya bawaan untuk barang baru di kategori itu.
export const itemCategoryRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    parent: reference,
    tracking_code: reference,
    version: z.number(),
});

export const itemCategoryInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    parent_id: z.string().nullable().optional(),
    tracking_code_id: z.string().nullable().optional(),
    version: z.number().optional(),
});
