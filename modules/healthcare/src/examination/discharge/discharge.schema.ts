import { z } from 'zod';

const text = z.string().nullable();

// Rujuk internal yang sudah dibuat dari tujuan ini: tujuan baru di kunjungan yang sama. Hanya dibaca; dibuat lewat
// POST .../internal-referrals, bukan lewat Simpan.
export const internalReferralSchema = z.object({
    id: z.string(),
    section_name: z.string(),
    queue_code: z.string(),
    practitioner_name: text,
    session_name: text,
    status: z.string(),
    note: text,
});

// Panel Status Pasien sistem lama (SIMtrDataRegPasien.StatusPasien dan isian di bawahnya), disimpan di tujuan
// kunjungan. Isian milik perilaku lain dikosongkan saat Simpan, seperti statuspasien_helper::submit.
// condition_id: keadaan pasien saat pulang dari poli (Condition "Meninggalkan Faskes" SATUSEHAT), tidak bergantung pada
// status, seperti Keadaan Pulang form KIA sistem lama.
export const dischargeSchema = z.object({
    status_id: text,
    condition_id: text,
    follow_up: z.boolean().nullable(),
    follow_up_date: text,
    consultant_id: text,
    referral_destination: text,
    referral_specialty: text,
    referral_reason: text,
    death_time_category: text,
    death_date: text,
    death_time: text,
    internal_referrals: z.array(internalReferralSchema),
});
export type Discharge = z.infer<typeof dischargeSchema>;

export const internalReferralInputSchema = z.object({
    status_id: z.string().nullable().optional(),
    section_id: z.string().nullable().optional(),
    practice_schedule_id: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
});
export type InternalReferralInput = z.infer<typeof internalReferralInputSchema>;

// Poli tujuan rujuk internal: section aktif di unit kunjungan yang belum ada di kunjungan ini, dengan jadwal praktik
// hari kunjungan.
export const referralOptionSchema = z.object({
    id: z.string(),
    name: z.string(),
    schedules: z.array(
        z.object({
            id: z.string(),
            practitioner_name: z.string(),
            session_name: z.string(),
            start_time: z.string(),
            end_time: z.string(),
            full: z.boolean(),
        }),
    ),
});
