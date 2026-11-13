import { z } from 'zod';

const text = z.string().nullable();
const number = z.number().nullable();

// Catatan Perkembangan Pasien Terintegrasi satu pemeriksaan, disusun dari isi rekam medis terstruktur seperti
// Outpatient::collection_history_cppt sistem lama. Kode pilihan sudah diganti namanya. Hanya dibaca.
export const cpptSchema = z.object({
    destination_id: z.string(),
    date: z.string(),
    section_name: z.string(),
    registration_number: z.string(),
    examination_number: z.string(),
    status: z.string(),
    doctor_name: text,
    nurse_name: text,
    // S: keluhan dan riwayat penyakit. Riwayat tidak ditulis bila dicentang tidak ada, seperti sistem lama.
    subjective: z.object({
        chief_complaint: text,
        additional_complaint: text,
        history_none: z.boolean().nullable(),
        present_history: text,
        past_history: text,
        family_history: text,
    }),
    // O: tanda vital, nyeri, risiko jatuh, dan pemeriksaan dasar gigi bila ada.
    objective: z.object({
        consciousness: text,
        systolic: number,
        diastolic: number,
        height: number,
        weight: number,
        waist_circumference: number,
        pulse_rate: number,
        respiratory_rate: number,
        oxygen_saturation: number,
        temperature: number,
        pain_scale: number,
        unsteady_gait: z.boolean().nullable(),
        uses_support: z.boolean().nullable(),
        dental: z.record(z.string(), text).nullable(),
    }),
    // A: diagnosa.
    assessment: z.array(
        z.object({
            icd10_code: z.string(),
            icd10_name: z.string(),
            type_name: z.string(),
            case_name: z.string(),
        }),
    ),
    // P: terapi, tindakan, dan resep. Resep yang sudah diserahkan farmasi ditulis sebagai "Obat Direalisasi" sistem lama
    // (BILLFarmasiDetail.JmlObat - JmlRetur): obat yang dipegang pasien, yaitu yang diserahkan dikurangi yang diretur,
    // dan obat yang habis diretur tidak ditulis. Resep yang belum diserahkan, misalnya di klinik tanpa module farmasi,
    // ditulis seperti yang diresepkan beserta statusnya.
    plan: z.object({
        drug_therapy: text,
        non_drug_therapy: text,
        procedures: z.array(
            z.object({ name: z.string(), quantity: z.number() }),
        ),
        prescriptions: z.array(
            z.object({
                number: text,
                status: z.enum(['draf', 'dikirim']),
                handed_over: z.boolean(),
                lines: z.array(
                    z.object({
                        compound: number,
                        drug_name: text,
                        // Jumlah beserta satuannya, misalnya "2 STRIP"; kosong pada kepala racikan.
                        quantity: text,
                        requested_quantity: number,
                        signa: text,
                        usage_instruction: text,
                        notes: text,
                    }),
                ),
            }),
        ),
    }),
});
export type Cppt = z.infer<typeof cpptSchema>;

// Satu kunjungan di Riwayat kunjungan: pemeriksaan lain pasien ini yang sudah dimulai.
export const visitHistoryRowSchema = z.object({
    id: z.string(),
    date: z.string(),
    section_name: z.string(),
    examination_number: z.string(),
    doctor_name: text,
    diagnoses: text,
});
