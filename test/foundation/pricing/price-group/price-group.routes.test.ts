import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';
import {
    createMember,
    createTenant,
} from '../../../support/tenant-fixtures.ts';

type PriceGroup = {
    id: string;
    code: string;
    name: string;
    is_active: boolean;
    version: number;
};
const api = '/api/v1/pricing/price-groups';

async function json<T>(response: Response, status: number): Promise<T> {
    const text = await response.text();
    if (response.status !== status)
        throw new Error(`Expected ${status}, got ${response.status}: ${text}`);
    return JSON.parse(text) as T;
}

// Kelompok harga Core: kode pendek unik per tenant selama barisnya belum dihapus, hak kelola terpisah dari hak lihat,
// dan penghapusan lunak. Penolakan hapus saat dipakai tipe pasien diuji di module layanan kesehatan.
describe.skipIf(!process.env.DB_HOST)('price groups', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let tenantId: string;
    let manager: Browser;
    let viewer: Browser;

    const create = async (code: string, name = code) =>
        (
            await json<{ data: PriceGroup }>(
                await manager.post(api, { code, name }),
                201,
            )
        ).data;

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Kelompok Harga');
        const owner = await createMember(pool, tenantId, [
            'core.pricing-setup.manage',
        ]);
        manager = browser();
        await manager.login(owner.email, owner.password);
        const reader = await createMember(pool, tenantId, [
            'core.pricing-setup.inquire',
        ]);
        viewer = browser();
        await viewer.login(reader.email, reader.password);
    });

    test('a price group is saved with its code in capitals and listed back', async () => {
        const created = await create(' umum ', 'Umum');
        expect(created).toEqual({
            id: created.id,
            code: 'UMUM',
            name: 'Umum',
            is_active: true,
            version: 1,
        });
        const listed = await json<{ data: PriceGroup[]; can_manage: boolean }>(
            await manager.get(`${api}?q=UMUM`),
            200,
        );
        expect(listed.data.map((group) => group.id)).toEqual([created.id]);
        expect(listed.can_manage).toBe(true);
    });

    test('a code already used by a live price group is refused, and is free again once that group is deleted', async () => {
        const first = await create('WNA', 'Warga negara asing');
        const taken = await json<{ errors: Record<string, string[]> }>(
            await manager.post(api, { code: 'wna', name: 'Lain' }),
            422,
        );
        expect(Object.keys(taken.errors)).toEqual(['code']);
        expect(
            (
                await manager.delete(`${api}/${first.id}`, {
                    version: first.version,
                })
            ).status,
        ).toBe(204);
        const second = await create('WNA', 'Wisatawan');
        const rows = await pool.unsafe<{ id: string; deleted: boolean }[]>(
            `select id, deleted_at is not null as deleted from kelompok_harga
             where tenant_id = $1 and kode = 'WNA' order by deleted_at nulls first`,
            [tenantId],
        );
        expect([...rows]).toEqual([
            { id: second.id, deleted: false },
            { id: first.id, deleted: true },
        ]);
    });

    test('a blank code or name is refused per field', async () => {
        const refused = await json<{ errors: Record<string, string[]> }>(
            await manager.post(api, { code: ' ', name: '' }),
            422,
        );
        expect(Object.keys(refused.errors).sort()).toEqual(['code', 'name']);
    });

    test('a viewer can read price groups but cannot add one', async () => {
        const listed = await json<{ data: PriceGroup[]; can_manage: boolean }>(
            await viewer.get(api),
            200,
        );
        expect(listed.data.length).toBeGreaterThan(0);
        expect(listed.can_manage).toBe(false);
        expect((await viewer.post(api, { code: 'X', name: 'X' })).status).toBe(
            403,
        );
    });

    test('active=1 leaves out an inactive price group', async () => {
        const group = await create('PEMDA', 'Pemda');
        await json(
            await manager.patch(`${api}/${group.id}`, {
                code: 'PEMDA',
                name: 'Pemda',
                is_active: false,
                version: group.version,
            }),
            200,
        );
        const active = await json<{ data: PriceGroup[] }>(
            await manager.get(`${api}?active=1&q=PEMDA`),
            200,
        );
        expect(active.data).toEqual([]);
        const all = await json<{ data: PriceGroup[] }>(
            await manager.get(`${api}?q=PEMDA`),
            200,
        );
        expect(all.data.map((row) => [row.code, row.is_active])).toEqual([
            ['PEMDA', false],
        ]);
    });
});
