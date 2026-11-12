import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    json,
    refused,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Level = {
    id: string;
    item_id: string;
    location: { id: string; code: string };
    minimum_quantity: string | null;
    maximum_quantity: string | null;
    version: number;
};

const path = `${inventoryApi}/stockkeeping-units`;

// Stok minimum dan maksimum barang per lokasi (Stockkeeping Unit BC): satu baris per barang dan lokasi bukan transit,
// isian diperiksa, dan hapus berarti deleted_at sehingga lokasi itu bisa diatur lagi.
describe.skipIf(!process.env.DB_HOST)('stockkeeping units', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let item: { id: string };
    let warehouse: { id: string };
    let pharmacy: { id: string };
    let transit: { id: string };

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Stok Optimum',
        );
        item = await business.item('SKU-1');
        warehouse = await business.location('SKU-GDG');
        pharmacy = await business.location('SKU-FAR');
        transit = await business.location('SKU-TRN', { is_transit: true });
    });

    const list = async () =>
        (
            await json<{ data: Level[]; can_manage: boolean }>(
                await business.admin.get(`${path}?item_id=${item.id}`),
                200,
            )
        ).data;

    test('a level is kept per item and location, shown in the location order, and changed with the current version', async () => {
        const created = (
            await json<{ data: Level }>(
                await business.admin.post(path, {
                    item_id: item.id,
                    location_id: warehouse.id,
                    minimum_quantity: 20,
                    maximum_quantity: '200.5',
                }),
                201,
            )
        ).data;
        expect([created.minimum_quantity, created.maximum_quantity]).toEqual([
            '20',
            '200.5',
        ]);
        await json(
            await business.admin.post(path, {
                item_id: item.id,
                location_id: pharmacy.id,
                maximum_quantity: 50,
            }),
            201,
        );
        expect(
            (await list()).map((level) => [
                level.location.code,
                level.minimum_quantity,
                level.maximum_quantity,
            ]),
        ).toEqual([
            ['SKU-FAR', null, '50'],
            ['SKU-GDG', '20', '200.5'],
        ]);
        expect(
            (
                await business.admin.patch(`${path}/${created.id}`, {
                    item_id: item.id,
                    location_id: warehouse.id,
                    maximum_quantity: 300,
                    version: created.version + 5,
                })
            ).status,
        ).toBe(409);
        const updated = await json<{ data: Level }>(
            await business.admin.patch(`${path}/${created.id}`, {
                item_id: item.id,
                location_id: warehouse.id,
                minimum_quantity: null,
                maximum_quantity: 300,
                version: created.version,
            }),
            200,
        );
        expect([
            updated.data.minimum_quantity,
            updated.data.maximum_quantity,
        ]).toEqual([null, '300']);
    });

    test('a second level for the same location, a transit location, and impossible quantities are refused field by field', async () => {
        const errors = async (body: Record<string, unknown>) =>
            Object.keys(
                await refused(
                    await business.admin.post(path, {
                        item_id: item.id,
                        ...body,
                    }),
                ),
            ).sort();
        expect(
            await errors({ location_id: warehouse.id, maximum_quantity: 10 }),
        ).toEqual(['location_id']);
        expect(
            await errors({ location_id: transit.id, maximum_quantity: 10 }),
        ).toEqual(['location_id']);
        const other = await business.location('SKU-PST');
        expect(await errors({ location_id: other.id })).toEqual([
            'minimum_quantity',
        ]);
        expect(
            await errors({
                location_id: other.id,
                minimum_quantity: 10,
                maximum_quantity: 5,
            }),
        ).toEqual(['maximum_quantity']);
        expect(
            await errors({
                location_id: other.id,
                minimum_quantity: -1,
                maximum_quantity: 'banyak',
            }),
        ).toEqual(['maximum_quantity', 'minimum_quantity']);
        expect(
            await errors({ location_id: 'bukan-id', maximum_quantity: 1 }),
        ).toEqual(['location_id']);
    });

    test('delete fills deleted_at, and the location can be set again afterwards', async () => {
        const [level] = (await list()).filter(
            (entry) => entry.location.id === pharmacy.id,
        );
        if (!level) throw new Error('No level.');
        expect(
            (
                await business.admin.delete(`${path}/${level.id}`, {
                    version: level.version,
                })
            ).status,
        ).toBe(204);
        const [stored] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from gd_m_barang_lokasi where id = $1',
            [level.id],
        );
        expect(stored?.deleted).toBe(true);
        expect((await list()).map((entry) => entry.location.code)).toEqual([
            'SKU-GDG',
        ]);
        await json(
            await business.admin.post(path, {
                item_id: item.id,
                location_id: pharmacy.id,
                minimum_quantity: 1,
            }),
            201,
        );
    });

    test('reading follows the item right and changing needs the item maintain right', async () => {
        const reader = await createMember(pool, business.tenantId, [
            'core.inventory-item.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            reader.membershipId,
        );
        const session = browser();
        await session.login(reader.email, reader.password);
        const shown = await json<{ data: Level[]; can_manage: boolean }>(
            await session.get(`${path}?item_id=${item.id}`),
            200,
        );
        expect(shown.can_manage).toBe(false);
        expect(
            (
                await session.post(path, {
                    item_id: item.id,
                    location_id: warehouse.id,
                    maximum_quantity: 1,
                })
            ).status,
        ).toBe(403);
    });
});
