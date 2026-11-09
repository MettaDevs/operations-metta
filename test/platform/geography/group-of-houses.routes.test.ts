import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { createMember, createTenant } from '../../support/tenant-fixtures.ts';

type Hamlet = {
    id: string;
    tenant_id: string;
    village_id: string;
    code: string | null;
    name: string;
    active: boolean;
    postal_code: string | null;
    override_postal_code: boolean;
    village_name: string;
    version: number;
};

const path = '/api/v1/settings/address-setup/group-of-houses';

// Dusun/banjar per desa per tenant. Tidak ada padanannya yang hidup di CoreERP (tabelnya ada tanpa pintu tulis), jadi
// test ini spesifikasinya. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('group of houses', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let tenantId: string;
    let manager: Browser;
    let member: Browser;
    let otherManager: Browser;
    let benoa: string;
    let jimbaran: string;
    afterAll(close);

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Dusun');
        const managing = await createMember(pool, tenantId, [
            'core.reference-data.manage',
        ]);
        manager = browser();
        await manager.login(managing.email, managing.password);
        const plain = await createMember(pool, tenantId, [
            'core.reference-data.inquire',
        ]);
        member = browser();
        await member.login(plain.email, plain.password);
        const otherTenant = await createTenant(pool, 'Klinik Lain');
        const other = await createMember(pool, otherTenant, [
            'core.reference-data.manage',
        ]);
        otherManager = browser();
        await otherManager.login(other.email, other.password);
        const villages = await pool.unsafe(
            "select id, code from ref_villages where code in ('5103051004', '5103051006') order by code",
        );
        benoa = String(villages[0]?.id);
        jimbaran = String(villages[1]?.id);
    });

    async function created(body: object, as = manager): Promise<Hamlet> {
        const response = await as.post(path, body);
        expect(response.status).toBe(201);
        const { data } = (await response.json()) as { data: Hamlet };
        expect(response.headers.get('location')).toBe(`${path}/${data.id}`);
        return data;
    }

    async function list(query = '', as = manager): Promise<Hamlet[]> {
        const response = await as.get(`${path}${query}`);
        expect(response.status).toBe(200);
        return ((await response.json()) as { data: Hamlet[] }).data;
    }

    async function errors(response: Response) {
        expect(response.status).toBe(422);
        return ((await response.json()) as { errors: Record<string, string[]> })
            .errors;
    }

    test('a manager records a hamlet that takes its postal code from the village', async () => {
        const banjar = await created({
            village_id: benoa,
            name: 'Banjar Kaja',
            code: 'BKJ',
        });
        expect(banjar).toMatchObject({
            tenant_id: tenantId,
            village_id: benoa,
            code: 'BKJ',
            name: 'Banjar Kaja',
            active: true,
            postal_code: '80362',
            override_postal_code: false,
            village_name: 'Benoa',
            district_name: 'Kuta Selatan',
            regency_name: 'Kabupaten Badung',
            province_name: 'Bali',
            version: 1,
        });
        const own = await created({
            village_id: benoa,
            name: 'Banjar Kelod',
            override_postal_code: true,
            postal_code: '80361',
        });
        expect(own).toMatchObject({
            postal_code: '80361',
            override_postal_code: true,
        });
        expect(
            (await list(`?village_id=${benoa}`)).map((row) => row.name),
        ).toEqual(['Banjar Kaja', 'Banjar Kelod']);
        // Anggota tanpa duty Kelola tetap bisa memilihnya di form alamat.
        expect((await list(`?village_id=${benoa}`, member)).length).toBe(2);
        expect((await list('?q=kelod')).map((row) => row.name)).toEqual([
            'Banjar Kelod',
        ]);
    });

    test('the name is unique per village, ignoring case, while another village may reuse it', async () => {
        await created({ village_id: benoa, name: 'Dusun Tengah' });
        expect(
            await errors(
                await manager.post(path, {
                    village_id: benoa,
                    name: 'dusun tengah',
                }),
            ),
        ).toEqual({
            name: ['Nama ini sudah dipakai di desa/kelurahan yang sama.'],
        });
        await created({ village_id: jimbaran, name: 'Dusun Tengah' });
    });

    test('the unique index stops a duplicate that passed the application check', async () => {
        const first = await created({
            village_id: jimbaran,
            name: 'Banjar Uji Indeks',
        });
        await expect(
            pool.unsafe(
                "insert into ref_group_of_houses (id, tenant_id, village_id, name) values ($1, $2, $3, 'BANJAR UJI INDEKS')",
                [Bun.randomUUIDv7(), tenantId, first.village_id],
            ),
        ).rejects.toThrow('ref_group_of_houses_name_unique');
    });

    test('input is checked before anything is written', async () => {
        expect(await errors(await manager.post(path, {}))).toEqual({
            village_id: ['Pilih desa/kelurahan.'],
            name: ['Isi nama.'],
        });
        expect(
            await errors(
                await manager.post(path, {
                    village_id: Bun.randomUUIDv7(),
                    name: 'Dusun Hilang',
                }),
            ),
        ).toEqual({ village_id: ['Pilih desa/kelurahan dari daftar.'] });
        expect(
            await errors(
                await manager.post(path, {
                    village_id: 'benoa',
                    name: 'x'.repeat(201),
                    postal_code: '8036',
                    code: 'K'.repeat(31),
                }),
            ),
        ).toEqual({
            village_id: ['Pilih desa/kelurahan dari daftar.'],
            name: ['Nama paling panjang 200 karakter.'],
            code: ['Kode paling panjang 30 karakter.'],
            postal_code: ['Kode pos berisi 5 angka.'],
        });
    });

    test('changing needs the version the user opened', async () => {
        const hamlet = await created({ village_id: benoa, name: 'Dusun Ubah' });
        const url = `${path}/${hamlet.id}`;
        expect(
            (
                await manager.patch(url, {
                    village_id: benoa,
                    name: 'Dusun Baru',
                })
            ).status,
        ).toBe(428);
        const changed = await manager.patch(url, {
            village_id: jimbaran,
            name: 'Dusun Baru',
            active: false,
            version: hamlet.version,
        });
        expect(changed.status).toBe(200);
        expect(((await changed.json()) as { data: Hamlet }).data).toMatchObject(
            {
                village_id: jimbaran,
                village_name: 'Jimbaran',
                name: 'Dusun Baru',
                active: false,
                version: hamlet.version + 1,
            },
        );
        const stale = await manager.patch(url, {
            village_id: jimbaran,
            name: 'Dusun Lagi',
            version: hamlet.version,
        });
        expect(stale.status).toBe(409);
        expect(await stale.json()).toMatchObject({
            error: { code: 'stale_version' },
        });
    });

    test('deleting archives the row, hides it, and frees its name', async () => {
        const hamlet = await created({
            village_id: benoa,
            name: 'Dusun Hapus',
        });
        const url = `${path}/${hamlet.id}`;
        expect((await manager.delete(url, {})).status).toBe(428);
        expect(
            (await manager.delete(url, { version: hamlet.version })).status,
        ).toBe(204);
        const [row] = await pool.unsafe(
            'select deleted_at is not null as deleted from ref_group_of_houses where id = $1',
            [hamlet.id],
        );
        expect(row?.deleted).toBe(true);
        expect((await list()).map((item) => item.id)).not.toContain(hamlet.id);
        expect(
            (
                await manager.patch(url, {
                    village_id: benoa,
                    name: 'Dusun Hapus',
                    version: hamlet.version + 1,
                })
            ).status,
        ).toBe(404);
        await created({ village_id: benoa, name: 'Dusun Hapus' });
    });

    test('only the reference data manager may write', async () => {
        expect(
            (await member.post(path, { village_id: benoa, name: 'Dusun Liar' }))
                .status,
        ).toBe(403);
        const hamlet = await created({ village_id: benoa, name: 'Dusun Izin' });
        expect(
            (
                await member.patch(`${path}/${hamlet.id}`, {
                    village_id: benoa,
                    name: 'Dusun Liar',
                    version: hamlet.version,
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await member.delete(`${path}/${hamlet.id}`, {
                    version: hamlet.version,
                })
            ).status,
        ).toBe(403);
    });

    test('another tenant neither sees nor changes these hamlets, and may use the same names', async () => {
        const hamlet = await created({
            village_id: benoa,
            name: 'Banjar Bersama',
        });
        expect(await list('', otherManager)).toEqual([]);
        expect(
            (
                await otherManager.patch(`${path}/${hamlet.id}`, {
                    village_id: benoa,
                    name: 'Banjar Diambil',
                    version: hamlet.version,
                })
            ).status,
        ).toBe(404);
        expect(
            (
                await otherManager.delete(`${path}/${hamlet.id}`, {
                    version: hamlet.version,
                })
            ).status,
        ).toBe(404);
        const theirs = await created(
            { village_id: benoa, name: 'Banjar Bersama' },
            otherManager,
        );
        expect(theirs.tenant_id).not.toBe(tenantId);
        expect((await list('', otherManager)).map((row) => row.id)).toEqual([
            theirs.id,
        ]);
    });
});
