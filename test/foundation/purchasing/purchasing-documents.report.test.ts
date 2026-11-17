import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { extractText, getDocumentProxy } from 'unpdf';
import {
    createBusiness,
    inventoryApi,
    inventoryDuties,
    json,
    type Business,
} from '../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../support/operations-app.ts';
import { documentText } from '../../support/receipt-fixture.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../support/tenant-fixtures.ts';

type Reference = { id: string; code: string; name: string };
type Receipt = {
    id: string;
    number: string;
    version: number;
    lines: { id: string }[];
};

// Penerimaan barang dan retur ke vendor dicetak mesin cetak Core: vendor dan nomor dokumennya, batch dan kedaluwarsa,
// nilai sesudah diskon dan PPN dengan terbilang, petugas dari pengguna yang memposting. Retur membawa batch dari baris
// penerimaannya dan nilainya dari harga beli sesudah diskon.
describe.skipIf(!process.env.DB_HOST)('purchasing documents', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let receipt: Receipt;
    let returnId: string;
    let returnNumber: string;
    let userName: string;
    const print = (code: string, id: string, query = 'format=docx') =>
        business.admin.get(`/api/v1/reports/${code}/records/${id}?${query}`);
    const text = async (code: string, id: string) => {
        const response = await print(code, id);
        expect(response.status).toBe(200);
        return documentText(new Uint8Array(await response.arrayBuffer()));
    };

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Cetak Pembelian',
            [
                ...inventoryDuties,
                'core.vendor.manage',
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
        const warehouse = await business.location('GUDANG');
        const tracked = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        const item = await business.item('AMX-500', {
            tracking_code_id: tracked.id,
        });
        const blud = await created(`${inventoryApi}/funding-sources`, {
            code: 'BLUD',
            name: 'Dana BLUD',
        });
        const vendor = await created('/api/v1/purchasing/vendors', {
            name: 'PBF Uji Cetak Pembelian',
        });
        const draft = await created<Receipt>('/api/v1/purchasing/receipts', {
            vendor_id: vendor.id,
            location_id: warehouse.id,
            posting_date: '2026-11-03',
            vendor_document_number: 'FJ-UJI-77',
            lines: [
                {
                    item_id: item.id,
                    unit_id: business.uom.id,
                    quantity: 20,
                    unit_cost: 2000,
                    discount_percent: 10,
                    vat_percent: 11,
                    batch_number: 'B-BELI',
                    expiry_date: '2028-01-31',
                    funding_source_id: blud.id,
                    budget_year: 2026,
                },
            ],
        });
        receipt = (
            await json<{ data: Receipt }>(
                await business.admin.post(
                    `/api/v1/purchasing/receipts/${draft.id}/post`,
                    { version: draft.version },
                ),
                200,
            )
        ).data;
        const returned = await json<{
            data: { returns: { id: string; number: string }[] };
        }>(
            await business.admin.post(
                `/api/v1/purchasing/receipts/${receipt.id}/returns`,
                {
                    posting_date: '2026-11-05',
                    reason: 'Kemasan rusak',
                    lines: [
                        { receipt_line_id: receipt.lines[0]?.id, quantity: 5 },
                    ],
                },
            ),
            200,
        );
        const [posted] = returned.data.returns;
        if (!posted) throw new Error('Retur tidak tercatat.');
        returnId = posted.id;
        returnNumber = posted.number;
        const [user] = await pool.unsafe<{ name: string }[]>(
            `select u.name from users u join tenant_memberships m on m.user_id = u.id where m.id = $1`,
            [business.member.membershipId],
        );
        userName = user?.name ?? '';
    });

    test('the receipt shows the vendor document, each batch with expiry and funding, and the total with VAT in words', async () => {
        const document = await text('core.purchase-receipt', receipt.id);
        expect(document).toContain('PENERIMAAN BARANG');
        expect(document).toContain(receipt.number);
        expect(document).toContain('PBF Uji Cetak Pembelian');
        expect(document).toContain('FJ-UJI-77');
        expect(document).toContain('B-BELI');
        expect(document).toContain('31 Januari 2028');
        expect(document).toContain('Dana BLUD');
        expect(document).toContain('36.000');
        expect(document).toContain('3.960');
        expect(document).toContain('39.960');
        expect(document).toContain(
            'Tiga Puluh Sembilan Ribu Sembilan Ratus Enam Puluh Rupiah',
        );
        expect(document).toContain(`( ${userName} )`);
        expect(document).not.toContain('{');
    });

    test('the return carries the batch of the receipt line and its value after discount', async () => {
        const document = await text('core.purchase-return', returnId);
        expect(document).toContain('RETUR BARANG KE VENDOR');
        expect(document).toContain(returnNumber);
        expect(document).toContain(receipt.number);
        expect(document).toContain('Kemasan rusak');
        expect(document).toContain('B-BELI');
        expect(document).toContain('31 Januari 2028');
        expect(document).toContain('1.800');
        expect(document).toContain('9.000');
        expect(document).toContain('Sembilan Ribu Rupiah');
        expect(document).toContain(`( ${userName} )`);
        expect(document).not.toContain('{');
    });

    test('printing needs the receipt read permission', async () => {
        const clerk = await createMember(pool, business.tenantId, [
            'core.organization.manage',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            clerk.membershipId,
        );
        const session = browser();
        await session.login(clerk.email, clerk.password);
        for (const [code, id] of [
            ['core.purchase-receipt', receipt.id],
            ['core.purchase-return', returnId],
        ] as const)
            expect(
                (
                    await session.get(
                        `/api/v1/reports/${code}/records/${id}?format=docx`,
                    )
                ).status,
            ).toBe(403);
    });

    test.skipIf(!process.env.RENDERER_URL)(
        'the receipt PDF is A4 landscape and the return A4 portrait',
        async () => {
            const page = async (code: string, id: string) => {
                const response = await print(code, id, 'format=pdf');
                expect(response.status).toBe(200);
                const pdf = await getDocumentProxy(
                    new Uint8Array(await response.arrayBuffer()),
                );
                const { text: content } = await extractText(pdf, {
                    mergePages: true,
                });
                expect(content).toContain('B-BELI');
                return (await pdf.getPage(1)).view.map(Math.round);
            };
            expect(await page('core.purchase-receipt', receipt.id)).toEqual([
                0, 0, 842, 595,
            ]);
            expect(await page('core.purchase-return', returnId)).toEqual([
                0, 0, 595, 842,
            ]);
        },
    );
});
