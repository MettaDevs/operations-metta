import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Tindakan milik tenant (SIMmListJasa sistem lama), dipilih di baris Biaya Tindakan pemeriksaan.
export const procedureRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    // Nama dalam bahasa lain, misalnya untuk pasien turis (JasaNameEnglish sistem lama).
    international_name: z.string().nullable(),
    group_id: z.string().nullable(),
    group_name: z.string().nullable(),
    category_id: z.string().nullable(),
    category_name: z.string().nullable(),
    // Cost RS persen dan rupiah (CostRSPersen, CostRSRupiah), teks desimal.
    hospital_cost_percent: z.string(),
    hospital_cost_amount: z.string(),
    // Kode dari katalog procedure.options.ts.
    posting_group: z.string(),
    incentive_source: z.string(),
    polyclinic: z.string(),
    // Section yang menawarkan tindakan ini di Biaya Tindakan pemeriksaan (SIMmListJasaSection).
    sections: z.array(z.object({ id: z.string(), name: z.string() })),
    is_active: z.boolean(),
    // Centang status kartu Jasa sistem lama (procedureFlags di procedure.options.ts).
    is_package: z.boolean(),
    reproductive_clinic: z.boolean(),
    manual_tariff: z.boolean(),
    inpatient_day: z.boolean(),
    mcu: z.boolean(),
    auto_system: z.boolean(),
    kso: z.boolean(),
    varies_by_operation_category: z.boolean(),
    varies_by_cito: z.boolean(),
    requires_doctor: z.boolean(),
    uses_device: z.boolean(),
    version: z.number(),
});

export const procedureListQuerySchema = listParametersSchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
    group: z.string().optional(),
    // Hanya tindakan yang ditawarkan di section ini.
    section: z.string().optional(),
});

export const procedureInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    international_name: z.string().nullable().optional(),
    group_id: z.string().nullable().optional(),
    category_id: z.string().nullable().optional(),
    // Section yang menawarkan tindakan ini, dikirim lengkap: yang tidak disebut lagi dilepas. Tanpa section_ids,
    // section tindakan tidak disentuh.
    section_ids: z.array(z.string()).optional(),
    // Teks desimal (12.5) atau angka.
    hospital_cost_percent: z.union([z.string(), z.number()]).optional(),
    hospital_cost_amount: z.union([z.string(), z.number()]).optional(),
    posting_group: z.string().optional(),
    incentive_source: z.string().optional(),
    polyclinic: z.string().optional(),
    is_active: z.boolean().optional(),
    is_package: z.boolean().optional(),
    reproductive_clinic: z.boolean().optional(),
    manual_tariff: z.boolean().optional(),
    inpatient_day: z.boolean().optional(),
    mcu: z.boolean().optional(),
    auto_system: z.boolean().optional(),
    kso: z.boolean().optional(),
    varies_by_operation_category: z.boolean().optional(),
    varies_by_cito: z.boolean().optional(),
    requires_doctor: z.boolean().optional(),
    uses_device: z.boolean().optional(),
    version: z.number().optional(),
});
