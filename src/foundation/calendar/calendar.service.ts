import { z } from 'zod';
import type { Workspace } from '../../platform/access/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Bind,
    type Database,
} from '../../platform/database/index.ts';
import {
    abort,
    coded,
    dateSchema,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../platform/http/index.ts';
import {
    calendarDayInputSchema,
    calendarInputSchema,
    calendarRowSchema,
    composeInputSchema,
    workingTimeIntervalSchema,
} from './calendar.schema.ts';
import {
    archiveLines,
    composeWorkingTimes,
    dayOfWeek,
    insertLines,
    intervalsKey,
    linesJson,
    lockCalendarDays,
    normalizeIntervals,
    totalHours,
    workingTimes,
} from './working-times.service.ts';

const rowSql = `select * from (
    select c.id, c.code, c.name, c.version, b.code as base_code,
           case when b.id is null then null
                else json_build_object('id', b.id, 'code', b.code, 'name', b.name) end as base_calendar,
           c.base_calendar_id
    from working_time_calendars c
    left join working_time_calendars b on b.tenant_id = c.tenant_id and b.id = c.base_calendar_id
         and b.deleted_at is null
    where c.tenant_id = $1 and c.deleted_at is null) calendars
    where true`;

const storedDaySchema = z.object({
    id: z.string(),
    date: z.string(),
    control: z.enum(['open', 'closed', 'base']),
    lines: z.array(workingTimeIntervalSchema),
    note: z.string().nullable(),
    composed: z.boolean(),
    version: z.number(),
});

type Input = { code: string; name: string; base_calendar_id: string | null };

// Kalender (Sys Admin → Kalender), pola "Calendars" F&O: kode, nama, kalender dasar, dan jam kerja per tanggal. Kalender
// milik tenant dan dipakai semua module; yang memasangnya ke sesuatu, misalnya jadwal praktik, adalah module pemilik
// hal itu, lewat fungsi di index.ts.
export class Calendars {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(parameters: URLSearchParams) {
        this.workspace.guard('calendar', 'read');
        const bindings: Bind[] = [this.workspace.tenantId];
        let filter = '';
        const base = parameters.get('base');
        if (base === 'with') filter += ' and base_calendar_id is not null';
        if (base === 'without') filter += ' and base_calendar_id is null';
        // Pilihan kalender dasar tidak menawarkan kalender yang sedang dibuka.
        const exclude = lookupId(parameters.get('exclude') ?? '');
        if (exclude) {
            bindings.push(exclude);
            filter += ` and id <> $${bindings.length}`;
        }
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: { code: 'code', name: 'name', base_calendar: 'base_code' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => calendarRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has('core.calendar.update'),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  calendarRowSchema,
                  `${rowSql} and calendars.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Kalender tidak ditemukan.');
        return found;
    }

    private checked(body: unknown): Input {
        const parsed = calendarInputSchema.safeParse(body);
        const data = parsed.success ? parsed.data : null;
        const errors: Record<string, string> = {};
        const code = data?.code.trim().toUpperCase() ?? '';
        if (!code) errors.code = 'Isi kode kalender.';
        else if (code.length > 50)
            errors.code = 'Kode kalender paling banyak 50 karakter.';
        const name = data?.name.trim() ?? '';
        if (!name) errors.name = 'Isi nama kalender.';
        else if (name.length > 150)
            errors.name = 'Nama kalender paling banyak 150 karakter.';
        const base = data?.base_calendar_id ?? null;
        if (base !== null && !lookupId(base))
            errors.base_calendar_id = 'Pilih kalender dasar dari daftar.';
        if (Object.keys(errors).length || !data) validation(errors);
        return { code, name, base_calendar_id: base };
    }

    // Kalender dasar harus kalender tenant ini, dan rantainya tidak boleh kembali ke kalender yang disimpan. Dijalankan
    // di bawah kunci per tenant, supaya dua admin yang menyimpan bersamaan tidak sama-sama membuat putaran.
    private async checkBase(id: string, baseId: string | null) {
        await this.db.execute(
            "select pg_advisory_xact_lock(hashtextextended('working_time_calendars:' || $1, 0))",
            [this.workspace.tenantId],
        );
        if (baseId === null) return;
        if (baseId === id)
            validation({
                base_calendar_id:
                    'Kalender tidak bisa menjadi kalender dasar dirinya sendiri.',
            });
        const chain = await this.db.rows(
            z.object({ id: z.string() }),
            `with recursive chain as (
                 select id, base_calendar_id, 0 as depth from working_time_calendars
                 where tenant_id = $1 and id = $2 and deleted_at is null
                 union all
                 select c.id, c.base_calendar_id, chain.depth + 1 from chain
                 join working_time_calendars c on c.tenant_id = $1 and c.id = chain.base_calendar_id
                      and c.deleted_at is null
                 where chain.depth < 64
             )
             select id from chain`,
            [this.workspace.tenantId, baseId],
        );
        if (!chain.length)
            validation({
                base_calendar_id: 'Pilih kalender dasar dari daftar.',
            });
        if (chain.some((calendar) => calendar.id === id))
            validation({
                base_calendar_id:
                    'Kalender dasar ini sudah mengikuti kalender yang sedang diubah. Pilih kalender lain supaya tidak saling mengikuti.',
            });
    }

    async create(body: unknown) {
        this.workspace.guard('calendar', 'update');
        const input = this.checked(body);
        const id = Bun.randomUUIDv7();
        try {
            await this.db.transaction(async () => {
                await this.checkBase(id, input.base_calendar_id);
                const stamp = nowSql();
                await this.db.insert('working_time_calendars', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    code: input.code,
                    name: input.name,
                    base_calendar_id: input.base_calendar_id,
                    created_at: stamp,
                    updated_at: stamp,
                });
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('calendar', 'update');
        const current = await this.row(id);
        const input = this.checked(body);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                await this.checkBase(current.id, input.base_calendar_id);
                updated = await this.db.execute(
                    `update working_time_calendars set code = $1, name = $2, base_calendar_id = $3, updated_at = $4
                     where tenant_id = $5 and id = $6 and version = $7 and deleted_at is null`,
                    [
                        input.code,
                        input.name,
                        input.base_calendar_id,
                        nowSql(),
                        this.workspace.tenantId,
                        current.id,
                        version,
                    ],
                );
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Menghapus mengisi deleted_at. Kalender yang masih menjadi kalender dasar kalender lain tidak boleh dihapus, karena
    // hari yang mengikutinya akan kehilangan jam kerjanya tanpa ada yang melihat.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('calendar', 'update');
        const current = await this.row(id);
        let deleted = 0;
        await this.db.transaction(async () => {
            await this.checkBase(current.id, null);
            const followers = await this.db.rows(
                z.object({ code: z.string() }),
                `select code from working_time_calendars
                 where tenant_id = $1 and base_calendar_id = $2 and deleted_at is null order by code`,
                [this.workspace.tenantId, current.id],
            );
            if (followers.length)
                validation({
                    _form: `Kalender ini masih menjadi kalender dasar ${followers.map((calendar) => calendar.code).join(', ')}. Ganti kalender dasarnya lebih dulu.`,
                });
            deleted = await this.db.execute(
                'update working_time_calendars set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
                [
                    nowSql(),
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        });
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }

    // Setiap tanggal dalam rentang: baris tersimpan kalender ini (bila ada) dan hasilnya setelah kalender dasar dibaca.
    async days(id: string, parameters: URLSearchParams) {
        this.workspace.guard('calendar', 'read');
        const calendar = await this.row(id);
        const from = parameters.get('from') ?? '';
        const to = parameters.get('to') ?? '';
        const resolved = await workingTimes(this.db, {
            tenantId: this.workspace.tenantId,
            calendarId: calendar.id,
            from,
            to,
        });
        const stored = new Map(
            (
                await this.db.rows(
                    storedDaySchema,
                    `select d.id, d.date::text as date, d.control, ${linesJson('d', '$1')} as lines, d.note,
                            d.composed, d.version
                     from working_time_calendar_days d
                     where d.tenant_id = $1 and d.working_time_calendar_id = $2 and d.deleted_at is null
                       and d.date between $3::date and $4::date`,
                    [this.workspace.tenantId, calendar.id, from, to],
                )
            ).map((day) => [day.date, day]),
        );
        return {
            data: resolved.map((day) => ({
                date: day.date,
                day_of_week: dayOfWeek(day.date),
                stored: stored.get(day.date) ?? null,
                resolved: day,
            })),
            can_manage: this.workspace.permissions.has('core.calendar.update'),
        };
    }

    async compose(id: string, body: unknown) {
        this.workspace.guard('calendar', 'update');
        const calendar = await this.row(id);
        const parsed = composeInputSchema.safeParse(body);
        if (!parsed.success)
            validation({ from: 'Isi tanggal mulai dan tanggal selesai.' });
        return {
            data: await composeWorkingTimes(this.db, {
                tenantId: this.workspace.tenantId,
                calendarId: calendar.id,
                templateId: parsed.data.template_id,
                from: parsed.data.from,
                to: parsed.data.to,
            }),
        };
    }

    // Ubah satu tanggal: buka dengan jam kerjanya, tutup, atau ikuti kalender dasar, beserta catatannya. Jam kerja tetap
    // tersimpan walau harinya ditutup, sehingga membukanya lagi memulihkan jamnya. Hari yang diubah di sini tidak lagi
    // ditimpa "Susun jam kerja".
    async setDay(id: string, date: string, body: unknown) {
        this.workspace.guard('calendar', 'update');
        const calendar = await this.row(id);
        if (!dateSchema.safeParse(date).success)
            abort(404, 'Tanggal tidak ditemukan.');
        const parsed = calendarDayInputSchema.safeParse(body);
        if (!parsed.success)
            validation({
                control: 'Pilih buka, tutup, atau ikuti kalender dasar.',
            });
        const input = parsed.data;
        const errors: Record<string, string> = {};
        const lines = normalizeIntervals(
            input.lines.map((line, index) => ({ ...line, index })),
            'lines',
            errors,
        );
        if (input.control === 'open' && !input.lines.length)
            errors.lines = 'Hari yang buka butuh sedikitnya satu rentang jam.';
        if (input.control === 'base' && !calendar.base_calendar)
            errors.control =
                'Kalender ini tidak punya kalender dasar untuk diikuti.';
        const note = input.note?.trim() || null;
        if (note && note.length > 255)
            errors.note = 'Catatan paling banyak 255 karakter.';
        if (Object.keys(errors).length) validation(errors);
        const hours = input.control === 'open' ? totalHours(lines) : 0;
        await this.db.transaction(async () => {
            await lockCalendarDays(this.db, calendar.id);
            const current = await this.db.one(
                storedDaySchema,
                `select d.id, d.date::text as date, d.control, ${linesJson('d', '$1')} as lines, d.note, d.composed,
                        d.version
                 from working_time_calendar_days d
                 where d.tenant_id = $1 and d.working_time_calendar_id = $2 and d.date = $3::date
                   and d.deleted_at is null`,
                [this.workspace.tenantId, calendar.id, date],
            );
            if ((current?.version ?? null) !== input.version)
                coded(409, 'stale_version', staleMessage);
            const stamp = nowSql();
            const dayId = current?.id ?? Bun.randomUUIDv7();
            if (current)
                await this.db.execute(
                    `update working_time_calendar_days set control = $1, note = $2, hours = $3, composed = false,
                            updated_at = $4
                     where tenant_id = $5 and id = $6`,
                    [
                        input.control,
                        note,
                        hours,
                        stamp,
                        this.workspace.tenantId,
                        dayId,
                    ],
                );
            else
                await this.db.insert('working_time_calendar_days', {
                    id: dayId,
                    tenant_id: this.workspace.tenantId,
                    working_time_calendar_id: calendar.id,
                    date,
                    day_of_week: dayOfWeek(date),
                    control: input.control,
                    note,
                    hours,
                    composed: false,
                    created_at: stamp,
                    updated_at: stamp,
                });
            if (
                !current ||
                intervalsKey(current.lines) !== intervalsKey(lines)
            ) {
                if (current)
                    await archiveLines(
                        this.db,
                        this.workspace.tenantId,
                        [dayId],
                        stamp,
                    );
                await insertLines(
                    this.db,
                    this.workspace.tenantId,
                    [{ id: dayId, intervals: lines }],
                    stamp,
                );
            }
        });
        return this.days(
            calendar.id,
            new URLSearchParams({ from: date, to: date }),
        );
    }

    // Menghapus hari mengisi deleted_at pada hari dan jam kerjanya. Tanggal itu kembali belum disusun, dan penyusunan
    // berikutnya mengisinya lagi.
    async deleteDay(request: Request, id: string, date: string, body: unknown) {
        this.workspace.guard('calendar', 'update');
        const calendar = await this.row(id);
        if (!dateSchema.safeParse(date).success)
            abort(404, 'Tanggal tidak ditemukan.');
        const version = expectedVersion(request, body);
        let deleted: string | undefined;
        await this.db.transaction(async () => {
            await lockCalendarDays(this.db, calendar.id);
            const stamp = nowSql();
            deleted = (
                await this.db.one(
                    z.object({ id: z.string() }),
                    `update working_time_calendar_days set deleted_at = $1, updated_at = $1
                     where tenant_id = $2 and working_time_calendar_id = $3 and date = $4::date and version = $5
                       and deleted_at is null
                     returning id`,
                    [
                        stamp,
                        this.workspace.tenantId,
                        calendar.id,
                        date,
                        version,
                    ],
                )
            )?.id;
            if (deleted)
                await archiveLines(
                    this.db,
                    this.workspace.tenantId,
                    [deleted],
                    stamp,
                );
        });
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('working_time_calendars_code_unique')
    )
        validation({ code: 'Kode ini sudah dipakai kalender lain.' });
}
