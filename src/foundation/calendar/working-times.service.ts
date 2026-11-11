import { z } from 'zod';
import { nowSql, type Database } from '../../platform/database/index.ts';
import { dateSchema, lookupId, validation } from '../../platform/http/index.ts';
import {
    workingTimeIntervalSchema,
    type DayControl,
    type WorkingTimeInterval,
} from './calendar.schema.ts';

// Jam kerja kalender per tanggal, pola F&O: "Compose working times" menulis satu hari per tanggal dari template jam
// kerja, dan setiap tanggal dibaca lewat kalender dasarnya bila hari itu `base`.
//
// Dua keputusan, keduanya mengikuti F&O kecuali yang disebut:
// - Tanggal yang belum disusun dianggap tutup, sama dengan F&O yang menganggap tanggal tanpa jam kerja tidak bekerja.
//   Layar menampilkannya "Belum disusun" supaya bedanya dengan tutup yang disengaja tetap terlihat.
// - Menyusun ulang hanya menimpa hari yang ditulis penyusunan sebelumnya. Hari yang diubah orang, misalnya ditutup
//   karena libur atau dibuka dengan jam khusus, dibiarkan. F&O menimpa semuanya; di sini libur yang sudah diisi tidak
//   hilang karena template disusun ulang. Untuk menyerahkan tanggal itu lagi ke penyusunan, hapus harinya.

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const maxLines = 24;
// Rentang terpanjang satu kali penyusunan atau pembacaan, dalam selisih hari (sekitar tiga tahun), sama dengan CoreERP.
export const maxRangeDays = 1100;

const minutes = (time: string) =>
    Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const hoursOf = (line: WorkingTimeInterval) =>
    Math.round(
        ((minutes(line.to) +
            (line.ends_next_day ? 24 * 60 : 0) -
            minutes(line.from)) /
            60) *
            100,
    ) / 100;

export type NormalizedInterval = WorkingTimeInterval & { hours: number };

// Rentang jam satu hari: format JJ:MM, selesai sesudah mulai (atau besoknya bila ends_next_day), tidak bertumpuk, dan
// paling banyak 24 jam. Jumlah jam dihitung di sini, bukan diambil dari kiriman. Kesalahan dikembalikan per baris
// dengan awalan field pemanggil dan nomor baris aslinya, supaya layar menandai baris yang salah.
export function normalizeIntervals(
    lines: {
        index: number;
        from: string;
        to: string;
        ends_next_day?: boolean | undefined;
    }[],
    prefix: string,
    errors: Record<string, string>,
): NormalizedInterval[] {
    const field = (index: number, part: 'from' | 'to') =>
        `${prefix}.${index}.${part}`;
    if (lines.length > maxLines) {
        errors[prefix] = `Paling banyak ${maxLines} rentang jam dalam sehari.`;
        return [];
    }
    const ranges: { index: number; start: number; end: number }[] = [];
    const normalized = lines.flatMap(({ index, ...line }) => {
        const endsNextDay = line.ends_next_day ?? false;
        if (!timePattern.test(line.from)) {
            errors[field(index, 'from')] =
                'Jam mulai ditulis JJ:MM, misalnya 08:00.';
            return [];
        }
        if (line.to !== '24:00' && !timePattern.test(line.to)) {
            errors[field(index, 'to')] =
                'Jam selesai ditulis JJ:MM, misalnya 17:00 atau 24:00.';
            return [];
        }
        const start = minutes(line.from);
        const end = minutes(line.to) + (endsNextDay ? 24 * 60 : 0);
        if (endsNextDay && (line.to === '24:00' || end - start > 24 * 60)) {
            errors[field(index, 'to')] =
                'Rentang yang selesai besok harus berakhir paling lambat pada jam mulainya.';
            return [];
        }
        if (end <= start) {
            errors[field(index, 'to')] =
                'Jam selesai harus setelah jam mulai. Tandai "Selesai besok" bila rentang ini lewat tengah malam.';
            return [];
        }
        ranges.push({ index, start, end });
        return [
            {
                from: line.from,
                to: line.to,
                ends_next_day: endsNextDay,
                hours: hoursOf({ ...line, ends_next_day: endsNextDay }),
            },
        ];
    });
    ranges.sort((a, b) => a.start - b.start);
    for (let index = 1; index < ranges.length; index++) {
        const current = ranges[index];
        const previous = ranges[index - 1];
        if (current && previous && current.start < previous.end)
            errors[field(current.index, 'from')] =
                'Rentang jam ini bertumpuk dengan baris lain.';
    }
    if (
        ranges.length &&
        ranges.reduce((total, range) => total + range.end - range.start, 0) >
            24 * 60
    )
        errors[prefix] =
            'Jumlah jam dalam satu hari tidak boleh lebih dari 24.';
    return normalized.sort((a, b) => minutes(a.from) - minutes(b.from));
}

