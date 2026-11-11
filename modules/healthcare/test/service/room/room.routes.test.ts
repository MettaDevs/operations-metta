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

type Room = {
    id: string;
    operating_unit_id: string;
    operating_unit_name: string;
    code: string;
    floor: string | null;
    name: string;
    display_name: string | null;
    sort_order: number;
    is_active: boolean;
    version: number;
};

const api = '/api/modules/healthcare/v1/rooms';

// Master ruangan: ruang fisik per operating unit, kode unik per unit selama belum dihapus, Delete mengisi deleted_at,
// tenant terpisah, dan izin per aksi. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('room master', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let tenantId: string;
    let admin: Browser;
    let induk: string;
    let barat: string;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function organization(body: Record<string, unknown>) {
        return (
            await json<{ data: { id: string } }>(
                await admin.post('/api/v1/organizations', body),
                201,
            )
        ).data.id;
    }

    async function member(tenant: string, duties: string[]) {
        const created = await createMember(pool, tenant, duties);
        await grantAllOrganizations(pool, tenant, created.membershipId);
        const session = browser();
        await session.login(created.email, created.password);
        return session;
    }

    async function created(body: Record<string, unknown>) {
        return (await json<{ data: Room }>(await admin.post(api, body), 201))
            .data;
    }

    async function codes(as: Browser, query: string) {
        return (
            await json<{ data: Room[] }>(
                await as.get(`${api}?per_page=100&${query}`),
                200,
            )
        ).data.map((room) => room.code);
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Ruangan');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        admin = await member(tenantId, [
            'core.organization.manage',
            'healthcare.service-setup.manage',
        ]);
        await organization({
            classification: 'legal_entity',
            name: 'PT Klinik Uji Ruangan',
            company_code: `KR${Date.now() % 100000}`,
            country_code: 'ID',
        });
        induk = await organization({
            classification: 'operating_unit',
            name: 'Puskesmas Induk',
            operating_unit_type: 'department',
            operating_unit_number: 'RNG-1',
        });
        barat = await organization({
            classification: 'operating_unit',
            name: 'Puskesmas Barat',
            operating_unit_type: 'department',
            operating_unit_number: 'RNG-2',
        });
    }, 60_000);

    test('a room is created, changed, and refuses a stale version', async () => {
        const room = await created({
            operating_unit_id: induk,
            code: ' L1R1 ',
            floor: 'Lantai 1',
            name: 'Ruang 1',
        });
        expect(room).toEqual(
            expect.objectContaining({
                operating_unit_id: induk,
                operating_unit_name: 'Puskesmas Induk',
                code: 'L1R1',
                floor: 'Lantai 1',
                display_name: null,
                sort_order: 0,
                is_active: true,
            }),
        );
        const changed = await json<{ data: Room }>(
            await admin.patch(`${api}/${room.id}`, {
                operating_unit_id: induk,
                code: 'L1R1',
                floor: 'Lantai 1',
                name: 'Ruang 1',
                display_name: 'Poli Umum 1',
                sort_order: 3,
                is_active: false,
                version: room.version,
            }),
            200,
        );
        expect(changed.data).toEqual(
            expect.objectContaining({
                display_name: 'Poli Umum 1',
                sort_order: 3,
                is_active: false,
            }),
        );
        const stale = await admin.patch(`${api}/${room.id}`, {
            operating_unit_id: induk,
            code: 'L1R1',
            name: 'Ruang 1',
            version: room.version,
        });
        expect(stale.status).toBe(409);
        const missing = await admin.post(api, {
            operating_unit_id: induk,
            code: '',
            name: '',
        });
        expect(
            Object.keys(
                (await json<{ errors: Record<string, string[]> }>(missing, 422))
                    .errors,
            ).sort(),
        ).toEqual(['code', 'name']);
    }, 30_000);

    test('a code is unique per operating unit until the room is deleted', async () => {
        const first = await created({
            operating_unit_id: induk,
            code: 'L2R1',
            name: 'Ruang lantai 2',
        });
        const twin = await admin.post(api, {
            operating_unit_id: induk,
            code: 'l2r1',
            name: 'Ruang kembar',
        });
        expect(
            (await json<{ errors: Record<string, string[]> }>(twin, 422)).errors
                .code,
        ).toBeDefined();
        await created({
            operating_unit_id: barat,
            code: 'L2R1',
            name: 'Ruang lantai 2 barat',
        });
        expect(
            (
                await admin.delete(`${api}/${first.id}`, {
                    version: first.version,
                })
            ).status,
        ).toBe(204);
        const [row] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from sim_m_ruangan where id = $1',
            [first.id],
        );
        expect(row?.deleted).toBe(true);
        expect(await codes(admin, `operating_unit_id=${induk}`)).not.toContain(
            'L2R1',
        );
        await created({
            operating_unit_id: induk,
            code: 'L2R1',
            name: 'Ruang lantai 2 baru',
        });
    }, 30_000);

    test('the list filters by unit and status, and searches by code and name', async () => {
        expect(await codes(admin, `operating_unit_id=${barat}`)).toEqual([
            'L2R1',
        ]);
        expect(
            await codes(admin, `operating_unit_id=${induk}&status=inactive`),
        ).toEqual(['L1R1']);
        expect(await codes(admin, 'q=lantai%202%20barat')).toEqual(['L2R1']);
    }, 30_000);

    test('another tenant and members without the duty cannot reach these rooms', async () => {
        const [room] = (
            await json<{ data: Room[] }>(
                await admin.get(`${api}?per_page=1`),
                200,
            )
        ).data;
        if (!room) throw new Error('Belum ada ruangan.');
        const otherTenant = await createTenant(pool, 'Klinik Uji Ruangan Lain');
        await entitle(pool, otherTenant, 'healthcare');
        await recordInstallation(pool, otherTenant, 'healthcare');
        const outsider = await member(otherTenant, [
            'healthcare.service-setup.manage',
        ]);
        expect(await codes(outsider, '')).toEqual([]);
        expect(
            (
                await outsider.patch(`${api}/${room.id}`, {
                    operating_unit_id: induk,
                    code: 'X',
                    name: 'Diambil',
                    version: room.version,
                })
            ).status,
        ).toBe(404);
        expect(
            (
                await outsider.post(api, {
                    operating_unit_id: induk,
                    code: 'X',
                    name: 'Asing',
                })
            ).status,
        ).toBe(422);
        const reader = await member(tenantId, [
            'healthcare.service-setup.inquire',
        ]);
        expect((await codes(reader, '')).length).toBeGreaterThan(0);
        expect(
            (
                await reader.post(api, {
                    operating_unit_id: induk,
                    code: 'R9',
                    name: 'Ruang 9',
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await reader.delete(`${api}/${room.id}`, {
                    version: room.version,
                })
            ).status,
        ).toBe(403);
        const stranger = await member(tenantId, ['core.organization.inquire']);
        expect((await stranger.get(api)).status).toBe(403);
    }, 30_000);
});
