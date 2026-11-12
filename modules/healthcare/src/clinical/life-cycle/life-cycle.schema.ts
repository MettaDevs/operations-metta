import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Siklus hidup: aturan yang memilih siklus hidup dan klaster kunjungan dari jenis kelamin, umur dalam bulan, dan
// status hamil pasien. Nilai kosong tidak membatasi. Batas umur atas tidak termasuk.
export const lifeCycleRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    cluster_id: z.string(),
    cluster_code: z.string(),
    cluster_name: z.string(),
    min_age_months: z.number(),
    max_age_months: z.number().nullable(),
    // Kode jenis kelamin party Core.
    gender: z.string().nullable(),
    gender_name: z.string().nullable(),
    requires_pregnancy: z.boolean().nullable(),
    // Prioritas terkecil menang bila beberapa siklus hidup cocok.
    priority: z.number(),
    sort_order: z.number(),
    is_active: z.boolean(),
    version: z.number(),
});
export type LifeCycleRow = z.infer<typeof lifeCycleRowSchema>;

export const lifeCycleListQuerySchema = listParametersSchema.extend({
    cluster_id: z.string().optional(),
    status: z.enum(['active', 'inactive']).optional(),
});

export const lifeCycleInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    cluster_id: z.string(),
    min_age_months: z.number().int(),
    max_age_months: z.number().int().nullable(),
    gender: z.string().nullable(),
    requires_pregnancy: z.boolean().nullable(),
    priority: z.number().int(),
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
