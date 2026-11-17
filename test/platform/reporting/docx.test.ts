import { describe, expect, test } from 'bun:test';
import PizZip from 'pizzip';
import {
    fillDocx,
    layoutTags,
    paperOf,
} from '../../../src/platform/reporting/docx.ts';
import {
    cell,
    paragraph,
    when,
    wordDocument,
} from '../../../src/platform/reporting/index.ts';

function text(docx: Uint8Array): string {
    const xml = new PizZip(docx).file('word/document.xml')?.asText() ?? '';
    return xml
        .replaceAll(/<w:br w:type="page"\/>/g, '[PAGE]')
        .replaceAll(/<w:br\/>/g, '\n')
        .replaceAll(/<\/w:p>/g, '|')
        .replaceAll(/<[^>]+>/g, '');
}

const label = wordDocument({
    paper: { widthMm: 96, heightMm: 200 },
    marginMm: 5,
    font: 'Arial',
    fontSize: 9,
    body: [
        ...when('letterhead.name', [paragraph('{letterhead.name}')]),
        paragraph('{#items}{$no}. {drug} {^$last}'),
        paragraph([{ pageBreak: true }]),
        paragraph('{/$last}{/items}'),
        {
            kind: 'table',
            widths: [1, 1],
            borders: 'grid',
            rows: [
                {
                    cells: [
                        cell('{#items}{drug}'),
                        cell('{patient}{/items}', { align: 'right' }),
                    ],
                },
            ],
        },
        paragraph('{note}'),
    ],
});

describe('word layouts', () => {
    test('the paper size of a layout is the one its document carries', () => {
        expect(paperOf(label)).toEqual({ widthMm: 96, heightMm: 200 });
    });

    test('loops repeat paragraphs and table rows, $no and $last work inside loops, and empty conditional lines vanish', () => {
        const filled = text(
            fillDocx(label, {
                letterhead: { name: '' },
                patient: 'Pasien Contoh',
                items: [{ drug: 'Parasetamol' }, { drug: 'Amoksisilin' }],
                note: 'Baris satu\nBaris dua',
            }),
        );
        expect(filled).toContain('1. Parasetamol');
        expect(filled).toContain('2. Amoksisilin');
        expect(filled.match(/\[PAGE\]/g)?.length).toBe(1);
        expect(filled).toContain('Parasetamol|Pasien Contoh');
        expect(filled).toContain('Amoksisilin|Pasien Contoh');
        expect(filled).toContain('Baris satu\nBaris dua');
        expect(filled).not.toContain('{');
        expect(filled.startsWith('|')).toBe(false);
    });

    test('tags are read as paths from the root, including tags inside loops', () => {
        expect(layoutTags(label).sort()).toEqual(
            [
                'letterhead.name',
                'letterhead.name.letterhead.name',
                'items',
                'items.$no',
                'items.drug',
                'items.$last',
                'items.patient',
                'note',
            ].sort(),
        );
    });

    test('a broken template is refused with the tag that breaks it', () => {
        const broken = wordDocument({
            paper: { widthMm: 210, heightMm: 297 },
            marginMm: 10,
            font: 'Arial',
            fontSize: 10,
            body: [paragraph('{#items}{drug}')],
        });
        expect(() => layoutTags(broken)).toThrow();
    });
});
