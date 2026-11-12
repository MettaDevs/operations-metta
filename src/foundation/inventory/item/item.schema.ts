import { z } from 'zod';

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

// refuse_negative_stock kosong berarti mengikuti parameter persediaan legal entity.
export const itemRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    base_unit: reference,
    category: reference.nullable(),
    tracking_code: reference.nullable(),
    // Dari profil pelacakan, supaya dokumen tahu kapan nomor batch dan kedaluwarsa wajib diisi.
    batch_required: z.boolean(),
    expiry_required: z.boolean(),
    refuse_negative_stock: z.boolean().nullable(),
    is_blocked: z.boolean(),
    version: z.number(),
});

// tracking_code_id yang tidak dikirim saat membuat barang disalin dari kategorinya; saat mengubah, berarti tetap.
export const itemInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    base_unit_id: z.string(),
    category_id: z.string().nullable().optional(),
    tracking_code_id: z.string().nullable().optional(),
    refuse_negative_stock: z.boolean().nullable().optional(),
    is_blocked: z.boolean().optional(),
    version: z.number().optional(),
});

export const batchRowSchema = z.object({
    id: z.string(),
    batch_number: z.string(),
    expiry_date: z.string().nullable(),
});
