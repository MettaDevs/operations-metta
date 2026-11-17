import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    inventoryDuties,
    json,
    refused,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import { documentText } from '../../../support/receipt-fixture.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Reference = { id: string; code: string; name: string };
type Order = {
    id: string;
    number: string;
    status: string;
    amount: string;
    vat_amount: string;
    expected_receipt_date: string | null;
    version: number;
    lines: {
        id: string;
        unit: Reference;
        quantity_per_unit: string;
        amount: string;
        expected_receipt_date: string | null;
    }[];
};
type Line = Record<string, unknown>;

const path = '/api/v1/purchasing/orders';

// Purchase order: baris dalam satuan beli, nilai sesudah diskon dan PPN, Rilis yang mengunci isi order dan Buka lagi
// yang membukanya, penolakan ubah dan hapus order dirilis, cetak, dan izin. Status diperiksa dengan SQL langsung.
describe.skipIf(!process.env.DB_HOST)('purchase orders', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let location: { id: string };
    let medicine: { id: string };
    let box: Reference;
    let vendor: { id: string; version: number };

    beforeAll(async () => {
        business = await createBusiness(pool, browser, 'Klinik Uji Order', [
            ...inventoryDuties,
            'core.vendor.manage',
            'core.purchase-order.manage',
        ]);
        const created = async <T = Reference>(
            route: string,
            body: Record<string, unknown>,
        ) =>
            (
                await json<{ data: T }>(
                    await business.admin.post(route, body),
                    201,
                )
            ).data;
        location = await business.location('GUDANG');
        box = await created(`${inventoryApi}/units-of-measure`, {
            code: 'BOX',
            name: 'Kotak',
        });
        medicine = await business.item('AMX');
        await created(`${inventoryApi}/item-units`, {
            item_id: medicine.id,
            unit_id: box.id,
            quantity_per_unit: 100,
        });
        vendor = await created('/api/v1/purchasing/vendors', {
            name: 'PBF Uji Order',
        });
    });

    const line = (overrides: Line = {}): Line => ({
        item_id: medicine.id,
        unit_id: box.id,
        quantity: 3,
        unit_cost: 150000,
        discount_percent: 10,
        vat_percent: 11,
        ...overrides,
    });
    const create = (lines: Line[], overrides: Line = {}) =>
        business.admin.post(path, {
            vendor_id: vendor.id,
            location_id: location.id,
            order_date: '2026-11-17',
            expected_receipt_date: '2026-11-20',
            lines,
            ...overrides,
        });
    const draft = async (lines: Line[]) =>
        (await json<{ data: Order }>(await create(lines), 201)).data;
    const act = (order: Order, action: 'release' | 'reopen') =>
        business.admin.post(`${path}/${order.id}/${action}`, {
            version: order.version,
        });
    const status = async (id: string) =>
        (
            await pool.unsafe<{ status: string; released: boolean }[]>(
                `select status, dirilis_pada is not null as released from bl_tr_order where id = $1`,
                [id],
            )
        )[0];

    test('an order is numbered, valued after discount with VAT, and lines without a date follow the header', async () => {
        const order = await draft([
            line(),
            line({ quantity: 1, expected_receipt_date: '2026-11-25' }),
        ]);
        expect(order.number).toMatch(/^PO-\d{8}$/);
        expect(order.status).toBe('terbuka');
        // 3 x 150.000 x 90% + 1 x 150.000 x 90% = 540.000; PPN 11% = 59.400.
        expect(order.amount).toBe('540000');
        expect(order.vat_amount).toBe('59400');
        expect(order.lines.map((row) => row.expected_receipt_date)).toEqual([
            null,
            '2026-11-25',
        ]);
        expect(await status(order.id)).toEqual({
            status: 'terbuka',
            released: false,
        });
    });

    test('a line without a unit takes the purchase unit of the item', async () => {
        const order = await draft([line({ unit_id: null })]);
        expect(order.lines[0]?.unit.code).toBe('TAB');
        expect(order.lines[0]?.quantity_per_unit).toBe('1');
    });

    test('lines are checked like a receipt: quantity above zero and a unit of the item', async () => {
        const errors = await refused(
            await create([line({ quantity: 0, unit_id: business.uom.id })]),
        );
        expect(Object.keys(errors).sort()).toEqual(['lines.0.quantity']);
        const other = await refused(
            await create([line()], { vendor_id: location.id }),
        );
        expect(other.vendor_id).toEqual(['Pilih vendor dari daftar.']);
    });

    test('release locks the order, refuses changes and deletion, and reopen unlocks it', async () => {
        const order = await draft([line()]);
        const released = (
            await json<{ data: Order }>(await act(order, 'release'), 200)
        ).data;
        expect(released.status).toBe('dirilis');
        expect(await status(order.id)).toEqual({
            status: 'dirilis',
            released: true,
        });

        // Rilis yang diulang dengan versi lama menjawab order yang sama tanpa menulis apa pun.
        expect((await act(order, 'release')).status).toBe(200);

        const update = await refused(
            await business.admin.patch(`${path}/${order.id}`, {
                vendor_id: vendor.id,
                location_id: location.id,
                order_date: '2026-11-17',
                lines: [line({ quantity: 9 })],
                version: released.version,
            }),
        );
        expect(update._form?.[0]).toContain('Buka lagi');
        const removal = await refused(
            await business.admin.delete(`${path}/${order.id}`, {
                version: released.version,
            }),
        );
        expect(removal._form?.[0]).toContain('Buka lagi');

        const reopened = (
            await json<{ data: Order }>(await act(released, 'reopen'), 200)
        ).data;
        expect(reopened.status).toBe('terbuka');
        expect(await status(order.id)).toEqual({
            status: 'terbuka',
            released: false,
        });
        expect(
            (
                await business.admin.delete(`${path}/${order.id}`, {
                    version: reopened.version,
                })
            ).status,
        ).toBe(204);
        expect((await business.admin.get(`${path}/${order.id}`)).status).toBe(
            404,
        );
    });

    test('an order without lines cannot be released', async () => {
        const order = await draft([]);
        const errors = await refused(await act(order, 'release'));
        expect(errors.lines).toEqual([
            'Tambahkan sedikitnya satu barang sebelum order dirilis.',
        ]);
        expect((await status(order.id))?.status).toBe('terbuka');
    });

    test('an order for a vendor set inactive after saving cannot be released', async () => {
        const make = await json<{ data: { id: string; version: number } }>(
            await business.admin.post('/api/v1/purchasing/vendors', {
                name: 'PBF Uji Nonaktif',
            }),
            201,
        );
        const order = (
            await json<{ data: Order }>(
                await create([line()], { vendor_id: make.data.id }),
                201,
            )
        ).data;
        await pool.unsafe(
            `update vendors set status = 'inactive' where id = $1`,
            [make.data.id],
        );
        const errors = await refused(await act(order, 'release'));
        expect(errors.vendor_id?.[0]).toContain('nonaktif');
        expect((await status(order.id))?.status).toBe('terbuka');
    });

    test('the printed order shows the vendor, the delivery location, and the total with VAT', async () => {
        const order = await draft([line()]);
        await json(await act(order, 'release'), 200);
        const response = await business.admin.get(
            `/api/v1/reports/core.purchase-order/records/${order.id}?format=docx`,
        );
        expect(response.status).toBe(200);
        const text = documentText(new Uint8Array(await response.arrayBuffer()));
        expect(text).toContain('PURCHASE ORDER');
        expect(text).toContain(order.number);
        expect(text).toContain('PBF Uji Order');
        expect(text).toContain('Lokasi GUDANG');
        expect(text).not.toContain('BELUM DIRILIS');
    });

    test('a member without the order duty can neither read nor print orders', async () => {
        const order = await draft([line()]);
        const member = await createMember(pool, business.tenantId, [
            'core.vendor.manage',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            member.membershipId,
        );
        const other = browser();
        await other.login(member.email, member.password);
        expect((await other.get(path)).status).toBe(403);
        expect(
            (
                await other.get(
                    `/api/v1/reports/core.purchase-order/records/${order.id}?format=docx`,
                )
            ).status,
        ).toBe(403);
    });
});
