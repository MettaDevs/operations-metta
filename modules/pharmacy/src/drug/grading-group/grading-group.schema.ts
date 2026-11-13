import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Kelompok grading obat (SIMmKelompokGrading sistem lama), misalnya INJEKSI atau OBAT ORAL: pengelompokan obat untuk
// grading harga. Tanpa kode, karena orang memilihnya dari namanya.
export const gradingGroupRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    is_active: z.boolean(),
    version: z.number(),
});

// `active=1` hanya kelompok yang aktif, untuk pilihan di data obat dan grading harga.
export const gradingGroupListQuerySchema = listParametersSchema.extend({
    active: z.literal('1').optional(),
});

export const gradingGroupInputSchema = z.object({
    name: z.string(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
