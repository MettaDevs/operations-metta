import { z } from 'zod';
import { listParametersSchema } from '../../platform/http/index.ts';

// Satu rentang jam kerja dalam sehari, "JJ:MM". `ends_next_day` menandai rentang yang selesai lewat tengah malam,
// misalnya 22:00 sampai 06:00; tanpanya jam selesai harus sesudah jam mulai, dan 24:00 boleh dipakai untuk tengah malam.
export const workingTimeIntervalSchema = z.object({
    from: z.string(),
    to: z.string(),
    ends_next_day: z.boolean(),
});
export type WorkingTimeInterval = z.infer<typeof workingTimeIntervalSchema>;

// Template jam kerja: rentang jam per hari dalam seminggu, 0 = Senin ... 6 = Minggu. Hari tanpa rentang berarti tutup.
export const templateLineSchema = workingTimeIntervalSchema.extend({
    day_of_week: z.number().int(),
});

export const workingTimeTemplateRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    lines: z.array(templateLineSchema),
    version: z.number(),
});

export const workingTimeTemplateInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    lines: z.array(
        z.object({
            day_of_week: z.number(),
            from: z.string(),
            to: z.string(),
            ends_next_day: z.boolean().optional(),
        }),
    ),
    version: z.number().optional(),
});

export const calendarRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    base_calendar: z
        .object({ id: z.string(), code: z.string(), name: z.string() })
        .nullable(),
    version: z.number(),
});

export const calendarListQuerySchema = listParametersSchema.extend({
    base: z.enum(['with', 'without']).optional(),
    exclude: z.string().optional(),
});

export const calendarInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    base_calendar_id: z.string().nullable(),
    version: z.number().optional(),
});

// Cara satu tanggal diatur: buka dengan jam kerjanya, tutup, atau mengikuti kalender dasar pada tanggal itu.
export const dayControls = ['open', 'closed', 'base'] as const;
export type DayControl = (typeof dayControls)[number];

export const calendarDayInputSchema = z.object({
    control: z.enum(dayControls),
    lines: z.array(
        z.object({
            from: z.string(),
            to: z.string(),
            ends_next_day: z.boolean().optional(),
        }),
    ),
    note: z.string().nullable(),
    // Versi hari yang sedang diubah; null untuk tanggal yang belum punya baris.
    version: z.number().nullable(),
});

export const composeInputSchema = z.object({
    from: z.string(),
    to: z.string(),
    // null: setiap tanggal mengikuti kalender dasar.
    template_id: z.string().nullable(),
});

export const daysQuerySchema = z.object({
    from: z.string(),
    to: z.string(),
});
