import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Kelompok tindakan (SIMmGroupJasa sistem lama), dipilih di kartu tindakan dan kategori tindakan.
export const procedureGroupRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    international_name: z.string().nullable(),
    // Kode Kelompok Perawatan dari katalog procedure-group.options.ts.
    treatment_group: z.string(),
    // NoUrut sistem lama, urutan kwitansi.
    sort_order: z.number(),
    is_active: z.boolean(),
    version: z.number(),
});

export const procedureGroupListQuerySchema = listParametersSchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
});

export const procedureGroupInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    international_name: z.string().nullable().optional(),
    treatment_group: z.string().optional(),
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
