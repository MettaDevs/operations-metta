import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import PizZip from 'pizzip';
import { paymentReceiptReport } from '../../../src/foundation/billing/index.ts';
import { reportShape } from '../../../src/platform/reporting/catalog.ts';
import {
    paragraph,
    wordDocument,
} from '../../../src/platform/reporting/index.ts';
import {
    cellFormats,
    excelWorkbook,
} from '../../../src/platform/reporting/xlsx.ts';
import {
    json,
    legalEntity,
    selectLegalEntity,
} from '../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { documentText, paidReceipt } from '../../support/receipt-fixture.ts';
import { readWorkbook } from '../../support/workbook-reader.ts';

type Layout = {
    ref: string;
    name: string;
    language: string;
    paper: { widthMm: number; heightMm: number } | null;
    source: string;
    is_default: boolean;
};

function layout(...lines: string[]): Uint8Array {
    return wordDocument({
        paper: { widthMm: 148, heightMm: 210 },
        marginMm: 10,
        font: 'Arial',
        fontSize: 10,
        body: lines.map((line) => paragraph(line)),
    });
}

function form(bytes: Uint8Array, name: string, language = 'id') {
    const body = new FormData();
    body.append(
        'file',
        new File([new Uint8Array(bytes)], name, {
            type: 'application/octet-stream',
        }),
    );
    body.append('name', name.replace(/\.(docx|xlsx|xlsm)$/, ''));
    body.append('language', language);
    return body;
}

