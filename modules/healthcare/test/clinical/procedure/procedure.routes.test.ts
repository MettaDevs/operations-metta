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

type Procedure = {
    id: string;
    code: string;
    name: string;
    group_id: string | null;
    group_name: string | null;
    is_active: boolean;
    version: number;
};

type Metadata = {
    permissions: { create: boolean; update: boolean; delete: boolean };
    groups: { id: string; code: string; name: string; active: boolean }[];
};

const api = '/api/modules/healthcare/v1';

// Master tindakan: Setup klinis memelihara, pemeriksa menambah dari baris Biaya Tindakan tanpa boleh mengubah, kelompok
// aktif dari daftar pendek, kode unik, Delete lunak yang ditahan bila sudah dipakai pemeriksaan, dan batas tenant.
// Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('procedures', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let tenantId: string;
    let admin: Browser;
    let groups: Record<'lab' | 'retired', string>;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function refused(response: Response) {
        return (await json<{ errors: Record<string, string[]> }>(response, 422))
            .errors;
    }

    async function member(tenant: string, duties: string[]) {
        const account = await createMember(pool, tenant, duties);
        await grantAllOrganizations(pool, tenant, account.membershipId);
        const session = browser();
        await session.login(account.email, account.password);
        return session;
    }

    async function create(as: Browser, body: Record<string, unknown>) {
        return (
            await json<{ data: Procedure }>(
                await as.post(`${api}/procedures`, body),
                201,
            )
        ).data;
    }

    const list = async (as: Browser, query = '') =>
        (
            await json<{ data: Procedure[] }>(
                await as.get(`${api}/procedures?${query}`),
                200,
            )
        ).data;

    async function group(code: string, name: string, active = true) {
        const created = await json<{ data: { id: string; version: number } }>(
            await admin.post(`${api}/procedure-groups`, {
                code,
                name,
            }),
            201,
        );
        if (!active)
            await json(
                await admin.patch(
                    `${api}/procedure-groups/${created.data.id}`,
                    { code, name, is_active: false, version: 1 },
                ),
                200,
            );
        return created.data.id;
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Tindakan');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        admin = await member(tenantId, ['healthcare.clinical-setup.manage']);
        groups = {
            lab: await group('LAB', 'Laboratorium'),
            retired: await group('LAMA', 'Kelompok lama'),
        };
    }, 60_000);

    test('metadata lists every group with its status and the permissions of the user', async () => {
        const metadata = await json<Metadata>(
            await admin.get(`${api}/procedures/metadata`),
            200,
        );
        expect(metadata.permissions).toEqual({
            create: true,
            update: true,
            delete: true,
        });
        expect(
            metadata.groups.map((row) => [row.code, row.active]),
        ).toContainEqual(['LAB', true]);
    });

    test('a procedure is created, found, changed, and refuses a stale version', async () => {
        const added = await create(admin, {
            code: ' T001 ',
            name: 'Cek gula darah',
            group_id: groups.lab,
        });
        expect(added).toMatchObject({
            code: 'T001',
            name: 'Cek gula darah',
            group_id: groups.lab,
            group_name: 'Laboratorium',
            is_active: true,
        });
        await create(admin, { code: 'T002', name: 'Rawat luka' });
        expect((await list(admin, 'q=gula')).map((row) => row.id)).toEqual([
            added.id,
        ]);
        expect((await list(admin, 'q=t001')).map((row) => row.id)).toEqual([
            added.id,
        ]);
        expect(
            (await list(admin, `group=${groups.lab}`)).map((row) => row.id),
        ).toEqual([added.id]);

        const changed = (
            await json<{ data: Procedure }>(
                await admin.patch(`${api}/procedures/${added.id}`, {
                    code: 'T001',
                    name: 'Cek gula darah sewaktu',
                    group_id: null,
                    is_active: false,
                    version: added.version,
                }),
                200,
            )
        ).data;
        expect(changed).toMatchObject({
            name: 'Cek gula darah sewaktu',
            group_id: null,
            group_name: null,
            is_active: false,
        });
        expect(
            (await list(admin, 'status=inactive')).map((row) => row.id),
        ).toEqual([added.id]);
        expect(
            (
                await admin.patch(`${api}/procedures/${added.id}`, {
                    code: 'T001',
                    name: 'Basi',
                    version: added.version,
                })
            ).status,
        ).toBe(409);
    });

    test('code and name are required, lengths are checked, and codes are unique regardless of case', async () => {
        expect(
            await refused(
                await admin.post(`${api}/procedures`, { code: ' ', name: '' }),
            ),
        ).toEqual({
            code: ['Isi kode tindakan.'],
            name: ['Isi nama tindakan.'],
        });
        expect(
            await refused(
                await admin.post(`${api}/procedures`, {
                    code: 'X'.repeat(21),
                    name: 'N'.repeat(201),
                }),
            ),
        ).toEqual({
            code: ['Paling panjang 20 karakter.'],
            name: ['Paling panjang 200 karakter.'],
        });
        await create(admin, { code: 'UNIK1', name: 'Pertama' });
        expect(
            await refused(
                await admin.post(`${api}/procedures`, {
                    code: 'unik1',
                    name: 'Kedua',
                }),
            ),
        ).toEqual({ code: ['Kode ini sudah ada di daftar tindakan.'] });
    });

    test('only active groups are accepted, except the one already saved on the procedure', async () => {
        const inactive = await group('NONAKTIF', 'Kelompok nonaktif', false);
        for (const groupId of [inactive, Bun.randomUUIDv7(), 'bukan-id'])
            expect(
                await refused(
                    await admin.post(`${api}/procedures`, {
                        code: 'G1',
                        name: 'Kelompok salah',
                        group_id: groupId,
                    }),
                ),
            ).toEqual({ group_id: ['Pilih dari daftar.'] });

        const kept = await create(admin, {
            code: 'G2',
            name: 'Kelompok kemudian nonaktif',
            group_id: groups.retired,
        });
        await pool.unsafe(
            'update sim_m_tindakan_kelompok set aktif = false where id = $1',
            [groups.retired],
        );
        const changed = (
            await json<{ data: Procedure }>(
                await admin.patch(`${api}/procedures/${kept.id}`, {
                    code: 'G2',
                    name: 'Masih di kelompok lama',
                    group_id: groups.retired,
                    version: kept.version,
                }),
                200,
            )
        ).data;
        expect([changed.group_id, changed.group_name]).toEqual([
            groups.retired,
            'Kelompok lama',
        ]);
        expect(
            await refused(
                await admin.patch(`${api}/procedures/${kept.id}`, {
                    code: 'G2',
                    name: 'Pindah ke nonaktif lain',
                    group_id: inactive,
                    version: changed.version,
                }),
            ),
        ).toEqual({ group_id: ['Pilih dari daftar.'] });
    });

    test('delete is soft, frees the code, and is refused once an examination uses the procedure', async () => {
        const unused = await create(admin, { code: 'HAPUS', name: 'Dihapus' });
        expect(
            (
                await admin.delete(`${api}/procedures/${unused.id}`, {
                    version: unused.version,
                })
            ).status,
        ).toBe(204);
        const [row] = await pool.unsafe<{ deleted_at: Date | null }[]>(
            'select deleted_at from sim_m_tindakan where id = $1',
            [unused.id],
        );
        expect(row?.deleted_at).not.toBeNull();
        expect((await list(admin)).map((entry) => entry.id)).not.toContain(
            unused.id,
        );
        await create(admin, { code: 'HAPUS', name: 'Kode dipakai lagi' });

        const used = await create(admin, { code: 'DIPAKAI', name: 'Dipakai' });
        // Baris Biaya Tindakan disisipkan langsung tanpa pemeriksaan sungguhan: yang diuji hanya penahan Delete.
        // session_replication_role hanya berlaku di transaksi ini, jadi foreign key tabel bersama tetap utuh.
        await pool.begin(async (sql) => {
            await sql.unsafe('set local session_replication_role = replica');
            await sql.unsafe(
                `insert into sim_tr_pemeriksaan_tindakan (id, tenant_id, pemeriksaan_id, urutan, tindakan_id, jumlah)
                 values ($1, $2, $3, 1, $4, 1)`,
                [Bun.randomUUIDv7(), tenantId, Bun.randomUUIDv7(), used.id],
            );
        });
        expect(
            await refused(
                await admin.delete(`${api}/procedures/${used.id}`, {
                    version: used.version,
                }),
            ),
        ).toEqual({
            id: [
                'Tindakan ini sudah dipakai di pemeriksaan. Nonaktifkan saja supaya tidak dipilih lagi.',
            ],
        });
    });

    test('an examiner adds a procedure from the examination but cannot change or delete it', async () => {
        const examiner = await member(tenantId, [
            'healthcare.examination.manage',
        ]);
        const metadata = await json<Metadata>(
            await examiner.get(`${api}/procedures/metadata`),
            200,
        );
        expect(metadata.permissions).toEqual({
            create: true,
            update: false,
            delete: false,
        });
        const added = await create(examiner, {
            code: 'PERIKSA',
            name: 'Ditambah pemeriksa',
        });
        expect(
            (
                await examiner.patch(`${api}/procedures/${added.id}`, {
                    code: 'PERIKSA',
                    name: 'Diubah',
                    version: added.version,
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await examiner.delete(`${api}/procedures/${added.id}`, {
                    version: added.version,
                })
            ).status,
        ).toBe(403);

        const reader = await member(tenantId, [
            'healthcare.clinical-setup.inquire',
        ]);
        expect((await reader.get(`${api}/procedures`)).status).toBe(200);
        expect(
            (await reader.post(`${api}/procedures`, { code: 'X', name: 'X' }))
                .status,
        ).toBe(403);
        const outsider = await member(tenantId, ['healthcare.patient.inquire']);
        expect((await outsider.get(`${api}/procedures`)).status).toBe(403);
    });

    test('another tenant neither sees nor changes our procedures', async () => {
        const ours = await create(admin, { code: 'MILIK', name: 'Milik kami' });
        const other = await createTenant(pool, 'Klinik Tindakan Lain');
        await entitle(pool, other, 'healthcare');
        await recordInstallation(pool, other, 'healthcare');
        const stranger = await member(other, [
            'healthcare.clinical-setup.manage',
        ]);
        expect((await list(stranger)).map((row) => row.id)).not.toContain(
            ours.id,
        );
        expect(
            (
                await stranger.patch(`${api}/procedures/${ours.id}`, {
                    code: 'MILIK',
                    name: 'Diambil',
                    version: ours.version,
                })
            ).status,
        ).toBe(404);
        expect(
            await refused(
                await stranger.post(`${api}/procedures`, {
                    code: 'MILIK',
                    name: 'Kode sama di tenant lain',
                    group_id: groups.lab,
                }),
            ),
        ).toEqual({ group_id: ['Pilih dari daftar.'] });
        await create(stranger, {
            code: 'MILIK',
            name: 'Kode sama di tenant lain',
        });
    });
});
