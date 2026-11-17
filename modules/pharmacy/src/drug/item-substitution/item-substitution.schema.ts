import { z } from 'zod';

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

// Satu obat yang boleh menggantikan obat lain saat resep disiapkan (Item Substitution BC). Satu satuan dasar obat
// pengganti menggantikan satu satuan dasar obat resep.
export const itemSubstitutionRowSchema = z.object({
    id: z.string(),
    substitute: reference,
    base_unit_name: z.string(),
    notes: z.string().nullable(),
    is_blocked: z.boolean(),
    version: z.number(),
});
export type ItemSubstitutionRow = z.infer<typeof itemSubstitutionRowSchema>;

// interchangeable: juga mencatat arah sebaliknya (Interchangeable BC), bila belum ada.
export const itemSubstitutionInputSchema = z.object({
    substitute_item_id: z.string(),
    notes: z.string().nullable().optional(),
    interchangeable: z.boolean().optional(),
});
