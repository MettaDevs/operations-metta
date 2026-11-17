import Docxtemplater, { type DXT } from 'docxtemplater';
import PizZip from 'pizzip';
import type { TemplateView } from './format.ts';

// Semua pengetahuan tentang berkas Word ada di sini: mengisi layout, membaca ukuran kertas dan tag-nya, dan menulis
// layout bawaan. Tag memakai sintaks docxtemplater: `{field}`, `{#baris}…{/baris}` untuk perulangan (baris tabel
// berulang bila tag pembuka dan penutupnya di satu baris), `{#flag}…{/flag}` dan `{^flag}…{/flag}` untuk syarat.
// `{$first}`, `{$last}`, dan `{$no}` (nomor urut mulai 1) tersedia di dalam perulangan.

function lookup(scope: unknown, path: string[]): unknown {
    let value: unknown = scope;
    for (const key of path) {
        if (value === null || typeof value !== 'object') return undefined;
        value = Reflect.get(value, key);
    }
    return value;
}

function parser(tag: string): DXT.Parser {
    const trimmed = tag.trim();
    const path = trimmed.split('.');
    return {
        get(scope: unknown, context: DXT.ParserContext): unknown {
            if (trimmed === '.') return scope;
            const depth = context.scopePathItem.length;
            if (
                trimmed === '$first' ||
                trimmed === '$last' ||
                trimmed === '$no'
            ) {
                if (depth === 0) return undefined;
                const index = context.scopePathItem[depth - 1] ?? 0;
                const length = context.scopePathLength[depth - 1] ?? 0;
                if (trimmed === '$first') return index === 0;
                if (trimmed === '$last') return index === length - 1;
                return String(index + 1);
            }
            return lookup(scope, path);
        },
    };
}

function template(layout: Uint8Array, modules: DXT.Module[] = []) {
    return new Docxtemplater(new PizZip(layout), {
        paragraphLoop: true,
        linebreaks: true,
        parser,
        nullGetter: () => '',
        errorLogging: false,
        modules,
    });
}

export function fillDocx(layout: Uint8Array, view: TemplateView): Uint8Array {
    const document = template(layout);
    document.render(view);
    return document
        .getZip()
        .generate({ type: 'uint8array', compression: 'DEFLATE' });
}

export type Paper = { widthMm: number; heightMm: number };

const twipsPerMm = 1440 / 25.4;

// Ukuran kertas dibaca dari section pertama dokumen, jadi ukuran kertas sebuah layout tidak pernah ditulis dua kali:
// yang dicetak LibreOffice adalah ukuran yang dibawa dokumen itu sendiri.
export function paperOf(layout: Uint8Array): Paper | null {
    const xml = new PizZip(layout).file('word/document.xml')?.asText();
    const size = xml ? /<w:pgSz\b[^>]*>/.exec(xml)?.[0] : undefined;
    if (!size) return null;
    const width = Number(/\bw:w="(\d+)"/.exec(size)?.[1]);
    const height = Number(/\bw:h="(\d+)"/.exec(size)?.[1]);
    if (!width || !height) return null;
    return {
        widthMm: Math.round(width / twipsPerMm),
        heightMm: Math.round(height / twipsPerMm),
    };
}

// Tag yang dipakai sebuah layout, sebagai path bertitik dari akar (`services.name` untuk tag di dalam `{#services}`),
// dari dokumen, header, dan footer. Sintaks yang rusak, misalnya perulangan yang tidak ditutup, melempar error
// docxtemplater. InspectModule bawaan docxtemplater tidak dipakai karena menarik lodash. Hook postparse dipanggil juga
// untuk isi setiap perulangan, jadi yang dibaca hanya hasil panggilan yang bukan isi perulangan lain.
export function layoutTags(layout: Uint8Array): string[] {
    const calls: DXT.Part[][] = [];
    template(layout, [
        {
            name: 'LayoutTags',
            postparse(parsed: DXT.Part[]) {
                calls.push(parsed);
                return parsed;
            },
        },
    ]);
    const nested = new Set<DXT.Part[]>();
    for (const parts of calls)
        for (const part of parts)
            if (part.subparsed) nested.add(part.subparsed);
    const tags = new Set<string>();
    const collect = (parts: DXT.Part[], prefix: string) => {
        for (const part of parts) {
            if (part.type !== 'placeholder') continue;
            tags.add(prefix + part.value);
            if (part.subparsed)
                collect(part.subparsed, `${prefix}${part.value}.`);
        }
    };
    for (const parts of calls) if (!nested.has(parts)) collect(parts, '');
    return [...tags];
}

// Penulis layout bawaan. Cukup untuk dokumen kantor sederhana: paragraf, tabel, tebal, perataan, ukuran huruf, dan
// pindah halaman. Layout yang lebih rumit dibuat di Word lalu diunggah lewat layar Layout cetak.

export type Run =
    | string
    | { text: string; bold?: boolean; size?: number }
    | { pageBreak: true };

export type Paragraph = {
    kind: 'paragraph';
    runs: Run[];
    align?: 'left' | 'center' | 'right';
    bold?: boolean;
    size?: number;
    spaceAfter?: number;
};

export type Cell = { content: Paragraph[]; span?: number };
// cantSplit menahan satu baris tabel di satu halaman, misalnya kotak tanda tangan yang tidak boleh terbelah.
export type Row = { cells: Cell[]; header?: boolean; cantSplit?: boolean };
export type Table = {
    kind: 'table';
    widths: number[];
    rows: Row[];
    borders: 'none' | 'lines' | 'grid';
};

