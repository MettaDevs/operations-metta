import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { reports } from '../../../src/main.ts';
import { unknownTags } from '../../../src/platform/reporting/catalog.ts';
import {
    defineReport,
    field,
    paragraph,
    reportCatalog,
    wordDocument,
    type BuiltinLayout,
} from '../../../src/platform/reporting/index.ts';

const fields = {
    patient_name: field.text('Nama pasien'),
    items: field.lines('Obat', { drug: field.text('Obat') }),
    printed_ok: field.flag('Siap'),
};

function layout(...lines: string[]): Uint8Array {
    return wordDocument({
        paper: { widthMm: 210, heightMm: 297 },
        marginMm: 10,
        font: 'Arial',
        fontSize: 10,
        body: lines.map((line) => paragraph(line)),
    });
}

function report(
    code: string,
    layouts: BuiltinLayout[],
    permission = 'test.thing.read',
) {
    const [first, ...rest] = layouts;
    if (!first) throw new Error('Butuh layout.');
    return defineReport({
        code,
        name: 'Uji',
        moduleId: 'test',
        permission,
        workspace: () => Promise.reject(new Error('Tidak dipakai.')),
        fields,
        sample: {
            legalEntityId: 'x',
            operatingUnitId: null,
            fileName: 'Uji',
            values: { patient_name: 'A', items: [], printed_ok: true },
        },
        layouts: [first, ...rest],
        load: () => Promise.resolve(null),
    });
}

const builtin = (document: Uint8Array): BuiltinLayout => ({
    format: 'docx',
    key: 'a4',
    name: 'A4',
    language: 'id',
    document: () => document,
});

describe('report catalog', () => {
    test('a tag inside a loop may name a field of the line, a field of the root, or a loop helper', () => {
        expect(
            unknownTags(
                fields,
                layout(
                    '{#items}{$no} {drug} {patient_name} {letterhead.name} {printed.at_date}{/items}',
                    '{#printed_ok}{patient_name}{/printed_ok}',
                ),
            ),
        ).toEqual([]);
    });

    test('a tag that names nothing is reported with its path', () => {
        expect(
            unknownTags(
                fields,
                layout('{patient}', '{#items}{dose}{/items}', '{$no}'),
            ).sort(),
        ).toEqual(['$no', 'items.dose', 'patient'].sort());
    });

    test('a built-in layout with an unknown tag stops the process at start, so CI fails before release', () => {
        expect(() =>
            reportCatalog([report('test.a', [builtin(layout('{patient}'))])]),
        ).toThrow('tag yang tidak dikenal: patient');
    });

    test('codes are unique and permissions belong to the module that owns the dataset', () => {
        const ok = builtin(layout('{patient_name}'));
        expect(() =>
            reportCatalog([report('test.a', [ok]), report('test.a', [ok])]),
        ).toThrow('didaftarkan dua kali');
        expect(() =>
            reportCatalog([report('test.a', [ok], 'core.payment.read')]),
        ).toThrow('harus milik test');
    });

    test('a dataset field may not take a name the engine fills for every report', () => {
        const taken = defineReport({
            code: 'test.a',
            name: 'Uji',
            moduleId: 'test',
            permission: 'test.thing.read',
            workspace: () => Promise.reject(new Error('Tidak dipakai.')),
            fields: { signers: field.text('Penanda tangan') },
            sample: {
                legalEntityId: 'x',
                operatingUnitId: null,
                fileName: 'Uji',
                values: { signers: 'B' },
            },
            layouts: [builtin(layout('{signers}'))],
            load: () => Promise.resolve(null),
        });
        expect(() => reportCatalog([taken])).toThrow(
            'Field signers laporan test.a dipakai mesin cetak.',
        );
    });

    test('a field key that cannot be an Excel name stops the process, because any legal entity may upload an Excel layout', () => {
        const cellLike = defineReport({
            code: 'test.a',
            name: 'Uji',
            moduleId: 'test',
            permission: 'test.thing.read',
            workspace: () => Promise.reject(new Error('Tidak dipakai.')),
            fields: { a1: field.lines('Baris', { drug: field.text('Obat') }) },
            sample: {
                legalEntityId: 'x',
                operatingUnitId: null,
                fileName: 'Uji',
                values: { a1: [] },
            },
            layouts: [builtin(layout('{#a1}{drug}{/a1}'))],
            load: () => Promise.resolve(null),
        });
        expect(() => reportCatalog([cellLike])).toThrow(
            'Laporan test.a: Kunci ini tidak bisa menjadi nama di Excel: a1.',
        );
    });

    test('an Excel built-in layout that names a column the report does not have stops the process', () => {
        const excel: BuiltinLayout = {
            format: 'xlsx',
            key: 'per-obat',
            name: 'Per obat',
            language: 'id',
            workbook: {
                sheets: [
                    {
                        name: 'Ringkasan',
                        orientation: 'portrait',
                        widths: [],
                        cells: [
                            { at: 'A1', content: { name: 'patient_name' } },
                        ],
                        pivot: {
                            table: 'items',
                            at: 'A3',
                            rows: ['drug'],
                            values: ['dose'],
                            grandTotalCaption: 'JUMLAH',
                        },
                    },
                ],
                visibleTables: [],
            },
        };
        expect(() => reportCatalog([report('test.a', [excel])])).toThrow(
            'Layout bawaan test.a/per-obat: Pivot layout bawaan memakai kolom items[dose] yang tidak ada.',
        );
    });

    test('every print action on a screen names a report in the catalog', async () => {
        const used: string[] = [];
        for (const root of ['src', 'modules'])
            for await (const path of new Glob('**/*.tsx').scan(root)) {
                const source = await Bun.file(`${root}/${path}`).text();
                for (const match of source.matchAll(
                    /<PrintAction\s+report="([^"]+)"/g,
                ))
                    used.push(match[1] ?? '');
            }
        expect(used.length).toBeGreaterThan(0);
        expect(used.filter((code) => !reports.has(code))).toEqual([]);
    });
});
