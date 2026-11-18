import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    inventoryDuties,
    json,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Reference = { id: string; code: string; name: string };
type Document = { id: string; number: string; version: number };
type Receipt = Document & { lines: { id: string }[] };
type Payment = Document & {
    status: string;
    amount: string;
    lines: {
        id: string;
        entry_id: string;
        amount: string;
        remaining: string;
    }[];
};
type OpenEntry = {
    entry_id: string;
    document_number: string;
    remaining: string;
    on_drafts: string;
    open: string;
};
type LedgerEntry = {
    kind: string;
    document_number: string;
    remaining: string;
    paid: string;
    payments: { id: string; number: string; amount: string }[];
    open: boolean;
};
type Refusal = {
    errors: Record<string, string[]>;
    actions: unknown[];
};

const payments = '/api/v1/purchasing/vendor-payments';
const invoices = '/api/v1/purchasing/invoices';
const receipts = '/api/v1/purchasing/receipts';
const duties = [
    ...inventoryDuties,
    'core.vendor.manage',
    'core.purchase-receipt.manage',
    'core.purchase-invoice.manage',
    'core.vendor-payment.manage',
    'core.billing-setup.manage',
    'core.bank-account.manage',
];

describe.skipIf(!process.env.DB_HOST)('vendor payments', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let medicine: { id: string };
    let box: Reference;
    let vendor: { id: string };
    let location: { id: string };
    let transfer: { id: string };
    let receivable: { id: string };
    let cash: { id: string };
    let bankAccount: { id: string; version: number };
    let invoiceCount = 0;

    const created = async <T = Reference>(
        route: string,
        body: Record<string, unknown>,
    ) =>
        (await json<{ data: T }>(await business.admin.post(route, body), 201))
            .data;
    const act = (route: string, record: Document, action: 'post' | 'reverse') =>
        business.admin.post(`${route}/${record.id}/${action}`, {
            version: record.version,
        });

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Bayar Vendor',
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
            name: 'PBF Uji Bayar',
        });
        transfer = await created('/api/v1/billing/payment-methods', {
            code: 'TRF',
            name: 'Transfer',
            behavior: 'non_tunai',
        });
        receivable = await created('/api/v1/billing/payment-methods', {
            code: 'BON',
            name: 'Bon',
            behavior: 'piutang',
        });
        cash = await created('/api/v1/billing/payment-methods', {
            code: 'TUNAI',
            name: 'Tunai',
            behavior: 'tunai',
        });
        bankAccount = await created('/api/v1/bank/accounts', {
            code: 'BCA-OPS',
            name: 'Operasional',
            bank_name: 'BCA',
            account_number: '1234567890',
        });
    });

    async function postedInvoice() {
        const draft = await created<Receipt>(receipts, {
            vendor_id: vendor.id,
            location_id: location.id,
            posting_date: '2026-11-02',
            lines: [
                {
                    item_id: medicine.id,
                    unit_id: box.id,
                    quantity: 10,
                    unit_cost: 10000,
                },
            ],
        });
        const receipt = (
            await json<{ data: Receipt }>(
                await act(receipts, draft, 'post'),
                200,
            )
        ).data;
        const invoice = await created<Document>(invoices, {
            vendor_id: vendor.id,
            vendor_invoice_number: `INV-${++invoiceCount}`,
            document_date: '2026-11-05',
            posting_date: '2026-11-06',
            lines: [
                {
                    kind: 'barang',
                    receipt_line_id: receipt.lines[0]?.id ?? '',
                    quantity: 10,
                    unit_cost: 10000,
                },
            ],
        });
        return (
            await json<{ data: Document }>(
                await act(invoices, invoice, 'post'),
                200,
            )
        ).data;
    }
    const openEntries = async (paymentId?: string) =>
        (
            await json<{ data: OpenEntry[] }>(
                await business.admin.get(
                    `/api/v1/purchasing/vendor-payment-entries?vendor_id=${vendor.id}${paymentId ? `&payment_id=${paymentId}` : ''}`,
                ),
                200,
            )
        ).data;
    const entryOf = async (invoice: Document) => {
        const found = (await openEntries()).find(
            (entry) => entry.document_number === invoice.number,
        );
        if (!found) throw new Error(`${invoice.number} tidak terbuka`);
        return found;
    };
    const draft = (
        lines: { entry_id: string; amount: number | string }[],
        overrides: Record<string, unknown> = {},
    ) =>
        business.admin.post(payments, {
            vendor_id: vendor.id,
            posting_date: '2026-11-20',
            payment_method_id: transfer.id,
            bank_account_id: bankAccount.id,
            reference: 'TRF-1',
            lines,
            ...overrides,
        });
    const pay = async (lines: { entry_id: string; amount: number }[]) =>
        (
            await json<{ data: Payment }>(
                await act(
                    payments,
                    (await json<{ data: Payment }>(await draft(lines), 201))
                        .data,
                    'post',
                ),
                200,
            )
        ).data;
    const invoiceEntry = async (invoiceId: string) =>
        (
            await pool.unsafe<
                { sisa: string; closed_by_payment: boolean; closed: boolean }[]
            >(
                `select trim_scale(e.sisa)::text as sisa, e.ditutup_pada is not null as closed,
                        exists (select 1 from ap_tr_entri_utang p
                                where p.id = e.ditutup_oleh_entri_id and p.jenis = 'pembayaran') as closed_by_payment
                 from ap_tr_entri_utang e where e.faktur_id = $1 and e.jenis = 'faktur'`,
                [invoiceId],
            )
        )[0];
    const paymentEntries = async (paymentId: string) => [
        ...(await pool.unsafe<
            { jenis: string; jumlah: string; sisa: string; closed: boolean }[]
        >(
            `select jenis, trim_scale(jumlah)::text as jumlah, trim_scale(sisa)::text as sisa,
                    ditutup_pada is not null as closed
             from ap_tr_entri_utang where pembayaran_id = $1 order by jenis`,
            [paymentId],
        )),
    ];
    const ledger = async (all = false) =>
        (
            await json<{ data: LedgerEntry[]; remaining: string }>(
                await business.admin.get(
                    `/api/v1/purchasing/vendor-ledger${all ? '?all=1' : ''}`,
                ),
                200,
            )
        ).data;

    test('a partial payment lowers the remaining amount and paying the rest closes the invoice entry', async () => {
        const invoice = await postedInvoice();
        const entry = await entryOf(invoice);
        expect(entry).toMatchObject({ remaining: '100000', open: '100000' });

        const first = await pay([{ entry_id: entry.entry_id, amount: 40000 }]);
        expect(first.number).toMatch(/^PV-\d{8}$/);
        expect(first).toMatchObject({ status: 'diposting', amount: '40000' });
        expect(first.lines[0]).toMatchObject({
            amount: '40000',
            remaining: '60000',
        });
        expect(await invoiceEntry(invoice.id)).toEqual({
            sisa: '60000',
            closed: false,
            closed_by_payment: false,
        });
        expect(await paymentEntries(first.id)).toEqual([
            { jenis: 'pembayaran', jumlah: '-40000', sisa: '0', closed: true },
        ]);
        expect(
            (await ledger()).find(
                (row) => row.document_number === invoice.number,
            ),
        ).toMatchObject({
            remaining: '60000',
            paid: '40000',
            payments: [{ id: first.id, number: first.number, amount: '40000' }],
            open: true,
        });

        const over = await json<Refusal>(
            await draft([{ entry_id: entry.entry_id, amount: 60001 }]),
            422,
        );
        expect(over.errors['lines.0.amount']?.[0]).toContain(
            'Paling banyak 60000',
        );

        const rest = await pay([{ entry_id: entry.entry_id, amount: 60000 }]);
        expect(await invoiceEntry(invoice.id)).toEqual({
            sisa: '0',
            closed: true,
            closed_by_payment: true,
        });
        expect(
            (await openEntries()).some(
                (open) => open.entry_id === entry.entry_id,
            ),
        ).toBe(false);
        expect(
            (await ledger()).some(
                (row) => row.document_number === invoice.number,
            ),
        ).toBe(false);
        const closed = await ledger(true);
        expect(
            closed.find((row) => row.document_number === invoice.number),
        ).toMatchObject({ remaining: '0', paid: '100000', open: false });
        expect(closed).toContainEqual(
            expect.objectContaining({
                kind: 'pembayaran',
                document_number: rest.number,
            }),
        );

        await json(await act(payments, rest, 'post'), 200);
        expect(await paymentEntries(rest.id)).toHaveLength(1);
    });

    test('cancelling a payment reopens the invoice and lets the invoice be cancelled again', async () => {
        const invoice = await postedInvoice();
        const entry = await entryOf(invoice);
        const first = await pay([{ entry_id: entry.entry_id, amount: 30000 }]);
        const second = await pay([{ entry_id: entry.entry_id, amount: 70000 }]);

        const paid = await json<Refusal>(
            await act(invoices, invoice, 'reverse'),
            422,
        );
        expect(paid.errors._form?.[0]).toContain('sudah dibayar');
        expect(paid.actions).toEqual([
            {
                kind: 'open',
                label: `Buka pembayaran ${second.number}`,
                page: 'core.vendor-payment',
                recordId: second.id,
            },
        ]);

        const earlier = await json<Refusal>(
            await act(payments, first, 'reverse'),
            422,
        );
        expect(earlier.errors._form?.[0]).toContain(
            `sudah dibayar lagi di ${second.number}`,
        );
        expect(earlier.actions).toEqual([
            {
                kind: 'open',
                label: `Buka pembayaran ${second.number}`,
                page: 'core.vendor-payment',
                recordId: second.id,
            },
        ]);

        const cancelled = (
            await json<{ data: Payment }>(
                await act(payments, second, 'reverse'),
                200,
            )
        ).data;
        expect(cancelled.status).toBe('dibatalkan');
        expect(await invoiceEntry(invoice.id)).toEqual({
            sisa: '70000',
            closed: false,
            closed_by_payment: false,
        });
        expect(await paymentEntries(second.id)).toEqual([
            {
                jenis: 'pembatalan_pembayaran',
                jumlah: '70000',
                sisa: '0',
                closed: true,
            },
            { jenis: 'pembayaran', jumlah: '-70000', sisa: '0', closed: true },
        ]);

        await json(await act(payments, first, 'reverse'), 200);
        expect((await invoiceEntry(invoice.id))?.sisa).toBe('100000');
        await json(await act(invoices, invoice, 'reverse'), 200);
    });

    test('two drafts cannot pay the same remaining amount', async () => {
        const invoice = await postedInvoice();
        const entry = await entryOf(invoice);
        const held = (
            await json<{ data: Payment }>(
                await draft([{ entry_id: entry.entry_id, amount: 80000 }]),
                201,
            )
        ).data;
        expect(
            (await openEntries()).find(
                (open) => open.entry_id === entry.entry_id,
            ),
        ).toMatchObject({
            remaining: '100000',
            on_drafts: '80000',
            open: '20000',
        });
        expect(
            (await openEntries(held.id)).find(
                (open) => open.entry_id === entry.entry_id,
            )?.open,
        ).toBe('100000');
        const second = await json<Refusal>(
            await draft([{ entry_id: entry.entry_id, amount: 30000 }]),
            422,
        );
        expect(second.errors['lines.0.amount']?.[0]).toContain(
            'Paling banyak 20000',
        );

        await pay([{ entry_id: entry.entry_id, amount: 20000 }]);
        await json(await act(payments, held, 'post'), 200);
        expect(await invoiceEntry(invoice.id)).toMatchObject({
            sisa: '0',
            closed: true,
        });
    });

    test('payment needs a cash or bank payment method and a date not before the invoice', async () => {
        const invoice = await postedInvoice();
        const entry = await entryOf(invoice);
        const methods = (
            await json<{ data: Reference[] }>(
                await business.admin.get(
                    '/api/v1/purchasing/vendor-payment-methods',
                ),
                200,
            )
        ).data;
        expect(methods.map((method) => method.code).sort()).toEqual([
            'TRF',
            'TUNAI',
        ]);
        const invalid = await json<Refusal>(
            await draft([{ entry_id: entry.entry_id, amount: 0 }], {
                payment_method_id: receivable.id,
            }),
            422,
        );
        expect(Object.keys(invalid.errors).sort()).toEqual([
            'lines.0.amount',
            'payment_method_id',
        ]);
        const early = (
            await json<{ data: Payment }>(
                await draft([{ entry_id: entry.entry_id, amount: 1000 }], {
                    posting_date: '2026-11-01',
                }),
                201,
            )
        ).data;
        const refused = await json<Refusal>(
            await act(payments, early, 'post'),
            422,
        );
        expect(refused.errors.posting_date?.[0]).toContain(
            `sebelum tanggal posting ${invoice.number}`,
        );
        const empty = (await json<{ data: Payment }>(await draft([]), 201))
            .data;
        expect(
            (await json<Refusal>(await act(payments, empty, 'post'), 422))
                .errors.lines,
        ).toBeDefined();
    });

    test('a non-cash payment posts only from an unblocked local bank account, and cash takes none', async () => {
        const invoice = await postedInvoice();
        const entry = await entryOf(invoice);
        const lines = [{ entry_id: entry.entry_id, amount: 1000 }];
        const cashWithBank = await json<Refusal>(
            await draft(lines, { payment_method_id: cash.id }),
            422,
        );
        expect(cashWithBank.errors.bank_account_id?.[0]).toContain(
            'tunai tidak memakai rekening',
        );
        const withoutBank = (
            await json<{ data: Payment }>(
                await draft(lines, { bank_account_id: null }),
                201,
            )
        ).data;
        expect(
            (await json<Refusal>(await act(payments, withoutBank, 'post'), 422))
                .errors.bank_account_id?.[0],
        ).toContain('Pilih rekening bank');
        await business.admin.delete(`${payments}/${withoutBank.id}`, {
            version: withoutBank.version,
        });

        const fromBank = (
            await json<{
                data: Payment & {
                    bank_account: { code: string } | null;
                };
            }>(await draft(lines), 201)
        ).data;
        expect(fromBank.bank_account?.code).toBe('BCA-OPS');
        const blocked = (
            await json<{ data: { version: number } }>(
                await business.admin.patch(
                    `/api/v1/bank/accounts/${bankAccount.id}`,
                    {
                        code: 'BCA-OPS',
                        name: 'Operasional',
                        bank_name: 'BCA',
                        account_number: '1234567890',
                        blocked: true,
                        version: bankAccount.version,
                    },
                ),
                200,
            )
        ).data;
        expect(
            (await json<Refusal>(await act(payments, fromBank, 'post'), 422))
                .errors.bank_account_id?.[0],
        ).toContain('diblokir');
        bankAccount = (
            await json<{ data: { id: string; version: number } }>(
                await business.admin.patch(
                    `/api/v1/bank/accounts/${bankAccount.id}`,
                    {
                        code: 'BCA-OPS',
                        name: 'Operasional',
                        bank_name: 'BCA',
                        account_number: '1234567890',
                        blocked: false,
                        version: blocked.version,
                    },
                ),
                200,
            )
        ).data;
        const posted = (
            await json<{ data: Payment }>(
                await act(payments, fromBank, 'post'),
                200,
            )
        ).data;
        expect(posted.status).toBe('diposting');
        const used = await json<Refusal>(
            await business.admin.delete(
                `/api/v1/bank/accounts/${bankAccount.id}`,
                { version: bankAccount.version },
            ),
            422,
        );
        expect(used.errors._form?.[0]).toContain('sudah dipakai pembayaran');
        const [row] = await pool.unsafe<{ bank: string | null }[]>(
            'select bank from ap_tr_pembayaran where id = $1',
            [posted.id],
        );
        expect(row).toEqual({ bank: null });
    });

    test('reading payments is separate from posting them', async () => {
        const reader = await createMember(pool, business.tenantId, [
            'core.vendor-payment.inquire',
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
        }>(await session.get(payments), 200);
        expect(listed.permissions).toEqual({
            update: false,
            post: false,
            reverse: false,
        });
        expect(
            (await session.get('/api/v1/purchasing/vendor-ledger')).status,
        ).toBe(200);
        expect(
            (
                await session.post(payments, {
                    vendor_id: vendor.id,
                    posting_date: '2026-11-20',
                    payment_method_id: transfer.id,
                    lines: [],
                })
            ).status,
        ).toBe(403);
    });
});
