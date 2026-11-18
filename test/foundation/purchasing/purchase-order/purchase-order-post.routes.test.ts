import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    inventoryDuties,
    json,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';

type Reference = { id: string; code: string; name: string };
type OrderLine = {
    id: string;
    quantity_received: string;
    quantity_invoiced: string;
    outstanding_quantity: string;
    quantity_to_receive: string | null;
    quantity_to_invoice: string | null;
    batch_number: string | null;
    item: Reference & { batch_required: boolean; expiry_required: boolean };
};
type Order = {
    id: string;
    number: string;
    status: string;
    version: number;
    lines: OrderLine[];
};
type Posted = {
    data: Order;
    posted: {
        receipt: { id: string; number: string } | null;
        invoice: { id: string; number: string } | null;
    };
};
type Refusal = { errors: Record<string, string[]> };
type PostLine = {
    quantity_to_receive?: number;
    quantity_to_invoice?: number;
    batch_number?: string;
    expiry_date?: string;
};

const orders = '/api/v1/purchasing/orders';

describe.skipIf(!process.env.DB_HOST)('posting from a purchase order', () => {
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
            'Klinik Uji Posting PO',
            [
                ...inventoryDuties,
                'core.vendor.manage',
                'core.purchase-order.manage',
                'core.purchase-receipt.manage',
                'core.purchase-invoice.manage',
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
        const tracked = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        medicine = await business.item('AMX', {
            tracking_code_id: tracked.id,
        });
        await created(`${inventoryApi}/item-units`, {
            item_id: medicine.id,
            unit_id: box.id,
            quantity_per_unit: 100,
        });
        plain = await business.item('KASA');
        vendor = await created('/api/v1/purchasing/vendors', {
            name: 'PBF Uji Posting',
        });
    });

    async function releasedOrder() {
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
                            quantity: 5,
                            unit_cost: 150000,
                            discount_percent: 10,
                        },
                        {
                            item_id: plain.id,
                            unit_id: business.uom.id,
                            quantity: 20,
                            unit_cost: 500,
                            vat_percent: 11,
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
    const savePosting = (
        order: Order,
        lines: PostLine[],
        vendorInvoiceNumber: string | null = null,
    ) =>
        business.admin.patch(`${orders}/${order.id}/posting`, {
            posting_date: '2026-11-12',
            vendor_invoice_number: vendorInvoiceNumber,
            version: order.version,
            lines: order.lines.map((line, index) => ({
                id: line.id,
                ...lines[index],
            })),
        });
    const show = async (order: Order) =>
        (
            await json<{ data: Order }>(
                await business.admin.get(`${orders}/${order.id}`),
                200,
            )
        ).data;
    async function post(
        order: Order,
        mode: string,
        lines: PostLine[],
        vendorInvoiceNumber: string | null = null,
    ) {
        const current = await show(order);
        const saved = await savePosting(current, lines, vendorInvoiceNumber);
        if (saved.status !== 200) return saved;
        const { data } = (await saved.json()) as { data: Order };
        return business.admin.post(`${orders}/${order.id}/post`, {
            mode,
            version: data.version,
        });
    }
    const lot = { batch_number: 'b-01', expiry_date: '2028-01-31' };

    async function ledger(invoiceId: string) {
        return pool.unsafe<
            { amount: string; open: string; vendor_no: string }[]
        >(
            `select trim_scale(jumlah)::text as amount, trim_scale(sisa)::text as open,
                    no_faktur_vendor as vendor_no
             from ap_tr_entri_utang where faktur_id = $1 and jenis = 'faktur'`,
            [invoiceId],
        );
    }

    test('receive 3 of 5, then receive and invoice the last 2: one invoice bills all 5 and the vendor ledger owes it', async () => {
        const order = await releasedOrder();
        const first = await json<Posted>(
            await post(order, 'receive', [
                { quantity_to_receive: 3, ...lot },
                { quantity_to_receive: 0 },
            ]),
            200,
        );
        expect(first.posted.invoice).toBeNull();
        expect(first.data.status).toBe('dirilis');
        expect(first.data.lines.map((line) => line.quantity_received)).toEqual([
            '3',
            '0',
        ]);
        expect(await business.stock(medicine.id, location.id)).toEqual({
            'B-01': 300,
        });

        const second = await json<Posted>(
            await post(
                first.data,
                'receive_and_invoice',
                [
                    { quantity_to_receive: 2, quantity_to_invoice: 5, ...lot },
                    { quantity_to_receive: 20, quantity_to_invoice: 20 },
                ],
                'FV-2026-001',
            ),
            200,
        );
        expect(second.data.status).toBe('selesai');
        expect(
            second.data.lines.map((line) => [
                line.quantity_received,
                line.quantity_invoiced,
            ]),
        ).toEqual([
            ['5', '5'],
            ['20', '20'],
        ]);
        const invoice = second.posted.invoice;
        if (!invoice) throw new Error('No invoice was posted.');
        const lines = await pool.unsafe<
            { quantity: string; receipt: string }[]
        >(
            `select trim_scale(f.jumlah)::text as quantity, r.nomor as receipt
             from ap_tr_faktur_detail f
             join bl_tr_penerimaan_detail d on d.id = f.penerimaan_detail_id
             join bl_tr_penerimaan r on r.id = d.penerimaan_id
             where f.faktur_id = $1 and f.deleted_at is null order by f.urutan`,
            [invoice.id],
        );
        expect([...lines]).toEqual([
            {
                quantity: '3',
                receipt: first.posted.receipt?.number ?? '',
            },
            {
                quantity: '2',
                receipt: second.posted.receipt?.number ?? '',
            },
            {
                quantity: '20',
                receipt: second.posted.receipt?.number ?? '',
            },
        ]);
        const owed = String(5 * 135000 + 20 * 500 + (20 * 500 * 11) / 100);
        expect([...(await ledger(invoice.id))]).toEqual([
            { amount: owed, open: owed, vendor_no: 'FV-2026-001' },
        ]);
        const vendorLedger = await json<{
            data: { document_number: string; vendor_invoice_number: string }[];
        }>(await business.admin.get('/api/v1/purchasing/vendor-ledger'), 200);
        expect(
            vendorLedger.data.some(
                (entry) =>
                    entry.document_number === invoice.number &&
                    entry.vendor_invoice_number === 'FV-2026-001',
            ),
        ).toBe(true);
    });

    test('invoice only bills what was received, and the separate receipt and invoice path keeps working on the same order', async () => {
        const order = await releasedOrder();
        const received = await json<Posted>(
            await post(order, 'receive', [
                { quantity_to_receive: 4, ...lot },
                { quantity_to_receive: 10 },
            ]),
            200,
        );
        const refused = await json<Refusal>(
            await post(
                received.data,
                'invoice',
                [{ quantity_to_invoice: 5 }, { quantity_to_invoice: 10 }],
                'FV-2026-002',
            ),
            422,
        );
        expect(Object.keys(refused.errors)).toEqual([
            'lines.0.quantity_to_invoice',
        ]);
        expect(refused.errors['lines.0.quantity_to_invoice']?.[0]).toContain(
            'Paling banyak 4',
        );

        const invoiced = await json<Posted>(
            await post(
                received.data,
                'invoice',
                [{ quantity_to_invoice: 4 }, { quantity_to_invoice: 0 }],
                'FV-2026-002',
            ),
            200,
        );
        expect(invoiced.posted.receipt).toBeNull();
        expect(
            invoiced.data.lines.map((line) => line.quantity_invoiced),
        ).toEqual(['4', '0']);

        const draft = await json<{
            data: {
                id: string;
                version: number;
                lines: { quantity: string }[];
            };
        }>(
            await business.admin.post(`${orders}/${order.id}/receipts`, {
                posting_date: '2026-11-13',
            }),
            201,
        );
        expect(draft.data.lines.map((line) => line.quantity)).toEqual([
            '1',
            '10',
        ]);
    });

    test('over-receipt, missing lot, and a missing vendor invoice number are refused on the order line and write nothing', async () => {
        const order = await releasedOrder();
        const before = await pool.unsafe<{ count: number }[]>(
            `select count(*)::int as count from bl_tr_penerimaan where order_id = $1`,
            [order.id],
        );

        const over = await json<Refusal>(
            await post(order, 'receive', [
                { quantity_to_receive: 6, ...lot },
                { quantity_to_receive: 0 },
            ]),
            422,
        );
        expect(Object.keys(over.errors)).toEqual([
            'lines.0.quantity_to_receive',
        ]);

        await json<Posted>(
            await post(order, 'receive', [
                { quantity_to_receive: 0 },
                { quantity_to_receive: 1 },
            ]),
            200,
        );
        const current = (
            await json<{ data: Order }>(
                await business.admin.get(`${orders}/${order.id}`),
                200,
            )
        ).data;
        const noLot = await json<Refusal>(
            await post(current, 'receive', [
                { quantity_to_receive: 1 },
                { quantity_to_receive: 0 },
            ]),
            422,
        );
        expect(
            Object.keys(noLot.errors).every((key) =>
                key.startsWith('lines.0.'),
            ),
        ).toBe(true);

        const noNumber = await json<Refusal>(
            await post(current, 'receive_and_invoice', [
                { quantity_to_receive: 1, quantity_to_invoice: 1, ...lot },
                { quantity_to_receive: 0, quantity_to_invoice: 0 },
            ]),
            422,
        );
        expect(Object.keys(noNumber.errors)).toEqual(['vendor_invoice_number']);

        const after = await pool.unsafe<{ count: number }[]>(
            `select count(*)::int as count from bl_tr_penerimaan where order_id = $1`,
            [order.id],
        );
        expect(after[0]?.count).toBe((before[0]?.count ?? 0) + 1);
    });

    test('saved posting quantities survive a reload, posting uses them, and posting resets them to the defaults', async () => {
        const order = await releasedOrder();
        await json<{ data: Order }>(
            await savePosting(
                order,
                [
                    { quantity_to_receive: 3, ...lot },
                    { quantity_to_receive: 0 },
                ],
                'FV-2026-009',
            ),
            200,
        );
        const reopened = await show(order);
        expect(
            reopened.lines.map((line) => [
                line.quantity_to_receive,
                line.batch_number,
            ]),
        ).toEqual([
            ['3', 'B-01'],
            ['0', null],
        ]);

        const posted = await json<Posted>(
            await business.admin.post(`${orders}/${order.id}/post`, {
                mode: 'receive',
                version: reopened.version,
            }),
            200,
        );
        expect(
            posted.data.lines.map((line) => [
                line.quantity_received,
                line.quantity_to_receive,
                line.quantity_to_invoice,
                line.batch_number,
            ]),
        ).toEqual([
            ['3', null, null, null],
            ['0', null, null, null],
        ]);
        const receipt = await pool.unsafe<{ vendor_document: string }[]>(
            `select no_dokumen_vendor as vendor_document from bl_tr_penerimaan where id = $1`,
            [posted.posted.receipt?.id ?? ''],
        );
        expect(receipt[0]?.vendor_document).toBe('FV-2026-009');
    });

    test('a stale order version is refused', async () => {
        const order = await releasedOrder();
        const response = await savePosting(
            { ...order, version: order.version - 1 },
            [{ quantity_to_receive: 1, ...lot }, { quantity_to_receive: 0 }],
        );
        expect(response.status).toBe(409);
        const posting = await business.admin.post(
            `${orders}/${order.id}/post`,
            { mode: 'receive', version: order.version - 1 },
        );
        expect(posting.status).toBe(409);
    });
});
