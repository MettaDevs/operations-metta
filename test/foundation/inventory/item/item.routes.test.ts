import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    json,
    refused,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import { setCurrencyPrecision } from '../../../support/tenant-fixtures.ts';

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

    test('the base price follows the unit price precision of the currency, is kept when a caller does not send it, and a negative or malformed one is refused', async () => {
        const item = await business.item<Item & { base_price: string }>(
            'HARGA-1',
            { base_price: '1250' },
        );
        // Tenant baru memakai rupiah utuh, jadi harga dasar tanpa angka di belakang koma.
        expect(
            await refused(await change(item, { base_price: '1250.5' })),
        ).toEqual({
            base_price: [
                'Isi harga dasar 0 atau lebih, tanpa angka di belakang koma.',
            ],
        });
        await setCurrencyPrecision(pool, business.tenantId, {
            amount_decimals: 2,
            unit_amount_decimals: 4,
            invoice_rounding_precision: '0',
            invoice_rounding_type: 'nearest',
        });
        const priced = await json<{ data: Item & { base_price: string } }>(
            await change(item, { base_price: '1250.5' }),
            200,
        );
        expect(priced.data.base_price).toBe('1250.5');
        const renamed = await json<{ data: Item & { base_price: string } }>(
            await change(priced.data, { name: 'Harga tetap' }),
            200,
        );
        expect(renamed.data.base_price).toBe('1250.5');
        for (const base_price of [-1, 'murah', '1.00001'])
            expect(
                Object.keys(
                    await refused(await change(renamed.data, { base_price })),
                ),
            ).toEqual(['base_price']);
        const [stored] = await pool.unsafe<{ price: string }[]>(
            'select trim_scale(harga_dasar)::text as price from gd_m_barang where id = $1',
            [item.id],
        );
        expect(stored?.price).toBe('1250.5');
    });

    test('the KFA code is saved trimmed, kept when a caller does not send it, cleared with null or blank, and refused unless it is up to 20 digits', async () => {
        type Coded = Item & { kfa_code: string | null };
        const kfaRefused = {
            kfa_code: [
                'Isi kode KFA dengan angka saja, paling banyak 20 angka.',
            ],
        };
        expect((await business.item<Coded>('KFA-0')).kfa_code).toBeNull();
        const item = await business.item<Coded>('KFA-1', {
            kfa_code: ' 93001019 ',
        });
        expect(item.kfa_code).toBe('93001019');
        const renamed = await json<{ data: Coded }>(
            await change(item, { name: 'Nama baru' }),
            200,
        );
        expect(renamed.data.kfa_code).toBe('93001019');
        for (const kfa_code of ['9300-1019', 'KFA93001019', '1'.repeat(21), 93])
            expect(
                await refused(await change(renamed.data, { kfa_code })),
            ).toEqual(kfaRefused);
        const cleared = await json<{ data: Coded }>(
            await change(renamed.data, { kfa_code: null }),
            200,
        );
        expect(cleared.data.kfa_code).toBeNull();
        const typed = await json<{ data: Coded }>(
            await change(cleared.data, { kfa_code: '1'.repeat(20) }),
            200,
        );
        const blanked = await json<{ data: Coded }>(
            await change(typed.data, { kfa_code: '  ' }),
            200,
        );
        const [stored] = await pool.unsafe<{ kode_kfa: string | null }[]>(
            'select kode_kfa from gd_m_barang where id = $1',
            [blanked.data.id],
        );
        expect(stored).toEqual({ kode_kfa: null });
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

    test("an item's batches load in batches, nearest expiry first and undated last, and are searched by number", async () => {
        const item = await business.item<Item>('BATCH-1', {
            tracking_code_id: lot.id,
        });
        const receipt = (batch_number: string, expiry_date: string | null) => ({
            item_id: item.id,
            quantity: 1,
            unit_cost: 1,
            batch_number,
            expiry_date,
        });
        await business.posted('masuk', location.id, [
            receipt('Z300', '2027-09-30'),
            receipt('X100', null),
            receipt('Y200', '2027-01-31'),
        ]);
        type Page = {
            data: {
                id: string;
                batch_number: string;
                expiry_date: string | null;
            }[];
            next_cursor: string | null;
        };
        const page = async (query: string) =>
            json<Page>(
                await business.admin.get(`${path}/${item.id}/batches?${query}`),
                200,
            );
        const first = await page('per_page=2');
        expect(first.data).toEqual([
            {
                id: expect.any(String),
                batch_number: 'Y200',
                expiry_date: '2027-01-31',
            },
            {
                id: expect.any(String),
                batch_number: 'Z300',
                expiry_date: '2027-09-30',
            },
        ]);
        expect(first.next_cursor).not.toBeNull();
        const rest = await page(`per_page=2&cursor=${first.next_cursor ?? ''}`);
        expect(rest.data.map((batch) => batch.batch_number)).toEqual(['X100']);
        expect(rest.next_cursor).toBeNull();
        expect(
            (await page('q=z3')).data.map((batch) => batch.batch_number),
        ).toEqual(['Z300']);
    });

    test('the list shows stock, which entries lock the item, what its profile asks for, and filters blocked items', async () => {
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
        const emptied = await business.item<Item>('DAFTAR-3');
        await business.posted('masuk', location.id, [
            { item_id: emptied.id, quantity: 2, unit_cost: 1 },
        ]);
        await business.posted('keluar', location.id, [
            { item_id: emptied.id, quantity: 2 },
        ]);
        type Row = {
            code: string;
            inventory: string;
            has_entries: boolean;
            has_open_entries: boolean;
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
                row.has_open_entries,
                row.batch_required,
                row.expiry_required,
            ]);
        expect(await list('')).toEqual([
            ['DAFTAR-1', '7', true, true, true, false],
            ['DAFTAR-2', '0', false, false, false, false],
            ['DAFTAR-3', '0', true, false, false, false],
        ]);
        expect((await list('&blocked=false')).map(([code]) => code)).toEqual([
            'DAFTAR-1',
            'DAFTAR-3',
        ]);
    });

    describe('purchase and sales units', () => {
        type DefaultUnit = { code: string; quantity_per_unit: string };
        type UnitItem = Item & {
            purchase_unit: DefaultUnit;
            sales_unit: DefaultUnit;
        };
        let box: { id: string };
        let strip: { id: string };
        let bottle: { id: string };
        let item: UnitItem;
        let boxEntry: { entry_id: string; version: number };
        const entryPath = () =>
            `${inventoryApi}/item-units/${boxEntry.entry_id}`;
        const stored = async () =>
            (
                await pool.unsafe<
                    { purchase: string | null; sales: string | null }[]
                >(
                    'select satuan_beli_id as purchase, satuan_jual_id as sales from gd_m_barang where id = $1',
                    [item.id],
                )
            )[0];

        beforeAll(async () => {
            const unit = async (code: string) =>
                (
                    await json<{ data: { id: string } }>(
                        await business.admin.post(
                            `${inventoryApi}/units-of-measure`,
                            { code, name: `Satuan ${code}` },
                        ),
                        201,
                    )
                ).data;
            [box, strip, bottle] = await Promise.all([
                unit('KTK'),
                unit('STR'),
                unit('BTL'),
            ]);
        });

        test('a new item takes the base unit for both and refuses a packaging unit it cannot have yet', async () => {
            item = await business.item<UnitItem>('BAWAAN-1');
            expect([item.purchase_unit, item.sales_unit]).toMatchObject([
                { code: 'TAB', quantity_per_unit: '1' },
                { code: 'TAB', quantity_per_unit: '1' },
            ]);
            expect(
                Object.keys(
                    await refused(
                        await business.admin.post(path, {
                            code: 'BAWAAN-2',
                            name: 'Barang BAWAAN-2',
                            base_unit_id: business.uom.id,
                            purchase_unit_id: box.id,
                        }),
                    ),
                ),
            ).toEqual(['purchase_unit_id']);
        });

        test('only packaging units of the item are accepted, and a caller that does not send them keeps them', async () => {
            const packaging = async (unitId: string, quantity: number) =>
                (
                    await json<{
                        data: { entry_id: string; version: number };
                    }>(
                        await business.admin.post(
                            `${inventoryApi}/item-units`,
                            {
                                item_id: item.id,
                                unit_id: unitId,
                                quantity_per_unit: quantity,
                            },
                        ),
                        201,
                    )
                ).data;
            boxEntry = await packaging(box.id, 100);
            await packaging(strip.id, 10);
            expect(
                Object.keys(
                    await refused(
                        await change(item, {
                            purchase_unit_id: bottle.id,
                            sales_unit_id: 'bukan-id',
                        }),
                    ),
                ).sort(),
            ).toEqual(['purchase_unit_id', 'sales_unit_id']);
            const chosen = await json<{ data: UnitItem }>(
                await change(item, {
                    purchase_unit_id: box.id,
                    sales_unit_id: strip.id,
                }),
                200,
            );
            expect([
                chosen.data.purchase_unit,
                chosen.data.sales_unit,
            ]).toMatchObject([
                { code: 'KTK', quantity_per_unit: '100' },
                { code: 'STR', quantity_per_unit: '10' },
            ]);
            item = (
                await json<{ data: UnitItem }>(
                    await change(chosen.data, {}),
                    200,
                )
            ).data;
            expect(item.purchase_unit.code).toBe('KTK');
            expect(await stored()).toEqual({
                purchase: box.id,
                sales: strip.id,
            });
        });

        test('a packaging unit in use cannot be deleted or swapped, only resized, until the base unit is chosen again', async () => {
            expect(
                await refused(
                    await business.admin.delete(entryPath(), {
                        version: boxEntry.version,
                    }),
                ),
            ).toEqual({
                unit_id: [
                    'Satuan ini satuan beli barang ini, jadi tidak bisa dihapus. Ganti satuan belinya di kartu barang lebih dulu.',
                ],
            });
            expect(
                Object.keys(
                    await refused(
                        await business.admin.patch(entryPath(), {
                            item_id: item.id,
                            unit_id: bottle.id,
                            quantity_per_unit: 100,
                            version: boxEntry.version,
                        }),
                    ),
                ),
            ).toEqual(['unit_id']);
            const resized = await json<{ data: { version: number } }>(
                await business.admin.patch(entryPath(), {
                    item_id: item.id,
                    unit_id: box.id,
                    quantity_per_unit: 50,
                    version: boxEntry.version,
                }),
                200,
            );
            const based = await json<{ data: UnitItem }>(
                await change(item, {
                    purchase_unit_id: business.uom.id,
                    sales_unit_id: null,
                }),
                200,
            );
            expect(based.data.purchase_unit).toMatchObject({
                code: 'TAB',
                quantity_per_unit: '1',
            });
            expect(await stored()).toEqual({ purchase: null, sales: null });
            expect(
                (
                    await business.admin.delete(entryPath(), {
                        version: resized.data.version,
                    })
                ).status,
            ).toBe(204);
        });
    });
});
