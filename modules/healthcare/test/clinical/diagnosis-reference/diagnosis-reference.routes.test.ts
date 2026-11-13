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

type Entry = {
    id: string;
    code: string;
    name: string;
    sort_order: number;
    is_active: boolean;
    version: number;
};

const api = '/api/modules/healthcare/v1/diagnosis-references';

// Setup daftar pendek klinis, dari jenis diagnosa sampai alat penunjang: satu set endpoint untuk semua daftar, kode unik
// per daftar, Delete lunak yang ditahan selama barisnya dipakai, izin setup klinis, dan batas tenant. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila
// DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('diagnosis reference lists', () => {
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

    async function member(tenant: string, duties: string[]) {
        const account = await createMember(pool, tenant, duties);
        await grantAllOrganizations(pool, tenant, account.membershipId);
        const session = browser();
        await session.login(account.email, account.password);
        return session;
    }

    const list = async (as: Browser, name: string, query = '') =>
        (
            await json<{ data: Entry[] }>(
                await as.get(`${api}/${name}?${query}`),
                200,
            )
        ).data;

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Acuan Diagnosa');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        admin = await member(tenantId, ['healthcare.clinical-setup.manage']);
    }, 60_000);

    test('each list shows its seeded rows in order', async () => {
        expect(
            (await list(admin, 'diagnosis-types')).map((row) => row.code),
        ).toEqual(['PRIMER', 'SEKUNDER', 'KOMPLIKASI']);
        expect(
            (await list(admin, 'diagnosis-cases')).map((row) => row.name),
        ).toEqual(['Baru', 'Lama']);
        expect(await list(admin, 'prognoses')).toHaveLength(5);
        expect(
            (await list(admin, 'chronic-diseases', 'q=ginjal')).map(
                (row) => row.name,
            ),
        ).toEqual(['Penyakit Ginjal Kronis']);
        expect((await admin.get(`${api}/unknown`)).status).toBe(404);
    });

    test('a row is added, changed, and deleted softly, with codes unique per list', async () => {
        const added = (
            await json<{ data: Entry }>(
                await admin.post(`${api}/prognoses`, {
                    code: '06',
                    name: 'Ad Functionam',
                    sort_order: 6,
                }),
                201,
            )
        ).data;
        expect(added.is_active).toBe(true);
        expect(
            (
                await json<{ errors: Record<string, string[]> }>(
                    await admin.post(`${api}/prognoses`, {
                        code: '06',
                        name: 'Lagi',
                    }),
                    422,
                )
            ).errors,
        ).toEqual({ code: ['Kode ini sudah dipakai baris lain.'] });
        await json(
            await admin.post(`${api}/diagnosis-cases`, {
                code: '06',
                name: 'Kode sama di daftar lain',
            }),
            201,
        );
        const changed = (
            await json<{ data: Entry }>(
                await admin.patch(`${api}/prognoses/${added.id}`, {
                    code: '06',
                    name: 'Ad Functionam (fungsi)',
                    is_active: false,
                    version: added.version,
                }),
                200,
            )
        ).data;
        expect([changed.name, changed.is_active]).toEqual([
            'Ad Functionam (fungsi)',
            false,
        ]);
        expect(
            (
                await admin.patch(`${api}/prognoses/${added.id}`, {
                    code: '06',
                    name: 'Basi',
                    version: added.version,
                })
            ).status,
        ).toBe(409);
        expect(
            (
                await admin.delete(`${api}/prognoses/${added.id}`, {
                    version: changed.version,
                })
            ).status,
        ).toBe(204);
        const [row] = await pool.unsafe<{ deleted_at: Date | null }[]>(
            'select deleted_at from sim_m_prognosa where id = $1',
            [added.id],
        );
        expect(row?.deleted_at).not.toBeNull();
        expect(
            (await list(admin, 'prognoses')).map((entry) => entry.id),
        ).not.toContain(added.id);
    });

    test('medication routes start with the WHO ATC routes, and neither a code nor a name repeats', async () => {
        expect(
            (await list(admin, 'medication-routes')).map((row) => [
                row.code,
                row.name,
            ]),
        ).toEqual([
            ['O', 'Oral'],
            ['P', 'Parenteral'],
            ['R', 'Rektal'],
            ['V', 'Vaginal'],
            ['N', 'Nasal'],
            ['SL', 'Sublingual / bukal'],
            ['TD', 'Transdermal'],
            ['Inhal', 'Inhalasi'],
            ['Instill', 'Instilasi'],
            ['Implant', 'Implan'],
        ]);
        const refused = async (body: Record<string, unknown>) =>
            (
                await json<{ errors: Record<string, string[]> }>(
                    await admin.post(`${api}/medication-routes`, body),
                    422,
                )
            ).errors;
        expect(await refused({ code: 'o', name: 'Lewat mulut' })).toEqual({
            code: ['Kode ini sudah dipakai baris lain.'],
        });
        expect(await refused({ code: 'ORAL', name: 'oral' })).toEqual({
            name: ['Nama ini sudah dipakai baris lain.'],
        });
        await json(
            await admin.post(`${api}/medication-routes`, {
                code: 'TOP',
                name: 'Topikal',
                sort_order: 11,
            }),
            201,
        );
    });

    test('the tariff dimension lists start empty, keep codes unique ignoring case, and can be renamed and deleted', async () => {
        for (const name of [
            'care-classes',
            'operation-categories',
            'benefit-limit-categories',
            'supporting-devices',
        ]) {
            expect(await list(admin, name)).toEqual([]);
            const added = (
                await json<{ data: Entry }>(
                    await admin.post(`${api}/${name}`, {
                        code: 'a1',
                        name: 'Pertama',
                        sort_order: 3,
                    }),
                    201,
                )
            ).data;
            expect(
                (
                    await json<{ errors: Record<string, string[]> }>(
                        await admin.post(`${api}/${name}`, {
                            code: 'A1',
                            name: 'Kembar',
                        }),
                        422,
                    )
                ).errors,
            ).toEqual({ code: ['Kode ini sudah dipakai baris lain.'] });
            const renamed = (
                await json<{ data: Entry }>(
                    await admin.patch(`${api}/${name}/${added.id}`, {
                        code: 'A1',
                        name: 'Diganti',
                        sort_order: 4,
                        version: added.version,
                    }),
                    200,
                )
            ).data;
            expect(await list(admin, name)).toEqual([renamed]);
            expect(
                (
                    await admin.delete(`${api}/${name}/${added.id}`, {
                        version: renamed.version,
                    })
                ).status,
            ).toBe(204);
            expect(await list(admin, name)).toEqual([]);
        }
    });

    test('a benefit limit category or device held by a procedure cannot be deleted until the procedure lets go', async () => {
        const entry = async (name: string) =>
            (
                await json<{ data: Entry }>(
                    await admin.post(`${api}/${name}`, {
                        code: 'DIPAKAI',
                        name: 'Dipakai',
                    }),
                    201,
                )
            ).data;
        const category = await entry('benefit-limit-categories');
        const device = await entry('supporting-devices');
        const procedure = (
            await json<{ data: { id: string; version: number } }>(
                await admin.post('/api/modules/healthcare/v1/procedures', {
                    code: 'J-ALAT',
                    name: 'Nebulisasi',
                    benefit_limit_category_id: category.id,
                    supporting_device_id: device.id,
                }),
                201,
            )
        ).data;
        for (const [name, row] of [
            ['benefit-limit-categories', category],
            ['supporting-devices', device],
        ] as const)
            expect(
                (
                    await json<{ errors: Record<string, string[]> }>(
                        await admin.delete(`${api}/${name}/${row.id}`, {
                            version: row.version,
                        }),
                        422,
                    )
                ).errors,
            ).toEqual({
                id: [
                    'Baris ini sudah dipakai. Nonaktifkan saja supaya tidak dipilih lagi.',
                ],
            });
        await json(
            await admin.patch(
                `/api/modules/healthcare/v1/procedures/${procedure.id}`,
                {
                    code: 'J-ALAT',
                    name: 'Nebulisasi',
                    benefit_limit_category_id: null,
                    supporting_device_id: null,
                    version: procedure.version,
                },
            ),
            200,
        );
        for (const [name, row] of [
            ['benefit-limit-categories', category],
            ['supporting-devices', device],
        ] as const)
            expect(
                (
                    await admin.delete(`${api}/${name}/${row.id}`, {
                        version: row.version,
                    })
                ).status,
            ).toBe(204);
    });

    test('reading needs the clinical setup duty, changing needs the manage duty, and tenants stay apart', async () => {
        const reader = await member(tenantId, [
            'healthcare.clinical-setup.inquire',
        ]);
        expect(await list(reader, 'prognoses')).toHaveLength(5);
        expect(
            (await reader.post(`${api}/prognoses`, { code: 'X', name: 'X' }))
                .status,
        ).toBe(403);
        const outsider = await member(tenantId, ['healthcare.patient.inquire']);
        expect((await outsider.get(`${api}/prognoses`)).status).toBe(403);

        const other = await createTenant(pool, 'Klinik Acuan Lain');
        await entitle(pool, other, 'healthcare');
        await recordInstallation(pool, other, 'healthcare');
        const stranger = await member(other, [
            'healthcare.clinical-setup.manage',
        ]);
        const ours = (await list(admin, 'diagnosis-types'))[0]!;
        expect(
            (
                await stranger.patch(`${api}/diagnosis-types/${ours.id}`, {
                    code: 'PRIMER',
                    name: 'X',
                    version: ours.version,
                })
            ).status,
        ).toBe(404);
        expect(
            (await list(stranger, 'diagnosis-types')).map((row) => row.id),
        ).not.toContain(ours.id);
    });
});
