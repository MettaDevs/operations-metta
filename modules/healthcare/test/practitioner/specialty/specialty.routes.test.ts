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

type Specialty = {
    id: string;
    name: string;
    subspecialties: { id: string; name: string }[];
    version: number;
};

const api = '/api/modules/healthcare/v1';

// Spesialis dengan baris sub spesialisnya: nama unik per tenant dan per spesialis, simpan kartu mengganti baris sub
// spesialis, dan yang dipegang nakes tidak bisa dihapus. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST
// kosong.
describe.skipIf(!process.env.DB_HOST)('specialty master', () => {
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

    const errors = async (response: Response) =>
        (await json<{ errors: Record<string, string[]> }>(response, 422))
            .errors;

    async function member(tenant: string, duties: string[]) {
        const account = await createMember(pool, tenant, duties);
        await grantAllOrganizations(pool, tenant, account.membershipId);
        const session = browser();
        await session.login(account.email, account.password);
        return session;
    }

    const create = async (body: Record<string, unknown>) =>
        (
            await json<{ data: Specialty }>(
                await admin.post(`${api}/specialties`, body),
                201,
            )
        ).data;
    const lines = (specialty: Specialty) =>
        specialty.subspecialties.map((line) => line.name);

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Spesialis');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        admin = await member(tenantId, [
            'core.organization.manage',
            'healthcare.practitioner.manage',
        ]);
        await json(
            await admin.post('/api/v1/organizations', {
                classification: 'legal_entity',
                name: 'PT Klinik Uji Spesialis',
                company_code: `KS${Date.now() % 100000}`,
                country_code: 'ID',
            }),
            201,
        );
    }, 60_000);

    test('a specialty is created with its subspecialties, and names stay unique per tenant and per specialty', async () => {
        const dental = await create({
            name: ' Gigi & Oral ',
            subspecialties: [{ name: 'Bedah Mulut' }, { name: 'Ortodonsia' }],
        });
        expect([dental.name, lines(dental)]).toEqual([
            'Gigi & Oral',
            ['Bedah Mulut', 'Ortodonsia'],
        ]);
        expect(
            await errors(
                await admin.post(`${api}/specialties`, {
                    name: 'gigi & oral',
                }),
            ),
        ).toEqual({ name: ['Nama ini sudah dipakai spesialis lain.'] });
        expect(
            await errors(
                await admin.post(`${api}/specialties`, {
                    name: 'Anak',
                    subspecialties: [
                        { name: 'Neonatologi' },
                        { name: 'neonatologi' },
                        { name: ' ' },
                    ],
                }),
            ),
        ).toEqual({
            'subspecialties.1.name': ['Nama ini sudah ada di baris lain.'],
            'subspecialties.2.name': ['Isi nama sub spesialis.'],
        });
        // Nama sub spesialis yang sama boleh di spesialis lain.
        const surgery = await create({
            name: 'Bedah',
            subspecialties: [{ name: 'Bedah Mulut' }],
        });
        expect(lines(surgery)).toEqual(['Bedah Mulut']);
    });

    test('saving the card replaces the subspecialties and soft-deletes the removed ones', async () => {
        const specialty = await create({
            name: 'Penyakit Dalam',
            subspecialties: [{ name: 'Ginjal' }, { name: 'Jantung' }],
        });
        const [kidney, heart] = specialty.subspecialties;
        const saved = (
            await json<{ data: Specialty }>(
                await admin.patch(`${api}/specialties/${specialty.id}`, {
                    name: 'Penyakit Dalam',
                    subspecialties: [
                        { id: kidney!.id, name: 'Ginjal Hipertensi' },
                        { name: 'Gastroenterologi' },
                    ],
                    version: specialty.version,
                }),
                200,
            )
        ).data;
        expect(lines(saved)).toEqual(['Ginjal Hipertensi', 'Gastroenterologi']);
        expect(saved.subspecialties[0]!.id).toBe(kidney!.id);
        const rows = await pool.unsafe<
            { id: string; nama: string; removed: boolean }[]
        >(
            `select id, nama, deleted_at is not null as removed from sim_m_sub_spesialisasi
             where tenant_id = $1 and spesialisasi_id = $2 order by created_at, id`,
            [tenantId, specialty.id],
        );
        expect(rows.map((row) => [row.nama, row.removed])).toEqual([
            ['Ginjal Hipertensi', false],
            ['Jantung', true],
            ['Gastroenterologi', false],
        ]);
        expect(rows[1]!.id).toBe(heart!.id);
        expect(
            (
                await admin.patch(`${api}/specialties/${specialty.id}`, {
                    name: 'Basi',
                    version: specialty.version,
                })
            ).status,
        ).toBe(409);
    });

    test('a specialty or subspecialty held by a practitioner can be neither deleted nor removed', async () => {
        const specialty = await create({
            name: 'Kulit',
            subspecialties: [{ name: 'Kosmetik' }, { name: 'Alergi' }],
        });
        const [cosmetic, allergy] = specialty.subspecialties;
        const [profession] = await pool.unsafe<{ id: string }[]>(
            "select id from sim_m_profesi where tenant_id = $1 and kode = 'dokter'",
            [tenantId],
        );
        const practitioner = (
            await json<{ data: { id: string; version: number } }>(
                await admin.post(`${api}/practitioners`, {
                    name: 'Dokter Kulit',
                    profession_id: profession!.id,
                    specialty_id: specialty.id,
                    subspecialty_id: cosmetic!.id,
                }),
                201,
            )
        ).data;
        expect(
            await errors(
                await admin.delete(`${api}/specialties/${specialty.id}`, {
                    version: specialty.version,
                }),
            ),
        ).toEqual({
            id: [
                'Spesialis ini masih dipakai tenaga kesehatan. Ganti spesialis nakes itu lebih dulu.',
            ],
        });
        expect(
            await errors(
                await admin.patch(`${api}/specialties/${specialty.id}`, {
                    name: 'Kulit',
                    subspecialties: [{ id: allergy!.id, name: 'Alergi' }],
                    version: specialty.version,
                }),
            ),
        ).toEqual({
            subspecialties: [
                'Sub spesialis Kosmetik masih dipakai tenaga kesehatan. Ganti sub spesialis nakes itu lebih dulu.',
            ],
        });

        await json(
            await admin.patch(`${api}/practitioners/${practitioner.id}`, {
                profession_id: profession!.id,
                version: practitioner.version,
            }),
            200,
        );
        expect(
            (
                await admin.delete(`${api}/specialties/${specialty.id}`, {
                    version: specialty.version,
                })
            ).status,
        ).toBe(204);
        const [left] = await pool.unsafe<{ live: number }[]>(
            `select count(*)::int as live from sim_m_sub_spesialisasi
             where tenant_id = $1 and spesialisasi_id = $2 and deleted_at is null`,
            [tenantId, specialty.id],
        );
        expect(left?.live).toBe(0);
    }, 30_000);

    test('a viewer reads specialties but cannot add one, and another tenant has its own list', async () => {
        const viewer = await member(tenantId, [
            'healthcare.practitioner.inquire',
        ]);
        const listed = (
            await json<{ data: Specialty[] }>(
                await viewer.get(`${api}/specialties?q=gigi`),
                200,
            )
        ).data;
        expect(listed.map((row) => row.name)).toEqual(['Gigi & Oral']);
        expect(
            (
                await json<{ permissions: { create: boolean } }>(
                    await viewer.get(`${api}/specialties/metadata`),
                    200,
                )
            ).permissions.create,
        ).toBe(false);
        expect(
            (await viewer.post(`${api}/specialties`, { name: 'Mata' })).status,
        ).toBe(403);

        const other = await createTenant(pool, 'Klinik Spesialis Lain');
        await entitle(pool, other, 'healthcare');
        await recordInstallation(pool, other, 'healthcare');
        const stranger = await member(other, [
            'healthcare.practitioner.manage',
        ]);
        expect(
            (
                await json<{ data: Specialty[] }>(
                    await stranger.get(`${api}/specialties`),
                    200,
                )
            ).data,
        ).toEqual([]);
        expect(
            (
                await stranger.patch(`${api}/specialties/${listed[0]!.id}`, {
                    name: 'Diambil',
                    version: listed[0]!.version,
                })
            ).status,
        ).toBe(404);
    }, 30_000);
});
