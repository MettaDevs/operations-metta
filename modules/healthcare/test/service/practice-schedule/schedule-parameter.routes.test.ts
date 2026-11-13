import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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

type Parameters = {
    auto_generate: boolean;
    horizon_days: number;
    version: number | null;
    can_update: boolean;
};
type Template = { id: string; day: number; version: number };
type Metadata = {
    date: string;
    sections: { id: string; schedules: { capacity: number | null }[] }[];
};

const api = '/api/modules/healthcare/v1';
// NIK di test ini angka contoh yang jelas palsu, bukan nomor orang sungguhan.
const nik = () =>
    `97100000000${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`;

const addDays = (date: string, days: number) => {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
};
// Hari ISO: 1 Senin sampai 7 Minggu.
const isoDay = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

// Generate jadwal otomatis dari parameter jadwal: berjalan saat form pendaftaran dan layar jadwal dibaca, mengikuti
// tanggal hari ini yang sebenarnya. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('schedule parameters', () => {
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
    let poli: string;
    let pagi: string;
    let doctor: string;
    let today: string;
    let defaults: Parameters;
    const templates: Record<number, Template> = {};

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function created(path: string, body: Record<string, unknown>) {
        return (
            await json<{ data: { id: string; version: number } }>(
                await admin.post(path, body),
                201,
            )
        ).data;
    }

    async function parameters() {
        return (
            await json<{ data: Parameters }>(
                await admin.get(`${api}/practice-schedules/parameters`),
                200,
            )
        ).data;
    }

    async function setParameters(autoGenerate: boolean, horizonDays: number) {
        const current = await parameters();
        return admin.put(`${api}/practice-schedules/parameters`, {
            auto_generate: autoGenerate,
            horizon_days: horizonDays,
            ...(current.version === null ? {} : { version: current.version }),
        });
    }

    async function metadata() {
        return json<Metadata>(await admin.get(`${api}/visits/metadata`), 200);
    }

    // Jadwal bertanggal yang tersimpan, langsung dari database supaya pembacaannya tidak ikut menjalankan generate.
    async function stored() {
        const rows: { tanggal: string; kapasitas: number | null }[] =
            await pool.unsafe(
                `select tanggal::text as tanggal, kapasitas from sim_tr_jadwal_praktik
                 where tenant_id = $1 and deleted_at is null order by tanggal`,
                [tenantId],
            );
        return rows.map((row) => [row.tanggal, row.kapasitas]);
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Parameter Jadwal');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        await loadProfessions();
        const owner = await createMember(pool, tenantId, [
            'core.organization.manage',
            'healthcare.service-setup.manage',
            'healthcare.practitioner.manage',
            'healthcare.practice-schedule.manage',
            'healthcare.visit.manage',
        ]);
        await grantAllOrganizations(pool, tenantId, owner.membershipId);
        await pool.unsafe(
            `insert into role_assignment_data_policy_scopes
                 (id, tenant_id, role_assignment_id, policy_code, include_descendants, valid_from, created_at, updated_at)
             select $1, $2, id, 'healthcare.patient-unit', false, now() - interval '1 day', now(), now()
             from role_assignments where membership_id = $3`,
            [Bun.randomUUIDv7(), tenantId, owner.membershipId],
        );
        admin = browser();
        await admin.login(owner.email, owner.password);
        await created('/api/v1/organizations', {
            classification: 'legal_entity',
            name: 'PT Klinik Uji Parameter',
            company_code: `KP${Date.now() % 100000}`,
            country_code: 'ID',
        });
        const unit = (
            await created('/api/v1/organizations', {
                classification: 'operating_unit',
                name: 'Puskesmas Parameter',
                operating_unit_type: 'department',
                operating_unit_number: 'PRM-1',
            })
        ).id;
        defaults = await parameters();
        expect((await setParameters(false, 3)).status).toBe(200);
        poli = (
            await created(`${api}/sections`, {
                operating_unit_id: unit,
                code: 'PARAMETER',
                name: 'Poli Parameter',
                kind: 'rawat_jalan',
            })
        ).id;
        pagi = (
            await created(`${api}/practice-sessions`, {
                name: 'Pagi',
                start_time: '08:00',
                end_time: '12:00',
            })
        ).id;
        doctor = (
            await created(`${api}/practitioners`, {
                name: 'Dokter Parameter',
                nik: nik(),
                gender: 'female',
                phone: '081200000005',
                profession_id: professions.dokter,
            })
        ).id;
        for (let day = 1; day <= 7; day++)
            templates[day] = {
                ...(await created(`${api}/schedule-templates`, {
                    practitioner_id: doctor,
                    section_id: poli,
                    day,
                    session_id: pagi,
                    capacity: 10,
                    valid_from: '2026-01-01',
                })),
                day,
            };
    }, 120_000);

    test('a tenant without a setting generates seven days ahead, and an invalid horizon is refused', async () => {
        expect(defaults).toEqual({
            auto_generate: true,
            horizon_days: 7,
            version: null,
            can_update: true,
        });
        for (const horizon of [0, 93, 'tujuh'])
            expect(
                (
                    await admin.put(`${api}/practice-schedules/parameters`, {
                        auto_generate: true,
                        horizon_days: horizon,
                        version: 1,
                    })
                ).status,
            ).toBe(422);
    });

    test('with automatic generation off, opening the registration form adds no schedule', async () => {
        today = (await metadata()).date;
        expect(await stored()).toEqual([]);
    }, 30_000);

    test('with it on, opening the registration form generates the horizon and offers today', async () => {
        expect((await setParameters(true, 3)).status).toBe(200);
        const form = await metadata();
        expect(await stored()).toEqual([
            [today, 10],
            [addDays(today, 1), 10],
            [addDays(today, 2), 10],
        ]);
        expect(
            form.sections.find((section) => section.id === poli)?.schedules,
        ).toEqual([expect.objectContaining({ capacity: 10 })]);
    }, 30_000);

    test('later reads skip generation until a master changes', async () => {
        await pool.unsafe(
            `update sim_tr_jadwal_praktik set deleted_at = now()
             where tenant_id = $1 and tanggal = $2::date`,
            [tenantId, addDays(today, 1)],
        );
        await metadata();
        await admin.get(
            `${api}/practice-schedules?section_id=${poli}&from=${today}&to=${addDays(today, 6)}`,
        );
        expect(await stored()).toEqual([
            [today, 10],
            [addDays(today, 2), 10],
        ]);

        const changed = templates[isoDay(addDays(today, 2))]!;
        await json(
            await admin.patch(`${api}/schedule-templates/${changed.id}`, {
                practitioner_id: doctor,
                section_id: poli,
                day: changed.day,
                session_id: pagi,
                capacity: 15,
                valid_from: '2026-01-01',
                version: changed.version,
            }),
            200,
        );
        await admin.get(
            `${api}/practice-schedules?section_id=${poli}&from=${today}&to=${addDays(today, 6)}`,
        );
        expect(await stored()).toEqual([
            [today, 10],
            [addDays(today, 1), 10],
            [addDays(today, 2), 15],
        ]);
    }, 30_000);

    test('a longer horizon is generated on the next read, and the Generate button still covers other dates', async () => {
        expect((await setParameters(true, 5)).status).toBe(200);
        await metadata();
        expect((await stored()).map(([date]) => date)).toEqual(
            [0, 1, 2, 3, 4].map((days) => addDays(today, days)),
        );
        const generated = await json<{ data: { created: number } }>(
            await admin.post(`${api}/practice-schedules/generate`, {
                from: addDays(today, 10),
                to: addDays(today, 12),
                section_id: poli,
            }),
            200,
        );
        expect(generated.data.created).toBe(3);
    }, 30_000);
});
