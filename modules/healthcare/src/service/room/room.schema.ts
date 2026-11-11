import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Ruangan: ruang fisik di satu operating unit, misalnya L1R1 di lantai 1. Section memilih ruangan yang melayaninya.
export const roomRowSchema = z.object({
    id: z.string(),
    operating_unit_id: z.string(),
    operating_unit_name: z.string(),
    code: z.string(),
    floor: z.string().nullable(),
    name: z.string(),
    // Nama di layar antrean; kosong berarti nama ruangan.
    display_name: z.string().nullable(),
    // Urutan ruangan di unitnya, misalnya di layar antrean.
    sort_order: z.number(),
    is_active: z.boolean(),
    version: z.number(),
});

export const roomListQuerySchema = listParametersSchema.extend({
    operating_unit_id: z.string().optional(),
    status: z.enum(['active', 'inactive']).optional(),
});

export const roomInputSchema = z.object({
    operating_unit_id: z.string(),
    code: z.string(),
    floor: z.string().nullable().optional(),
    name: z.string(),
    display_name: z.string().nullable().optional(),
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
