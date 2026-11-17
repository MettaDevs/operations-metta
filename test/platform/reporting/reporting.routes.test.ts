import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import PizZip from 'pizzip';
import { extractText, getDocumentProxy } from 'unpdf';
import {
    registerBillingEventHandlers,
    replaceSaleBill,
} from '../../../src/foundation/billing/index.ts';
import { Database } from '../../../src/platform/database/index.ts';
import { createBillingBusiness, json } from '../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import {
    createMember,
    createTenant,
    grantAllOrganizations,
    setCurrencyPrecision,
} from '../../support/tenant-fixtures.ts';

function documentText(docx: Uint8Array): string {
    const xml = new PizZip(docx).file('word/document.xml')?.asText() ?? '';
    return xml
        .replaceAll(/<\/w:p>/g, '\n')
        .replaceAll(/<[^>]+>/g, '')
        .replaceAll(/[ \t]+/g, ' ');
}

// Mesin cetak lewat dokumen pertamanya, kuitansi kasir: dataset disaring tenant dan legal entity, izin baca pembayaran
// adalah izin cetaknya, kop dari identitas cetak legal entity, angka dari presisi mata uang tenant, bahasa dari layout,
// dan PDF dari Gotenberg bila RENDERER_URL diisi (CI menyalakannya). Diperiksa dari berkas yang diunduh.
describe.skipIf(!process.env.DB_HOST)('report printing', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    const offline = operationsTestApp({ RENDERER_URL: '' });
    afterAll(async () => {
        await close();
        await offline.close();
    });
    let tenantId: string;
    let cashier: Browser;
    let paymentId: string;
    let paymentNumber: string;
    const receipt = (id = paymentId, query = 'format=docx') =>
        `/api/v1/reports/core.payment-receipt/records/${id}?${query}`;

    async function login(
        app: Pick<typeof offline, 'pool' | 'browser'>,
        duties: string[],
        tenant = tenantId,
    ) {
        const member = await createMember(app.pool, tenant, duties);
        await grantAllOrganizations(app.pool, tenant, member.membershipId);
        const session = app.browser();
        await session.login(member.email, member.password);
        return session;
    }

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Cetak',
            [
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
            ],
        );
        tenantId = business.tenantId;
        cashier = business.admin;
        await setCurrencyPrecision(pool, tenantId, {
            amount_decimals: 0,
            unit_amount_decimals: 2,
            invoice_rounding_precision: '1',
            invoice_rounding_type: 'nearest',
        });
        await pool.unsafe(
            `update legal_entities set timezone = 'Asia/Makassar' where organization_id = $1`,
            [business.legalEntityId],
        );
        await pool.unsafe(
            `insert into print_identities (id, tenant_id, organization_id, display_name, parent_lines, tax_id,
                                           registration_id, footer_text, logos, created_at, updated_at)
             values ($1, $2, $3, 'Klinik Pratama Uji', '["Yayasan Sehat Uji"]', '01.234.567.8-901.000',
                     'Izin 123/2026', 'Terima kasih atas kunjungan Anda', '[]', now(), now())`,
            [Bun.randomUUIDv7(), tenantId, business.legalEntityId],
        );
        await json(
            await cashier.post('/api/v1/billing/payment-methods', {
                code: 'TUN',
                name: 'Tunai',
                behavior: 'tunai',
                counted_at_close: true,
            }),
            201,
        );
        await json(await cashier.post('/api/v1/billing/clerks/start', {}), 201);
        const documentId = Bun.randomUUIDv7();
        const connection = await pool.reserve();
        let version: number;
        try {
            const db = new Database(connection, undefined, Bun.randomUUIDv7());
            ({ version } = await db.transaction(() =>
                replaceSaleBill(db, {
                    tenantId,
                    legalEntityId: business.legalEntityId,
                    operatingUnitId: null,
                    module: 'pharmacy',
                    documentId,
                    number: 'OTC-0001',
                    date: '2026-11-16',
                    buyer: { partyId: null, name: 'Budi Contoh' },
                    group: 'OBAT',
                    fees: [],
                    lines: [
                        {
                            lineId: Bun.randomUUIDv7(),
                            item: {
                                id: Bun.randomUUIDv7(),
                                code: 'PCT',
                                name: 'Parasetamol',
                            },
                            quantity: '10',
                            unitPrice: '1500',
                            discountPercent: '0',
                        },
                        {
                            lineId: Bun.randomUUIDv7(),
                            item: {
                                id: Bun.randomUUIDv7(),
                                code: 'VTC',
                                name: 'Vitamin C',
                            },
                            quantity: '2',
                            unitPrice: '5000',
                            discountPercent: '10',
                        },
                    ],
                }),
            ));
        } finally {
            connection.release();
        }
        const paid = await json<{ data: { id: string; number: string } }>(
            await cashier.post(
                `/api/v1/billing/visits/${documentId}/payments`,
                { version, received: '50000' },
            ),
            201,
        );
        paymentId = paid.data.id;
        paymentNumber = paid.data.number;
    });

    test('the receipt carries the payment, the amounts in the tenant precision, the words, and the legal entity letterhead', async () => {
        const response = await cashier.get(receipt());
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain(
            'wordprocessingml',
        );
        expect(response.headers.get('content-disposition')).toContain(
            encodeURIComponent(`Kuitansi ${paymentNumber}.docx`),
        );
        const text = documentText(new Uint8Array(await response.arrayBuffer()));
        expect(text).toContain('Yayasan Sehat Uji');
        expect(text).toContain('Klinik Pratama Uji');
        expect(text).toContain('KUITANSI');
        expect(text).toContain(paymentNumber);
        expect(text).toContain('Budi Contoh');
        expect(text).toContain('24.000');
        expect(text).toContain('Dua Puluh Empat Ribu Rupiah');
        expect(text).toContain('50.000');
        expect(text).toContain('26.000');
        expect(text).toMatch(/WITA/);
        expect(text).toContain('Terima kasih atas kunjungan Anda');
        expect(text).not.toContain('{');
    });

    test('the English layout writes the same payment in English with English number grouping', async () => {
        const text = documentText(
            new Uint8Array(
                await (
                    await cashier.get(
                        receipt(paymentId, 'format=docx&layout=builtin:a4-en'),
                    )
                ).arrayBuffer(),
            ),
        );
        expect(text).toContain('RECEIPT');
        expect(text).toContain('24,000');
        expect(text).toContain('Twenty-Four Thousand Rupiah');
    });

    test('the print menu lists the built-in layouts with their paper sizes', async () => {
        const { data } = await json<{
            data: {
                ref: string;
                paper: { widthMm: number; heightMm: number };
                is_default: boolean;
            }[];
        }>(
            await cashier.get('/api/v1/reports/core.payment-receipt/layouts'),
            200,
        );
        expect(data.map((layout) => [layout.ref, layout.paper])).toEqual([
            ['builtin:a4', { widthMm: 210, heightMm: 297 }],
            ['builtin:a4-en', { widthMm: 210, heightMm: 297 }],
            ['builtin:thermal-76', { widthMm: 76, heightMm: 200 }],
        ]);
        expect(data[0]?.is_default).toBe(true);
    });

    test('printing needs the read permission of the payment, and another tenant cannot find it', async () => {
        const stranger = await login({ pool, browser }, [
            'core.organization.manage',
        ]);
        expect((await stranger.get(receipt())).status).toBe(403);
        const otherTenant = await createTenant(pool, 'Tenant lain');
        const outsider = await login(
            { pool, browser },
            ['core.payment.inquire'],
            otherTenant,
        );
        expect((await outsider.get(receipt())).status).toBe(404);
        expect(
            (
                await cashier.get(
                    '/api/v1/reports/core.unknown/records/x?format=docx',
                )
            ).status,
        ).toBe(404);
        expect((await cashier.get(receipt(Bun.randomUUIDv7()))).status).toBe(
            404,
        );
        expect(
            (
                await cashier.get(
                    receipt(paymentId, 'format=docx&layout=builtin:nope'),
                )
            ).status,
        ).toBe(422);
    });

    test('without a renderer the PDF is refused with a code the screen turns into a Word download', async () => {
        const reader = await login(offline, ['core.payment.inquire']);
        const response = await reader.get(receipt(paymentId, 'format=pdf'));
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
            error: { code: 'renderer_unavailable' },
        });
        expect((await reader.get(receipt())).status).toBe(200);
    });

    test.skipIf(!process.env.RENDERER_URL)(
        'the PDF is A4 and shows the same numbers as the payment',
        async () => {
            const response = await cashier.get(
                receipt(paymentId, 'format=pdf'),
            );
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toBe(
                'application/pdf',
            );
            const pdf = await getDocumentProxy(
                new Uint8Array(await response.arrayBuffer()),
            );
            const page = await pdf.getPage(1);
            expect(page.view.map(Math.round)).toEqual([0, 0, 595, 842]);
            const { text } = await extractText(pdf, { mergePages: true });
            expect(text).toContain(paymentNumber);
            expect(text).toContain('24.000');
            expect(text).toContain('Dua Puluh Empat Ribu Rupiah');
        },
    );
});
