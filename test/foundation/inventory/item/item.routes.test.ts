import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    json,
    refused,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';

type Item = {
    id: string;
    code: string;
    name: string;
    base_unit: { id: string };
    category: { id: string } | null;
    tracking_code: { id: string } | null;
    version: number;
};

// Barang: profil pelacakan bawaan dari kategori, dan yang terkunci begitu barang punya kartu gudang.
describe.skipIf(!process.env.DB_HOST)('inventory items', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    const path = `${inventoryApi}/items`;
    let business: Business;
    let location: { id: string };
    let lot: { id: string };
    let plain: { id: string };
    afterAll(close);

    beforeAll(async () => {
        business = await createBusiness(pool, browser, 'Klinik Uji Barang');
        location = await business.location('GUDANG');
        lot = await business.trackingCode('LOT', { batch_required: true });
        plain = await business.trackingCode('BEBAS', {});
    });

    const change = (item: Item, body: Record<string, unknown>) =>
        business.admin.patch(`${path}/${item.id}`, {
            code: item.code,
            name: item.name,
            base_unit_id: item.base_unit.id,
            category_id: item.category?.id ?? null,
            version: item.version,
            ...body,
        });

    test('a new item takes the tracking profile of its category unless one is given', async () => {
        const category = await json<{ data: { id: string } }>(
            await business.admin.post(`${inventoryApi}/item-categories`, {
                code: 'OBAT',
                name: 'Obat',
                tracking_code_id: lot.id,
            }),
            201,
        );
        const inherited = await business.item<Item>('KAT-1', {
            category_id: category.data.id,
        });
        expect(inherited.tracking_code?.id).toBe(lot.id);
        const chosen = await business.item<Item>('KAT-2', {
            category_id: category.data.id,
            tracking_code_id: null,
        });
        expect(chosen.tracking_code).toBeNull();
    });

    test('the tracking profile changes freely until the first entry, then is refused', async () => {
        const item = await business.item<Item>('LACAK-1', {
            tracking_code_id: lot.id,
        });
        const changed = await json<{ data: Item }>(
            await change(item, { tracking_code_id: plain.id }),
            200,
        );
        expect(changed.data.tracking_code?.id).toBe(plain.id);
        await business.posted('masuk', location.id, [
            { item_id: item.id, quantity: 2, unit_cost: 100 },
        ]);
        expect(
            Object.keys(
                await refused(
                    await change(changed.data, { tracking_code_id: lot.id }),
                ),
            ),
        ).toEqual(['tracking_code_id']);
        const renamed = await json<{ data: Item }>(
            await change(changed.data, { name: 'Nama baru' }),
            200,
        );
        expect(renamed.data.tracking_code?.id).toBe(plain.id);
        expect(renamed.data.name).toBe('Nama baru');
    });

    test('the base unit is refused while the item has open entries and allowed once they close', async () => {
        const box = await json<{ data: { id: string } }>(
            await business.admin.post(`${inventoryApi}/units-of-measure`, {
                code: 'BOX',
                name: 'Kotak',
            }),
            201,
        );
        const item = await business.item<Item>('SATUAN-1');
        await business.posted('masuk', location.id, [
            { item_id: item.id, quantity: 4, unit_cost: 100 },
        ]);
        expect(
            Object.keys(
                await refused(
                    await change(item, { base_unit_id: box.data.id }),
                ),
            ),
        ).toEqual(['base_unit_id']);
        await business.posted('keluar', location.id, [
            { item_id: item.id, quantity: 4 },
        ]);
        const changed = await json<{ data: Item }>(
            await change(item, { base_unit_id: box.data.id }),
            200,
        );
        expect(changed.data.base_unit.id).toBe(box.data.id);
    });

    test('a profile keeps its batch requirement once an item using it has entries', async () => {
        const profile = await business.trackingCode('KUNCI', {
            batch_required: true,
        });
        const item = await business.item('PROFIL-1', {
            tracking_code_id: profile.id,
        });
        await business.posted('masuk', location.id, [
            {
                item_id: item.id,
                quantity: 1,
                unit_cost: 1,
                batch_number: 'p1',
            },
        ]);
        const profilePath = `${inventoryApi}/item-tracking-codes/${profile.id}`;
        const update = (flags: Record<string, boolean>, version: number) =>
            business.admin.patch(profilePath, {
                code: 'KUNCI',
                name: 'Profil KUNCI',
                version,
                ...flags,
            });
        expect(
            Object.keys(
                await refused(await update({ batch_required: false }, 1)),
            ),
        ).toEqual(['batch_required']);
        const strict = await json<{ data: { strict_expiry: boolean } }>(
            await update({ batch_required: true, strict_expiry: true }, 1),
            200,
        );
        expect(strict.data.strict_expiry).toBe(true);
    });

    test('an item with entries cannot be deleted, an unused one can, and blocking stops its postings', async () => {
        const used = await business.item<Item>('HAPUS-1');
        await business.posted('masuk', location.id, [
            { item_id: used.id, quantity: 1, unit_cost: 1 },
        ]);
        expect(
            Object.keys(
                await refused(
                    await business.admin.delete(`${path}/${used.id}`, {
                        version: used.version,
                    }),
                ),
            ),
        ).toEqual(['_form']);
        const blocked = await json<{ data: Item }>(
            await change(used, { is_blocked: true }),
            200,
        );
        expect(
            Object.keys(
                await refused(
                    await business.adjust('keluar', location.id, [
                        { item_id: blocked.data.id, quantity: 1 },
                    ]),
                ),
            ),
        ).toEqual(['lines.0.item_id']);
        const unused = await business.item<Item>('HAPUS-2');
        expect(
            (
                await business.admin.delete(`${path}/${unused.id}`, {
                    version: unused.version,
                })
            ).status,
        ).toBe(204);
    });

    test('the list shows stock, whether the item is locked by entries, what its profile asks for, and filters blocked items', async () => {
        const stocked = await business.item<Item>('DAFTAR-1', {
            tracking_code_id: lot.id,
        });
        await business.posted('masuk', location.id, [
            {
                item_id: stocked.id,
                quantity: 7,
                batch_number: 'D1',
                unit_cost: 1,
            },
        ]);
        const fresh = await business.item<Item>('DAFTAR-2');
        await json(await change(fresh, { is_blocked: true }), 200);
        type Row = {
            code: string;
            inventory: string;
            has_entries: boolean;
            batch_required: boolean;
            expiry_required: boolean;
        };
        const list = async (query: string) =>
            (
                await json<{ data: Row[] }>(
                    await business.admin.get(`${path}?q=DAFTAR${query}`),
                    200,
                )
            ).data.map((row) => [
                row.code,
                row.inventory,
                row.has_entries,
                row.batch_required,
                row.expiry_required,
            ]);
        expect(await list('')).toEqual([
            ['DAFTAR-1', '7', true, true, false],
            ['DAFTAR-2', '0', false, false, false],
        ]);
        expect((await list('&blocked=false')).map(([code]) => code)).toEqual([
            'DAFTAR-1',
        ]);
    });
});
