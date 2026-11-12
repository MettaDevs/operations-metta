import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Daftar pendek klinis yang berbentuk sama (kode, nama, urutan, aktif): jenis diagnosa, kasus diagnosa, prognosa, dan
// penyakit kronis panel Diagnosa; kelompok tindakan; satuan obat, bentuk sediaan, dan aturan pakai resep. Isinya data
// per tenant; nilai di sini hanya nama daftarnya di URL.
export const diagnosisReferenceListSchema = z.enum([
    'diagnosis-types',
    'diagnosis-cases',
    'prognoses',
    'chronic-diseases',
    'procedure-groups',
    'drug-units',
    'dosage-forms',
    'usage-instructions',
]);
export type DiagnosisReferenceList = z.infer<
    typeof diagnosisReferenceListSchema
>;

export const diagnosisReferenceRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    sort_order: z.number(),
    is_active: z.boolean(),
    version: z.number(),
});

export const diagnosisReferenceListQuerySchema = listParametersSchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
});

export const diagnosisReferenceInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});