// Layout cetak per legal entity (Custom Report Layouts dan Report Layout Selection BC): unggahan diperiksa, disimpan
// di database lingkungan, dipilih sebagai bawaan untuk satu legal entity saja, dan bisa dikembalikan ke bawaan.
describe.skipIf(!process.env.DB_HOST)('report layouts', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let fixture: Awaited<ReturnType<typeof paidReceipt>>;
    let admin: Browser;
    const base = '/api/v1/reports/core.payment-receipt';
    const receiptText = async (session: Browser, query = 'format=docx') =>
        documentText(
            new Uint8Array(
                await (
                    await session.get(
                        `${base}/records/${fixture.paymentId}?${query}`,
                    )
                ).arrayBuffer(),
            ),
        );
    const listed = async (session: Browser) =>
        (
            await json<{ data: Layout[] }>(
                await session.get(`${base}/layouts`),
                200,
            )
        ).data;

    beforeAll(async () => {
        fixture = await paidReceipt(pool, browser, 'Klinik Uji Layout', [
            'core.report-layout.manage',
        ]);
        admin = fixture.cashier;
    });

    test('an uploaded layout becomes the receipt of its legal entity once chosen, and going back to the built-in restores it', async () => {
        const uploaded = await json<{ data: Layout }>(
            await admin.upload(
                `${base}/layouts`,
                form(
                    layout(
                        'KUITANSI KLINIK UJI {number}',
                        'Jumlah {total} ({total_words} Rupiah)',
                        '{#services}{name}: {amount}{/services}',
                        '{letterhead.name}',
                    ),
                    'Kuitansi A5 klinik',
                ),
            ),
            201,
        );
        expect(uploaded.data).toMatchObject({
            name: 'Kuitansi A5 klinik',
            language: 'id',
            paper: { widthMm: 148, heightMm: 210 },
            source: 'upload',
            is_default: false,
        });
        expect(await receiptText(admin)).not.toContain('KLINIK UJI');

        await json(
            await admin.put(`${base}/layout-default`, {
                layout: uploaded.data.ref,
            }),
            200,
        );
        const custom = await receiptText(admin);
        expect(custom).toContain(
            `KUITANSI KLINIK UJI ${fixture.paymentNumber}`,
        );
        expect(custom).toContain('Jumlah 24.000 (Dua Puluh Empat Ribu Rupiah)');
        expect(custom).toContain('Klinik Pratama Uji');
        expect((await listed(admin)).find((item) => item.is_default)?.ref).toBe(
            uploaded.data.ref,
        );

        await json(
            await admin.put(`${base}/layout-default`, { layout: 'builtin:a4' }),
            200,
        );
        expect(await receiptText(admin)).toContain('KUITANSI');
        expect(await receiptText(admin)).not.toContain('KLINIK UJI');
    });

    test('a chosen layout belongs to one legal entity; another legal entity keeps the built-in', async () => {
        const uploaded = await json<{ data: Layout }>(
            await admin.upload(
                `${base}/layouts`,
                form(layout('LAYOUT LE PERTAMA {number}'), 'Khusus LE pertama'),
            ),
            201,
        );
        await json(
            await admin.put(`${base}/layout-default`, {
                layout: uploaded.data.ref,
            }),
            200,
        );
        const second = await legalEntity(admin, 'PT Klinik Uji Kedua');
        await selectLegalEntity(admin, fixture.membershipId, second);
        const layouts = await listed(admin);
        expect(layouts.map((item) => item.ref)).not.toContain(
            uploaded.data.ref,
        );
        expect(layouts.find((item) => item.is_default)?.ref).toBe('builtin:a4');
        await selectLegalEntity(
            admin,
            fixture.membershipId,
            fixture.legalEntityId,
        );
        expect(await receiptText(admin)).toContain('LAYOUT LE PERTAMA');
    });

    test('deleting the chosen layout falls back to the built-in, and the same file uploaded twice is one layout', async () => {
        const bytes = layout('DIHAPUS NANTI {number}');
        const first = await json<{ data: Layout }>(
            await admin.upload(`${base}/layouts`, form(bytes, 'Sementara')),
            201,
        );
        const again = await json<{ data: Layout }>(
            await admin.upload(
                `${base}/layouts`,
                form(bytes, 'Sementara lagi'),
            ),
            201,
        );
        expect(again.data.ref).toBe(first.data.ref);
        await json(
            await admin.put(`${base}/layout-default`, {
                layout: first.data.ref,
            }),
            200,
        );
        await json(
            await admin.delete(`${base}/layouts/${first.data.ref}`),
            200,
        );
        expect((await listed(admin)).find((item) => item.is_default)?.ref).toBe(
            'builtin:a4',
        );
        expect(await receiptText(admin)).not.toContain('DIHAPUS NANTI');
        const [row] = await pool.unsafe<{ deleted: boolean }[]>(
            'select deleted_at is not null as deleted from report_layouts where id = $1',
            [first.data.ref],
        );
        expect(row?.deleted).toBe(true);
    });

    test('an upload with an unknown tag, a broken loop, a macro, or no Word document is refused with the reason', async () => {
        const refused = async (body: FormData) =>
            (
                await json<{ errors: Record<string, string[]> }>(
                    await admin.upload(`${base}/layouts`, body),
                    422,
                )
            ).errors.file?.[0] ?? '';
        expect(
            await refused(form(layout('{number} {nomor_pasien}'), 'Salah tag')),
        ).toContain('{nomor_pasien}');
        expect(
            await refused(form(layout('{#services}{name}'), 'Belum ditutup')),
        ).toContain('belum ditutup');
        const macro = new PizZip(layout('{number}'));
        macro.file('word/vbaProject.bin', 'x');
        expect(
            await refused(
                form(macro.generate({ type: 'uint8array' }), 'Bermakro'),
            ),
        ).toContain('makro');
        expect(
            await refused(form(new TextEncoder().encode('bukan word'), 'Teks')),
        ).toContain('bukan dokumen Word');
    });

    test('managing layouts needs the layout duty and the receipt permission; printing needs only the receipt permission', async () => {
        const reader = await fixture.member(['core.payment.inquire']);
        expect(
            (
                await reader.upload(
                    `${base}/layouts`,
                    form(layout('{number}'), 'X'),
                )
            ).status,
        ).toBe(403);
        expect((await listed(reader)).length).toBeGreaterThan(0);
        const layoutAdmin = await fixture.member(['core.report-layout.manage']);
        expect(
            (
                await layoutAdmin.upload(
                    `${base}/layouts`,
                    form(layout('{number}'), 'Y'),
                )
            ).status,
        ).toBe(404);
        const catalogue = await json<{ data: { code: string }[] }>(
            await layoutAdmin.get('/api/v1/report-layouts'),
            200,
        );
        expect(catalogue.data).toEqual([]);
        const full = await json<{
            data: { code: string; fields: { tag: string }[] }[];
        }>(await admin.get('/api/v1/report-layouts'), 200);
        const receipt = full.data.find(
            (report) => report.code === paymentReceiptReport.code,
        );
        expect(receipt?.fields.map((entry) => entry.tag)).toContain(
            'total_words',
        );
        expect(receipt?.fields.map((entry) => entry.tag)).toContain(
            'letterhead.name',
        );
    });

    test('any report takes an uploaded Excel layout: it is listed as Excel, prints as a workbook with real values, and refuses PDF', async () => {
        const workbook = excelWorkbook(
            reportShape(paymentReceiptReport.fields),
            cellFormats({ amountDecimals: 0, unitAmountDecimals: 0 }),
            {
                sheets: [
                    {
                        name: 'Kuitansi',
                        orientation: 'portrait',
                        widths: [24, 20],
                        cells: [
                            { at: 'A1', content: { name: 'letterhead.name' } },
                            { at: 'A2', content: { name: 'number' } },
                            {
                                at: 'A3',
                                content: { formula: 'SUM(services[amount])' },
                            },
                        ],
                    },
                ],
                dataSheets: [{ table: 'services', name: 'Layanan' }],
            },
        );
        const uploaded = await json<{ data: Layout & { format: string } }>(
            await admin.upload(
                `${base}/layouts`,
                form(workbook, 'Kuitansi Excel.xlsx'),
            ),
            201,
        );
        expect(uploaded.data).toMatchObject({
            name: 'Kuitansi Excel',
            format: 'xlsx',
            paper: null,
            source: 'upload',
        });
        const refused = await admin.get(
            `${base}/records/${fixture.paymentId}?format=pdf&layout=${uploaded.data.ref}`,
        );
        expect(refused.status).toBe(422);
        await json(
            await admin.put(`${base}/layout-default`, {
                layout: uploaded.data.ref,
            }),
            200,
        );
        const printed = await admin
            .get(`${base}/records/${fixture.paymentId}`)
            .finally(() =>
                admin.put(`${base}/layout-default`, { layout: 'builtin:a4' }),
            );
        expect(printed.status).toBe(200);
        expect(printed.headers.get('content-type')).toContain('spreadsheetml');
        expect(printed.headers.get('content-disposition')).toContain(
            encodeURIComponent(`Kuitansi ${fixture.paymentNumber}.xlsx`),
        );
        const book = readWorkbook(new Uint8Array(await printed.arrayBuffer()));
        expect(book.value('Report.number').value).toBe(fixture.paymentNumber);
        expect(book.value('Report.letterhead.name').value).toBe(
            'Klinik Pratama Uji',
        );
        expect(book.value('Report.total')).toMatchObject({
            kind: 'number',
            value: '24000',
            format: '#,##0',
        });
        expect(book.value('Report.total_words').value).toBe(
            'Dua Puluh Empat Ribu',
        );
        expect(
            book
                .table('services')
                .rows.map((row) => row.map((cell) => cell.value)),
        ).toEqual([['Obat dan BHP', '24000']]);
    });

    test('an Excel layout with a macro or a column the report does not have is refused with the reason', async () => {
        const refused = async (body: FormData) =>
            (
                await json<{ errors: Record<string, string[]> }>(
                    await admin.upload(`${base}/layouts`, body),
                    422,
                )
            ).errors.file?.[0] ?? '';
        const shape = reportShape(paymentReceiptReport.fields);
        const formats = cellFormats({
            amountDecimals: 0,
            unitAmountDecimals: 0,
        });
        const macro = new PizZip(
            excelWorkbook(shape, formats, { sheets: [], dataSheets: [] }),
        );
        macro.file('xl/vbaProject.bin', 'x');
        expect(
            await refused(
                form(macro.generate({ type: 'uint8array' }), 'Bermakro.xlsm'),
            ),
        ).toContain('makro');
        const unknown = excelWorkbook(shape, formats, {
            sheets: [
                {
                    name: 'Kuitansi',
                    orientation: 'portrait',
                    widths: [],
                    cells: [
                        {
                            at: 'A1',
                            content: { formula: 'SUM(services[harga])' },
                        },
                    ],
                },
            ],
            dataSheets: [],
        });
        expect(await refused(form(unknown, 'Salah kolom.xlsx'))).toContain(
            'services[harga]',
        );
    });

    test('a layout downloads as Word and previews with sample data and the real letterhead', async () => {
        const download = await admin.get(`${base}/layouts/builtin:a4/file`);
        expect(download.status).toBe(200);
        expect(
            documentText(new Uint8Array(await download.arrayBuffer())),
        ).toContain('{total_words}');
        const preview = await admin.get(
            `${base}/layouts/builtin:a4/preview?format=docx`,
        );
        expect(preview.status).toBe(200);
        const text = documentText(new Uint8Array(await preview.arrayBuffer()));
        expect(text).toContain(paymentReceiptReport.sample.values.number ?? '');
        expect(text).toContain('Klinik Pratama Uji');
    });

    test('the letterhead of an organization is edited in one place and printed on the next receipt', async () => {
        await json(
            await admin.put(`/api/v1/letterheads/${fixture.legalEntityId}`, {
                display_name: 'Klinik Pratama Uji Baru',
                parent_lines: 'Yayasan Sehat Uji\nCabang Kota Contoh',
                tax_id: '',
                registration_id: 'Izin 456/2026',
                footer_text: 'Simpan kuitansi ini',
            }),
            200,
        );
        const listedHeads = await json<{
            data: { organization_id: string; parent_lines: string[] }[];
        }>(await admin.get('/api/v1/letterheads'), 200);
        expect(
            listedHeads.data.find(
                (row) => row.organization_id === fixture.legalEntityId,
            )?.parent_lines,
        ).toEqual(['Yayasan Sehat Uji', 'Cabang Kota Contoh']);
        const text = await receiptText(admin);
        expect(text).toContain('Klinik Pratama Uji Baru');
        expect(text).toContain('Cabang Kota Contoh');
        expect(text).toContain('Simpan kuitansi ini');
        const reader = await fixture.member(['core.report-layout.inquire']);
        expect(
            (
                await reader.put(
                    `/api/v1/letterheads/${fixture.legalEntityId}`,
                    {
                        display_name: 'Tidak boleh',
                    },
                )
            ).status,
        ).toBe(403);
    });
});
