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
type Receipt = {
    id: string;
    number: string;
    version: number;
    lines: { id: string }[];
};
type Invoice = {
    id: string;
    number: string;
    status: string;
    due_date: string;
    amount: string;
    vat_amount: string;
    version: number;
    lines: {
        id: string;
        receipt_amount: string | null;
        amount: string;
        invoiced: string | null;
    }[];
};
type ReceiptLineChoice = {
    receipt_line_id: string;
    open: string;
    on_drafts: string;
    unit_cost: string;
};
type LedgerEntry = {
    kind: string;
    document_number: string;
    due_date: string;
    amount: string;
    remaining: string;
    open: boolean;
};

const invoices = '/api/v1/purchasing/invoices';
const receipts = '/api/v1/purchasing/receipts';
const duties = [
    ...inventoryDuties,
    'core.vendor.manage',
    'core.purchase-receipt.manage',
    'core.purchase-invoice.manage',
];

// Faktur pembelian atas penerimaan yang diposting (Get Receipt Lines BC): jumlah difakturkan di baris penerimaan tidak
// pernah melebihi yang diterima, termasuk lewat dua draf, harga faktur boleh berbeda dari harga terima, posting menulis
// entri utang dengan jatuh tempo dari termin, nomor faktur vendor unik per vendor, penerimaan yang sudah difakturkan
// tidak bisa dibatalkan postingnya, dan batal posting faktur membalik semuanya. Isi database diperiksa dengan SQL.
describe.skipIf(!process.env.DB_HOST)('purchase invoices', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let medicine: { id: string };
    let box: Reference;
    let vendor: { id: string };
    let location: { id: string };

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Faktur',
            duties,
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
        const terms = await created<{ id: string }>(
            '/api/v1/purchasing/payment-terms',
            { code: '30H', name: '30 hari', due_days: 30 },
        );
        vendor = await created('/api/v1/purchasing/vendors', {
            name: 'PBF Uji Faktur',
            payment_terms_id: terms.id,
        });
    });

    async function postedReceipt() {
        const draft = await json<{ data: Receipt }>(
            await business.admin.post(receipts, {
                vendor_id: vendor.id,
                location_id: location.id,
                posting_date: '2026-11-02',
                vendor_document_number: 'SJ-1',
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
            }),
            201,
        );
        return (
            await json<{ data: Receipt }>(
                await business.admin.post(`${receipts}/${draft.data.id}/post`, {
                    version: draft.data.version,
                }),
                200,
            )
        ).data;
    }
    const choices = async () =>
        (
            await json<{ data: ReceiptLineChoice[] }>(
                await business.admin.get(
                    `/api/v1/purchasing/invoice-receipt-lines?vendor_id=${vendor.id}`,
                ),
                200,
            )
        ).data;
    const draft = (
        receiptLineId: string,
        quantity: number,
        overrides: Record<string, unknown> = {},
    ) =>
        business.admin.post(invoices, {
            vendor_id: vendor.id,
            vendor_invoice_number: 'INV-001',
            document_date: '2026-11-05',
            posting_date: '2026-11-06',
            lines: [
                {
                    kind: 'barang',
                    receipt_line_id: receiptLineId,
                    quantity,
                    unit_cost: 155000,
                    discount_percent: 10,
                    vat_percent: 11,
                },
                {
                    kind: 'biaya',
                    description: 'Ongkos angkut',
                    unit_cost: 50000,
                },
            ],
            ...overrides,
        });
    const act = (invoice: Invoice, action: 'post' | 'reverse') =>
        business.admin.post(`${invoices}/${invoice.id}/${action}`, {
            version: invoice.version,
        });
    const invoiced = async (receiptLineId: string) =>
        (
            await pool.unsafe<{ invoiced: string }[]>(
                'select trim_scale(jumlah_difaktur)::text as invoiced from bl_tr_penerimaan_detail where id = $1',
                [receiptLineId],
            )
        )[0]?.invoiced;
    const ledger = async (invoiceId: string) => [
        ...(await pool.unsafe<
            {
                jenis: string;
                jumlah: string;
                sisa: string;
                jatuh_tempo: string;
                closed: boolean;
            }[]
        >(
            `select jenis, trim_scale(jumlah)::text as jumlah, trim_scale(sisa)::text as sisa,
                    jatuh_tempo::text, ditutup_pada is not null as closed
             from ap_tr_entri_utang where faktur_id = $1 order by jenis`,
            [invoiceId],
        )),
    ];

    test('posting invoices part of a receipt line at the vendor price and writes an open payable due after the terms', async () => {
        const receipt = await postedReceipt();
        const receiptLine = receipt.lines[0]?.id ?? '';
        expect(await choices()).toContainEqual(
            expect.objectContaining({
                receipt_line_id: receiptLine,
                open: '10',
                unit_cost: '150000',
            }),
        );
        const created = (
            await json<{ data: Invoice }>(await draft(receiptLine, 6), 201)
        ).data;
        expect(created.number).toMatch(/^PI-\d{8}$/);
        expect(created.due_date).toBe('2026-12-05');
        // 6 x 155.000 x 90% = 837.000 lawan 810.000 di harga terima; ditambah ongkos 50.000.
        expect(created.lines[0]).toMatchObject({
            amount: '837000',
            receipt_amount: '810000',
        });
        expect(created.amount).toBe('887000');
        expect(created.vat_amount).toBe('92070');
        const posted = (
            await json<{ data: Invoice }>(await act(created, 'post'), 200)
        ).data;
        expect(posted.status).toBe('diposting');
        expect(await invoiced(receiptLine)).toBe('6');
        expect(await ledger(created.id)).toEqual([
            {
                jenis: 'faktur',
                jumlah: '979070',
                sisa: '979070',
                jatuh_tempo: '2026-12-05',
                closed: false,
            },
        ]);
        const open = await json<{ data: LedgerEntry[]; remaining: string }>(
            await business.admin.get('/api/v1/purchasing/vendor-ledger'),
            200,
        );
        expect(open.data).toContainEqual(
            expect.objectContaining({
                document_number: created.number,
                due_date: '2026-12-05',
                remaining: '979070',
                open: true,
            }),
        );
        expect(
            (await choices()).find(
                (choice) => choice.receipt_line_id === receiptLine,
            )?.open,
        ).toBe('4');

        await json(await act(created, 'post'), 200);
        expect(await ledger(created.id)).toHaveLength(1);

        const over = await json<{ errors: Record<string, string[]> }>(
            await draft(receiptLine, 5, { vendor_invoice_number: 'INV-002' }),
            422,
        );
        expect(over.errors['lines.0.quantity']?.[0]).toContain(
            'Paling banyak 4',
        );
        const duplicate = await json<{ errors: Record<string, string[]> }>(
            await draft(receiptLine, 1, { vendor_invoice_number: 'inv-001' }),
            422,
        );
        expect(duplicate.errors.vendor_invoice_number?.[0]).toContain(
            'sudah dicatat',
        );

        const blocked = await json<{
            errors: Record<string, string[]>;
            actions: unknown[];
        }>(
            await business.admin.post(`${receipts}/${receipt.id}/reverse`, {
                version: receipt.version,
            }),
            422,
        );
        expect(blocked.errors._form?.[0]).toContain(
            `sudah difakturkan di ${created.number}`,
        );
        expect(blocked.actions).toEqual([
            {
                kind: 'open',
                label: `Buka faktur ${created.number}`,
                page: 'core.purchase-invoice',
                recordId: created.id,
            },
        ]);

        const reversed = (
            await json<{ data: Invoice }>(await act(posted, 'reverse'), 200)
        ).data;
        expect(reversed.status).toBe('dibatalkan');
        expect(await invoiced(receiptLine)).toBe('0');
        expect(await ledger(created.id)).toEqual([
            {
                jenis: 'faktur',
                jumlah: '979070',
                sisa: '0',
                jatuh_tempo: '2026-12-05',
                closed: true,
            },
            {
                jenis: 'pembatalan',
                jumlah: '-979070',
                sisa: '0',
                jatuh_tempo: '2026-12-05',
                closed: true,
            },
        ]);
        const after = await json<{ data: LedgerEntry[] }>(
            await business.admin.get('/api/v1/purchasing/vendor-ledger'),
            200,
        );
        expect(
            after.data.some(
                (entry) => entry.document_number === created.number,
            ),
        ).toBe(false);
        // Nomor faktur vendor dari faktur yang dibatalkan boleh dicatat ulang.
        await json(await draft(receiptLine, 10), 201);
    });

    test('two drafts cannot claim the same received quantity', async () => {
        const receipt = await postedReceipt();
        const receiptLine = receipt.lines[0]?.id ?? '';
        await json(
            await draft(receiptLine, 7, { vendor_invoice_number: 'D-1' }),
            201,
        );
        expect(
            (await choices()).find(
                (choice) => choice.receipt_line_id === receiptLine,
            ),
        ).toMatchObject({ open: '3', on_drafts: '7' });
        const second = await json<{ errors: Record<string, string[]> }>(
            await draft(receiptLine, 4, { vendor_invoice_number: 'D-2' }),
            422,
        );
        expect(second.errors['lines.0.quantity']?.[0]).toContain(
            'Paling banyak 3',
        );
    });

    test('a cost line needs a description and a goods line needs a posted receipt line of the vendor', async () => {
        const invalid = await json<{ errors: Record<string, string[]> }>(
            await business.admin.post(invoices, {
                vendor_id: vendor.id,
                vendor_invoice_number: 'X-1',
                document_date: '2026-11-05',
                posting_date: '2026-11-05',
                lines: [
                    { kind: 'biaya', description: ' ', unit_cost: 1000 },
                    {
                        kind: 'barang',
                        receipt_line_id: crypto.randomUUID(),
                        quantity: 1,
                        unit_cost: 1000,
                    },
                ],
            }),
            422,
        );
        expect(Object.keys(invalid.errors).sort()).toEqual([
            'lines.0.description',
            'lines.1.receipt_line_id',
        ]);
    });

    test('reading invoices and the vendor ledger is separate from posting them', async () => {
        const reader = await createMember(pool, business.tenantId, [
            'core.purchase-invoice.inquire',
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
        }>(await session.get(invoices), 200);
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
                await session.post(invoices, {
                    vendor_id: vendor.id,
                    vendor_invoice_number: 'NO',
                    document_date: '2026-11-05',
                    posting_date: '2026-11-05',
                    lines: [],
                })
            ).status,
        ).toBe(403);
    });
});
