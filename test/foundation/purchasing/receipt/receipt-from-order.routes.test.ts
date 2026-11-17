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

type Reference = { id: string; code: string; name: string };
type OrderLine = {
    id: string;
    quantity: string;
    quantity_received: string;
    outstanding_quantity: string;
    item: Reference;
    unit: Reference;
};
type Order = {
    id: string;
    number: string;
    status: string;
    version: number;
    lines: OrderLine[];
};
type ReceiptLine = {
    id: string;
    quantity: string;
    unit_cost: string;
    order_line_id: string | null;
    order_outstanding: string | null;
    item: Reference;
    unit: Reference;
};
type Receipt = {
    id: string;
    number: string;
    status: string;
    version: number;
    vendor: { id: string };
    location: Reference;
    order: { id: string; number: string } | null;
    lines: ReceiptLine[];
};
type Refusal = {
    errors: Record<string, string[]>;
    actions?: { kind: string; label: string; page: string; recordId: string }[];
};

const orders = '/api/v1/purchasing/orders';
const receipts = '/api/v1/purchasing/receipts';

// Penerimaan dari purchase order, pola BC: Terima barang membuat draf berisi sisa order, posting menambah jumlah
// diterima di baris order sampai ordernya selesai, batal posting menguranginya lagi, dan penerimaan tidak pernah melebihi
// order. Jumlah diterima dan status order dibaca dengan SQL langsung.
describe.skipIf(!process.env.DB_HOST)('receipts from purchase orders', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let location: { id: string };
    let medicine: { id: string };
    let plain: { id: string };
    let box: Reference;
    let vendor: { id: string };

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Terima Order',
            [
                ...inventoryDuties,
                'core.vendor.manage',
                'core.purchase-order.manage',
                'core.purchase-receipt.manage',
            ],
        );
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
        plain = await business.item('KASA');
        vendor = await created('/api/v1/purchasing/vendors', {
            name: 'PBF Uji Terima',
        });
    });

    async function releasedOrder(quantity = 3) {
        const order = (
            await json<{ data: Order }>(
                await business.admin.post(orders, {
                    vendor_id: vendor.id,
                    location_id: location.id,
                    order_date: '2026-11-10',
                    lines: [
                        {
                            item_id: medicine.id,
                            unit_id: box.id,
                            quantity,
                            unit_cost: 150000,
                            discount_percent: 10,
                        },
                        {
                            item_id: plain.id,
                            unit_id: business.uom.id,
                            quantity: 20,
                            unit_cost: 500,
                        },
                    ],
                }),
                201,
            )
        ).data;
        return (
            await json<{ data: Order }>(
                await business.admin.post(`${orders}/${order.id}/release`, {
                    version: order.version,
                }),
                200,
            )
        ).data;
    }
    const receive = (order: { id: string }) =>
        business.admin.post(`${orders}/${order.id}/receipts`, {
            posting_date: '2026-11-12',
        });
    const drafted = async (order: { id: string }) =>
        (await json<{ data: Receipt }>(await receive(order), 201)).data;
    const body = (receipt: Receipt, lines: Record<string, unknown>[]) => ({
        vendor_id: receipt.vendor.id,
        location_id: receipt.location.id,
        posting_date: '2026-11-12',
        lines,
        version: receipt.version,
    });
    const lineOf = (
        line: ReceiptLine,
        overrides: Record<string, unknown> = {},
    ) => ({
        id: line.id,
        item_id: line.item.id,
        unit_id: line.unit.id,
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        order_line_id: line.order_line_id,
        ...overrides,
    });
    const save = async (receipt: Receipt, lines: Record<string, unknown>[]) =>
        (
            await json<{ data: Receipt }>(
                await business.admin.patch(
                    `${receipts}/${receipt.id}`,
                    body(receipt, lines),
                ),
                200,
            )
        ).data;
    const post = (receipt: Receipt) =>
        business.admin.post(`${receipts}/${receipt.id}/post`, {
            version: receipt.version,
        });
    const reverse = (receipt: Receipt) =>
        business.admin.post(`${receipts}/${receipt.id}/reverse`, {
            version: receipt.version,
        });
    async function state(orderId: string) {
        const rows = await pool.unsafe<
            { status: string; closed: boolean; received: string[] }[]
        >(
            `select h.status, h.selesai_pada is not null as closed,
                    array_agg(trim_scale(d.jumlah_diterima)::text order by d.urutan) as received
             from bl_tr_order h join bl_tr_order_detail d on d.order_id = h.id and d.deleted_at is null
             where h.id = $1 group by h.status, h.selesai_pada`,
            [orderId],
        );
        return rows[0];
    }

    test('receiving fills a draft with what is outstanding, partial receipts add up, and the full receipt closes the order', async () => {
        const order = await releasedOrder();
        const first = await drafted(order);
        expect(first.order?.number).toBe(order.number);
        expect(first.status).toBe('draf');
        expect(
            first.lines.map((line) => [line.quantity, line.order_outstanding]),
        ).toEqual([
            ['3', '3'],
            ['20', '20'],
        ]);

        const [boxes, gauze] = first.lines;
        if (!boxes || !gauze) throw new Error('Draft lines missing.');
        const partial = await save(first, [
            lineOf(boxes, { quantity: 2 }),
            lineOf(gauze),
        ]);
        expect((await post(partial)).status).toBe(200);
        expect(await state(order.id)).toEqual({
            status: 'dirilis',
            closed: false,
            received: ['2', '20'],
        });
        const ledger = await pool.unsafe<{ quantity: string }[]>(
            `select trim_scale(jumlah)::text as quantity from gd_tr_kartu_gudang
             where sumber_jenis = 'penerimaan' and sumber_id = $1 order by id`,
            [first.id],
        );
        expect(ledger.map((row) => row.quantity)).toEqual(['200', '20']);

        const second = await drafted(order);
        expect(second.lines.map((line) => line.quantity)).toEqual(['1']);
        const closing = (await json<{ data: Receipt }>(await post(second), 200))
            .data;
        expect(await state(order.id)).toEqual({
            status: 'selesai',
            closed: true,
            received: ['3', '20'],
        });
        expect((await refused(await receive(order)))._form?.[0]).toContain(
            'sudah diterima',
        );

        expect((await reverse(closing)).status).toBe(200);
        expect(await state(order.id)).toEqual({
            status: 'dirilis',
            closed: false,
            received: ['2', '20'],
        });
    });

    test('a receipt cannot take more than is outstanding on the order', async () => {
        const order = await releasedOrder();
        const draft = await drafted(order);
        const [boxes, gauze] = draft.lines;
        if (!boxes || !gauze) throw new Error('Draft lines missing.');
        const over = await save(draft, [
            lineOf(boxes, { quantity: 4 }),
            lineOf(gauze),
        ]);
        const errors = await refused(await post(over));
        expect(errors['lines.0.quantity']?.[0]).toContain(
            'melebihi sisa order (3 BOX)',
        );
        expect(await state(order.id)).toEqual({
            status: 'dirilis',
            closed: false,
            received: ['0', '0'],
        });
    });

    test('a receipt from an order keeps the vendor, the location, and the order lines', async () => {
        const order = await releasedOrder();
        const draft = await drafted(order);
        const lines = draft.lines.map((line) => lineOf(line));
        const extra = await refused(
            await business.admin.patch(
                `${receipts}/${draft.id}`,
                body(draft, [
                    ...lines,
                    { item_id: plain.id, quantity: 1, unit_cost: 500 },
                ]),
            ),
        );
        expect(extra['lines.2.item_id']?.[0]).toContain(
            'hanya berisi barang order itu',
        );
        const other = await json<{ data: { id: string } }>(
            await business.admin.post('/api/v1/purchasing/vendors', {
                name: 'PBF Lain',
            }),
            201,
        );
        const moved = await refused(
            await business.admin.patch(`${receipts}/${draft.id}`, {
                ...body(draft, lines),
                vendor_id: other.data.id,
            }),
        );
        expect(moved.vendor_id?.[0]).toContain('sama dengan vendor ordernya');
    });

    test('an open order cannot be received, and a second draft points to the first', async () => {
        const open = (
            await json<{ data: Order }>(
                await business.admin.post(orders, {
                    vendor_id: vendor.id,
                    location_id: location.id,
                    order_date: '2026-11-10',
                    lines: [{ item_id: plain.id, quantity: 1, unit_cost: 500 }],
                }),
                201,
            )
        ).data;
        expect((await refused(await receive(open)))._form?.[0]).toContain(
            'belum dirilis',
        );

        const order = await releasedOrder();
        const draft = await drafted(order);
        const second = await json<Refusal>(await receive(order), 422);
        expect(second.errors._form?.[0]).toContain(draft.number);
        expect(second.actions).toEqual([
            {
                kind: 'open',
                label: `Buka penerimaan ${draft.number}`,
                page: 'core.purchase-receipt',
                recordId: draft.id,
            },
        ]);
    });

    test('posting a receipt of a reopened order is refused with a way to open the order', async () => {
        const order = await releasedOrder();
        const draft = await drafted(order);
        await json(
            await business.admin.post(`${orders}/${order.id}/reopen`, {
                version: order.version,
            }),
            200,
        );
        const response = await json<Refusal>(await post(draft), 422);
        expect(response.errors._form?.[0]).toContain(
            'Rilis ordernya lebih dulu',
        );
        expect(response.actions?.[0]?.page).toBe('core.purchase-order');
        expect((await state(order.id))?.received).toEqual(['0', '0']);
        expect(
            (await business.admin.get(`${receipts}/${draft.id}`)).status,
        ).toBe(200);
    });

    test('a partly received order keeps its received lines when reopened and closes once reduced to what came', async () => {
        const order = await releasedOrder();
        const draft = await drafted(order);
        const [boxes, gauze] = draft.lines;
        if (!boxes || !gauze) throw new Error('Draft lines missing.');
        await json(
            await post(
                await save(draft, [
                    lineOf(boxes, { quantity: 1 }),
                    lineOf(gauze),
                ]),
            ),
            200,
        );
        const reopened = (
            await json<{ data: Order }>(
                await business.admin.post(`${orders}/${order.id}/reopen`, {
                    version: (
                        await json<{ data: Order }>(
                            await business.admin.get(`${orders}/${order.id}`),
                            200,
                        )
                    ).data.version,
                }),
                200,
            )
        ).data;
        const [orderBoxes, orderGauze] = reopened.lines;
        if (!orderBoxes || !orderGauze) throw new Error('Order lines missing.');
        const orderLine = (line: OrderLine, quantity: string) => ({
            id: line.id,
            item_id: line.item.id,
            unit_id: line.unit.id,
            quantity,
            unit_cost: 150000,
        });
        const change = (lines: Record<string, unknown>[]) =>
            business.admin.patch(`${orders}/${order.id}`, {
                vendor_id: vendor.id,
                location_id: location.id,
                order_date: '2026-11-10',
                lines,
                version: reopened.version,
            });
        const below = await refused(
            await change([
                orderLine(orderBoxes, '0.5'),
                orderLine(orderGauze, '20'),
            ]),
        );
        expect(below['lines.0.quantity']?.[0]).toContain('sudah diterima (1)');
        const dropped = await refused(
            await change([orderLine(orderBoxes, '1')]),
        );
        expect(dropped.lines?.[0]).toContain('tidak bisa dihapus');
        expect(
            (
                await refused(
                    await business.admin.delete(`${orders}/${order.id}`, {
                        version: reopened.version,
                    }),
                )
            )._form?.[0],
        ).toContain('sudah diterima');

        const reduced = (
            await json<{ data: Order }>(
                await change([
                    orderLine(orderBoxes, '1'),
                    orderLine(orderGauze, '20'),
                ]),
                200,
            )
        ).data;
        expect(await state(order.id)).toEqual({
            status: 'terbuka',
            closed: false,
            received: ['1', '20'],
        });
        await json(
            await business.admin.post(`${orders}/${order.id}/release`, {
                version: reduced.version,
            }),
            200,
        );
        expect(await state(order.id)).toEqual({
            status: 'selesai',
            closed: true,
            received: ['1', '20'],
        });
    });
});
