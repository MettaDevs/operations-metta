import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { extractText, getDocumentProxy } from 'unpdf';
import { json } from '../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { documentText, paidReceipt } from '../../support/receipt-fixture.ts';
import {
    createMember,
    createTenant,
    grantAllOrganizations,
} from '../../support/tenant-fixtures.ts';

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
    let receiptFixture: Awaited<ReturnType<typeof paidReceipt>>;
    let cashier: Browser;
    let paymentId: string;
    let paymentNumber: string;
    const receipt = (id = paymentId, query = 'format=docx') =>
        `/api/v1/reports/core.payment-receipt/records/${id}?${query}`;

    beforeAll(async () => {
        receiptFixture = await paidReceipt(pool, browser, 'Klinik Uji Cetak');
        ({ cashier, paymentId, paymentNumber } = receiptFixture);
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
        const stranger = await receiptFixture.member([
            'core.organization.manage',
        ]);
        expect((await stranger.get(receipt())).status).toBe(403);
        const otherTenant = await createTenant(pool, 'Tenant lain');
        const outsiderMember = await createMember(pool, otherTenant, [
            'core.payment.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            otherTenant,
            outsiderMember.membershipId,
        );
        const outsider = browser();
        await outsider.login(outsiderMember.email, outsiderMember.password);
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
        const reader = await receiptFixture.member(
            ['core.payment.inquire'],
            offline,
        );
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
