import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    paragraph,
    wordDocument,
} from '../../../src/platform/reporting/index.ts';
import { json } from '../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { documentText, paidReceipt } from '../../support/receipt-fixture.ts';

type Signer = {
    id: string;
    title: string;
    name: string;
    id_number: string | null;
    report_code: string | null;
};
type Letterheads = {
    data: { organization_id: string; signers: Signer[] }[];
    reports: { code: string; name: string }[];
};

const signerLayout = wordDocument({
    paper: { widthMm: 148, heightMm: 210 },
    marginMm: 10,
    font: 'Arial',
    fontSize: 10,
    body: [
        paragraph('KUITANSI {number}'),
        paragraph('{#signers}'),
        paragraph('Mengetahui {title}: {name} [{id_number}]'),
        paragraph('{/signers}'),
    ],
});

// Penanda tangan dokumen (Officials F&O) disimpan per organisasi di kartu Kop surat dan dicetak lewat tag {#signers}:
// milik unit kerja dokumen bila ada, kalau tidak milik legal entity-nya, dan hanya yang berlaku untuk semua dokumen
// atau untuk laporan itu.
describe.skipIf(!process.env.DB_HOST)('print signers', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let fixture: Awaited<ReturnType<typeof paidReceipt>>;
    let admin: Browser;
    let unitId: string;
    const base = '/api/v1/reports/core.payment-receipt';
    const printed = async () =>
        documentText(
            new Uint8Array(
                await (
                    await admin.get(
                        `${base}/records/${fixture.paymentId}?format=docx`,
                    )
                ).arrayBuffer(),
            ),
        );
    const signersOf = async (organizationId: string) =>
        (
            await json<Letterheads>(await admin.get('/api/v1/letterheads'), 200)
        ).data.find((row) => row.organization_id === organizationId)?.signers ??
        [];
    const save = (organizationId: string, signers: unknown[]) =>
        admin.put(`/api/v1/letterheads/${organizationId}`, { signers });

    beforeAll(async () => {
        fixture = await paidReceipt(pool, browser, 'Klinik Uji Penanda', [
            'core.report-layout.manage',
        ]);
        admin = fixture.cashier;
        // Tagihan fixture tidak membawa unit kerja; tagihan yang diterbitkan sebuah unit dibuat dengan mengisinya.
        unitId = (
            await json<{ data: { id: string } }>(
                await admin.post('/api/v1/organizations', {
                    classification: 'operating_unit',
                    name: 'Unit Uji Penanda',
                    operating_unit_type: 'department',
                    operating_unit_number: `U${Math.floor(Math.random() * 1e6)}`,
                }),
                201,
            )
        ).data.id;
        await pool.unsafe(
            `update tagihan_kasir t set operating_unit_id = $1 from kasir k
             where k.id = $2 and t.tenant_id = k.tenant_id and t.sumber_dokumen_id = k.sumber_dokumen_id`,
            [unitId, fixture.paymentId],
        );
        const uploaded = await json<{ data: { ref: string } }>(
            await admin.upload(
                `${base}/layouts`,
                (() => {
                    const body = new FormData();
                    body.append(
                        'file',
                        new File(
                            [new Uint8Array(signerLayout)],
                            'penanda.docx',
                        ),
                    );
                    body.append('name', 'Kuitansi dengan penanda tangan');
                    body.append('language', 'id');
                    return body;
                })(),
            ),
            201,
        );
        await json(
            await admin.put(`${base}/layout-default`, {
                layout: uploaded.data.ref,
            }),
            200,
        );
    });

    test('a document without signers prints no signer block', async () => {
        const text = await printed();
        expect(text).toContain(`KUITANSI ${fixture.paymentNumber}`);
        expect(text).not.toContain('Mengetahui');
    });

    test('legal entity signers print in the order they were saved, limited to their document', async () => {
        await json(
            await save(fixture.legalEntityId, [
                {
                    title: 'Kepala Klinik',
                    name: 'Pejabat Satu',
                    id_number: 'NIP 1980',
                },
                {
                    title: 'Apoteker',
                    name: 'Pejabat Dua',
                    report_code: 'pharmacy.drug-label',
                },
                {
                    title: 'Bendahara',
                    name: 'Pejabat Tiga',
                    report_code: 'core.payment-receipt',
                },
            ]),
            200,
        );
        const text = await printed();
        expect(text).toContain(
            'Mengetahui Kepala Klinik: Pejabat Satu [NIP 1980]',
        );
        expect(text).toContain('Mengetahui Bendahara: Pejabat Tiga []');
        expect(text).not.toContain('Pejabat Dua');
        expect(text.indexOf('Pejabat Satu')).toBeLessThan(
            text.indexOf('Pejabat Tiga'),
        );
    });

    test('signers of the issuing unit replace those of the legal entity', async () => {
        await json(
            await save(unitId, [
                { title: 'Kepala Unit', name: 'Pejabat Unit' },
            ]),
            200,
        );
        const text = await printed();
        expect(text).toContain('Mengetahui Kepala Unit: Pejabat Unit');
        expect(text).not.toContain('Pejabat Satu');
    });

    test('saving the list keeps the rows sent, edits them in place, and archives the rest', async () => {
        const before = await signersOf(fixture.legalEntityId);
        const first = before[0];
        if (!first) throw new Error('Penanda tangan belum tersimpan.');
        await json(
            await save(fixture.legalEntityId, [
                { ...first, name: 'Pejabat Satu Baru' },
            ]),
            200,
        );
        const after = await signersOf(fixture.legalEntityId);
        expect(after.map((signer) => [signer.id, signer.name])).toEqual([
            [first.id, 'Pejabat Satu Baru'],
        ]);
        const [archived] = await pool.unsafe<{ count: string }[]>(
            `select count(*)::text as count from penanda_tangan_cetak
             where organization_id = $1 and deleted_at is not null`,
            [fixture.legalEntityId],
        );
        expect(archived?.count).toBe('2');
    });

    test('a signer needs a title and a name, and a document the catalog knows', async () => {
        const response = await save(fixture.legalEntityId, [
            { title: '', name: 'Tanpa Jabatan' },
            {
                title: 'Kepala',
                name: 'Dokumen Asing',
                report_code: 'x.unknown',
            },
        ]);
        expect(response.status).toBe(422);
        const { errors } = (await response.json()) as {
            errors: Record<string, string[]>;
        };
        expect(Object.keys(errors)).toEqual(['signers.0.title']);
        const unknown = await save(fixture.legalEntityId, [
            {
                title: 'Kepala',
                name: 'Dokumen Asing',
                report_code: 'x.unknown',
            },
        ]);
        expect(
            (
                (await unknown.json()) as {
                    errors: Record<string, string[]>;
                }
            ).errors,
        ).toEqual({ 'signers.0.report_code': ['Dokumen ini tidak dikenal.'] });
    });

    test('the layout screen lists the signer tags for layout authors', async () => {
        const catalogue = await json<{
            data: { code: string; fields: { tag: string }[] }[];
        }>(await admin.get('/api/v1/report-layouts'), 200);
        const tags = catalogue.data
            .find((report) => report.code === 'core.payment-receipt')
            ?.fields.map((entry) => entry.tag);
        expect(tags).toContain('signers');
        expect(tags).toContain('signers.name');
    });
});
