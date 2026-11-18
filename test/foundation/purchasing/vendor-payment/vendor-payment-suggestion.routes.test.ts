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
type Document = {
    id: string;
    number: string;
    version: number;
    lines: { id: string }[];
};
type Suggested = {
    id: string;
    number: string;
    status: string;
    amount: string;
    vendor: { id: string };
    lines: { document_number: string; amount: string }[];
};

const receipts = '/api/v1/purchasing/receipts';
const invoices = '/api/v1/purchasing/invoices';
const suggestions = '/api/v1/purchasing/vendor-payment-suggestions';
const duties = [
    ...inventoryDuties,
    'core.vendor.manage',
    'core.purchase-receipt.manage',
    'core.purchase-invoice.manage',
    'core.purchase-credit-memo.manage',
    'core.vendor-payment.manage',
    'core.billing-setup.manage',
];

describe.skipIf(!process.env.DB_HOST)('vendor payment suggestions', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let medicine: { id: string };
    let box: Reference;
    let location: { id: string };
    let cash: { id: string };
    let invoiceCount = 0;

    const created = async <T = Reference>(
        route: string,
        body: Record<string, unknown>,
    ) =>
        (await json<{ data: T }>(await business.admin.post(route, body), 201))
            .data;
    const posted = async <T extends { id: string; version: number }>(
        route: string,
        document: T,
    ) =>
        (
            await json<{ data: T }>(
                await business.admin.post(`${route}/${document.id}/post`, {
                    version: document.version,
                }),
                200,
            )
        ).data;

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Saran Bayar',
            duties,
        );
        medicine = await business.item('AMX');
        location = await business.location('GUDANG');
        box = await created(`${inventoryApi}/units-of-measure`, {
            code: 'BOX',
            name: 'Kotak',
        });
        await created(`${inventoryApi}/item-units`, {
            item_id: medicine.id,
            unit_id: box.id,
            quantity_per_unit: 100,
        });
        cash = await created('/api/v1/billing/payment-methods', {
            code: 'TUNAI',
            name: 'Tunai',
            behavior: 'tunai',
        });
    });

    async function invoiceFor(
        vendor: { id: string },
        dueDate: string,
        unitCost: number,
    ) {
        invoiceCount += 1;
        const receipt = await posted(
            receipts,
            await created<Document>(receipts, {
                vendor_id: vendor.id,
                location_id: location.id,
                posting_date: '2026-11-02',
                lines: [
                    {
                        item_id: medicine.id,
                        unit_id: box.id,
                        quantity: 1,
                        unit_cost: unitCost,
                    },
                ],
            }),
        );
        return posted(
            invoices,
            await created<Document>(invoices, {
                vendor_id: vendor.id,
                vendor_invoice_number: `INV-${invoiceCount}`,
                document_date: '2026-11-03',
                posting_date: '2026-11-03',
                due_date: dueDate,
                lines: [
                    {
                        kind: 'barang',
                        receipt_line_id: receipt.lines[0]?.id,
                        quantity: 1,
                        unit_cost: unitCost,
                    },
                ],
            }),
        );
    }

    const suggest = (overrides: Record<string, unknown> = {}) =>
        business.admin.post(suggestions, {
            last_due_date: '2026-11-30',
            posting_date: '2026-11-30',
            payment_method_id: cash.id,
            ...overrides,
        });

    test('one draft per vendor holds what falls due by the date, net of open credits', async () => {
        const first = await created<{ id: string }>(
            '/api/v1/purchasing/vendors',
            { name: 'PBF Saran Satu' },
        );
        const second = await created<{ id: string }>(
            '/api/v1/purchasing/vendors',
            { name: 'PBF Saran Dua' },
        );
        const early = await invoiceFor(first, '2026-11-10', 100000);
        const late = await invoiceFor(first, '2026-12-31', 50000);
        const other = await invoiceFor(second, '2026-11-20', 30000);
        const [line] = (
            await json<{ data: { invoice_line_id: string }[] }>(
                await business.admin.get(
                    `/api/v1/purchasing/credit-memo-invoice-lines?vendor_id=${first.id}`,
                ),
                200,
            )
        ).data.filter(
            (choice) => choice.invoice_line_id === early.lines[0]?.id,
        );
        const memo = await posted(
            '/api/v1/purchasing/credit-memos',
            await created<Document>('/api/v1/purchasing/credit-memos', {
                vendor_id: first.id,
                vendor_credit_memo_number: 'CN-1',
                document_date: '2026-11-05',
                posting_date: '2026-11-05',
                lines: [
                    {
                        kind: 'potongan',
                        invoice_line_id: line?.invoice_line_id,
                        description: 'Selisih harga',
                        quantity: 1,
                        unit_cost: 20000,
                    },
                ],
            }),
        );

        const drafts = (await json<{ data: Suggested[] }>(await suggest(), 201))
            .data;
        const forFirst = drafts.find((draft) => draft.vendor.id === first.id);
        const forSecond = drafts.find((draft) => draft.vendor.id === second.id);
        expect(forFirst?.status).toBe('draf');
        expect(forFirst?.amount).toBe('80000');
        expect(
            forFirst?.lines.map((entry) => [
                entry.document_number,
                entry.amount,
            ]),
        ).toEqual([
            [memo.number, '-20000'],
            [early.number, '100000'],
        ]);
        expect(
            forFirst?.lines.some(
                (entry) => entry.document_number === late.number,
            ),
        ).toBe(false);
        expect(forSecond?.lines.map((entry) => entry.document_number)).toEqual([
            other.number,
        ]);

        expect((await refused(await suggest()))._form?.[0]).toContain(
            'Tidak ada utang',
        );

        const draftSecond = forSecond ?? { id: '' };
        const [stored] = await pool.unsafe<{ version: number }[]>(
            'select version from ap_tr_pembayaran where id = $1',
            [draftSecond.id],
        );
        await business.admin.delete(
            `/api/v1/purchasing/vendor-payments/${draftSecond.id}`,
            { version: stored?.version },
        );
        const onlySecond = (
            await json<{ data: Suggested[] }>(
                await suggest({ vendor_id: second.id }),
                201,
            )
        ).data;
        expect(onlySecond.map((draft) => draft.vendor.id)).toEqual([second.id]);
    });

    test('a vendor whose credits cover its debts gets no draft, and the date must be real', async () => {
        const vendor = await created<{ id: string }>(
            '/api/v1/purchasing/vendors',
            { name: 'PBF Saran Kredit' },
        );
        const invoice = await invoiceFor(vendor, '2026-11-10', 10000);
        const [line] = (
            await json<{ data: { invoice_line_id: string }[] }>(
                await business.admin.get(
                    `/api/v1/purchasing/credit-memo-invoice-lines?vendor_id=${vendor.id}`,
                ),
                200,
            )
        ).data.filter(
            (choice) => choice.invoice_line_id === invoice.lines[0]?.id,
        );
        await posted(
            '/api/v1/purchasing/credit-memos',
            await created<Document>('/api/v1/purchasing/credit-memos', {
                vendor_id: vendor.id,
                vendor_credit_memo_number: 'CN-ALL',
                document_date: '2026-11-05',
                posting_date: '2026-11-05',
                lines: [
                    {
                        kind: 'potongan',
                        invoice_line_id: line?.invoice_line_id,
                        description: 'Potongan penuh',
                        quantity: 1,
                        unit_cost: 10000,
                    },
                ],
            }),
        );
        expect(
            (await refused(await suggest({ vendor_id: vendor.id })))._form?.[0],
        ).toContain('Tidak ada utang');
        expect(
            (await refused(await suggest({ last_due_date: '30-11-2026' })))
                .last_due_date?.[0],
        ).toContain('jatuh tempo');
    });
});
