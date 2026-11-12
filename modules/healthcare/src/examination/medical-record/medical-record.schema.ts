import { z } from 'zod';

// Isi tab Rekam Medis poli sistem lama, panel Anamnesa sampai Lainnya. Satu bentuk untuk dibaca dan disimpan: layar
// mengirim kembali bentuk yang ia terima. Angka boleh datang sebagai teks dari isian; service yang memeriksanya.

const text = z.string().nullable();
const flag = z.boolean().nullable();
const number = z.number().nullable();

export const anamnesisSchema = z.object({
    doctor_id: text,
    nurse_id: text,
    chief_complaint: text,
    additional_complaint: text,
    illness_years: number,
    illness_months: number,
    illness_days: number,
});

export const historySchema = z.object({
    none: z.boolean(),
    present: text,
    past: text,
    family: text,
});

// Alergi milik pasien, bukan kunjungan: terbawa ke pemeriksaan berikutnya.
export const allergySchema = z.object({
    none: z.boolean(),
    food_allergy_id: text,
    airborne_allergy_id: text,
    other: text,
});

export const statusSchema = z.object({
    uses_mobility_aid: flag,
    mobility_aid_note: text,
    communication_barrier: flag,
    communication_barrier_note: text,
    caregiver_at_home: flag,
    caregiver_at_home_note: text,
    needs_assistance: flag,
    needs_assistance_note: text,
    emotional_expression: text,
    language: text,
    language_note: text,
    lives_with: text,
    lives_with_note: text,
    social_economy: text,
    past_mental_disorder: text,
    economic_status: text,
    family_relationship: text,
});

export const physicalSchema = z.object({
    consciousness: text,
    systolic: number,
    diastolic: number,
    height: number,
    height_method: text,
    weight: number,
    waist_circumference: number,
    pulse_rate: number,
    respiratory_rate: number,
    oxygen_saturation: number,
    temperature: number,
    eye_opening: text,
    verbal_response: text,
    motor_response: text,
    mobility: text,
    toileting: text,
    eating: text,
    bathing: text,
    dressing: text,
    heart_rhythm: text,
    triage: text,
});

export const painSchema = z.object({
    has_pain: flag,
    trigger: text,
    quality: text,
    location: text,
    scale: number,
    timing: text,
});

export const fallRiskSchema = z.object({
    unsteady_gait: flag,
    uses_support: flag,
});

export const otherSchema = z.object({
    drug_therapy: text,
    non_drug_therapy: text,
    consumables: text,
    plan: text,
    smoking: flag,
    alcohol: flag,
    low_vegetable_fruit: flag,
    nursing_care_type: text,
    education: text,
    nursing_care_description: text,
    observation: text,
    notes: text,
    biopsychosocial: text,
    nursing_actions: text,
});

export const findingSchema = z.object({ aspect_id: z.string(), result: text });
export const anatomySchema = z.object({
    id: text,
    body_part: text,
    description: text,
});

export const medicalRecordSchema = z.object({
    id: text,
    version: number,
    anamnesis: anamnesisSchema,
    history: historySchema,
    allergy: allergySchema,
    status: statusSchema,
    physical: physicalSchema,
    pain: painSchema,
    fall_risk: fallRiskSchema,
    findings: z.array(findingSchema),
    anatomy: z.array(anatomySchema),
    other: otherSchema,
});
export type MedicalRecord = z.infer<typeof medicalRecordSchema>;

// Kiriman layar. Bentuk panelnya diperiksa per isian oleh service, supaya pesan salahnya menunjuk isian itu.
const panel = z.record(z.string(), z.unknown()).optional();
export const medicalRecordInputSchema = z.object({
    version: z.number().nullable().optional(),
    anamnesis: panel,
    history: panel,
    allergy: panel,
    status: panel,
    physical: panel,
    pain: panel,
    fall_risk: panel,
    findings: z.array(z.unknown()).optional(),
    anatomy: z.array(z.unknown()).optional(),
    other: panel,
});
// Bentuk kiriman layar: angka boleh masih berupa teks isian.
type Loose<T> = T extends number
    ? number | string
    : T extends (infer U)[]
      ? Loose<U>[]
      : T extends object
        ? { [K in keyof T]: Loose<T[K]> }
        : T;
export type MedicalRecordInput = Loose<MedicalRecord>;
