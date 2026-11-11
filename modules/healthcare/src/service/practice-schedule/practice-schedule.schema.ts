import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Sesi praktik, misalnya Pagi 08:00-12:00 (SIMmWaktuPraktek sistem lama). Jam ditulis JJ:MM. crosses_midnight dihitung
// database: selesai pada atau sebelum jam mulai berarti selesai besok.
export const practiceSessionRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    crosses_midnight: z.boolean(),
    is_active: z.boolean(),
    version: z.number(),
});

export const practiceSessionListQuerySchema = listParametersSchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
});

export const practiceSessionInputSchema = z.object({
    name: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});

// Template mingguan: day 1..7 = Senin..Minggu, 8 = hari libur kalendernya. capacity null berarti tanpa batas.
export const scheduleTemplateRowSchema = z.object({
    id: z.string(),
    practitioner_id: z.string(),
    practitioner_name: z.string(),
    section_id: z.string(),
    day: z.number(),
    session_id: z.string(),
    session_name: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    crosses_midnight: z.boolean(),
    capacity: z.number().nullable(),
    calendar_id: z.string().nullable(),
    calendar_name: z.string().nullable(),
    valid_from: z.string(),
    valid_to: z.string().nullable(),
    is_active: z.boolean(),
    version: z.number(),
});

export const scheduleTemplateListQuerySchema = z.object({
    section_id: z.string(),
});

export const scheduleTemplateInputSchema = z.object({
    practitioner_id: z.string(),
    section_id: z.string(),
    day: z.number(),
    session_id: z.string(),
    capacity: z.number().nullable().optional(),
    calendar_id: z.string().nullable().optional(),
    valid_from: z.string(),
    valid_to: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
    version: z.number().optional(),
});

export const schedulePractitionerSchema = z.object({
    id: z.string(),
    name: z.string(),
    profession: z.string(),
});

// Jadwal bertanggal. status `terjadwal` atau `batal`; source `template`, `manual`, atau `impor_bpjs`. ends_on berbeda
// dari date bila sesinya lewat tengah malam.
export const practiceScheduleRowSchema = z.object({
    id: z.string(),
    date: z.string(),
    ends_on: z.string(),
    practitioner_id: z.string(),
    practitioner_name: z.string(),
    substitute_practitioner_id: z.string().nullable(),
    substitute_practitioner_name: z.string().nullable(),
    section_id: z.string(),
    session_id: z.string(),
    session_name: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    capacity: z.number().nullable(),
    registered: z.number(),
    source: z.string(),
    template_id: z.string().nullable(),
    status: z.string(),
    cancel_reason: z.string().nullable(),
    manually_changed: z.boolean(),
    version: z.number(),
});

export const practiceScheduleListQuerySchema = z.object({
    section_id: z.string(),
    from: z.string(),
    to: z.string(),
});

// Jadwal tambahan di luar template.
export const practiceScheduleInputSchema = z.object({
    section_id: z.string(),
    date: z.string(),
    practitioner_id: z.string(),
    session_id: z.string(),
    capacity: z.number().nullable().optional(),
});

// Perubahan satu jadwal bertanggal. Field yang tidak dikirim tidak diubah.
export const practiceScheduleChangeSchema = z.object({
    status: z.enum(['terjadwal', 'batal']).optional(),
    cancel_reason: z.string().nullable().optional(),
    substitute_practitioner_id: z.string().nullable().optional(),
    capacity: z.number().nullable().optional(),
    version: z.number().optional(),
});

export const generateInputSchema = z.object({
    from: z.string(),
    to: z.string(),
    section_id: z.string().nullable().optional(),
});

// Jadwal yang ditawarkan pendaftaran kunjungan: hanya yang terjadwal, dengan nakes yang benar-benar praktik (pengganti
// bila ada).
export const registrationScheduleSchema = z.object({
    id: z.string(),
    date: z.string(),
    ends_on: z.string(),
    practitioner_id: z.string(),
    practitioner_name: z.string(),
    scheduled_practitioner_id: z.string(),
    is_substitute: z.boolean(),
    session_id: z.string(),
    session_name: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    capacity: z.number().nullable(),
    registered: z.number(),
    full: z.boolean(),
});
export type RegistrationSchedule = z.infer<typeof registrationScheduleSchema>;
