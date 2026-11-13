import { z } from 'zod';
import { dischargeSchema } from '../discharge/discharge.schema.ts';

// Isi tab Rekam Medis poli sistem lama, panel Anamnesa sampai E-Resep. Satu bentuk untuk dibaca dan disimpan: layar
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

// Pemeriksaan Dasar Gigi: Extraoral (bengkak sampai suhu kulit) lalu Intraoral, seperti PemeriksaanGigiDasar.php.
export const dentalSchema = z.object({
    swelling: text,
    consistency: text,
    skin_color: text,
    skin_temperature: text,
    mobility: text,
    gum_color: text,
    caries: text,
    intraoral_swelling: text,
    percussion: text,
    pressure: text,
    palpation: text,
    caries_status: text,
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

// Baris diagnosa (SIMtrRJDiagnosaAwal). Satu kode ICD-10 sekali per pemeriksaan, jadi baris dikenali dari kodenya.
// Kode dan nama ICD-10 hanya dibaca, untuk label pilihan. Posisi gigi hanya ada bila section memakai Pemeriksaan dasar
// gigi, seperti kolom Posisi Gigi sistem lama.
export const diagnosisSchema = z.object({
    icd10_id: text,
    icd10_code: text,
    icd10_name: text,
    type_id: text,
    case_id: text,
    doctor_id: text,
    nurse_id: text,
    tooth_position: text.optional(),
});

// Alergi obat pasien (SIMtrRiwayatAlergiObat), milik pasien seperti alergi lain. Kode dan nama hanya dibaca.
export const drugAllergySchema = z.object({
    drug_id: z.string(),
    drug_code: text,
    drug_name: z.string(),
});

// Baris Biaya Tindakan (SIMtrRJTransaksi). Satu tindakan sekali per pemeriksaan, jadi baris dikenali dari tindakannya.
// Kode, nama, tarif, pengisi, dan jamnya hanya dibaca; tarif dihitung server saat baris pertama kali disimpan.
export const procedureSchema = z.object({
    procedure_id: text,
    procedure_code: text,
    procedure_name: text,
    quantity: number,
    doctor_id: text,
    tariff: text,
    added_by: text,
    added_at: text,
});

export const drugUnitSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    quantity_per_unit: z.string(),
});

// Baris resep (SIMtrResepDetail): obat tunggal (compound kosong), kepala racikan "Racikan N" (drug_id kosong,
// compound N), atau komponen racikan (drug_id dan compound terisi). Baris dikenali dari obatnya, atau dari nomor
// racikannya untuk kepala racikan. Kode dan nama obat hanya dibaca.
export const prescriptionLineSchema = z.object({
    drug_id: text,
    drug_code: text,
    drug_name: text,
    // Satuan jumlah baris obat; kosong saat disimpan berarti satuan jual obat. Kode, nama, isi, dan pilihan satuan hanya
    // dibaca.
    unit_id: text,
    unit_code: text,
    unit_name: text,
    quantity_per_unit: text,
    units: z.array(drugUnitSchema),
    compound: number,
    quantity: number,
    requested_quantity: number,
    signa: text,
    usage_instruction_id: text,
    notes: text,
    // Yang dipegang pasien: diserahkan farmasi dikurangi yang dikembalikan, seperti "Obat Direalisasi" di CPPT sistem
    // lama. Hanya dibaca; kosong selama belum diserahkan.
    dispensed_quantity: text.optional(),
    // Total yang dikembalikan pasien ke farmasi; hanya dibaca, kosong bila belum pernah ada retur.
    returned_quantity: text.optional(),
});

// Resep (SIMtrResep). Hanya draf yang diubah Simpan; nomor, status, waktu kirim, dokter, dan perawat hanya dibaca.
export const prescriptionSchema = z.object({
    id: text,
    number: text,
    status: z.enum(['draf', 'dikirim', 'dibatalkan']),
    sent_at: text,
    // Waktu dan nomor penyerahan dari farmasi; hanya dibaca.
    dispensed_at: text.optional(),
    dispensing_number: text.optional(),
    doctor_name: text,
    nurse_name: text,
    notes: text,
    lines: z.array(prescriptionLineSchema),
});

// Isi rekam medis memuat panel yang dipakai section tujuan saja (medical-record.panels.ts). Panel lain tidak ada di
// bentuk ini, dan Simpan menolaknya.
export const medicalRecordSchema = z.object({
    id: text,
    version: number,
    anamnesis: anamnesisSchema.optional(),
    history: historySchema.optional(),
    allergy: allergySchema.optional(),
    status: statusSchema.optional(),
    physical: physicalSchema.optional(),
    pain: painSchema.optional(),
    fall_risk: fallRiskSchema.optional(),
    dental: dentalSchema.optional(),
    findings: z.array(findingSchema).optional(),
    anatomy: z.array(anatomySchema).optional(),
    other: otherSchema.optional(),
    diagnoses: z.array(diagnosisSchema).optional(),
    prognosis_id: text.optional(),
    chronic_disease_ids: z.array(z.string()).optional(),
    drug_allergies: z.array(drugAllergySchema).optional(),
    procedures: z.array(procedureSchema).optional(),
    prescriptions: z.array(prescriptionSchema).optional(),
    discharge: dischargeSchema.optional(),
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
    dental: panel,
    findings: z.array(z.unknown()).optional(),
    anatomy: z.array(z.unknown()).optional(),
    other: panel,
    diagnoses: z.array(z.unknown()).optional(),
    prognosis_id: z.unknown().optional(),
    chronic_disease_ids: z.array(z.unknown()).optional(),
    drug_allergies: z.array(z.unknown()).optional(),
    procedures: z.array(z.unknown()).optional(),
    prescriptions: z.array(z.unknown()).optional(),
    discharge: panel,
});
// Kirim ke farmasi: daftar resep layar (draf diambil darinya) beserta dokter dan perawat Anamnesa yang sedang diisi.
export const prescriptionSendSchema = z.object({
    version: z.number().nullable().optional(),
    doctor_id: z.unknown().optional(),
    nurse_id: z.unknown().optional(),
    prescriptions: z.array(z.unknown()).optional(),
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
export type PrescriptionSendInput = Pick<
    MedicalRecordInput,
    'version' | 'prescriptions'
> & {
    doctor_id?: string | null;
    nurse_id?: string | null;
};
