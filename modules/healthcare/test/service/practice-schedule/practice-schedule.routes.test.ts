import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from '../../../../../src/platform/database/index.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    createTenant,
    entitle,
    grantAllOrganizations,
    recordInstallation,
} from '../../../../../test/support/tenant-fixtures.ts';
import { schedulesForRegistration } from '../../../src/service/practice-schedule/practice-schedule.service.ts';

type Session = {
    id: string;
    name: string;
    start_time: string;
    end_time: string;
    crosses_midnight: boolean;
    version: number;
};
type Template = {
    id: string;
    day: number;
    capacity: number | null;
    version: number;
};
type Schedule = {
    id: string;
    date: string;
    ends_on: string;
    practitioner_id: string;
    substitute_practitioner_id: string | null;
    substitute_practitioner_name: string | null;
    session_id: string;
    capacity: number | null;
    registered: number;
    source: string;
    status: string;
    cancel_reason: string | null;
    manually_changed: boolean;
    version: number;
};
type Result = {
    created: number;
    updated: number;
    unchanged: number;
    kept: number;
    removed: number;
};

const api = '/api/modules/healthcare/v1';
// NIK di test ini angka contoh yang jelas palsu, bukan nomor orang sungguhan.
const nik = () =>
    `97000000000${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`;

// Jadwal praktik: sesi, template mingguan, dan jadwal bertanggal hasil generate. Butuh PostgreSQL yang sudah
// dimigrasi; dilewati bila DB_HOST kosong. 16 November 2026 hari Senin.
describe.skipIf(!process.env.DB_HOST)('practice schedule', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    // Profesi bawaan tenant dari migration 0022, menurut kodenya.
    const professions: Record<string, string> = {};
    async function loadProfessions() {
        for (const row of await pool.unsafe<{ kode: string; id: string }[]>(
            'select kode, id from sim_m_profesi where tenant_id = $1 and deleted_at is null',
            [tenantId],
        ))
            professions[row.kode] = row.id;
    }

    let tenantId: string;
    let admin: Browser;
    let unit: string;
    let pagi: Session;
    let malam: Session;
    const practitioners: Record<string, string> = {};

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function errors(response: Response) {
        return Object.keys(
            (await json<{ errors: Record<string, string[]> }>(response, 422))
                .errors,
        );
    }

    async function member(tenant: string, duties: string[]) {
        const account = await createMember(pool, tenant, duties);
        await grantAllOrganizations(pool, tenant, account.membershipId);
        const session = browser();
        await session.login(account.email, account.password);
        return session;
    }

    async function section(name: string) {
        return (
            await json<{ data: { id: string } }>(
                await admin.post(`${api}/sections`, {
                    operating_unit_id: unit,
                    name,
                    kind: 'rawat_jalan',
                }),
                201,
            )
        ).data.id;
    }

    async function practitioner(name: string) {
        return (
            await json<{ data: { id: string } }>(
                await admin.post(`${api}/practitioners`, {
                    name,
                    nik: nik(),
                    gender: 'female',
                    phone: '081200000002',
                    profession_id: professions.dokter,
                }),
                201,
            )
        ).data.id;
    }

    async function template(body: Record<string, unknown>) {
        return (
            await json<{ data: Template }>(
                await admin.post(`${api}/schedule-templates`, {
                    valid_from: '2026-11-01',
                    ...body,
                }),
                201,
            )
        ).data;
    }

    async function generate(from: string, to: string, sectionId?: string) {
        return (
            await json<{ data: Result }>(
                await admin.post(`${api}/practice-schedules/generate`, {
                    from,
                    to,
                    section_id: sectionId ?? null,
                }),
                200,
            )
        ).data;
    }

    async function schedules(sectionId: string, from: string, to: string) {
        return (
            await json<{ data: Schedule[] }>(
                await admin.get(
                    `${api}/practice-schedules?section_id=${sectionId}&from=${from}&to=${to}`,
                ),
                200,
            )
        ).data;
    }

    // Kalender Core dengan hari bertanggal yang disusun; `closed` ditutup, sisanya buka.
    async function calendar(code: string, closed: string[], open: string[]) {
        const id = Bun.randomUUIDv7();
        await pool.unsafe(
            'insert into working_time_calendars (id, tenant_id, code, name, created_at, updated_at) values ($1, $2, $3, $3, now(), now())',
            [id, tenantId, code],
        );
        for (const [date, control] of [
            ...closed.map((date) => [date, 'closed']),
            ...open.map((date) => [date, 'open']),
        ])
            await pool.unsafe(
                `insert into working_time_calendar_days (id, tenant_id, working_time_calendar_id, date, day_of_week,
                                                         control, hours, composed, created_at, updated_at)
                 values ($1, $2, $3, $4, 0, $5, 0, true, now(), now())`,
                [Bun.randomUUIDv7(), tenantId, id, date ?? '', control ?? ''],
            );
        return id;
    }

    async function withDb<T>(work: (db: Database) => Promise<T>): Promise<T> {
        const connection = await pool.reserve();
        try {
            return await work(new Database(connection, undefined, 'uji'));
        } finally {
            connection.release();
        }
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Jadwal');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        await loadProfessions();
        admin = await member(tenantId, [
            'core.organization.manage',
            'healthcare.service-setup.manage',
            'healthcare.practitioner.manage',
            'healthcare.practice-schedule.manage',
        ]);
        await json(
            await admin.post('/api/v1/organizations', {
                classification: 'legal_entity',
                name: 'PT Klinik Uji Jadwal',
                company_code: `KJ${Date.now() % 100000}`,
                country_code: 'ID',
            }),
            201,
        );
        unit = (
            await json<{ data: { id: string } }>(
                await admin.post('/api/v1/organizations', {
                    classification: 'operating_unit',
                    name: 'Puskesmas Jadwal',
                    operating_unit_type: 'department',
                    operating_unit_number: 'JDW-1',
                }),
                201,
            )
        ).data.id;
        for (const name of ['Dokter Ani', 'Dokter Budi', 'Dokter Citra'])
            practitioners[name] = await practitioner(name);
        // Test di sini menyusun jadwal bertanggal tetap lewat tombol Generate; generate otomatis untuk hari ini
        // diuji di schedule-parameter.routes.test.ts.
        await json(
            await admin.put(`${api}/practice-schedules/parameters`, {
                auto_generate: false,
                horizon_days: 7,
            }),
            200,
        );
    }, 60_000);

    test('sessions record their hours and know when they end the next day', async () => {
        pagi = (
            await json<{ data: Session }>(
                await admin.post(`${api}/practice-sessions`, {
                    name: 'Pagi',
                    start_time: '08:00',
                    end_time: '12:00',
                }),
                201,
            )
        ).data;
        malam = (
            await json<{ data: Session }>(
                await admin.post(`${api}/practice-sessions`, {
                    name: 'Malam',
                    start_time: '20:00',
                    end_time: '08:00',
                }),
                201,
            )
        ).data;
        expect(pagi).toEqual(
            expect.objectContaining({
                start_time: '08:00',
                end_time: '12:00',
                crosses_midnight: false,
            }),
        );
        expect(malam.crosses_midnight).toBe(true);
        expect(
            await errors(
                await admin.post(`${api}/practice-sessions`, {
                    name: ' pagi ',
                    start_time: '9:00',
                    end_time: '12:00',
                }),
            ),
        ).toEqual(['start_time']);
        expect(
            await errors(
                await admin.post(`${api}/practice-sessions`, {
                    name: 'PAGI',
                    start_time: '09:00',
                    end_time: '12:00',
                }),
            ),
        ).toEqual(['name']);
    }, 30_000);

    test('a template refuses a holiday day without a calendar, a zero capacity, and a duplicate', async () => {
        const poli = await section('Poli Validasi');
        const base = {
            practitioner_id: practitioners['Dokter Ani'],
            section_id: poli,
            session_id: pagi.id,
        };
        expect(
            await errors(
                await admin.post(`${api}/schedule-templates`, {
                    ...base,
                    day: 8,
                    valid_from: '2026-11-01',
                }),
            ),
        ).toEqual(['calendar_id']);
        expect(
            await errors(
                await admin.post(`${api}/schedule-templates`, {
                    ...base,
                    day: 1,
                    capacity: 0,
                    valid_from: '2026-11-01',
                }),
            ),
        ).toEqual(['capacity']);
        await template({ ...base, day: 1, capacity: 10 });
        expect(
            await errors(
                await admin.post(`${api}/schedule-templates`, {
                    ...base,
                    day: 1,
                    valid_from: '2026-11-01',
                }),
            ),
        ).toEqual(['session_id']);
        // Sesi yang dipakai template tidak bisa dihapus.
        expect(
            await errors(
                await admin.delete(`${api}/practice-sessions/${pagi.id}`, {
                    version: pagi.version,
                }),
            ),
        ).toEqual(['id']);
    }, 30_000);

    test('generate is idempotent and dates an overnight session on its start day', async () => {
        const poli = await section('Poli Generate');
        await template({
            practitioner_id: practitioners['Dokter Ani'],
            section_id: poli,
            day: 1,
            session_id: pagi.id,
            capacity: 20,
        });
        await template({
            practitioner_id: practitioners['Dokter Budi'],
            section_id: poli,
            day: 2,
            session_id: malam.id,
        });
        expect(await generate('2026-11-16', '2026-11-22', poli)).toEqual({
            created: 2,
            updated: 0,
            unchanged: 0,
            kept: 0,
            removed: 0,
        });
        expect(await generate('2026-11-16', '2026-11-22', poli)).toEqual({
            created: 0,
            updated: 0,
            unchanged: 2,
            kept: 0,
            removed: 0,
        });
        const rows = await schedules(poli, '2026-11-16', '2026-11-22');
        expect(
            rows.map((row) => [
                row.date,
                row.ends_on,
                row.capacity,
                row.status,
                row.source,
            ]),
        ).toEqual([
            ['2026-11-16', '2026-11-16', 20, 'terjadwal', 'template'],
            ['2026-11-17', '2026-11-18', null, 'terjadwal', 'template'],
        ]);
        expect(
            await errors(
                await admin.post(`${api}/practice-schedules/generate`, {
                    from: '2026-11-01',
                    to: '2027-02-15',
                }),
            ),
        ).toEqual(['to']);
    }, 30_000);

    test('a template change reaches only rows nobody has touched, and manual rows stay', async () => {
        const poli = await section('Poli Perubahan');
        const monday = await template({
            practitioner_id: practitioners['Dokter Ani'],
            section_id: poli,
            day: 1,
            session_id: pagi.id,
            capacity: 20,
        });
        await generate('2026-11-16', '2026-11-30', poli);
        const [registered, changed, untouched] = await schedules(
            poli,
            '2026-11-16',
            '2026-11-30',
        );
        if (!registered || !changed || !untouched)
            throw new Error('Expected three Mondays.');
        await pool.unsafe(
            'update sim_tr_jadwal_praktik set jumlah_terdaftar = 3 where id = $1',
            [registered.id],
        );
        await json(
            await admin.patch(`${api}/practice-schedules/${changed.id}`, {
                capacity: 25,
                version: changed.version,
            }),
            200,
        );
        const manual = (
            await json<{ data: Schedule }>(
                await admin.post(`${api}/practice-schedules`, {
                    section_id: poli,
                    date: '2026-11-18',
                    practitioner_id: practitioners['Dokter Citra'],
                    session_id: malam.id,
                    capacity: 5,
                }),
                201,
            )
        ).data;
        expect([manual.source, manual.ends_on]).toEqual([
            'manual',
            '2026-11-19',
        ]);
        await json(
            await admin.patch(`${api}/schedule-templates/${monday.id}`, {
                practitioner_id: practitioners['Dokter Ani'],
                section_id: poli,
                day: 1,
                session_id: pagi.id,
                capacity: 30,
                valid_from: '2026-11-01',
                version: monday.version,
            }),
            200,
        );
        expect(await generate('2026-11-16', '2026-11-30', poli)).toEqual({
            created: 0,
            updated: 1,
            unchanged: 0,
            kept: 3,
            removed: 0,
        });
        const capacities = async () =>
            (await schedules(poli, '2026-11-16', '2026-11-30')).map((row) => [
                row.date,
                row.capacity,
            ]);
        expect(await capacities()).toEqual([
            ['2026-11-16', 20],
            ['2026-11-18', 5],
            ['2026-11-23', 25],
            ['2026-11-30', 30],
        ]);
        // Template yang dihapus melepas baris yang belum disentuh; yang lain tetap.
        const [current] = await pool.unsafe<{ version: number }[]>(
            'select version from sim_m_jadwal_template where id = $1',
            [monday.id],
        );
        expect(
            (
                await admin.delete(`${api}/schedule-templates/${monday.id}`, {
                    version: current?.version,
                })
            ).status,
        ).toBe(204);
        expect((await generate('2026-11-16', '2026-11-30', poli)).removed).toBe(
            1,
        );
        expect(await capacities()).toEqual([
            ['2026-11-16', 20],
            ['2026-11-18', 5],
            ['2026-11-23', 25],
        ]);
        const [archived] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from sim_tr_jadwal_praktik where id = $1',
            [untouched.id],
        );
        expect(archived?.deleted).toBe(true);
    }, 30_000);

    test('a closed calendar day cancels the schedule, or uses the holiday template', async () => {
        const poli = await section('Poli Libur');
        // 17 November ditutup. 24 November belum disusun di kalender, jadi tetap praktik.
        const holidays = await calendar(
            `LIBUR${Date.now() % 100000}`,
            ['2026-11-17'],
            ['2026-11-10'],
        );
        await template({
            practitioner_id: practitioners['Dokter Ani'],
            section_id: poli,
            day: 2,
            session_id: pagi.id,
            calendar_id: holidays,
        });
        await template({
            practitioner_id: practitioners['Dokter Budi'],
            section_id: poli,
            day: 2,
            session_id: pagi.id,
            calendar_id: holidays,
        });
        // Dokter Budi tetap jaga pada hari libur, lewat template hari libur.
        await template({
            practitioner_id: practitioners['Dokter Budi'],
            section_id: poli,
            day: 8,
            session_id: pagi.id,
            capacity: 8,
            calendar_id: holidays,
        });
        await generate('2026-11-16', '2026-11-24', poli);
        const rows = await schedules(poli, '2026-11-16', '2026-11-24');
        const byName = (date: string, practitionerId: string | undefined) =>
            rows.find(
                (row) =>
                    row.date === date && row.practitioner_id === practitionerId,
            );
        expect(byName('2026-11-17', practitioners['Dokter Ani'])).toEqual(
            expect.objectContaining({
                status: 'batal',
                cancel_reason: 'Hari libur',
            }),
        );
        expect(byName('2026-11-17', practitioners['Dokter Budi'])).toEqual(
            expect.objectContaining({ status: 'terjadwal', capacity: 8 }),
        );
        expect(
            rows
                .filter((row) => row.date === '2026-11-24')
                .map((row) => row.status),
        ).toEqual(['terjadwal', 'terjadwal']);
    }, 30_000);

    test('registration sees scheduled rows with the substitute, flagged when full', async () => {
        const poli = await section('Poli Pendaftaran');
        await template({
            practitioner_id: practitioners['Dokter Ani'],
            section_id: poli,
            day: 3,
            session_id: pagi.id,
            capacity: 2,
        });
        await template({
            practitioner_id: practitioners['Dokter Budi'],
            section_id: poli,
            day: 3,
            session_id: malam.id,
        });
        await template({
            practitioner_id: practitioners['Dokter Citra'],
            section_id: poli,
            day: 3,
            session_id: malam.id,
        });
        await generate('2026-11-18', '2026-11-18', poli);
        const rows = await schedules(poli, '2026-11-18', '2026-11-18');
        const row = (id: string | undefined) => {
            const found = rows.find((item) => item.practitioner_id === id);
            if (!found) throw new Error('Expected a schedule.');
            return found;
        };
        const ani = row(practitioners['Dokter Ani']);
        const budi = row(practitioners['Dokter Budi']);
        const citra = row(practitioners['Dokter Citra']);
        await pool.unsafe(
            'update sim_tr_jadwal_praktik set jumlah_terdaftar = 2 where id = $1',
            [ani.id],
        );
        // Dokter Budi digantikan Dokter Citra; Dokter Citra sendiri batal dengan alasan.
        const substituted = (
            await json<{ data: Schedule }>(
                await admin.patch(`${api}/practice-schedules/${budi.id}`, {
                    substitute_practitioner_id: practitioners['Dokter Citra'],
                    version: budi.version,
                }),
                200,
            )
        ).data;
        expect(substituted.substitute_practitioner_name).toBe('Dokter Citra');
        expect(substituted.manually_changed).toBe(true);
        expect(
            await errors(
                await admin.patch(`${api}/practice-schedules/${citra.id}`, {
                    status: 'batal',
                    version: citra.version,
                }),
            ),
        ).toEqual(['cancel_reason']);
        await json(
            await admin.patch(`${api}/practice-schedules/${citra.id}`, {
                status: 'batal',
                cancel_reason: 'Cuti',
                version: citra.version,
            }),
            200,
        );
        expect(
            await errors(
                await admin.patch(`${api}/practice-schedules/${ani.id}`, {
                    capacity: 1,
                    version: ani.version,
                }),
            ),
        ).toEqual(['capacity']);
        const offered = await withDb((db) =>
            schedulesForRegistration(db, {
                tenantId,
                sectionId: poli,
                date: '2026-11-18',
            }),
        );
        expect(
            offered.map((item) => [
                item.practitioner_name,
                item.is_substitute,
                item.capacity,
                item.registered,
                item.full,
            ]),
        ).toEqual([
            ['Dokter Ani', false, 2, 2, true],
            ['Dokter Citra', true, null, 0, false],
        ]);
        expect(offered[1]?.scheduled_practitioner_id).toBe(
            practitioners['Dokter Budi'],
        );
        // Pembatalan tidak menghapus baris.
        const [cancelled] = await pool.unsafe<
            { status: string; deleted: boolean }[]
        >(
            'select status, deleted_at is not null as deleted from sim_tr_jadwal_praktik where id = $1',
            [citra.id],
        );
        expect(cancelled).toEqual({ status: 'batal', deleted: false });
        // Section nonaktif tidak menawarkan jadwal.
        await pool.unsafe(
            'update sim_m_section set aktif = false where id = $1',
            [poli],
        );
        expect(
            await withDb((db) =>
                schedulesForRegistration(db, {
                    tenantId,
                    sectionId: poli,
                    date: '2026-11-18',
                }),
            ),
        ).toEqual([]);
    }, 30_000);

    test('one practitioner has one schedule per section, date, and session', async () => {
        const poli = await section('Poli Unik');
        const body = {
            section_id: poli,
            date: '2026-11-20',
            practitioner_id: practitioners['Dokter Ani'],
            session_id: pagi.id,
        };
        await json(await admin.post(`${api}/practice-schedules`, body), 201);
        expect(
            await errors(await admin.post(`${api}/practice-schedules`, body)),
        ).toEqual(['session_id']);
        let code: unknown;
        try {
            await pool.unsafe(
                `insert into sim_tr_jadwal_praktik (id, tenant_id, tanggal, nakes_id, section_id, sesi_id, jam_mulai,
                                                    jam_selesai, berakhir_tanggal, sumber)
                 values ($1, $2, '2026-11-20', $3, $4, $5, '08:00', '12:00', '2026-11-20', 'manual')`,
                [
                    Bun.randomUUIDv7(),
                    tenantId,
                    practitioners['Dokter Ani'] ?? '',
                    poli,
                    pagi.id,
                ],
            );
        } catch (error) {
            code = (error as { code?: string }).code;
        }
        expect(code).toBe('23505');
    }, 30_000);

    test('another tenant cannot see, generate into, or change these schedules', async () => {
        const poli = await section('Poli Tenant');
        await template({
            practitioner_id: practitioners['Dokter Ani'],
            section_id: poli,
            day: 1,
            session_id: pagi.id,
        });
        await generate('2026-11-16', '2026-11-16', poli);
        const [row] = await schedules(poli, '2026-11-16', '2026-11-16');
        const otherTenant = await createTenant(pool, 'Klinik Uji Jadwal Lain');
        await entitle(pool, otherTenant, 'healthcare');
        await recordInstallation(pool, otherTenant, 'healthcare');
        const outsider = await member(otherTenant, [
            'healthcare.practice-schedule.manage',
        ]);
        const metadata = await json<{
            sections: unknown[];
            sessions: unknown[];
        }>(await outsider.get(`${api}/practice-schedules/metadata`), 200);
        expect([metadata.sections, metadata.sessions]).toEqual([[], []]);
        expect(
            (
                await json<{ data: unknown[] }>(
                    await outsider.get(
                        `${api}/schedule-templates?section_id=${poli}`,
                    ),
                    200,
                )
            ).data,
        ).toEqual([]);
        expect(
            (
                await json<{ data: unknown[] }>(
                    await outsider.get(
                        `${api}/practice-schedules?section_id=${poli}&from=2026-11-16&to=2026-11-16`,
                    ),
                    200,
                )
            ).data,
        ).toEqual([]);
        expect(
            (
                await json<{ data: Result }>(
                    await outsider.post(`${api}/practice-schedules/generate`, {
                        from: '2026-11-16',
                        to: '2026-11-16',
                        section_id: poli,
                    }),
                    200,
                )
            ).data,
        ).toEqual({
            created: 0,
            updated: 0,
            unchanged: 0,
            kept: 0,
            removed: 0,
        });
        expect(
            (
                await outsider.patch(`${api}/practice-schedules/${row?.id}`, {
                    status: 'batal',
                    cancel_reason: 'Diambil',
                    version: row?.version,
                })
            ).status,
        ).toBe(404);
        expect(
            (await schedules(poli, '2026-11-16', '2026-11-16')).map(
                (item) => item.status,
            ),
        ).toEqual(['terjadwal']);
    }, 30_000);

    test('permissions decide who reads, changes, and generates schedules', async () => {
        const reader = await member(tenantId, [
            'healthcare.practice-schedule.inquire',
        ]);
        expect(
            (
                await json<{ permissions: unknown }>(
                    await reader.get(`${api}/practice-schedules/metadata`),
                    200,
                )
            ).permissions,
        ).toEqual({ create: false, update: false, delete: false });
        expect((await reader.get(`${api}/practice-sessions`)).status).toBe(200);
        expect(
            (
                await reader.post(`${api}/practice-sessions`, {
                    name: 'Siang',
                    start_time: '13:00',
                    end_time: '16:00',
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await reader.post(`${api}/practice-schedules/generate`, {
                    from: '2026-11-16',
                    to: '2026-11-16',
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await reader.patch(`${api}/practice-sessions/${pagi.id}`, {
                    name: 'Pagi',
                    start_time: '08:00',
                    end_time: '12:00',
                    version: pagi.version,
                })
            ).status,
        ).toBe(403);
        const stranger = await member(tenantId, ['core.organization.inquire']);
        expect(
            (await stranger.get(`${api}/practice-schedules/metadata`)).status,
        ).toBe(403);
        // Menu Setup menampilkan ketiga layar dengan izin lihat jadwal praktik.
        const [app] = await pool.unsafe<{ navigation: string }[]>(
            "select navigation::text as navigation from apps where id = 'healthcare'",
        );
        for (const href of [
            '/healthcare/service/practice-sessions',
            '/healthcare/service/schedule-templates',
            '/healthcare/service/practice-schedules',
        ])
            expect(app?.navigation).toContain(href);
        // Kedua duty milik module, jadi installModule memberikannya kepada role pemilik tenant yang memasang sesudahnya.
        const duties = await pool.unsafe<{ code: string }[]>(
            "select code from security_duties where app_id = 'healthcare' and code like 'healthcare.practice-schedule.%' order by code",
        );
        expect(duties.map((duty) => duty.code)).toEqual([
            'healthcare.practice-schedule.inquire',
            'healthcare.practice-schedule.manage',
        ]);
    }, 30_000);
});