export type Block = Paragraph | Table;

export function paragraph(
    runs: Run | Run[],
    options: Omit<Paragraph, 'kind' | 'runs'> = {},
): Paragraph {
    return {
        kind: 'paragraph',
        runs: Array.isArray(runs) ? runs : [runs],
        ...options,
    };
}

// Blok yang hanya tampil bila tag-nya berisi. Tag pembuka dan penutup masing-masing di paragrafnya sendiri, supaya
// paragraphLoop docxtemplater membuang kedua paragraf itu dan tidak menyisakan baris kosong di kertas.
export function when(tag: string, blocks: Block[]): Block[] {
    return [paragraph(`{#${tag}}`), ...blocks, paragraph(`{/${tag}}`)];
}

function isParagraph(item: Run | Paragraph): item is Paragraph {
    return typeof item === 'object' && 'kind' in item;
}

export function cell(
    content: Run | Run[] | Paragraph[],
    options: Omit<Paragraph, 'kind' | 'runs'> & { span?: number } = {},
): Cell {
    const { span, ...format } = options;
    const items: (Run | Paragraph)[] = Array.isArray(content)
        ? content
        : [content];
    const runs: Run[] = [];
    for (const item of items) if (!isParagraph(item)) runs.push(item);
    const paragraphs = runs.length
        ? [paragraph(runs, format)]
        : items.filter(isParagraph);
    return span ? { content: paragraphs, span } : { content: paragraphs };
}

const escape = (text: string) =>
    text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');

function runXml(run: Run, paragraphFormat: Paragraph): string {
    if (typeof run === 'object' && 'pageBreak' in run)
        return '<w:r><w:br w:type="page"/></w:r>';
    const text = typeof run === 'string' ? run : run.text;
    const bold = (typeof run === 'object' && run.bold) || paragraphFormat.bold;
    const size =
        (typeof run === 'object' ? run.size : undefined) ??
        paragraphFormat.size;
    const properties = `${bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${size * 2}"/>` : ''}`;
    return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
}

function paragraphXml(block: Paragraph): string {
    const properties = [
        block.align && block.align !== 'left'
            ? `<w:jc w:val="${block.align === 'center' ? 'center' : 'right'}"/>`
            : '',
        `<w:spacing w:before="0" w:after="${Math.round((block.spaceAfter ?? 0) * 20)}" w:line="240" w:lineRule="auto"/>`,
    ].join('');
    return `<w:p><w:pPr>${properties}</w:pPr>${block.runs.map((run) => runXml(run, block)).join('')}</w:p>`;
}

function tableXml(block: Table, contentWidth: number): string {
    const total = block.widths.reduce((sum, width) => sum + width, 0);
    const twips = block.widths.map((width) =>
        Math.round((width / total) * contentWidth),
    );
    const line =
        '<w:{side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
    const sides =
        block.borders === 'grid'
            ? ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
            : block.borders === 'lines'
              ? ['top', 'bottom', 'insideH']
              : [];
    const borders = sides.map((side) => line.replace('{side}', side)).join('');
    const rows = block.rows
        .map((row) => {
            let column = 0;
            const cells = row.cells
                .map((item) => {
                    const span = item.span ?? 1;
                    const width = twips
                        .slice(column, column + span)
                        .reduce((sum, value) => sum + value, 0);
                    column += span;
                    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr>${item.content.map(paragraphXml).join('')}</w:tc>`;
                })
                .join('');
            const properties = `${row.header ? '<w:tblHeader/>' : ''}${row.cantSplit ? '<w:cantSplit/>' : ''}`;
            return `<w:tr>${properties ? `<w:trPr>${properties}</w:trPr>` : ''}${cells}</w:tr>`;
        })
        .join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="${contentWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar><w:left w:w="57" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${twips.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
}

export type WordDocument = {
    paper: Paper;
    marginMm: number;
    font: string;
    fontSize: number;
    body: Block[];
};

export function wordDocument(document: WordDocument): Uint8Array {
    const toTwips = (mm: number) => Math.round(mm * twipsPerMm);
    const margin = toTwips(document.marginMm);
    const contentWidth = toTwips(document.paper.widthMm) - 2 * margin;
    const body = document.body
        .map((block) =>
            block.kind === 'paragraph'
                ? paragraphXml(block)
                : // Paragraf kosong sesudah tabel menjaga dua tabel berurutan tidak menyatu saat dibuka di Word.
                  `${tableXml(block, contentWidth)}<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`,
        )
        .join('');
    const namespace =
        'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const zip = new PizZip();
    zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    );
    zip.file(
        '_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    zip.file(
        'word/_rels/document.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    );
    zip.file(
        'word/styles.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${namespace}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${document.font}" w:hAnsi="${document.font}" w:cs="${document.font}" w:eastAsia="${document.font}"/><w:sz w:val="${document.fontSize * 2}"/><w:szCs w:val="${document.fontSize * 2}"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`,
    );
    zip.file(
        'word/document.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${namespace}><w:body>${body}<w:sectPr><w:pgSz w:w="${toTwips(document.paper.widthMm)}" w:h="${toTwips(document.paper.heightMm)}"/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    );
    return zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
}
