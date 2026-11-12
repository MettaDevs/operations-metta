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

type Profession = {
    id: string;
    code: string;
    name: string;
    fills_medical_staff: boolean;
    fills_nurse: boolean;
    sort_order: number;
    is_active: boolean;
    version: number;
};

const api = '/api/modules/healthcare/v1';

// Master profesi tenaga kesehatan: bawaan dari katalog lama, dua centang peran pemeriksaan, tidak bisa dihapus selama
// dipakai nakes, profesi nonaktif tidak bisa dipilih untuk nakes baru, izin, dan batas tenant. Butuh PostgreSQL yang
// sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('profession master', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let tenantId: string;
    let admin: Browser;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function list(as: Browser, query = '') {
        return (
            await json<{ data: Profession[] }>(
                await as.get(`${api}/professions?${query}`),
                200,
            )
        ).data;
    }

    async function member(tenant: string, duties: string[]) {
        const account = await createMember(pool, tenant, duties);
        await grantAllOrganizations(pool, tenant, account.membershipId);
        const session = browser();
        await session.login(account.email, account.password);
        return session;
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Profesi');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        admin = await member(tenantId, [
            'core.organization.manage',
            'healthcare.practitioner.manage',
        ]);
        await json(
            await admin.post('/api/v1/organizations', {
                classification: 'legal_entity',
                name: 'PT Klinik Uji Profesi',
                company_code: `KP${Date.now() % 100000}`,
                country_code: 'ID',
            }),
            201,
        );
    }, 60_000);

    test('the old profession codes are seeded with their examination roles', async () => {
        expect(
            (await list(admin)).map((row) => [
                row.code,
                row.name,
                row.fills_medical_staff,
                row.fills_nurse,
            ]),
        ).toEqual([
            ['dokter', 'Dokter', true, false],
            ['dokter_gigi', 'Dokter gigi', true, false],
            ['bidan', 'Bidan', false, true],
            ['perawat', 'Perawat', false, true],
            ['apoteker', 'Apoteker', false, false],
            ['analis', 'Analis', false, false],
            ['lainnya', 'Lainnya', false, false],
        ]);
    });

    test('a profession is created and changed with its roles, codes stay unique, and stale versions are refused', async () => {
        const created = (
            await json<{ data: Profession }>(
                await admin.post(`${api}/professions`, {
                    code: 'nutrisionis',
                    name: 'Nutrisionis',
                    fills_nurse: true,
                    sort_order: 8,
                }),
                201,
            )
        ).data;
        expect([created.fills_medical_staff, created.fills_nurse]).toEqual([
            false,
            true,
        ]);
        expect(
            (
                await json<{ errors: Record<string, string[]> }>(
                    await admin.post(`${api}/professions`, {
                        code: 'NUTRISIONIS',
                        name: 'Lain',
                    }),
                    422,
                )
            ).errors,
        ).toEqual({ code: ['Kode ini sudah dipakai profesi lain.'] });
        const changed = (
            await json<{ data: Profession }>(
                await admin.patch(`${api}/professions/${created.id}`, {
                    code: 'nutrisionis',
                    name: 'Nutrisionis',
                    fills_medical_staff: true,
                    fills_nurse: true,
                    version: created.version,
                }),
                200,
            )
        ).data;
        expect([changed.fills_medical_staff, changed.fills_nurse]).toEqual([
            true,
            true,
        ]);
        expect(
            (
                await admin.patch(`${api}/professions/${created.id}`, {
                    code: 'nutrisionis',
                    name: 'Nutrisionis',
                    version: created.version,
                })
            ).status,
        ).toBe(409);
    });

    test('a profession in use cannot be deleted, an unused one is archived, and an inactive one cannot be picked', async () => {
        const professions = await list(admin);
        const analis = professions.find((row) => row.code === 'analis')!;
        const practitioner = (
            await json<{ data: { id: string; version: number } }>(
                await admin.post(`${api}/practitioners`, {
                    name: 'Analis Uji',
                    profession_id: analis.id,
                }),
                201,
            )
        ).data;
        expect(
            (
                await json<{ errors: Record<string, string[]> }>(
                    await admin.delete(`${api}/professions/${analis.id}`, {
                        version: analis.version,
                    }),
                    422,
                )
            ).errors,
        ).toEqual({
            id: [
                'Profesi ini masih dipakai tenaga kesehatan. Ganti profesi nakes itu lebih dulu.',
            ],
        });

        const inactive = (
            await json<{ data: Profession }>(
                await admin.patch(`${api}/professions/${analis.id}`, {
                    code: 'analis',
                    name: 'Analis',
                    is_active: false,
                    version: analis.version,
                }),
                200,
            )
        ).data;
        expect(
            (
                await json<{ errors: Record<string, string[]> }>(
                    await admin.post(`${api}/practitioners`, {
                        name: 'Analis Baru',
                        profession_id: inactive.id,
                    }),
                    422,
                )
            ).errors,
        ).toEqual({ profession_id: ['Pilih profesi dari daftar.'] });
        // Nakes yang sudah memegang profesi nonaktif tetap bisa disimpan.
        await json(
            await admin.patch(`${api}/practitioners/${practitioner.id}`, {
                profession_id: inactive.id,
                license_number: 'SIP-ANALIS',
                version: practitioner.version,
            }),
            200,
        );

        const lainnya = professions.find((row) => row.code === 'lainnya')!;
        expect(
            (
                await admin.delete(`${api}/professions/${lainnya.id}`, {
                    version: lainnya.version,
                })
            ).status,
        ).toBe(204);
        const [row] = await pool.unsafe<{ archived: boolean }[]>(
            'select deleted_at is not null as archived from sim_m_profesi where id = $1',
            [lainnya.id],
        );
        expect(row?.archived).toBe(true);
        expect((await list(admin)).map((item) => item.code)).not.toContain(
            'lainnya',
        );
    });

    test('a viewer reads professions but cannot change them, and another tenant has its own list', async () => {
        const viewer = await member(tenantId, [
            'healthcare.practitioner.inquire',
        ]);
        const professions = await list(viewer);
        expect(professions.length).toBeGreaterThan(0);
        expect(
            (
                await viewer.post(`${api}/professions`, {
                    code: 'x',
                    name: 'X',
                })
            ).status,
        ).toBe(403);

        const otherTenant = await createTenant(pool, 'Klinik Profesi Lain');
        await entitle(pool, otherTenant, 'healthcare');
        await recordInstallation(pool, otherTenant, 'healthcare');
        const outsider = await member(otherTenant, [
            'healthcare.practitioner.manage',
        ]);
        const theirs = await list(outsider);
        expect(theirs.map((row) => row.code)).toContain('dokter');
        expect(theirs.map((row) => row.id)).not.toContain(professions[0]?.id);
        expect(
            (await outsider.get(`${api}/professions?q=nutrisionis`)).status,
        ).toBe(200);
        expect(
            (await list(outsider, 'q=nutrisionis')).map((row) => row.code),
        ).toEqual([]);
    });
});
