import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { createMember, createTenant } from '../../support/tenant-fixtures.ts';

type Calendar = {
    id: string;
    code: string;
    name: string;
    base_calendar: { id: string; code: string; name: string } | null;
    version: number;
};
type Template = { id: string; code: string; version: number };
type Day = {
    date: string;
    stored: {
        control: string;
        composed: boolean;
        note: string | null;
        version: number;
        lines: unknown[];
    } | null;
    resolved: { open: boolean; composed: boolean; note: string | null };
};
type Errors = { errors: Record<string, string[]> };

// Sys Admin → Kalender dan Template jam kerja: master Core yang dipakai semua module, pola kalender F&O.
describe.skipIf(!process.env.DB_HOST)('calendars', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    const calendars = '/api/v1/calendars';
    const templates = '/api/v1/working-time-templates';
    let admin: Browser;
    let viewer: Browser;
    let outsider: Browser;
    let stranger: Browser;
    let weekdays: Template;
    afterAll(close);

    async function login(tenantId: string, duties: string[]) {
        const member = await createMember(pool, tenantId, duties);
        const session = browser();
        await session.login(member.email, member.password);
        return session;
    }

    async function createCalendar(
        code: string,
        baseId: string | null = null,
    ): Promise<Calendar> {
        const response = await admin.post(calendars, {
            code,
            name: `Kalender ${code}`,
            base_calendar_id: baseId,
        });
        expect(response.status).toBe(201);
        return ((await response.json()) as { data: Calendar }).data;
    }

    async function days(id: string, from: string, to: string) {
        return (
            (await (
                await admin.get(`${calendars}/${id}/days?from=${from}&to=${to}`)
            ).json()) as { data: Day[] }
        ).data;
    }

    beforeAll(async () => {
        const tenantId = await createTenant(pool, 'Klinik Uji Kalender Layar');
        admin = await login(tenantId, ['core.calendar.manage']);
        viewer = await login(tenantId, ['core.calendar.inquire']);
        outsider = await login(tenantId, ['core.organization.inquire']);
        stranger = await login(
            await createTenant(pool, 'Klinik Uji Kalender Asing'),
            ['core.calendar.manage'],
        );
        const response = await admin.post(templates, {
            code: 'harikerja',
            name: 'Senin sampai Jumat',
            lines: [0, 1, 2, 3, 4].map((day) => ({
                day_of_week: day,
                from: '08:00',
                to: '16:00',
            })),
        });
        expect(response.status).toBe(201);
        weekdays = ((await response.json()) as { data: Template }).data;
    });

    test('a template stores its hours per weekday, rejects overlapping or reversed hours, and keeps its code unique', async () => {
        expect(weekdays.code).toBe('HARIKERJA');
        const refused = await admin.post(templates, {
            code: 'salah',
            name: 'Salah',
            lines: [
                { day_of_week: 0, from: '08:00', to: '12:00' },
                { day_of_week: 0, from: '11:00', to: '13:00' },
                { day_of_week: 1, from: '17:00', to: '08:00' },
                {
                    day_of_week: 2,
                    from: '22:00',
                    to: '06:00',
                    ends_next_day: true,
                },
            ],
        });
        expect(refused.status).toBe(422);
        expect(
            Object.keys(((await refused.json()) as Errors).errors).sort(),
        ).toEqual(['lines.1.from', 'lines.2.to']);
        const duplicate = await admin.post(templates, {
            code: 'HariKerja',
            name: 'Kembar',
            lines: [],
        });
        expect(duplicate.status).toBe(422);
        expect(((await duplicate.json()) as Errors).errors.code).toEqual([
            'Kode ini sudah dipakai template lain.',
        ]);
    });

    test('a calendar code is unique per tenant whatever its case, and a deleted code can be used again', async () => {
        const first = await createCalendar('umum');
        expect(first.code).toBe('UMUM');
        const clash = await admin.post(calendars, {
            code: 'Umum',
            name: 'Kembar',
            base_calendar_id: null,
        });
        expect(clash.status).toBe(422);
        expect(
            (
                await admin.delete(`${calendars}/${first.id}`, {
                    version: first.version,
                })
            ).status,
        ).toBe(204);
        expect((await createCalendar('UMUM')).code).toBe('UMUM');
        // Tenant lain boleh memakai kode yang sama dan tidak melihat kalender tenant ini.
        expect(
            (
                await stranger.post(calendars, {
                    code: 'UMUM',
                    name: 'Asing',
                    base_calendar_id: null,
                })
            ).status,
        ).toBe(201);
        const foreign = (
            (await (await stranger.get(calendars)).json()) as {
                data: Calendar[];
            }
        ).data;
        expect(foreign.map((calendar) => calendar.name)).toEqual(['Asing']);
    });

    test('base calendars never loop, and a calendar still followed by another cannot be deleted', async () => {
        const national = await createCalendar('NASIONAL');
        const clinic = await createCalendar('KLINIK', national.id);
        expect(clinic.base_calendar?.code).toBe('NASIONAL');
        const loop = await admin.patch(`${calendars}/${national.id}`, {
            code: 'NASIONAL',
            name: national.name,
            base_calendar_id: clinic.id,
            version: national.version,
        });
        expect(loop.status).toBe(422);
        expect(((await loop.json()) as Errors).errors.base_calendar_id).toEqual(
            [
                'Kalender dasar ini sudah mengikuti kalender yang sedang diubah. Pilih kalender lain supaya tidak saling mengikuti.',
            ],
        );
        const followed = await admin.delete(`${calendars}/${national.id}`, {
            version: national.version,
        });
        expect(followed.status).toBe(422);
        const filtered = (
            (await (await admin.get(`${calendars}?base=with`)).json()) as {
                data: Calendar[];
            }
        ).data.map((calendar) => calendar.code);
        expect(filtered).toEqual(['KLINIK']);
    });

    test('a day changed by hand survives composing again, and deleting it hands the date back to compose', async () => {
        const calendar = await createCalendar('LIBUR');
        const compose = () =>
            admin.post(`${calendars}/${calendar.id}/compose`, {
                from: '2026-12-21',
                to: '2026-12-27',
                template_id: weekdays.id,
            });
        expect(
            ((await (await compose()).json()) as { data: unknown }).data,
        ).toEqual({ created: 7, updated: 0, unchanged: 0, kept: 0 });
        const [christmas] = await days(calendar.id, '2026-12-25', '2026-12-25');
        const closed = await admin.put(
            `${calendars}/${calendar.id}/days/2026-12-25`,
            {
                control: 'closed',
                lines: christmas?.stored?.lines,
                note: 'Natal',
                version: christmas?.stored?.version,
            },
        );
        expect(closed.status).toBe(200);
        const [saved] = ((await closed.json()) as { data: Day[] }).data;
        expect(saved?.stored).toMatchObject({
            control: 'closed',
            composed: false,
            note: 'Natal',
        });
        // Jam kerjanya tetap tersimpan walau harinya ditutup.
        expect(saved?.stored?.lines).toHaveLength(1);
        expect(
            ((await (await compose()).json()) as { data: unknown }).data,
        ).toEqual({ created: 0, updated: 0, unchanged: 6, kept: 1 });
        const [kept] = await days(calendar.id, '2026-12-25', '2026-12-25');
        expect(kept?.resolved).toMatchObject({ open: false, note: 'Natal' });

        // Versi lama ditolak.
        expect(
            (
                await admin.put(`${calendars}/${calendar.id}/days/2026-12-25`, {
                    control: 'open',
                    lines: [{ from: '08:00', to: '12:00' }],
                    note: null,
                    version: christmas?.stored?.version ?? 0,
                })
            ).status,
        ).toBe(409);
        expect(
            (
                await admin.delete(
                    `${calendars}/${calendar.id}/days/2026-12-25`,
                    { version: kept?.stored?.version },
                )
            ).status,
        ).toBe(204);
        const [handedBack] = await days(
            calendar.id,
            '2026-12-25',
            '2026-12-25',
        );
        expect(handedBack?.stored).toBeNull();
        expect(handedBack?.resolved.composed).toBe(false);
        expect(
            ((await (await compose()).json()) as { data: unknown }).data,
        ).toEqual({ created: 1, updated: 0, unchanged: 6, kept: 0 });
    });

    test('a day can follow the base calendar only when the calendar has one, and an open day needs hours', async () => {
        const alone = await createCalendar('SENDIRI');
        const base = await admin.put(
            `${calendars}/${alone.id}/days/2026-11-02`,
            {
                control: 'base',
                lines: [],
                note: null,
                version: null,
            },
        );
        expect(base.status).toBe(422);
        const empty = await admin.put(
            `${calendars}/${alone.id}/days/2026-11-02`,
            {
                control: 'open',
                lines: [],
                note: null,
                version: null,
            },
        );
        expect(((await empty.json()) as Errors).errors.lines).toEqual([
            'Hari yang buka butuh sedikitnya satu rentang jam.',
        ]);
        const night = await admin.put(
            `${calendars}/${alone.id}/days/2026-11-02`,
            {
                control: 'open',
                lines: [{ from: '22:00', to: '06:00', ends_next_day: true }],
                note: 'Jaga malam',
                version: null,
            },
        );
        expect(night.status).toBe(200);
        const following = await createCalendar('IKUT', alone.id);
        expect(
            (
                await admin.put(
                    `${calendars}/${following.id}/days/2026-11-02`,
                    {
                        control: 'base',
                        lines: [],
                        note: null,
                        version: null,
                    },
                )
            ).status,
        ).toBe(200);
        const [day] = await days(following.id, '2026-11-02', '2026-11-02');
        expect(day?.resolved).toMatchObject({
            open: true,
            note: 'Jaga malam',
        });
    });

    test('the screens are guarded by Core permissions of their own, and another tenant cannot reach a calendar', async () => {
        const calendar = await createCalendar('JAGA');
        expect((await outsider.get(calendars)).status).toBe(403);
        expect((await outsider.get(templates)).status).toBe(403);
        const read = await viewer.get(calendars);
        expect(read.status).toBe(200);
        expect(
            ((await read.json()) as { can_manage: boolean }).can_manage,
        ).toBe(false);
        expect(
            (
                await viewer.post(calendars, {
                    code: 'TIDAK',
                    name: 'Tidak boleh',
                    base_calendar_id: null,
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await viewer.post(`${calendars}/${calendar.id}/compose`, {
                    from: '2026-11-02',
                    to: '2026-11-02',
                    template_id: weekdays.id,
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await stranger.get(
                    `${calendars}/${calendar.id}/days?from=2026-11-02&to=2026-11-02`,
                )
            ).status,
        ).toBe(404);
        expect(
            (
                await stranger.post(`${calendars}/${calendar.id}/compose`, {
                    from: '2026-11-02',
                    to: '2026-11-02',
                    template_id: weekdays.id,
                })
            ).status,
        ).toBe(404);
    });
});
