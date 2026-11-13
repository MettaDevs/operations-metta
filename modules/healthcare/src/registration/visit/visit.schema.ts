import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

const optionalText = z.string().nullable().optional();
// Layar mengirim isian angka apa adanya; service yang memeriksa nilainya.
const optionalMeasure = z.union([z.number(), z.string()]).nullable().optional();

// Isian pendaftaran kunjungan. Nomor registrasi, nomor bukti, dan nomor antrean tidak pernah datang dari klien.
export const visitInputSchema = z.object({
    patient_id: z.string(),
    patient_type_id: z.string(),
    guarantor_id: optionalText,
    card_number: optionalText,
    height_cm: optionalMeasure,
    weight_kg: optionalMeasure,
    visit_condition: z.string(),
    patient_condition_ids: z.array(z.string()).optional(),
    screening_sign_ids: z.array(z.string()).optional(),
    section_id: z.string(),
    practice_schedule_id: optionalText,
    // Ditanyakan hanya bila siklus hidup bersyarat hamil dapat berlaku untuk pasien; bawaannya tidak hamil.
    pregnant: z.boolean().optional(),
});
export type VisitInput = z.infer<typeof visitInputSchema>;

export const visitCancelInputSchema = z.object({
    version: z.number().optional(),
    reason: z.string(),
});

export const visitListQuerySchema = listParametersSchema.extend({
    from: z.string().optional(),
    to: z.string().optional(),
    section_id: z.string().optional(),
    practitioner_id: z.string().optional(),
    patient_type_id: z.string().optional(),
    patient_id: z.string().optional(),
    cluster_id: z.string().optional(),
    status: z.string().optional(),
});

export const visitClassificationQuerySchema = z.object({
    patient_id: z.string(),
    pregnant: z.enum(['true', 'false']).optional(),
});

export const visitDestinationSchema = z.object({
    id: z.string(),
    sequence: z.number(),
    section_id: z.string(),
    section_name: z.string(),
    practice_schedule_id: z.string().nullable(),
    practitioner_id: z.string().nullable(),
    practitioner_name: z.string().nullable(),
    queue_number: z.number(),
    queue_code: z.string(),
    examination_number: z.string(),
    status: z.string(),
    room_id: z.string().nullable(),
});

export const visitSchema = z.object({
    id: z.string(),
    version: z.number(),
    registration_number: z.string(),
    legal_entity_id: z.string(),
    operating_unit_id: z.string(),
    operating_unit_name: z.string(),
    patient_id: z.string(),
    patient_nrm: z.string(),
    patient_name: z.string(),
    date: z.string(),
    registered_at: z.string(),
    patient_type_id: z.string(),
    patient_type_name: z.string(),
    guarantor_id: z.string().nullable(),
    guarantor_name: z.string().nullable(),
    card_number: z.string().nullable(),
    // Patient KTP pasien saat kunjungan didaftarkan; harga kunjungan membaca nilai ini, bukan nilai pasien sekarang.
    ktp_patient: z.boolean(),
    height_cm: z.coerce.number().nullable(),
    weight_kg: z.coerce.number().nullable(),
    visit_condition: z.string(),
    age_years: z.number().nullable(),
    age_months: z.number().nullable(),
    age_days: z.number().nullable(),
    visit_kind: z.string(),
    screening_category_id: z.string().nullable(),
    screening_category_name: z.string().nullable(),
    screening_category_color: z.string().nullable(),
    pregnant: z.boolean(),
    // Kosong untuk kunjungan yang didaftarkan sebelum klaster ILP ada.
    life_cycle_id: z.string().nullable(),
    life_cycle_name: z.string().nullable(),
    cluster_id: z.string().nullable(),
    cluster_code: z.string().nullable(),
    cluster_name: z.string().nullable(),
    status: z.string(),
    cancelled_by_user_id: z.string().nullable(),
    cancelled_at: z.string().nullable(),
    cancel_reason: z.string().nullable(),
    patient_conditions: z.array(z.object({ id: z.string(), name: z.string() })),
    screening_signs: z.array(
        z.object({ id: z.string(), name: z.string(), category_id: z.string() }),
    ),
    destinations: z.array(visitDestinationSchema),
});
export type Visit = z.infer<typeof visitSchema>;

export const visitListRowSchema = z.object({
    id: z.string(),
    registration_number: z.string(),
    date: z.string(),
    registered_at: z.string(),
    status: z.string(),
    visit_kind: z.string(),
    patient_id: z.string(),
    patient_nrm: z.string(),
    patient_name: z.string(),
    gender: z.string().nullable(),
    birth_date: z.string().nullable(),
    birth_place: z.string().nullable(),
    age_years: z.number().nullable(),
    nik: z.string().nullable(),
    document_number: z.string().nullable(),
    old_number: z.string().nullable(),
    address: z.string().nullable(),
    visit_condition: z.string(),
    patient_type_name: z.string(),
    guarantor_name: z.string().nullable(),
    card_number: z.string().nullable(),
    section_id: z.string(),
    section_name: z.string(),
    practitioner_id: z.string().nullable(),
    practitioner_name: z.string().nullable(),
    queue_code: z.string(),
    examination_number: z.string(),
    screening_category_name: z.string().nullable(),
    screening_category_color: z.string().nullable(),
    life_cycle_name: z.string().nullable(),
    cluster_id: z.string().nullable(),
    cluster_code: z.string().nullable(),
    cluster_name: z.string().nullable(),
});
