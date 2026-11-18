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
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Reference = { id: string; code: string; name: string };
type Document = {
    id: string;
    number: string;
    status: string;
    version: number;
    lines: { id: string }[];
};
type CreditMemo = Document & {
    amount: string;
    vat_amount: string;
    remaining: string | null;
    applies_to: { amount: string | null; unapplied_date: string | null } | null;
};
type ReturnLine = {
    return_line_id: string;
    open: string;
    unit_cost: string;
    discount_percent: string;
    vat_percent: string;
};
type OpenEntry = {
    entry_id: string;
    kind: string;
    document_number: string;
    open: string;
};

const memos = '/api/v1/purchasing/credit-memos';
const receipts = '/api/v1/purchasing/receipts';
const invoices = '/api/v1/purchasing/invoices';
const payments = '/api/v1/purchasing/vendor-payments';
const duties = [
    ...inventoryDuties,
    'core.vendor.manage',
    'core.purchase-receipt.manage',
    'core.purchase-invoice.manage',
    'core.purchase-credit-memo.manage',
    'core.vendor-payment.manage',
    'core.billing-setup.manage',
];

describe.skipIf(!process.env.DB_HOST)('purchase credit memos', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let medicine: { id: string };
    let box: Reference;
    let vendor: { id: string };
    let location: { id: string };
    let cash: { id: string };
    let receiptCount = 0;

    const created = async <T = Reference>(
        route: string,
        body: Record<string, unknown>,
    ) =>
        (await json<{ data: T }>(await business.admin.post(route, body), 201))
            .data;

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Nota Kredit',
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
        vendor = await created('/api/v1/purchasing/vendors', {
            name: 'PBF Uji Nota Kredit',
        });
        cash = await created('/api/v1/billing/payment-methods', {
            code: 'TUNAI',
            name: 'Tunai',
            behavior: 'tunai',
        });
    });

    const act = (
        route: string,
        document: { id: string; version: number },
        action: 'post' | 'reverse',
    ) =>
        business.admin.post(`${route}/${document.id}/${action}`, {
            version: document.version,
        });

    const unapply = (
        document: { id: string; version: number },
        body: Record<string, unknown>,
    ) =>
        business.admin.post(`${memos}/${document.id}/unapply`, {
            ...body,
            version: document.version,
        });

    async function postedInvoice() {
        receiptCount += 1;
        const receipt = await created<Document>(receipts, {
            vendor_id: vendor.id,
            location_id: location.id,
            posting_date: '2026-11-02',
            lines: [
                {
                    item_id: medicine.id,
                    unit_id: box.id,
                    quantity: 10,
                    unit_cost: 150000,
                    discount_percent: 10,
                    vat_percent: 11,
                },
            ],
        });
        const posted = (
            await json<{ data: Document }>(
                await act(receipts, receipt, 'post'),
                200,
            )
        ).data;
        const invoice = await created<Document>(invoices, {
            vendor_id: vendor.id,
            vendor_invoice_number: `INV-${receiptCount}`,
            document_date: '2026-11-05',
            posting_date: '2026-11-06',
            lines: [
                {
                    kind: 'barang',
                    receipt_line_id: posted.lines[0]?.id,
                    quantity: 10,
                    unit_cost: 150000,
                    discount_percent: 10,
                    vat_percent: 11,
                },
            ],
        });
        return {
            receipt: posted,
            invoice: (
                await json<{ data: Document }>(
                    await act(invoices, invoice, 'post'),
                    200,
                )
            ).data,
        };
    }

    const returned = async (receipt: Document, quantity: number) => {
        const view = await json<{
            data: { returns: { id: string; version: number }[] };
        }>(
            await business.admin.post(`${receipts}/${receipt.id}/returns`, {
                posting_date: '2026-11-07',
                reason: 'Kemasan rusak',
                lines: [
                    {
                        receipt_line_id: receipt.lines[0]?.id,
                        quantity,
                        unit_id: box.id,
                    },
                ],
            }),
            200,
        );
        const latest = view.data.returns.at(-1);
        if (!latest) throw new Error('return not created');
        return latest;
    };

    const invoiceEntry = async (invoiceId: string) =>
        (
            await pool.unsafe<{ id: string; sisa: string }[]>(
                `select id, trim_scale(sisa)::text as sisa from ap_tr_entri_utang
                 where faktur_id = $1 and jenis = 'faktur'`,
                [invoiceId],
            )
        )[0];

    const creditEntries = async (memoId: string) => [
        ...(await pool.unsafe<
            { jenis: string; jumlah: string; sisa: string }[]
        >(
            `select jenis, trim_scale(jumlah)::text as jumlah, trim_scale(sisa)::text as sisa
             from ap_tr_entri_utang where nota_kredit_id = $1 order by jenis`,
            [memoId],
        )),
    ];

    const memoBody = (
        lines: Record<string, unknown>[],
        overrides: Record<string, unknown> = {},
    ) => ({
        vendor_id: vendor.id,
        vendor_credit_memo_number: 'CN-001',
        document_date: '2026-11-08',
        posting_date: '2026-11-08',
        lines,
        ...overrides,
    });

    test('returned goods are credited once, straight against the invoice they were billed on', async () => {
        const { receipt, invoice } = await postedInvoice();
        const shipped = await returned(receipt, 2);
        const [choice] = (
            await json<{ data: ReturnLine[] }>(
                await business.admin.get(
                    `/api/v1/purchasing/credit-memo-return-lines?vendor_id=${vendor.id}`,
                ),
                200,
            )
        ).data;
        expect(choice).toMatchObject({
            open: '2',
            unit_cost: '150000',
            discount_percent: '10',
            vat_percent: '11',
        });
        const returnLine = (quantity: number) => ({
            kind: 'retur',
            return_line_id: choice?.return_line_id,
            quantity,
            unit_cost: 150000,
            discount_percent: 10,
            vat_percent: 11,
        });
        const entry = await invoiceEntry(invoice.id);
        expect(
            (
                await refused(
                    await business.admin.post(memos, memoBody([returnLine(3)])),
                )
            )['lines.0.quantity']?.[0],
        ).toContain('Paling banyak 2');
        const memo = await created<CreditMemo>(
            memos,
            memoBody([returnLine(2)], { applies_to_entry_id: entry?.id }),
        );
        expect(memo.amount).toBe('270000');
        expect(memo.vat_amount).toBe('29700');
        expect(
            (
                await refused(
                    await business.admin.post(
                        memos,
                        memoBody([], {
                            vendor_credit_memo_number: 'cn-001',
                        }),
                    ),
                )
            ).vendor_credit_memo_number?.[0],
        ).toContain('sudah dicatat');

        const posted = (
            await json<{ data: CreditMemo }>(
                await act(memos, memo, 'post'),
                200,
            )
        ).data;
        expect(posted.status).toBe('diposting');
        expect(posted.remaining).toBe('0');
        expect(await creditEntries(memo.id)).toEqual([
            { jenis: 'nota_kredit', jumlah: '-299700', sisa: '0' },
        ]);
        expect((await invoiceEntry(invoice.id))?.sisa).toBe('1198800');
        const [credited] = await pool.unsafe<{ dikredit: string }[]>(
            'select trim_scale(jumlah_dikredit)::text as dikredit from bl_tr_retur_detail where id = $1',
            [choice?.return_line_id ?? null],
        );
        expect(credited?.dikredit).toBe('2');
        expect(
            (
                await json<{ data: ReturnLine[] }>(
                    await business.admin.get(
                        `/api/v1/purchasing/credit-memo-return-lines?vendor_id=${vendor.id}`,
                    ),
                    200,
                )
            ).data,
        ).toEqual([]);

        expect(
            (
                await refused(
                    await business.admin.post(
                        `${receipts}/${receipt.id}/returns/${shipped.id}/reverse`,
                        { version: shipped.version },
                    ),
                )
            )._form?.[0],
        ).toContain(`sudah dikreditkan di ${memo.number}`);
        expect(
            (await refused(await act(memos, posted, 'reverse')))._form?.[0],
        ).toContain('sudah dipakai');
        expect(
            (await refused(await act(invoices, invoice, 'reverse')))._form?.[0],
        ).toContain(`nota kredit ${memo.number}`);

        expect(
            (
                await refused(
                    await unapply(posted, { posting_date: '2026-11-07' }),
                )
            ).posting_date?.[0],
        ).toContain('tidak boleh sebelum');
        const unapplied = (
            await json<{ data: CreditMemo }>(
                await unapply(posted, { posting_date: '2026-11-09' }),
                200,
            )
        ).data;
        expect(unapplied.applies_to).toMatchObject({
            amount: '299700',
            unapplied_date: '2026-11-09',
        });
        expect((await invoiceEntry(invoice.id))?.sisa).toBe('1498500');
        expect(await creditEntries(memo.id)).toEqual([
            { jenis: 'nota_kredit', jumlah: '-299700', sisa: '-299700' },
        ]);
        expect(
            (
                await refused(
                    await unapply(unapplied, { posting_date: '2026-11-09' }),
                )
            )._form?.[0],
        ).toContain('sudah dilepas');

        const reversed = (
            await json<{ data: CreditMemo }>(
                await act(memos, unapplied, 'reverse'),
                200,
            )
        ).data;
        expect(reversed.status).toBe('dibatalkan');
        await json(await act(invoices, invoice, 'reverse'), 200);
    });

    test('a credit memo applied to an invoice is unapplied only after a later payment on that invoice is reversed', async () => {
        const { invoice } = await postedInvoice();
        const [line] = (
            await json<{
                data: { invoice_line_id: string; invoice: { id: string } }[];
            }>(
                await business.admin.get(
                    `/api/v1/purchasing/credit-memo-invoice-lines?vendor_id=${vendor.id}`,
                ),
                200,
            )
        ).data.filter((choice) => choice.invoice.id === invoice.id);
        const entry = await invoiceEntry(invoice.id);
        const memo = await created<CreditMemo>(
            memos,
            memoBody(
                [
                    {
                        kind: 'potongan',
                        invoice_line_id: line?.invoice_line_id,
                        description: 'Selisih harga',
                        quantity: 10,
                        unit_cost: 1000,
                        vat_percent: 11,
                    },
                ],
                {
                    vendor_credit_memo_number: 'CN-003',
                    applies_to_entry_id: entry?.id,
                },
            ),
        );
        const posted = (
            await json<{ data: CreditMemo }>(
                await act(memos, memo, 'post'),
                200,
            )
        ).data;
        const paid = (
            await json<{ data: Document }>(
                await act(
                    payments,
                    await created<Document>(payments, {
                        vendor_id: vendor.id,
                        posting_date: '2026-11-20',
                        payment_method_id: cash.id,
                        lines: [{ entry_id: entry?.id, amount: 100000 }],
                    }),
                    'post',
                ),
                200,
            )
        ).data;

        const blocked = await json<{
            errors: Record<string, string[]>;
            actions: { label: string }[];
        }>(await unapply(posted, { posting_date: '2026-11-20' }), 422);
        expect(blocked.errors._form?.[0]).toContain(paid.number);
        expect(blocked.actions[0]?.label).toBe(
            `Buka pembayaran ${paid.number}`,
        );
        expect((await invoiceEntry(invoice.id))?.sisa).toBe('1387400');

        await json(await act(payments, paid, 'reverse'), 200);
        const unapplied = (
            await json<{ data: CreditMemo }>(
                await unapply(posted, { posting_date: '2026-11-20' }),
                200,
            )
        ).data;
        await json(await act(memos, unapplied, 'reverse'), 200);
        await json(await act(invoices, invoice, 'reverse'), 200);
    });

    test('an open allowance credit is netted in a vendor payment, and cancels only once the payment is reversed', async () => {
        const { invoice } = await postedInvoice();
        const [line] = (
            await json<{ data: { invoice_line_id: string }[] }>(
                await business.admin.get(
                    `/api/v1/purchasing/credit-memo-invoice-lines?vendor_id=${vendor.id}`,
                ),
                200,
            )
        ).data;
        const memo = await created<CreditMemo>(
            memos,
            memoBody(
                [
                    {
                        kind: 'potongan',
                        invoice_line_id: line?.invoice_line_id,
                        description: 'Selisih harga',
                        quantity: 10,
                        unit_cost: 5000,
                        vat_percent: 11,
                    },
                ],
                { vendor_credit_memo_number: 'CN-002' },
            ),
        );
        const posted = (
            await json<{ data: CreditMemo }>(
                await act(memos, memo, 'post'),
                200,
            )
        ).data;
        expect(posted.remaining).toBe('55500');

        const open = (
            await json<{ data: OpenEntry[] }>(
                await business.admin.get(
                    `/api/v1/purchasing/vendor-payment-entries?vendor_id=${vendor.id}`,
                ),
                200,
            )
        ).data;
        const credit = open.find((entry) => entry.kind === 'nota_kredit');
        const debt = open.find(
            (entry) => entry.document_number === invoice.number,
        );
        expect(credit?.open).toBe('-55500');
        const payment = (lines: Record<string, unknown>[]) =>
            business.admin.post(payments, {
                vendor_id: vendor.id,
                posting_date: '2026-11-20',
                payment_method_id: cash.id,
                lines,
            });
        const creditOnly = await created<Document>(payments, {
            vendor_id: vendor.id,
            posting_date: '2026-11-20',
            payment_method_id: cash.id,
            lines: [{ entry_id: credit?.entry_id, amount: 55500 }],
        });
        expect(
            (await refused(await act(payments, creditOnly, 'post'))).lines?.[0],
        ).toContain('harus lebih dari 0');
        await business.admin.delete(`${payments}/${creditOnly.id}`, {
            version: creditOnly.version,
        });

        const netted = (
            await json<{ data: Document & { amount: string } }>(
                await payment([
                    { entry_id: debt?.entry_id, amount: 100000 },
                    { entry_id: credit?.entry_id, amount: 55500 },
                ]),
                201,
            )
        ).data;
        expect(netted.amount).toBe('44500');
        const paid = (
            await json<{ data: Document }>(
                await act(payments, netted, 'post'),
                200,
            )
        ).data;
        expect(await creditEntries(memo.id)).toEqual([
            { jenis: 'nota_kredit', jumlah: '-55500', sisa: '0' },
        ]);
        expect((await invoiceEntry(invoice.id))?.sisa).toBe('1398500');
        const [paymentEntry] = await pool.unsafe<{ jumlah: string }[]>(
            `select trim_scale(jumlah)::text as jumlah from ap_tr_entri_utang
             where pembayaran_id = $1 and jenis = 'pembayaran'`,
            [paid.id],
        );
        expect(paymentEntry?.jumlah).toBe('-44500');

        const usedRefusal = await json<{
            errors: Record<string, string[]>;
            actions: { label: string }[];
        }>(await act(memos, posted, 'reverse'), 422);
        expect(usedRefusal.errors._form?.[0]).toContain(paid.number);
        expect(usedRefusal.actions[0]?.label).toBe(
            `Buka pembayaran ${paid.number}`,
        );

        await json(await act(payments, paid, 'reverse'), 200);
        expect(await creditEntries(memo.id)).toEqual([
            { jenis: 'nota_kredit', jumlah: '-55500', sisa: '-55500' },
        ]);
        const fresh = (
            await json<{ data: CreditMemo }>(
                await business.admin.get(`${memos}/${memo.id}`),
                200,
            )
        ).data;
        expect(
            (
                await json<{ data: CreditMemo }>(
                    await act(memos, fresh, 'reverse'),
                    200,
                )
            ).data.status,
        ).toBe('dibatalkan');
        expect(await creditEntries(memo.id)).toEqual([
            { jenis: 'nota_kredit', jumlah: '-55500', sisa: '0' },
            { jenis: 'pembatalan_nota_kredit', jumlah: '55500', sisa: '0' },
        ]);
        expect(
            (
                await refused(
                    await business.admin.post(
                        memos,
                        memoBody(
                            [
                                {
                                    kind: 'potongan',
                                    invoice_line_id: line?.invoice_line_id,
                                    description: 'Ulang',
                                    quantity: 1,
                                    unit_cost: 1,
                                },
                            ],
                            { vendor_credit_memo_number: 'CN-002' },
                        ),
                    ),
                )
            ).vendor_credit_memo_number?.[0],
        ).toContain('sudah dicatat');
    });

    test('a credit memo worth nothing does not post, and reading is separate from posting', async () => {
        const { invoice } = await postedInvoice();
        const [line] = (
            await json<{ data: { invoice_line_id: string }[] }>(
                await business.admin.get(
                    `/api/v1/purchasing/credit-memo-invoice-lines?vendor_id=${vendor.id}`,
                ),
                200,
            )
        ).data;
        expect(line).toBeDefined();
        const zero = await created<CreditMemo>(
            memos,
            memoBody(
                [
                    {
                        kind: 'potongan',
                        invoice_line_id: line?.invoice_line_id,
                        description: 'Tanpa nilai',
                        quantity: 1,
                        unit_cost: 0,
                    },
                ],
                { vendor_credit_memo_number: `CN-ZERO-${invoice.number}` },
            ),
        );
        expect(
            (await refused(await act(memos, zero, 'post'))).lines?.[0],
        ).toContain('lebih dari 0');

        const reader = await createMember(pool, business.tenantId, [
            'core.purchase-credit-memo.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            reader.membershipId,
        );
        const session = browser();
        await session.login(reader.email, reader.password);
        const listed = await json<{
            permissions: { update: boolean; post: boolean; reverse: boolean };
        }>(await session.get(memos), 200);
        expect(listed.permissions).toEqual({
            update: false,
            post: false,
            reverse: false,
        });
        expect((await session.post(memos, memoBody([]))).status).toBe(403);
        expect(
            (
                await session.post(`${memos}/${zero.id}/post`, {
                    version: zero.version,
                })
            ).status,
        ).toBe(403);
    });
});
