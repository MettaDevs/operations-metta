import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    composeWorkingTimes,
    isOpen,
    workingTimes,
} from '../../../src/foundation/calendar/index.ts';
import { Database } from '../../../src/platform/database/index.ts';
import { HttpFailure } from '../../../src/platform/http/index.ts';
import { operationsTestApp } from '../../support/operations-app.ts';
import { createTenant } from '../../support/tenant-fixtures.ts';

// Fungsi kalender yang dipanggil module lain: menyusun jam kerja dari template, dan membaca jam kerja satu tanggal
// lewat kalender dasarnya. Data awal ditulis lewat SQL langsung, supaya yang diuji hanya fungsinya.
describe.skipIf(!process.env.DB_HOST)('working times', () => {
    if (!process.env.DB_HOST) return;
    const { pool, close } = operationsTestApp();
    let tenantId: string;
    let otherTenantId: string;
    let weekdays: string;
    let night: string;
    afterAll(close);

    // Field yang ditolak validasi, atau kegagalan test bila pemanggilan justru berhasil.
    async function refusal(work: Promise<unknown>): Promise<string[]> {
        try {
            await work;
        } catch (error) {
            if (error instanceof HttpFailure && 'errors' in error.body)
                return Object.keys(error.body.errors ?? {});
            throw error;
        }
        throw new Error('Expected a validation refusal.');
    }

    async function withDb<T>(work: (db: Database) => Promise<T>): Promise<T> {
        const connection = await pool.reserve();
        try {
            return await work(new Database(connection, undefined, 'uji'));
        } finally {
            connection.release();
        }
    }

    async function template(
        code: string,
        lines: [number, string, string, boolean][],
    ) {
        const id = Bun.randomUUIDv7();
        await pool.unsafe(
            'insert into working_time_templates (id, tenant_id, code, name, created_at, updated_at) values ($1, $2, $3, $3, now(), now())',
            [id, tenantId, code],
        );
        for (const [day, from, to, endsNextDay] of lines)
            await pool.unsafe(
                `insert into working_time_lines (id, tenant_id, working_time_template_id, day_of_week, from_time, to_time,
                                                 ends_next_day, created_at, updated_at)
                 values ($1, $2, $3, $4, $5, $6, $7, now(), now())`,
                [Bun.randomUUIDv7(), tenantId, id, day, from, to, endsNextDay],
            );
        return id;
    }

    async function calendar(code: string, baseId: string | null = null) {
        const id = Bun.randomUUIDv7();
        await pool.unsafe(
            'insert into working_time_calendars (id, tenant_id, code, name, base_calendar_id, created_at, updated_at) values ($1, $2, $3, $3, $4, now(), now())',
            [id, tenantId, code, baseId],
        );
        return id;
    }

    const compose = (
        calendarId: string,
        templateId: string | null,
        from: string,
        to: string,
    ) =>
        withDb((db) =>
            composeWorkingTimes(db, {
                tenantId,
                calendarId,
                templateId,
                from,
                to,
            }),
        );

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Kalender');
        otherTenantId = await createTenant(pool, 'Klinik Uji Kalender Lain');
        // Senin sampai Jumat 08:00-12:00 dan 13:00-16:00; Sabtu dan Minggu tutup.
        weekdays = await template(
            'HARIKERJA',
            [0, 1, 2, 3, 4].flatMap(
                (day): [number, string, string, boolean][] => [
                    [day, '08:00', '12:00', false],
                    [day, '13:00', '16:00', false],
                ],
            ),
        );
        // Jaga malam setiap hari, 22:00 sampai 06:00 besoknya.
        night = await template(
            'MALAM',
            [0, 1, 2, 3, 4, 5, 6].map(
                (day): [number, string, string, boolean] => [
                    day,
                    '22:00',
                    '06:00',
                    true,
                ],
            ),
        );
    });

    test('compose writes one day per date from the weekly pattern, and running it again changes nothing', async () => {
        const id = await calendar('SUSUN');
        // 2 November 2026 hari Senin.
        const first = await compose(id, weekdays, '2026-11-02', '2026-11-08');
        expect(first).toEqual({
            created: 7,
            updated: 0,
            unchanged: 0,
            kept: 0,
        });
        const days = await withDb((db) =>
            workingTimes(db, {
                tenantId,
                calendarId: id,
                from: '2026-11-01',
                to: '2026-11-08',
            }),
        );
        expect(days.map((day) => [day.date, day.open, day.composed])).toEqual([
            ['2026-11-01', false, false],
            ['2026-11-02', true, true],
            ['2026-11-03', true, true],
            ['2026-11-04', true, true],
            ['2026-11-05', true, true],
            ['2026-11-06', true, true],
            ['2026-11-07', false, true],
            ['2026-11-08', false, true],
        ]);
        expect(days[1]?.intervals).toEqual([
            { from: '08:00', to: '12:00', ends_next_day: false },
            { from: '13:00', to: '16:00', ends_next_day: false },
        ]);
        const [hours] = await pool.unsafe<{ hours: string }[]>(
            "select hours::text from working_time_calendar_days where working_time_calendar_id = $1 and date = '2026-11-02'",
            [id],
        );
        expect(hours?.hours).toBe('7.00');

        const versions = () =>
            pool.unsafe<{ version: number }[]>(
                'select version from working_time_calendar_days where working_time_calendar_id = $1 order by date',
                [id],
            );
        const before = await versions();
        const again = await compose(id, weekdays, '2026-11-02', '2026-11-08');
        expect(again).toEqual({
            created: 0,
            updated: 0,
            unchanged: 7,
            kept: 0,
        });
        expect(await versions()).toEqual(before);

        // Template lain atas rentang yang tumpang tindih: hari lama ditimpa di tempat, hari baru ditambah.
        const changed = await compose(id, night, '2026-11-07', '2026-11-09');
        expect(changed).toEqual({
            created: 1,
            updated: 2,
            unchanged: 0,
            kept: 0,
        });
        const [rows] = await pool.unsafe<{ days: number; lines: number }[]>(
            `select (select count(*)::int from working_time_calendar_days where working_time_calendar_id = $1 and deleted_at is null) as days,
                    (select count(*)::int from working_time_calendar_lines l join working_time_calendar_days d on d.id = l.working_time_calendar_day_id
                     where d.working_time_calendar_id = $1 and l.deleted_at is null) as lines`,
            [id],
        );
        expect(rows).toEqual({ days: 8, lines: 5 * 2 + 3 });
    });

    test('an interval may end the next morning', async () => {
        const id = await calendar('MALAM');
        await compose(id, night, '2026-11-02', '2026-11-02');
        const [day] = await withDb((db) =>
            workingTimes(db, {
                tenantId,
                calendarId: id,
                from: '2026-11-02',
                to: '2026-11-02',
            }),
        );
        expect(day?.intervals).toEqual([
            { from: '22:00', to: '06:00', ends_next_day: true },
        ]);
        const [hours] = await pool.unsafe<{ hours: string }[]>(
            'select hours::text from working_time_calendar_days where working_time_calendar_id = $1',
            [id],
        );
        expect(hours?.hours).toBe('8.00');
    });

    test('a holiday kept once in the base calendar closes every calendar that follows it', async () => {
        const national = await calendar('NASIONAL');
        await compose(national, weekdays, '2026-12-21', '2026-12-27');
        await pool.unsafe(
            "update working_time_calendar_days set control = 'closed', note = 'Natal', composed = false where working_time_calendar_id = $1 and date = '2026-12-25'",
            [national],
        );
        const clinic = await calendar('KLINIK', national);
        expect(await compose(clinic, null, '2026-12-21', '2026-12-27')).toEqual(
            {
                created: 7,
                updated: 0,
                unchanged: 0,
                kept: 0,
            },
        );
        // Rantai dua tingkat: kalender yang mengikuti kalender klinik ikut membaca kalender nasional.
        const branch = await calendar('CABANG', clinic);
        await compose(branch, null, '2026-12-24', '2026-12-25');
        const open = (calendarId: string, date: string) =>
            withDb((db) => isOpen(db, { tenantId, calendarId, date }));
        expect(await open(clinic, '2026-12-24')).toBe(true);
        expect(await open(clinic, '2026-12-25')).toBe(false);
        expect(await open(branch, '2026-12-24')).toBe(true);
        expect(await open(branch, '2026-12-25')).toBe(false);
        const [christmas] = await withDb((db) =>
            workingTimes(db, {
                tenantId,
                calendarId: branch,
                from: '2026-12-25',
                to: '2026-12-25',
            }),
        );
        expect(christmas).toEqual({
            date: '2026-12-25',
            open: false,
            composed: true,
            intervals: [],
            note: 'Natal',
        });
        // Tanggal yang belum disusun di mana pun dihitung tutup.
        expect(await open(clinic, '2027-01-04')).toBe(false);
    });

    test('following the base calendar needs a base calendar, and a template from the same tenant', async () => {
        const alone = await calendar('SENDIRI');
        expect(
            await refusal(compose(alone, null, '2026-11-02', '2026-11-02')),
        ).toEqual(['template_id']);
        expect(
            await refusal(
                withDb((db) =>
                    composeWorkingTimes(db, {
                        tenantId: otherTenantId,
                        calendarId: alone,
                        templateId: weekdays,
                        from: '2026-11-02',
                        to: '2026-11-02',
                    }),
                ),
            ),
        ).toEqual(['calendar_id']);
        expect(
            await refusal(compose(alone, weekdays, '2026-01-01', '2029-12-31')),
        ).toEqual(['to']);
    });

    test('another tenant reads nothing from this calendar', async () => {
        const id = await calendar('RAHASIA');
        await compose(id, weekdays, '2026-11-02', '2026-11-02');
        expect(
            await withDb((db) =>
                workingTimes(db, {
                    tenantId: otherTenantId,
                    calendarId: id,
                    from: '2026-11-02',
                    to: '2026-11-02',
                }),
            ),
        ).toEqual([]);
        expect(
            await withDb((db) =>
                isOpen(db, {
                    tenantId: otherTenantId,
                    calendarId: id,
                    date: '2026-11-02',
                }),
            ),
        ).toBe(false);
    });
});
