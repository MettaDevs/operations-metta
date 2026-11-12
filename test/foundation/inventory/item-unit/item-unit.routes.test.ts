import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    json,
    refused,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';

type ItemUnit = {
    id: string;
    entry_id: string | null;
    code: string;
    quantity_per_unit: string;
    is_base: boolean;
    version: number;
};

const path = `${inventoryApi}/item-units`;

// Satuan kemasan barang (Item Units of Measure di BC): satuan dasar selalu berisi 1, satuan lain berisi berapa satuan
// dasar, satu baris per satuan per barang.
describe.skipIf(!process.env.DB_HOST)('item units of measure', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let business: Business;
    let item: { id: string };
    let box: { id: string };

    beforeAll(async () => {
        business = await createBusiness(pool, browser, 'Klinik Uji Kemasan');
        item = await business.item('PCT');
        box = (
            await json<{ data: { id: string } }>(
                await business.admin.post(`${inventoryApi}/units-of-measure`, {
                    code: 'BOX',
                    name: 'Kotak',
                }),
                201,
            )
        ).data;
    });

    const units = async () =>
        (
            await json<{ data: ItemUnit[] }>(
                await business.admin.get(`${path}?item_id=${item.id}`),
                200,
            )
        ).data;

    test('the base unit leads with 1, then each packaging unit with its quantity in base units', async () => {
        expect(await units()).toMatchObject([
            {
                code: 'TAB',
                quantity_per_unit: '1',
                is_base: true,
                entry_id: null,
            },
        ]);
        const created = await json<{ data: ItemUnit }>(
            await business.admin.post(path, {
                item_id: item.id,
                unit_id: box.id,
                quantity_per_unit: '100',
            }),
            201,
        );
        expect(created.data).toMatchObject({
            id: box.id,
            code: 'BOX',
            quantity_per_unit: '100',
            is_base: false,
        });
        expect((await units()).map((unit) => unit.code)).toEqual([
            'TAB',
            'BOX',
        ]);
    });

    test('the base unit, a second row for the same unit, and a quantity of zero are refused', async () => {
        const attempt = (unitId: string, quantity: number) =>
            business.admin.post(path, {
                item_id: item.id,
                unit_id: unitId,
                quantity_per_unit: quantity,
            });
        expect(
            Object.keys(await refused(await attempt(business.uom.id, 10))),
        ).toEqual(['unit_id']);
        expect(Object.keys(await refused(await attempt(box.id, 10)))).toEqual([
            'unit_id',
        ]);
        expect(Object.keys(await refused(await attempt(box.id, 0)))).toEqual([
            'quantity_per_unit',
        ]);
        expect(
            Object.keys(await refused(await business.admin.get(path))),
        ).toEqual(['item_id']);
        expect(
            Object.keys(
                await refused(
                    await business.admin.get(`${path}?item_id=bukan`),
                ),
            ),
        ).toEqual(['item_id']);
    });

    test('a packaging unit can be changed and deleted, and a unit still used as packaging cannot be deleted', async () => {
        const [packaging] = (await units()).filter((unit) => !unit.is_base);
        if (!packaging?.entry_id) throw new Error('Packaging unit missing.');
        expect(
            Object.keys(
                await refused(
                    await business.admin.delete(
                        `${inventoryApi}/units-of-measure/${box.id}`,
                        { version: 1 },
                    ),
                ),
            ),
        ).toEqual(['_form']);
        const changed = await json<{ data: ItemUnit }>(
            await business.admin.patch(`${path}/${packaging.entry_id}`, {
                item_id: item.id,
                unit_id: box.id,
                quantity_per_unit: 50,
                version: packaging.version,
            }),
            200,
        );
        expect(changed.data.quantity_per_unit).toBe('50');
        expect(
            (
                await business.admin.delete(`${path}/${packaging.entry_id}`, {
                    version: changed.data.version,
                })
            ).status,
        ).toBe(204);
        expect((await units()).map((unit) => unit.code)).toEqual(['TAB']);
        const [row] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from gd_m_barang_satuan where id = $1',
            [packaging.entry_id],
        );
        expect(row?.deleted).toBe(true);
    });
});
