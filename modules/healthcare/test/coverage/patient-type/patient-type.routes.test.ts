import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    createTenant,
    entitle,
    recordInstallation,
} from '../../../../../test/support/tenant-fixtures.ts';

type PatientType = {
    id: string;
    max_visits_per_section_per_day: number;
    version: number;
};
const api = '/api/modules/healthcare/v1/patient-types';

// Batas kunjungan per poli per hari pada tipe pasien. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST
// kosong.
describe.skipIf(!process.env.DB_HOST)('patient type visit limit', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let admin: Browser;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function create(code: string, extra: Record<string, unknown> = {}) {
        return (
            await json<{ data: PatientType }>(
                await admin.post(api, { code, name: code, ...extra }),
                201,
            )
        ).data;
    }

    beforeAll(async () => {
        const tenantId = await createTenant(pool, 'Klinik Uji Batas Kunjungan');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        const owner = await createMember(pool, tenantId, [
            'healthcare.payment-setup.manage',
        ]);
        admin = browser();
        await admin.login(owner.email, owner.password);
    });

    test('a patient type without a limit is unlimited', async () => {
        expect((await create('UMUM')).max_visits_per_section_per_day).toBe(0);
    });

    test('the limit is saved on create and update, and read back from the list', async () => {
        const created = await create('BPJS', {
            max_visits_per_section_per_day: '1',
        });
        expect(created.max_visits_per_section_per_day).toBe(1);
        const updated = await json<{ data: PatientType }>(
            await admin.patch(`${api}/${created.id}`, {
                code: 'BPJS',
                name: 'BPJS',
                max_visits_per_section_per_day: 2,
                version: created.version,
            }),
            200,
        );
        expect(updated.data.max_visits_per_section_per_day).toBe(2);
        const listed = await json<{ data: PatientType[] }>(
            await admin.get(`${api}?q=BPJS`),
            200,
        );
        expect(listed.data).toEqual([
            expect.objectContaining({
                id: created.id,
                max_visits_per_section_per_day: 2,
            }),
        ]);
    });

    test('a negative, fractional, non-numeric, or blank limit is refused', async () => {
        for (const limit of [-1, 1.5, 'dua', '']) {
            const refused = await json<{ errors: Record<string, string[]> }>(
                await admin.post(api, {
                    code: 'SALAH',
                    name: 'Salah',
                    max_visits_per_section_per_day: limit,
                }),
                422,
            );
            expect(Object.keys(refused.errors)).toEqual([
                'max_visits_per_section_per_day',
            ]);
        }
    });

    test('a limit saved over an older version is refused and leaves the newer one', async () => {
        const created = await create('ASR');
        const body = { code: 'ASR', name: 'ASR', version: created.version };
        await json(
            await admin.patch(`${api}/${created.id}`, {
                ...body,
                max_visits_per_section_per_day: 3,
            }),
            200,
        );
        const stale = await admin.patch(`${api}/${created.id}`, {
            ...body,
            max_visits_per_section_per_day: 5,
        });
        expect(stale.status).toBe(409);
        const [row] = await pool.unsafe<{ visit_limit: number }[]>(
            'select maks_kunjungan_per_poli_per_hari as visit_limit from sim_m_tipe_pasien where id = $1',
            [created.id],
        );
        expect(row?.visit_limit).toBe(3);
    });
});
