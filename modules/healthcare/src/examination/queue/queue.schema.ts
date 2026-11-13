import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Ruangan yang memanggil datang dari tempat memanggil, bukan dari pendaftaran atau jadwal.
export const callNextInputSchema = z.object({
    section_id: z.string(),
    room_id: z.string(),
});

// Mulai periksa dari daftar tanpa dipanggil lebih dulu butuh ruangan; pasien yang sudah dipanggil memakai ruangannya.
export const startInputSchema = z.object({
    room_id: z.string().nullable().optional(),
});

export const queueListQuerySchema = listParametersSchema.extend({
    date: z.string().optional(),
    section_id: z.string().optional(),
    room_id: z.string().optional(),
    status: z.string().optional(),
    cluster_id: z.string().optional(),
    practitioner_id: z.string().optional(),
});

// Satu tujuan kunjungan di antrean poli, beserta pasien dan kunjungannya.
export const queueEntrySchema = z.object({
    id: z.string(),
    visit_id: z.string(),
    date: z.string(),
    section_id: z.string(),
    section_name: z.string(),
    queue_number: z.number(),
    queue_code: z.string(),
    queue_position: z.number(),
    status: z.string(),
    room_id: z.string().nullable(),
    room_name: z.string().nullable(),
    practitioner_id: z.string().nullable(),
    practitioner_name: z.string().nullable(),
    registration_number: z.string(),
    examination_number: z.string(),
    registered_at: z.string(),
    visit_status: z.string(),
    visit_kind: z.string(),
    patient_id: z.string(),
    patient_nrm: z.string(),
    patient_name: z.string(),
    gender: z.string().nullable(),
    birth_date: z.string().nullable(),
    age_years: z.number().nullable(),
    age_months: z.number().nullable(),
    age_days: z.number().nullable(),
    patient_type_name: z.string(),
    guarantor_name: z.string().nullable(),
    cluster_code: z.string().nullable(),
    cluster_name: z.string().nullable(),
    life_cycle_name: z.string().nullable(),
    screening_category_name: z.string().nullable(),
    screening_category_color: z.string().nullable(),
    // Panggilan terakhir dan jumlahnya, dari riwayat tindakan antrean.
    called_at: z.string().nullable(),
    call_count: z.number(),
    // Poli asal rujuk internal, bila tujuan ini rujukan.
    referrer_section_name: z.string().nullable(),
    // Waktu Mulai periksa dan Selesai periksa tujuan ini (SIMtrRJ.WaktuMulaiPeriksa dan WaktuSelesaiPeriksa).
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
});
export type QueueEntry = z.infer<typeof queueEntrySchema>;
