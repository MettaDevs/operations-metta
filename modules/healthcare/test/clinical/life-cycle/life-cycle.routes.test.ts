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

type Cluster = {
    id: string;
    code: string;
    name: string;
    is_active: boolean;
    version: number;
};
type LifeCycle = {
    id: string;
    code: string;
    name: string;
    cluster_id: string;
    cluster_code: string;
    min_age_months: number;
    max_age_months: number | null;
    gender: string | null;
    gender_name: string | null;
    requires_pregnancy: boolean | null;
    priority: number;
    version: number;
};

const api = '/api/modules/healthcare/v1';

// Klaster dan siklus hidup ILP di Setup: isi bawaan per tenant saat module dipasang, ubah dan hapus, validasi, izin,
// dan isolasi tenant. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('ILP clusters and life cycles', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let admin: Browser;
    let other: Browser;
    let tenantId: string;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return (text ? JSON.parse(text) : undefined) as T;
    }

    async function tenantAdmin(name: string, duties: string[]) {
        const tenant = await createTenant(pool, name);
        await entitle(pool, tenant, 'healthcare');
        await recordInstallation(pool, tenant, 'healthcare');
        const account = await createMember(pool, tenant, duties);
        const session = browser();
        await session.login(account.email, account.password);
        return { tenant, session };
    }

    async function clusters(as: Browser) {
        return (
            await json<{ data: Cluster[] }>(
                await as.get(`${api}/clusters`),
                200,
            )
        ).data;
    }

    async function lifeCycles(as: Browser, query = '') {
        return (
            await json<{ data: LifeCycle[] }>(
                await as.get(`${api}/life-cycles${query}`),
                200,
            )
        ).data;
    }

    beforeAll(async () => {
        ({ tenant: tenantId, session: admin } = await tenantAdmin(
            'Puskesmas Uji ILP',
            ['healthcare.clinical-setup.manage'],
        ));
        ({ session: other } = await tenantAdmin('Puskesmas Uji ILP Lain', [
            'healthcare.clinical-setup.manage',
        ]));
    });

    test('every tenant that installs the module gets the five ILP clusters and their life cycles once', async () => {
        const list = await clusters(admin);
        expect(list.map((row) => [row.code, row.name])).toEqual([
            ['K1', 'Manajemen'],
            ['K2', 'Kesehatan Ibu dan Anak'],
            ['K3', 'Kesehatan Dewasa dan Lanjut Usia'],
            ['K4', 'Penanggulangan Penyakit Menular dan Kesehatan Lingkungan'],
            ['K5', 'Lintas Klaster'],
        ]);
        expect(
            (await lifeCycles(admin)).map((row) => [
                row.code,
                row.cluster_code,
                row.min_age_months,
                row.max_age_months,
                row.gender,
                row.requires_pregnancy,
                row.priority,
            ]),
        ).toEqual([
            ['IBU', 'K2', 0, null, 'female', true, 1],
            ['BALITA', 'K2', 0, 84, null, null, 10],
            ['ANAK', 'K2', 84, 216, null, null, 10],
            ['DEWASA', 'K3', 216, 720, null, null, 10],
            ['LANSIA', 'K3', 720, null, null, null, 10],
        ]);
        // Mencatat pemasangan lagi tidak menambah baris, juga setelah tenant menghapus salah satunya.
        const lansia = (await lifeCycles(admin)).find(
            (row) => row.code === 'LANSIA',
        );
        expect(lansia).toBeDefined();
        await json(
            await admin.delete(`${api}/life-cycles/${lansia?.id}`, {
                version: lansia?.version,
            }),
            204,
        );
        await pool.unsafe(
            "update core_module_installations set status = 'installed', updated_at = now() where tenant_id = $1 and module_id = 'healthcare'",
            [tenantId],
        );
        expect(await clusters(admin)).toHaveLength(5);
        expect((await lifeCycles(admin)).map((row) => row.code)).not.toContain(
            'LANSIA',
        );
        // Tenant lain punya barisnya sendiri.
        const otherClusters = await clusters(other);
        expect(otherClusters).toHaveLength(5);
        expect(
            otherClusters.some((row) =>
                list.some((mine) => mine.id === row.id),
            ),
        ).toBe(false);
    });

    test('a life cycle is validated against its cluster, gender codes, and age range', async () => {
        const [k5] = (await clusters(admin)).filter((row) => row.code === 'K5');
        const refused = await json<{ errors: Record<string, string[]> }>(
            await admin.post(`${api}/life-cycles`, {
                code: '',
                name: 'Calon pengantin',
                cluster_id: (await clusters(other))[0]?.id,
                min_age_months: 240,
                max_age_months: 120,
                gender: null,
                requires_pregnancy: null,
                priority: 5,
            }),
            422,
        );
        expect(Object.keys(refused.errors).sort()).toEqual([
            'code',
            'max_age_months',
        ]);
        const foreignCluster = await json<{ errors: Record<string, string[]> }>(
            await admin.post(`${api}/life-cycles`, {
                code: 'CATIN',
                name: 'Calon pengantin',
                cluster_id: (await clusters(other))[0]?.id,
                min_age_months: 216,
                max_age_months: null,
                gender: 'robot',
                requires_pregnancy: null,
                priority: 5,
            }),
            422,
        );
        expect(foreignCluster.errors.cluster_id).toEqual([
            'Pilih klaster dari daftar.',
        ]);
        const created = (
            await json<{ data: LifeCycle }>(
                await admin.post(`${api}/life-cycles`, {
                    code: 'CATIN',
                    name: 'Calon pengantin',
                    cluster_id: k5?.id,
                    min_age_months: 216,
                    max_age_months: null,
                    gender: 'female',
                    requires_pregnancy: false,
                    priority: 50,
                }),
                201,
            )
        ).data;
        expect(created.gender_name).toBe('Perempuan');
        expect(
            (
                await json<{ errors: Record<string, string[]> }>(
                    await admin.post(`${api}/life-cycles`, {
                        code: 'catin',
                        name: 'Lagi',
                        cluster_id: k5?.id,
                        min_age_months: 0,
                        max_age_months: null,
                        gender: null,
                        requires_pregnancy: null,
                        priority: 50,
                    }),
                    422,
                )
            ).errors.code,
        ).toEqual(['Kode ini sudah dipakai siklus hidup lain.']);
        const updated = (
            await json<{ data: LifeCycle }>(
                await admin.patch(`${api}/life-cycles/${created.id}`, {
                    code: 'CATIN',
                    name: 'Calon pengantin',
                    cluster_id: k5?.id,
                    min_age_months: 192,
                    max_age_months: 600,
                    gender: null,
                    requires_pregnancy: null,
                    priority: 50,
                    version: created.version,
                }),
                200,
            )
        ).data;
        expect([updated.min_age_months, updated.max_age_months]).toEqual([
            192, 600,
        ]);
        expect(
            (await lifeCycles(admin, `?cluster_id=${k5?.id}`)).map(
                (row) => row.code,
            ),
        ).toEqual(['CATIN']);
        // Klaster yang masih dipakai siklus hidup tidak bisa dihapus.
        const blocked = await json<{ errors: Record<string, string[]> }>(
            await admin.delete(`${api}/clusters/${k5?.id}`, {
                version: k5?.version,
            }),
            422,
        );
        expect(blocked.errors.id?.[0]).toContain('masih dipakai siklus hidup');
        await json(
            await admin.delete(`${api}/life-cycles/${updated.id}`, {
                version: updated.version,
            }),
            204,
        );
        await json(
            await admin.delete(`${api}/clusters/${k5?.id}`, {
                version: k5?.version,
            }),
            204,
        );
        expect((await clusters(admin)).map((row) => row.code)).not.toContain(
            'K5',
        );
    });

    test('a cluster code is unique per tenant and another tenant cannot touch it', async () => {
        const created = (
            await json<{ data: Cluster }>(
                await admin.post(`${api}/clusters`, {
                    code: 'K6',
                    name: 'Klaster percobaan',
                    sort_order: 6,
                }),
                201,
            )
        ).data;
        expect(
            (
                await json<{ errors: Record<string, string[]> }>(
                    await admin.post(`${api}/clusters`, {
                        code: 'k6',
                        name: 'Lain',
                    }),
                    422,
                )
            ).errors.code,
        ).toEqual(['Kode ini sudah dipakai klaster lain.']);
        await json(
            await other.patch(`${api}/clusters/${created.id}`, {
                code: 'K6',
                name: 'Diambil',
                version: created.version,
            }),
            404,
        );
        // Kode yang sama boleh di tenant lain.
        await json(
            await other.post(`${api}/clusters`, { code: 'K6', name: 'Lain' }),
            201,
        );
    });

    test('reading needs the inquire duty and changing needs the manage duty', async () => {
        const reader = await createMember(pool, tenantId, [
            'healthcare.clinical-setup.inquire',
        ]);
        const readerSession = browser();
        await readerSession.login(reader.email, reader.password);
        const metadata = await json<{
            permissions: { create: boolean; update: boolean; delete: boolean };
        }>(await readerSession.get(`${api}/life-cycles/metadata`), 200);
        expect(metadata.permissions).toEqual({
            create: false,
            update: false,
            delete: false,
        });
        expect(await clusters(readerSession)).not.toHaveLength(0);
        await json(
            await readerSession.post(`${api}/clusters`, {
                code: 'K7',
                name: 'Tanpa izin',
            }),
            403,
        );
        const stranger = await createMember(pool, tenantId, [
            'healthcare.visit.inquire',
        ]);
        const strangerSession = browser();
        await strangerSession.login(stranger.email, stranger.password);
        await json(await strangerSession.get(`${api}/clusters`), 403);
        await json(await strangerSession.get(`${api}/life-cycles`), 403);
    });
});