export const totalHours = (intervals: NormalizedInterval[]) =>
    Math.round(intervals.reduce((total, line) => total + line.hours, 0) * 100) /
    100;

// Teks pembanding: urutan dan bentuk yang sama untuk rentang yang sama, dari mana pun asalnya.
export const intervalsKey = (intervals: WorkingTimeInterval[]) =>
    JSON.stringify(
        intervals
            .map((line) => [line.from, line.to, line.ends_next_day])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );

// 0 = Senin ... 6 = Minggu, sama dengan kolom day_of_week dari CoreERP.
export const dayOfWeek = (date: string) =>
    (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

const dayMs = 24 * 60 * 60 * 1000;
export function datesBetween(from: string, to: string): string[] {
    const dates: string[] = [];
    for (
        let time = Date.parse(`${from}T00:00:00Z`);
        time <= Date.parse(`${to}T00:00:00Z`);
        time += dayMs
    )
        dates.push(new Date(time).toISOString().slice(0, 10));
    return dates;
}

export function checkedRange(from: string, to: string): void {
    const errors: Record<string, string> = {};
    if (!dateSchema.safeParse(from).success) errors.from = 'Isi tanggal mulai.';
    if (!dateSchema.safeParse(to).success) errors.to = 'Isi tanggal selesai.';
    if (Object.keys(errors).length) validation(errors);
    const days = (Date.parse(to) - Date.parse(from)) / dayMs;
    if (days < 0)
        validation({
            to: 'Tanggal selesai tidak boleh sebelum tanggal mulai.',
        });
    if (days > maxRangeDays)
        validation({ to: 'Rentang tanggal paling panjang 3 tahun.' });
}

// Satu tanggal kalender setelah kalender dasarnya dibaca. `composed` false berarti tanggal itu belum disusun di
// kalender ini maupun kalender dasar yang diikutinya; ia tetap dihitung tutup.
export const workingDaySchema = z.object({
    date: z.string(),
    open: z.boolean(),
    composed: z.boolean(),
    intervals: z.array(workingTimeIntervalSchema),
    note: z.string().nullable(),
});
export type WorkingDay = z.infer<typeof workingDaySchema>;

export const linesJson = (dayAlias: string, tenant: string) =>
    `(select coalesce(json_agg(json_build_object('from', to_char(l.from_time, 'HH24:MI'), 'to', to_char(l.to_time, 'HH24:MI'),
                                                'ends_next_day', l.ends_next_day) order by l.from_time), '[]'::json)
      from working_time_calendar_lines l
      where l.tenant_id = ${tenant} and l.working_time_calendar_day_id = ${dayAlias}.id and l.deleted_at is null)`;

// Jam kerja setiap tanggal dalam rentang. Hari `base` diikuti ke kalender dasarnya, berantai sampai hari yang buka atau
// tutup. Kalender dasar yang dihapus, atau hari `base` di kalender tanpa kalender dasar, dihitung tutup. Kalender di
// tenant lain atau yang sudah dihapus memberi daftar kosong.
export async function workingTimes(
    db: Database,
    input: { tenantId: string; calendarId: string; from: string; to: string },
): Promise<WorkingDay[]> {
    checkedRange(input.from, input.to);
    if (!lookupId(input.calendarId)) return [];
    return db.rows(
        workingDaySchema,
        `with recursive dates as (
             select day::date as date from generate_series($2::date, $3::date, interval '1 day') as day
         ), walk as (
             select dates.date, c.id as calendar_id, c.base_calendar_id, 0 as depth
             from dates
             join working_time_calendars c on c.tenant_id = $1 and c.id = $4 and c.deleted_at is null
             union all
             select w.date, b.id, b.base_calendar_id, w.depth + 1
             from walk w
             join working_time_calendar_days d on d.tenant_id = $1 and d.working_time_calendar_id = w.calendar_id
                  and d.date = w.date and d.deleted_at is null and d.control = 'base'
             join working_time_calendars b on b.tenant_id = $1 and b.id = w.base_calendar_id and b.deleted_at is null
             where w.depth < 32
         )
         select date, coalesce(control = 'open', false) as open, control is not null as composed,
                case when control = 'open' then intervals else '[]'::json end as intervals, note
         from (select distinct on (w.date) w.date::text as date, d.control, d.note,
                      ${linesJson('d', '$1')} as intervals
               from walk w
               left join working_time_calendar_days d on d.tenant_id = $1 and d.working_time_calendar_id = w.calendar_id
                    and d.date = w.date and d.deleted_at is null
               order by w.date, w.depth desc) resolved
         order by date`,
        [input.tenantId, input.from, input.to, input.calendarId],
    );
}

// Apakah kalender buka pada tanggal itu, setelah kalender dasarnya dibaca. Tanggal yang belum disusun dihitung tutup.
export async function isOpen(
    db: Database,
    input: { tenantId: string; calendarId: string; date: string },
): Promise<boolean> {
    const [day] = await workingTimes(db, {
        tenantId: input.tenantId,
        calendarId: input.calendarId,
        from: input.date,
        to: input.date,
    });
    return day?.open ?? false;
}

export type ComposeResult = {
    created: number;
    updated: number;
    unchanged: number;
    kept: number;
};

const storedDaySchema = z.object({
    id: z.string(),
    date: z.string(),
    control: z.string(),
    composed: z.boolean(),
    intervals: z.array(workingTimeIntervalSchema),
});

type Target = {
    date: string;
    control: DayControl;
    intervals: NormalizedInterval[];
};

// Kunci per kalender untuk semua yang menulis hari bertanggalnya: penyusunan dan ubah satu hari.
export async function lockCalendarDays(
    db: Database,
    calendarId: string,
): Promise<void> {
    await db.execute(
        "select pg_advisory_xact_lock(hashtextextended('working_time_calendar_days:' || $1, 0))",
        [calendarId],
    );
}

// Bawa jam kerja dari template ke setiap tanggal dalam rentang, atau, bila templateId null, jadikan setiap tanggal
// mengikuti kalender dasar. Hari dalam template tanpa rentang jam menjadi tutup. Aman diulang: hari yang sudah sama
// tidak ditulis lagi, dan hari yang diubah orang tidak ditimpa (lihat keputusan di atas). Jumlah query tetap, berapa
// pun panjang rentangnya.
export async function composeWorkingTimes(
    db: Database,
    input: {
        tenantId: string;
        calendarId: string;
        templateId: string | null;
        from: string;
        to: string;
    },
): Promise<ComposeResult> {
    checkedRange(input.from, input.to);
    const calendar = lookupId(input.calendarId)
        ? await db.one(
              z.object({ base_calendar_id: z.string().nullable() }),
              'select base_calendar_id from working_time_calendars where tenant_id = $1 and id = $2 and deleted_at is null',
              [input.tenantId, input.calendarId],
          )
        : undefined;
    if (!calendar) validation({ calendar_id: 'Kalender tidak ditemukan.' });
    let pattern = new Map<number, NormalizedInterval[]>();
    if (input.templateId === null) {
        if (!calendar.base_calendar_id)
            validation({
                template_id:
                    'Kalender ini tidak punya kalender dasar. Pilih template jam kerja.',
            });
    } else {
        pattern = await templatePattern(db, input.tenantId, input.templateId);
    }
    const targets: Target[] = datesBetween(input.from, input.to).map((date) => {
        if (input.templateId === null)
            return { date, control: 'base', intervals: [] };
        const intervals = pattern.get(dayOfWeek(date)) ?? [];
        return {
            date,
            control: intervals.length ? 'open' : 'closed',
            intervals,
        };
    });

    return db.transaction(async () => {
        await lockCalendarDays(db, input.calendarId);
        const stored = new Map(
            (
                await db.rows(
                    storedDaySchema,
                    `select d.id, d.date::text as date, d.control, d.composed, ${linesJson('d', '$1')} as intervals
                     from working_time_calendar_days d
                     where d.tenant_id = $1 and d.working_time_calendar_id = $2 and d.deleted_at is null
                       and d.date between $3::date and $4::date`,
                    [input.tenantId, input.calendarId, input.from, input.to],
                )
            ).map((day) => [day.date, day]),
        );
        const result: ComposeResult = {
            created: 0,
            updated: 0,
            unchanged: 0,
            kept: 0,
        };
        const inserts: (Target & { id: string })[] = [];
        const updates: (Target & { id: string })[] = [];
        for (const target of targets) {
            const day = stored.get(target.date);
            if (!day) {
                inserts.push({ ...target, id: Bun.randomUUIDv7() });
                result.created++;
            } else if (!day.composed) result.kept++;
            else if (
                day.control === target.control &&
                intervalsKey(day.intervals) === intervalsKey(target.intervals)
            )
                result.unchanged++;
            else {
                updates.push({ ...target, id: day.id });
                result.updated++;
            }
        }
        await writeDays(db, input.tenantId, input.calendarId, inserts, updates);
        return result;
    });
}

async function templatePattern(
    db: Database,
    tenantId: string,
    templateId: string,
): Promise<Map<number, NormalizedInterval[]>> {
    const template = lookupId(templateId)
        ? await db.one(
              z.object({ id: z.string() }),
              'select id from working_time_templates where tenant_id = $1 and id = $2 and deleted_at is null',
              [tenantId, templateId],
          )
        : undefined;
    if (!template)
        validation({ template_id: 'Pilih template jam kerja dari daftar.' });
    const lines = await db.rows(
        z.object({
            day_of_week: z.number(),
            from: z.string(),
            to: z.string(),
            ends_next_day: z.boolean(),
        }),
        `select day_of_week, to_char(from_time, 'HH24:MI') as "from", to_char(to_time, 'HH24:MI') as "to",
                ends_next_day
         from working_time_lines
         where tenant_id = $1 and working_time_template_id = $2 and deleted_at is null
           and from_time is not null and to_time is not null
         order by day_of_week, from_time`,
        [tenantId, templateId],
    );
    const pattern = new Map<number, NormalizedInterval[]>();
    for (const { day_of_week, ...line } of lines)
        pattern.set(day_of_week, [
            ...(pattern.get(day_of_week) ?? []),
            { ...line, hours: hoursOf(line) },
        ]);
    return pattern;
}

// Tulis hari baru dan hari yang berubah beserta jam kerjanya dalam beberapa perintah massal. Hari yang ditulis di sini
// selalu milik penyusunan (composed). Jam kerja lama hari yang berubah diarsipkan, tidak dihapus.
async function writeDays(
    db: Database,
    tenantId: string,
    calendarId: string,
    inserts: (Target & { id: string })[],
    updates: (Target & { id: string })[],
): Promise<void> {
    const stamp = nowSql();
    const record = (day: Target & { id: string }) => ({
        id: day.id,
        date: day.date,
        day_of_week: dayOfWeek(day.date),
        control: day.control,
        hours: day.control === 'open' ? totalHours(day.intervals) : 0,
    });
    if (inserts.length)
        await db.execute(
            `insert into working_time_calendar_days (id, tenant_id, working_time_calendar_id, date, day_of_week, control,
                                                     hours, composed, created_at, updated_at)
             select r.id, $1::uuid, $2::uuid, r.date, r.day_of_week, r.control, r.hours, true, $3::timestamp, $3::timestamp
             from jsonb_to_recordset($4::text::jsonb) as r(id uuid, date date, day_of_week smallint, control text, hours numeric)`,
            [tenantId, calendarId, stamp, JSON.stringify(inserts.map(record))],
        );
    if (updates.length) {
        await db.execute(
            `update working_time_calendar_days d
             set control = r.control, hours = r.hours, day_of_week = r.day_of_week, note = null, updated_at = $2
             from jsonb_to_recordset($3::text::jsonb) as r(id uuid, date date, day_of_week smallint, control text, hours numeric)
             where d.tenant_id = $1 and d.id = r.id`,
            [tenantId, stamp, JSON.stringify(updates.map(record))],
        );
        await archiveLines(
            db,
            tenantId,
            updates.map((day) => day.id),
            stamp,
        );
    }
    await insertLines(db, tenantId, [...inserts, ...updates], stamp);
}

export async function archiveLines(
    db: Database,
    tenantId: string,
    dayIds: string[],
    stamp: string,
): Promise<void> {
    await db.execute(
        `update working_time_calendar_lines set deleted_at = $2, updated_at = $2
         where tenant_id = $1 and deleted_at is null
           and working_time_calendar_day_id in (select value::uuid from jsonb_array_elements_text($3::text::jsonb))`,
        [tenantId, stamp, JSON.stringify(dayIds)],
    );
}

export async function insertLines(
    db: Database,
    tenantId: string,
    days: { id: string; intervals: NormalizedInterval[] }[],
    stamp: string,
): Promise<void> {
    const lines = days.flatMap((day) =>
        day.intervals.map((line) => ({
            id: Bun.randomUUIDv7(),
            day_id: day.id,
            from_time: line.from,
            to_time: line.to,
            ends_next_day: line.ends_next_day,
            hours: line.hours,
        })),
    );
    if (!lines.length) return;
    await db.execute(
        `insert into working_time_calendar_lines (id, tenant_id, working_time_calendar_day_id, from_time, to_time,
                                                  ends_next_day, hours, created_at, updated_at)
         select r.id, $1::uuid, r.day_id, r.from_time::time, r.to_time::time, r.ends_next_day, r.hours,
                $2::timestamp, $2::timestamp
         from jsonb_to_recordset($3::text::jsonb)
              as r(id uuid, day_id uuid, from_time text, to_time text, ends_next_day boolean, hours numeric)`,
        [tenantId, stamp, JSON.stringify(lines)],
    );
}
