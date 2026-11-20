import PizZip from 'pizzip';
import type { Cell, Locale } from './format.ts';
import {
    captionPrefix,
    columnKind,
    definedNames,
    valuePrefix,
    workbookReferences,
    type WorkbookColumn,
    type WorkbookData,
    type WorkbookShape,
    type WorkbookTable,
} from './workbook.ts';

// Ditulis di atas pizzip tanpa pustaka xlsx: pustaka yang membaca lalu menyimpan ulang workbook (exceljs, SheetJS)
// membuang pivot, slicer, dan chart buatan legal entity.

export const xlsxMimeType =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const infoSheetName = 'Keterangan laporan';

const mainNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipNs =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relationshipType = (name: string) => `${relationshipNs}/${name}`;
const contentType = (name: string) =>
    `application/vnd.openxmlformats-officedocument.spreadsheetml.${name}+xml`;
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Pemisah di kode format bukan pemisah tampilan: Excel berbahasa Indonesia menampilkan 1.234,50.
export type CellFormats = {
    readonly money: string;
    readonly unitAmount: string;
};

export function cellFormats(
    locale: Pick<Locale, 'amountDecimals' | 'unitAmountDecimals'>,
): CellFormats {
    const code = (decimals: number) =>
        decimals > 0 ? `#,##0.${'0'.repeat(decimals)}` : '#,##0';
    return {
        money: code(locale.amountDecimals),
        unitAmount: code(locale.unitAmountDecimals),
    };
}

function escapeXml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function unescapeXml(text: string): string {
    return text
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&');
}

// Karakter kendali yang tidak sah di XML dibuang; Excel menolak sel teks lebih dari 32.767 karakter.
function cellText(text: string): string {
    return escapeXml(
        text
            .replace(
                /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,
                '',
            )
            .slice(0, 32_767),
    );
}

function attribute(tag: string, name: string): string | null {
    const match = new RegExp(`\\s${name.replace('.', '\\.')}="([^"]*)"`).exec(
        tag,
    );
    return match?.[1] === undefined ? null : unescapeXml(match[1]);
}

function withAttribute(tag: string, name: string, value: string): string {
    const pattern = new RegExp(`\\s${name}="[^"]*"`);
    if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${value}"`);
    return tag.replace(/\s*(\/?>)$/, ` ${name}="${value}"$1`);
}

function withoutAttribute(tag: string, name: string): string {
    return tag.replace(new RegExp(`\\s${name}="[^"]*"`), '');
}

function startTag(xml: string, element: string): string | null {
    return new RegExp(`<${element}\\b[^>]*>`).exec(xml)?.[0] ?? null;
}

function columnName(index: number): string {
    let name = '';
    for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26))
        name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
    return name;
}

function parseAddress(address: string): { column: number; row: number } | null {
    const match = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(address.toUpperCase());
    if (!match?.[1] || !match[2]) return null;
    let column = 0;
    for (let index = 0; index < match[1].length; index++)
        column = column * 26 + match[1].charCodeAt(index) - 64;
    return { column: column - 1, row: Number(match[2]) };
}

function inRange(address: string, range: string): boolean {
    const [from = '', to = from] = range.split(':');
    const cell = parseAddress(address);
    const start = parseAddress(from);
    const end = parseAddress(to);
    return (
        cell !== null &&
        start !== null &&
        end !== null &&
        cell.column >= start.column &&
        cell.column <= end.column &&
        cell.row >= start.row &&
        cell.row <= end.row
    );
}

function quotedSheet(name: string): string {
    return `'${name.replaceAll("'", "''")}'`;
}

type Relationship = {
    readonly id: string;
    readonly type: string;
    readonly target: string;
    readonly external: boolean;
};

function directory(path: string): string {
    return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function relationshipsPath(part: string): string {
    const dir = directory(part);
    const file = part.slice(dir ? dir.length + 1 : 0);
    return `${dir ? `${dir}/` : ''}_rels/${file}.rels`;
}

function resolvePath(from: string, target: string): string {
    if (target.startsWith('/')) return target.slice(1);
    const parts = directory(from).split('/').filter(Boolean);
    for (const segment of target.split('/'))
        if (segment === '..') parts.pop();
        else if (segment !== '.' && segment) parts.push(segment);
    return parts.join('/');
}

function relativeTarget(from: string, to: string): string {
    const base = directory(from).split('/').filter(Boolean);
    const target = to.split('/');
    let shared = 0;
    while (
        shared < base.length &&
        shared < target.length - 1 &&
        base[shared] === target[shared]
    )
        shared++;
    return [
        ...base.slice(shared).map(() => '..'),
        ...target.slice(shared),
    ].join('/');
}

class Package {
    constructor(private readonly zip: PizZip) {}

    paths(): string[] {
        return Object.keys(this.zip.files).filter(
            (path) => !this.zip.files[path]?.dir,
        );
    }

    has(path: string): boolean {
        return this.zip.file(path) !== null;
    }

    read(path: string): string {
        const file = this.zip.file(path);
        if (!file) throw new Error(`Bagian ${path} tidak ada di workbook.`);
        return file.asText();
    }

    write(path: string, xml: string): void {
        this.zip.file(path, xml);
    }

    remove(path: string): void {
        this.zip.remove(path);
    }

    relationships(part: string): Relationship[] {
        const path = relationshipsPath(part);
        if (!this.has(path)) return [];
        return [...this.read(path).matchAll(/<Relationship\b[^>]*>/g)].map(
            ([tag]) => {
                const external = attribute(tag, 'TargetMode') === 'External';
                const target = attribute(tag, 'Target') ?? '';
                return {
                    id: attribute(tag, 'Id') ?? '',
                    type: attribute(tag, 'Type') ?? '',
                    target: external ? target : resolvePath(part, target),
                    external,
                };
            },
        );
    }

    relate(part: string, type: string, target: string): string {
        const path = relationshipsPath(part);
        const xml = this.has(path)
            ? this.read(path)
            : `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
        const taken = new Set(this.relationships(part).map((item) => item.id));
        let index = taken.size + 1;
        while (taken.has(`rId${index}`)) index++;
        const id = `rId${index}`;
        this.write(
            path,
            xml.replace(
                '</Relationships>',
                `<Relationship Id="${id}" Type="${relationshipType(type)}" Target="${escapeXml(relativeTarget(part, target))}"/></Relationships>`,
            ),
        );
        return id;
    }

    unrelate(part: string, type: string): void {
        const path = relationshipsPath(part);
        if (!this.has(path)) return;
        this.write(
            path,
            this.read(path).replace(/<Relationship\b[^>]*>/g, (tag) =>
                attribute(tag, 'Type') === relationshipType(type) ? '' : tag,
            ),
        );
    }

    declare(part: string, type: string): void {
        const types = this.read('[Content_Types].xml');
        if (types.includes(`PartName="/${part}"`)) return;
        this.write(
            '[Content_Types].xml',
            types.replace(
                '</Types>',
                `<Override PartName="/${part}" ContentType="${type}"/></Types>`,
            ),
        );
    }

    undeclare(part: string): void {
        this.write(
            '[Content_Types].xml',
            this.read('[Content_Types].xml').replace(
                new RegExp(
                    `<Override\\b[^>]*PartName="/${part.replaceAll('.', '\\.')}"[^>]*/>`,
                ),
                '',
            ),
        );
    }

    freePath(name: (index: number) => string): string {
        let index = 1;
        while (this.has(name(index))) index++;
        return name(index);
    }

    bytes(): Uint8Array {
        return this.zip.generate({
            type: 'uint8array',
            compression: 'DEFLATE',
        });
    }
}

type SheetEntry = {
    readonly name: string;
    readonly path: string;
};

type TableEntry = {
    readonly name: string;
    readonly path: string;
    readonly ref: string;
    readonly sheet: SheetEntry;
};

const rangeKey = (sheet: string, ref: string) =>
    `${sheet.toLowerCase()}!${ref.replaceAll('$', '').toUpperCase()}`;

class Book {
    readonly workbookPath: string;
    workbook: string;
    readonly sheets: SheetEntry[];

    constructor(readonly pack: Package) {
        const office = pack
            .relationships('')
            .find((item) => item.type === relationshipType('officeDocument'));
        if (!office) throw new Error('Workbook tanpa bagian utama.');
        this.workbookPath = office.target;
        this.workbook = pack.read(this.workbookPath);
        const targets = new Map(
            pack
                .relationships(this.workbookPath)
                .map((item) => [item.id, item.target]),
        );
        this.sheets = [...this.workbook.matchAll(/<sheet\b[^>]*>/g)].flatMap(
            ([tag]) => {
                const path = targets.get(attribute(tag, 'r:id') ?? '');
                const name = attribute(tag, 'name');
                return path && name ? [{ name, path }] : [];
            },
        );
    }

    related(part: string, type: string): string[] {
        return this.pack
            .relationships(part)
            .filter((item) => item.type === relationshipType(type))
            .map((item) => item.target);
    }

    tables(): TableEntry[] {
        return this.sheets.flatMap((sheet) =>
            this.related(sheet.path, 'table').map((path) => {
                const root = startTag(this.pack.read(path), 'table') ?? '';
                return {
                    name:
                        attribute(root, 'displayName') ??
                        attribute(root, 'name') ??
                        '',
                    path,
                    ref: attribute(root, 'ref') ?? '',
                    sheet,
                };
            }),
        );
    }

    sheetNamed(name: string): SheetEntry | undefined {
        return this.sheets.find(
            (sheet) => sheet.name.toLowerCase() === name.toLowerCase(),
        );
    }

    addSheet(name: string, xml: string, hidden: boolean): SheetEntry {
        let unique = name.slice(0, 31);
        for (let index = 2; this.sheetNamed(unique); index++)
            unique = `${name.slice(0, 26)} (${index})`;
        const path = this.pack.freePath(
            (index) => `xl/worksheets/sheet${index}.xml`,
        );
        this.pack.write(path, xml);
        this.pack.declare(path, contentType('worksheet'));
        const id = this.pack.relate(this.workbookPath, 'worksheet', path);
        const sheetIds = [...this.workbook.matchAll(/<sheet\b[^>]*>/g)].map(
            ([tag]) => Number(attribute(tag, 'sheetId') ?? 0),
        );
        this.workbook = this.workbook.replace(
            '</sheets>',
            `<sheet name="${escapeXml(unique)}" sheetId="${Math.max(0, ...sheetIds) + 1}"${hidden ? ' state="hidden"' : ''} r:id="${id}"/></sheets>`,
        );
        const sheet = { name: unique, path };
        this.sheets.push(sheet);
        return sheet;
    }

    nextTableId(): number {
        return (
            Math.max(
                0,
                ...this.pack
                    .paths()
                    .filter((path) => /^xl\/tables\/[^/]+\.xml$/.test(path))
                    .map((path) =>
                        Number(
                            attribute(
                                startTag(this.pack.read(path), 'table') ?? '',
                                'id',
                            ) ?? 0,
                        ),
                    ),
            ) + 1
        );
    }
}

type CellStyle = 'general' | 'money' | 'unit-amount' | 'date' | 'datetime';
type EngineStyles = Record<CellStyle, number>;

const builtinFormats = { general: 0, date: 14, datetime: 22 } as const;

function engineStyles(book: Book, formats: CellFormats): EngineStyles {
    const [path] = book.related(book.workbookPath, 'styles');
    if (!path) throw new Error('Workbook tanpa styles.xml.');
    let styles = book.pack.read(path);
    const numberFormats = [...styles.matchAll(/<numFmt\b[^>]*>/g)].map(
        ([tag]) => ({
            id: Number(attribute(tag, 'numFmtId') ?? 0),
            code: attribute(tag, 'formatCode') ?? '',
        }),
    );
    const formatId = (code: string) => {
        const found = numberFormats.find((format) => format.code === code);
        if (found) return found.id;
        const id =
            Math.max(163, ...numberFormats.map((format) => format.id)) + 1;
        numberFormats.push({ id, code });
        return id;
    };
    const wanted: Record<CellStyle, number> = {
        ...builtinFormats,
        money: formatId(formats.money),
        'unit-amount': formatId(formats.unitAmount),
    };
    const numFmts = `<numFmts count="${numberFormats.length}">${numberFormats
        .map(
            (format) =>
                `<numFmt numFmtId="${format.id}" formatCode="${escapeXml(format.code)}"/>`,
        )
        .join('')}</numFmts>`;
    styles = /<numFmts\b[\s\S]*?<\/numFmts>|<numFmts\b[^>]*\/>/.test(styles)
        ? styles.replace(
              /<numFmts\b[\s\S]*?<\/numFmts>|<numFmts\b[^>]*\/>/,
              numFmts,
          )
        : styles.replace(/(<styleSheet\b[^>]*>)/, `$1${numFmts}`);
    const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
    if (!cellXfs) throw new Error('styles.xml tanpa cellXfs.');
    const xfs = [
        ...(cellXfs[1] ?? '').matchAll(
            /<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g,
        ),
    ].map(([xf]) => xf);
    const plain = (xf: string, formatId: number) =>
        xf.endsWith('/>') &&
        attribute(xf, 'numFmtId') === String(formatId) &&
        ['fontId', 'fillId', 'borderId', 'xfId'].every(
            (name) => (attribute(xf, name) ?? '0') === '0',
        );
    const ids = Object.fromEntries(
        Object.entries(wanted).map(([style, formatId]) => {
            const found = xfs.findIndex((xf) => plain(xf, formatId));
            if (found >= 0) return [style, found];
            xfs.push(
                `<xf numFmtId="${formatId}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`,
            );
            return [style, xfs.length - 1];
        }),
    );
    styles = styles.replace(
        /<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/,
        `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`,
    );
    book.pack.write(path, styles);
    return {
        general: Number(ids.general),
        money: Number(ids.money),
        'unit-amount': Number(ids['unit-amount']),
        date: Number(ids.date),
        datetime: Number(ids.datetime),
    };
}

function cellStyle(cell: Cell): CellStyle {
    switch (cell.kind) {
        case 'empty':
        case 'text':
        case 'flag':
            return 'general';
        case 'number':
            return cell.style === 'quantity' ? 'general' : cell.style;
        case 'date':
        case 'datetime':
            return cell.kind;
        default: {
            const unknown: never = cell;
            throw new Error(`Unknown cell: ${JSON.stringify(unknown)}`);
        }
    }
}

function textCell(address: string, text: string, style: number): string {
    return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${cellText(text)}</t></is></c>`;
}

function cellXml(address: string, cell: Cell, styles: EngineStyles): string {
    const style = styles[cellStyle(cell)];
    switch (cell.kind) {
        case 'empty':
            return '';
        case 'text':
            return textCell(address, cell.text, style);
        case 'flag':
            return `<c r="${address}" s="${style}" t="b"><v>${cell.value ? 1 : 0}</v></c>`;
        case 'number':
            return `<c r="${address}" s="${style}"><v>${cell.decimal}</v></c>`;
        case 'date':
        case 'datetime':
            return `<c r="${address}" s="${style}"><v>${cell.serial}</v></c>`;
        default: {
            const unknown: never = cell;
            throw new Error(`Unknown cell: ${JSON.stringify(unknown)}`);
        }
    }
}

function tableRange(table: WorkbookTable, rows: number): string {
    return `A1:${columnName(table.columns.length - 1)}${Math.max(rows, 1) + 1}`;
}

function tableSheetData(
    table: WorkbookTable,
    rows: readonly (readonly Cell[])[],
    styles: EngineStyles,
): string {
    const header = table.columns
        .map((column, index) =>
            textCell(`${columnName(index)}1`, column.name, styles.general),
        )
        .join('');
    const body = rows
        .map(
            (cells, index) =>
                `<row r="${index + 2}">${cells
                    .map((cell, column) =>
                        cellXml(
                            `${columnName(column)}${index + 2}`,
                            cell,
                            styles,
                        ),
                    )
                    .join('')}</row>`,
        )
        .join('');
    return `<sheetData><row r="1">${header}</row>${body}</sheetData>`;
}

function tableColumnsXml(
    table: WorkbookTable,
    existing: readonly string[] = [],
): string {
    const known = new Map(
        existing.map((tag) => [
            (attribute(tag, 'name') ?? '').toLowerCase(),
            tag,
        ]),
    );
    let nextId = Math.max(
        0,
        ...existing.map((tag) => Number(attribute(tag, 'id') ?? 0)),
    );
    const columns = table.columns.map((column) => {
        const kept = known.get(column.name.toLowerCase());
        const id = kept ? attribute(kept, 'id') : String(++nextId);
        const dxf = kept ? attribute(kept, 'dataDxfId') : null;
        return `<tableColumn id="${id}" name="${escapeXml(column.name)}"${dxf === null ? '' : ` dataDxfId="${dxf}"`}/>`;
    });
    return `<tableColumns count="${columns.length}">${columns.join('')}</tableColumns>`;
}

function newTableXml(id: number, table: WorkbookTable, range: string): string {
    return `${declaration}<table xmlns="${mainNs}" id="${id}" name="${table.name}" displayName="${table.name}" ref="${range}" totalsRowShown="0"><autoFilter ref="${range}"/>${tableColumnsXml(table)}<tableStyleInfo name="TableStyleLight9" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
}

// Id tabel dan id kolom yang namanya sama dipertahankan, supaya slicer tetap menunjuk kolom yang sama.
function rewrittenTableXml(
    xml: string,
    table: WorkbookTable,
    range: string,
): string {
    const root = startTag(xml, 'table') ?? '';
    const tag = withAttribute(
        withoutAttribute(
            withoutAttribute(
                withoutAttribute(
                    withAttribute(root, 'ref', range),
                    'totalsRowCount',
                ),
                'headerRowCount',
            ),
            'totalsRowShown',
        ),
        'totalsRowShown',
        '0',
    );
    const existing = [...xml.matchAll(/<tableColumn\b[^>]*>/g)].map(
        ([column]) => column,
    );
    const styleInfo = /<tableStyleInfo\b[^>]*\/>/.exec(xml)?.[0] ?? '';
    const extensions = /<extLst>[\s\S]*<\/extLst>/.exec(xml)?.[0] ?? '';
    return `${declaration}${tag}<autoFilter ref="${range}"/>${tableColumnsXml(table, existing)}${styleInfo}${extensions}</table>`;
}

function tableSheetXml(
    sheetData: string,
    range: string,
    relation: string,
): string {
    return `${declaration}<worksheet xmlns="${mainNs}" xmlns:r="${relationshipNs}"><dimension ref="${range}"/><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="50" width="18" customWidth="1"/></cols>${sheetData}<pageMargins left="0.5" right="0.5" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><tableParts count="1"><tablePart r:id="${relation}"/></tableParts></worksheet>`;
}

function replaceSheetData(xml: string, sheetData: string, range: string) {
    const withData = xml.replace(
        /<sheetData\b[^>]*\/>|<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/,
        sheetData,
    );
    return /<dimension\b[^>]*\/>/.test(withData)
        ? withData.replace(
              /<dimension\b[^>]*\/>/,
              `<dimension ref="${range}"/>`,
          )
        : withData;
}

function addTableSheet(
    book: Book,
    table: WorkbookTable,
    rows: readonly (readonly Cell[])[],
    styles: EngineStyles,
    sheetName: string,
    hidden: boolean,
): SheetEntry {
    const range = tableRange(table, rows.length);
    const tablePath = book.pack.freePath(
        (index) => `xl/tables/table${index}.xml`,
    );
    book.pack.write(tablePath, newTableXml(book.nextTableId(), table, range));
    book.pack.declare(tablePath, contentType('table'));
    const sheet = book.addSheet(sheetName, '', hidden);
    const relation = book.pack.relate(sheet.path, 'table', tablePath);
    book.pack.write(
        sheet.path,
        tableSheetXml(tableSheetData(table, rows, styles), range, relation),
    );
    return sheet;
}

function writeTables(
    book: Book,
    shape: WorkbookShape,
    data: WorkbookData,
    styles: EngineStyles,
): Set<string> {
    const tables = new Map(
        book.tables().map((table) => [table.name.toLowerCase(), table]),
    );
    const owned = new Set<string>();
    for (const table of shape.tables) {
        const rows = data.tables.get(table.name) ?? [];
        const range = tableRange(table, rows.length);
        const found = tables.get(table.name.toLowerCase());
        if (!found) {
            owned.add(
                addTableSheet(book, table, rows, styles, table.name, true).path,
            );
            continue;
        }
        owned.add(found.sheet.path);
        book.pack.write(
            found.sheet.path,
            replaceSheetData(
                book.pack.read(found.sheet.path),
                tableSheetData(table, rows, styles),
                range,
            ),
        );
        book.pack.write(
            found.path,
            rewrittenTableXml(book.pack.read(found.path), table, range),
        );
    }
    return owned;
}

function writeInfoSheet(
    book: Book,
    shape: WorkbookShape,
    data: WorkbookData,
    styles: EngineStyles,
): { sheet: SheetEntry; names: string } {
    const rows = workbookReferences(shape);
    const empty: Cell = { kind: 'empty' };
    const header = ['Nama', 'Arti', 'Nilai']
        .map((text, index) =>
            textCell(`${columnName(index)}1`, text, styles.general),
        )
        .join('');
    const sheetData = `<sheetData><row r="1">${header}</row>${rows
        .map((row, index) => {
            const line = index + 2;
            return `<row r="${line}">${textCell(`A${line}`, row.reference, styles.general)}${textCell(`B${line}`, row.label, styles.general)}${cellXml(`C${line}`, row.value ? (data.names.get(row.value.column) ?? empty) : empty, styles)}</row>`;
        })
        .join('')}</sheetData>`;
    const range = `A1:C${rows.length + 1}`;
    const existing = book.sheetNamed(infoSheetName);
    const sheet =
        existing ??
        book.addSheet(
            infoSheetName,
            `${declaration}<worksheet xmlns="${mainNs}" xmlns:r="${relationshipNs}"><dimension ref="${range}"/><cols><col min="1" max="1" width="44" customWidth="1"/><col min="2" max="2" width="56" customWidth="1"/><col min="3" max="3" width="32" customWidth="1"/></cols><sheetData/></worksheet>`,
            true,
        );
    book.pack.write(
        sheet.path,
        replaceSheetData(book.pack.read(sheet.path), sheetData, range),
    );
    const at = (column: string, index: number) =>
        `${escapeXml(quotedSheet(sheet.name))}!$${column}$${index + 2}`;
    const names = rows
        .map(
            (row, index) =>
                `<definedName name="${row.caption}">${at('B', index)}</definedName>${row.value ? `<definedName name="${row.value.name}">${at('C', index)}</definedName>` : ''}`,
        )
        .join('');
    return { sheet, names };
}

function isEngineName(name: string): boolean {
    const lower = name.toLowerCase();
    return (
        lower.startsWith(valuePrefix.toLowerCase()) ||
        lower.startsWith(captionPrefix.toLowerCase())
    );
}

function writeNames(workbook: string, names: string): string {
    const cleaned = workbook.replace(
        /<definedName\b[^>]*>[\s\S]*?<\/definedName>/g,
        (element) =>
            isEngineName(
                attribute(startTag(element, 'definedName') ?? '', 'name') ?? '',
            )
                ? ''
                : element,
    );
    if (/<definedNames\b[^>]*\/>/.test(cleaned))
        return cleaned.replace(
            /<definedNames\b[^>]*\/>/,
            `<definedNames>${names}</definedNames>`,
        );
    if (cleaned.includes('</definedNames>'))
        return cleaned.replace('</definedNames>', `${names}</definedNames>`);
    const anchor =
        /<\/functionGroups>|<functionGroups\b[^>]*\/>|<\/externalReferences>/.exec(
            cleaned,
        )?.[0];
    return cleaned.replace(
        anchor ?? '</sheets>',
        `${anchor ?? '</sheets>'}<definedNames>${names}</definedNames>`,
    );
}

function requestRecalculation(workbook: string): string {
    const calc = startTag(workbook, 'calcPr');
    if (calc)
        return workbook.replace(
            calc,
            withAttribute(calc, 'fullCalcOnLoad', '1'),
        );
    return workbook.replace(
        '</definedNames>',
        '</definedNames><calcPr fullCalcOnLoad="1"/>',
    );
}

const cellPattern =
    /<c\b[^>]*\/>|<c\b(?:[^>]*[^/>])?>(?:(?!<\/c>)[\s\S])*<\/c>/g;

function clearFormulaResults(sheet: string): string {
    return sheet.replace(cellPattern, (element) => {
        if (!/<f\b/.test(element)) return element;
        const start = startTag(element, 'c') ?? '';
        return element
            .replace(start, withoutAttribute(start, 't'))
            .replace(/<v>[\s\S]*?<\/v>|<v\/>/, '')
            .replace(/<is>[\s\S]*?<\/is>/, '');
    });
}

function clearRange(sheet: string, range: string): string {
    return sheet.replace(cellPattern, (element) =>
        inRange(attribute(startTag(element, 'c') ?? '', 'r') ?? '', range)
            ? ''
            : element,
    );
}

// LibreOffice menyimpan sumber pivot sebagai rentang; tanpa dikembalikan ke nama tabel, pivot hanya membaca baris
// sebanyak contoh saat disimpan.
function pivotSource(
    xml: string,
    ranges: ReadonlyMap<string, string>,
): string | null {
    const source = startTag(xml, 'worksheetSource') ?? '';
    const name = attribute(source, 'name');
    if (name) return name;
    const sheet = attribute(source, 'sheet');
    const ref = attribute(source, 'ref');
    return sheet && ref ? (ranges.get(rangeKey(sheet, ref)) ?? null) : null;
}

function tableRanges(book: Book, shape: WorkbookShape): Map<string, string> {
    const names = new Set(
        shape.tables.map((table) => table.name.toLowerCase()),
    );
    return new Map(
        book
            .tables()
            .filter((table) => names.has(table.name.toLowerCase()))
            .map((table) => [
                rangeKey(table.sheet.name, table.ref),
                table.name,
            ]),
    );
}

// Hasil tersimpan rumus dan isi pivot dikosongkan: tanpa itu, berkas yang dibuka di Protected View atau di LibreOffice
// (bawaannya tidak menghitung ulang .xlsx) menampilkan angka contoh dari layout.
function refreshDerived(
    book: Book,
    owned: ReadonlySet<string>,
    ranges: ReadonlyMap<string, string>,
): void {
    for (const sheet of book.sheets) {
        if (owned.has(sheet.path)) continue;
        let xml = clearFormulaResults(book.pack.read(sheet.path));
        for (const pivot of book.related(sheet.path, 'pivotTable')) {
            const location = startTag(book.pack.read(pivot), 'location');
            const range = location ? attribute(location, 'ref') : null;
            if (range) xml = clearRange(xml, range);
        }
        book.pack.write(sheet.path, xml);
    }
    for (const cache of book.related(
        book.workbookPath,
        'pivotCacheDefinition',
    )) {
        let xml = book.pack.read(cache);
        const root = startTag(xml, 'pivotCacheDefinition');
        if (root)
            xml = xml.replace(root, withAttribute(root, 'refreshOnLoad', '1'));
        const source = startTag(xml, 'worksheetSource');
        const table = pivotSource(xml, ranges);
        if (source && table && attribute(source, 'name') === null)
            xml = xml.replace(
                source,
                `<worksheetSource name="${escapeXml(table)}"/>`,
            );
        book.pack.write(cache, xml);
    }
    for (const chain of book.related(book.workbookPath, 'calcChain')) {
        book.pack.remove(chain);
        book.pack.undeclare(chain);
    }
    book.pack.unrelate(book.workbookPath, 'calcChain');
}

export function fillWorkbook(
    layout: Uint8Array,
    shape: WorkbookShape,
    data: WorkbookData,
    formats: CellFormats,
): Uint8Array {
    const book = new Book(new Package(new PizZip(layout)));
    const ranges = tableRanges(book, shape);
    const styles = engineStyles(book, formats);
    const owned = writeTables(book, shape, data, styles);
    const info = writeInfoSheet(book, shape, data, styles);
    owned.add(info.sheet.path);
    book.workbook = requestRecalculation(writeNames(book.workbook, info.names));
    refreshDerived(book, owned, ranges);
    book.pack.write(book.workbookPath, book.workbook);
    return book.pack.bytes();
}

export type WorkbookRefusal =
    | { readonly reason: 'not-workbook' }
    | { readonly reason: 'macro' }
    | { readonly reason: 'embedded-object' }
    | { readonly reason: 'external-source' }
    | { readonly reason: 'external-function'; readonly functions: string[] }
    | { readonly reason: 'name-taken'; readonly names: string[] }
    | { readonly reason: 'crowded-sheet'; readonly sheet: string }
    | { readonly reason: 'totals-row'; readonly table: string }
    | {
          readonly reason: 'unknown-columns';
          readonly table: string;
          readonly columns: string[];
      }
    | { readonly reason: 'unknown-references'; readonly references: string[] }
    | { readonly reason: 'sheet-reference'; readonly sheets: string[] };

// Fungsi yang menghubungi luar berkas. fullCalcOnLoad menjalankannya dengan data laporan setiap kali berkas dibuka.
const externalFunctions =
    /(?:^|[^A-Za-z0-9_.])(?:_xlfn\.|_xlws\.)?(WEBSERVICE|IMAGE|RTD|CALL|REGISTER\.ID)\s*\(/gi;
const engineReference =
    /(?:^|[^A-Za-z0-9_.])((?:Report|Caption)\.[A-Za-z0-9_.]+)/gi;
const structuredReference =
    /(?:^|[^A-Za-z0-9_.\]])([A-Za-z_\\][A-Za-z0-9_.]*)\[((?:[^[\]]|\[[^[\]]*\])*)\]/g;
const sheetReference = /(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!/g;
const specialItems = /^#(all|data|headers|totals|this row)$/i;
const sheetExtras =
    /<(?:mergeCells|conditionalFormatting|dataValidations|hyperlinks|drawing|legacyDrawing|picture|oleObjects|controls|x14:conditionalFormattings|x14:dataValidations|x14:sparklineGroups)\b/;

function formulasOf(book: Book): { text: string; owner: string | null }[] {
    const formulas: { text: string; owner: string | null }[] = [];
    for (const path of book.pack.paths())
        if (/^xl\/(worksheets|charts|chartsheets)\/[^/]+\.xml$/.test(path))
            for (const [, , text] of book.pack
                .read(path)
                .matchAll(
                    /<(?:[A-Za-z0-9]+:)?(f|formula|formula1|formula2)\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?\1>/g,
                ))
                formulas.push({ text: unescapeXml(text ?? ''), owner: null });
    for (const [, attributes, text] of book.workbook.matchAll(
        /<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g,
    ))
        formulas.push({
            text: unescapeXml(text ?? ''),
            owner: attribute(attributes ?? '', 'name') ?? '',
        });
    return formulas;
}

export function inspectWorkbook(
    bytes: Uint8Array,
    shape: WorkbookShape,
): WorkbookRefusal | null {
    let pack: Package;
    try {
        pack = new Package(new PizZip(bytes));
    } catch {
        return { reason: 'not-workbook' };
    }
    const paths = pack.paths();
    const types = pack.has('[Content_Types].xml')
        ? pack.read('[Content_Types].xml')
        : '';
    if (
        /macroEnabled/i.test(types) ||
        paths.some((path) => /vbaProject/i.test(path))
    )
        return { reason: 'macro' };
    let book: Book;
    try {
        book = new Book(pack);
    } catch {
        return { reason: 'not-workbook' };
    }
    if (
        !types.includes(contentType('sheet.main')) ||
        !startTag(book.workbook, 'workbook') ||
        book.related(book.workbookPath, 'styles').length === 0
    )
        return { reason: 'not-workbook' };
    if (paths.some((path) => /^xl\/(embeddings|activeX)\//i.test(path)))
        return { reason: 'embedded-object' };
    const external = paths
        .filter((path) => path.endsWith('.rels'))
        .some((path) =>
            [...pack.read(path).matchAll(/<Relationship\b[^>]*>/g)].some(
                ([tag]) =>
                    attribute(tag, 'TargetMode') === 'External' &&
                    attribute(tag, 'Type') !== relationshipType('hyperlink'),
            ),
        );
    if (
        external ||
        paths.some((path) =>
            /^xl\/(externalLinks\/|queryTables\/|connections\.xml$)/i.test(
                path,
            ),
        )
    )
        return { reason: 'external-source' };

    const formulas = formulasOf(book).map((formula) => ({
        ...formula,
        bare: formula.text.replace(/"(?:[^"]|"")*"/g, '""'),
    }));
    const called = new Set(
        formulas.flatMap(({ bare }) =>
            [...bare.matchAll(externalFunctions)].map(([, name]) =>
                (name ?? '').toUpperCase(),
            ),
        ),
    );
    if (called.size)
        return { reason: 'external-function', functions: [...called] };

    const lower = (name: string) => name.toLowerCase();
    const engineTables = new Map(
        shape.tables.map((table) => [lower(table.name), table]),
    );
    const engineNames = new Set(definedNames(shape).map(lower));
    const tables = book.tables();
    const authorNames = formulas.flatMap(({ owner }) =>
        owner !== null && !isEngineName(owner) ? [owner] : [],
    );
    const taken = [
        ...authorNames.filter((name) => engineTables.has(lower(name))),
        ...tables
            .map((table) => table.name)
            .filter((name) => engineNames.has(lower(name))),
    ];
    if (taken.length) return { reason: 'name-taken', names: taken };

    const ownedSheets = new Set([lower(infoSheetName)]);
    for (const table of tables) {
        const shapeTable = engineTables.get(lower(table.name));
        if (!shapeTable) continue;
        ownedSheets.add(lower(table.sheet.name));
        const xml = pack.read(table.path);
        const root = startTag(xml, 'table') ?? '';
        if (Number(attribute(root, 'totalsRowCount') ?? 0) > 0)
            return { reason: 'totals-row', table: table.name };
        const known = new Set(
            shapeTable.columns.map((column) => lower(column.name)),
        );
        const extra = [...xml.matchAll(/<tableColumn\b[^>]*>/g)]
            .map(([tag]) => attribute(tag, 'name') ?? '')
            .filter((name) => !known.has(lower(name)));
        if (extra.length)
            return {
                reason: 'unknown-columns',
                table: table.name,
                columns: extra,
            };
        const sheet = pack.read(table.sheet.path);
        const range = attribute(root, 'ref') ?? '';
        const outside = [...sheet.matchAll(cellPattern)].some(
            ([element]) =>
                /<(v|f|is)\b/.test(element) &&
                !inRange(
                    attribute(startTag(element, 'c') ?? '', 'r') ?? '',
                    range,
                ),
        );
        const others = pack
            .relationships(table.sheet.path)
            .filter(
                (item) => item.type !== relationshipType('printerSettings'),
            );
        if (outside || sheetExtras.test(sheet) || others.length !== 1)
            return { reason: 'crowded-sheet', sheet: table.sheet.name };
    }
    const info = book.sheetNamed(infoSheetName);
    if (
        info &&
        pack
            .relationships(info.path)
            .some((item) => item.type !== relationshipType('printerSettings'))
    )
        return { reason: 'crowded-sheet', sheet: info.name };

    const unknown = new Set<string>();
    const referencedSheets = new Set<string>();
    for (const { bare, owner } of formulas) {
        for (const [, name] of bare.matchAll(engineReference))
            if (name && !engineNames.has(lower(name))) unknown.add(name);
        for (const [, tableName, inner] of bare.matchAll(structuredReference)) {
            const table = engineTables.get(lower(tableName ?? ''));
            if (!table) continue;
            const known = new Set(
                table.columns.map((column) => lower(column.name)),
            );
            const items = (inner ?? '').includes('[')
                ? [...(inner ?? '').matchAll(/\[([^\]]*)\]/g)].map(
                      ([, item]) => item ?? '',
                  )
                : [inner ?? ''];
            for (const item of items) {
                const column = item.replace(/^@/, '').trim();
                if (
                    column &&
                    !specialItems.test(column) &&
                    !known.has(lower(column))
                )
                    unknown.add(`${tableName ?? ''}[${column}]`);
            }
        }
        if (
            owner === null ||
            (!isEngineName(owner) && !owner.startsWith('_xlnm.'))
        )
            for (const [, quoted, plain] of bare.matchAll(sheetReference)) {
                const sheet = quoted?.replaceAll("''", "'") ?? plain ?? '';
                if (ownedSheets.has(lower(sheet))) referencedSheets.add(sheet);
            }
    }
    const ranges = tableRanges(book, shape);
    for (const cache of book.related(
        book.workbookPath,
        'pivotCacheDefinition',
    )) {
        const xml = pack.read(cache);
        const table = engineTables.get(lower(pivotSource(xml, ranges) ?? ''));
        const sourceSheet = attribute(
            startTag(xml, 'worksheetSource') ?? '',
            'sheet',
        );
        if (!table && sourceSheet && ownedSheets.has(lower(sourceSheet)))
            referencedSheets.add(sourceSheet);
        if (!table) continue;
        const known = new Set(
            table.columns.map((column) => lower(column.name)),
        );
        for (const [field] of xml.matchAll(/<cacheField\b[^>]*>/g)) {
            const name = attribute(field, 'name') ?? '';
            if (
                attribute(field, 'formula') === null &&
                attribute(field, 'databaseField') !== '0' &&
                !known.has(lower(name))
            )
                unknown.add(`${table.name}[${name}]`);
        }
    }
    if (unknown.size)
        return { reason: 'unknown-references', references: [...unknown] };
    if (referencedSheets.size)
        return { reason: 'sheet-reference', sheets: [...referencedSheets] };
    return null;
}

export type ExcelContent =
    | { readonly text: string }
    | { readonly name: string }
    | { readonly formula: string };

export type ExcelCell = {
    readonly at: string;
    readonly content: ExcelContent;
    readonly style?: 'heading' | 'title' | 'label';
};

export type PivotSpec = {
    readonly table: string;
    readonly at: string;
    readonly rows: readonly string[];
    readonly values: readonly string[];
    readonly grandTotalCaption: string;
};

export type ExcelSheet = {
    readonly name: string;
    readonly orientation: 'portrait' | 'landscape';
    // Lebar kolom dalam karakter, mulai kolom A.
    readonly widths: readonly number[];
    readonly cells: readonly ExcelCell[];
    readonly pivot?: PivotSpec;
    readonly printTitleRows?: readonly [number, number];
};

export type ExcelWorkbook = {
    readonly sheets: readonly ExcelSheet[];
    readonly visibleTables: readonly {
        readonly table: string;
        readonly sheet: string;
    }[];
};

const fontSizes = { heading: 14, title: 12, label: 11 } as const;

function builtinStyles(formats: CellFormats) {
    const xfs: string[] = [
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    ];
    const keys = new Map<string, number>([['0:0', 0]]);
    const fonts = ['heading', 'title', 'label'] as const;
    const formatIds: Record<CellStyle, number> = {
        ...builtinFormats,
        money: 164,
        'unit-amount': formats.unitAmount === formats.money ? 164 : 165,
    };
    return {
        xf(style: ExcelCell['style'], format: CellStyle): number {
            const fontId = style ? fonts.indexOf(style) + 1 : 0;
            const formatId = formatIds[format];
            const key = `${fontId}:${formatId}`;
            const found = keys.get(key);
            if (found !== undefined) return found;
            xfs.push(
                `<xf numFmtId="${formatId}" fontId="${fontId}" fillId="0" borderId="0" xfId="0"${formatId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}/>`,
            );
            keys.set(key, xfs.length - 1);
            return xfs.length - 1;
        },
        format(format: CellStyle): number {
            return formatIds[format];
        },
        xml(): string {
            const numFmts = [
                `<numFmt numFmtId="164" formatCode="${escapeXml(formats.money)}"/>`,
                ...(formatIds['unit-amount'] === 165
                    ? [
                          `<numFmt numFmtId="165" formatCode="${escapeXml(formats.unitAmount)}"/>`,
                      ]
                    : []),
            ];
            const font = (size: number, bold: boolean) =>
                `<font>${bold ? '<b/>' : ''}<sz val="${size}"/><name val="Calibri"/><family val="2"/></font>`;
            return `${declaration}<styleSheet xmlns="${mainNs}"><numFmts count="${numFmts.length}">${numFmts.join('')}</numFmts><fonts count="4">${font(11, false)}${fonts.map((name) => font(fontSizes[name], true)).join('')}</fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
        },
    };
}

function formatOf(column: WorkbookColumn): CellStyle {
    const kind = columnKind(column);
    switch (kind) {
        case 'money':
        case 'unit-amount':
        case 'date':
        case 'datetime':
            return kind;
        case 'text':
        case 'flag':
        case 'quantity':
            return 'general';
        default: {
            const unknown: never = kind;
            throw new Error(`Jenis field tidak dikenal: ${String(unknown)}`);
        }
    }
}

function pivotXml(
    name: string,
    cacheId: number,
    table: WorkbookTable,
    pivot: PivotSpec,
    styles: ReturnType<typeof builtinStyles>,
): { cache: string; records: string; table: string } {
    const column = (key: string) => {
        const index = table.columns.findIndex((item) => item.name === key);
        const found = table.columns[index];
        if (!found)
            throw new Error(
                `Pivot layout bawaan memakai kolom ${table.name}[${key}] yang tidak ada.`,
            );
        return { index, column: found };
    };
    const rows = pivot.rows.map(column);
    const values = pivot.values.map(column);
    const captions = [...rows, ...values].map(({ column: item }) => item.label);
    const clash = captions.filter(
        (caption, index) =>
            captions.findIndex(
                (other) => other.toLowerCase() === caption.toLowerCase(),
            ) !== index ||
            table.columns.some(
                (item) => item.name.toLowerCase() === caption.toLowerCase(),
            ),
    );
    if (clash.length)
        throw new Error(
            `Judul pivot layout bawaan bentrok: ${clash.join(', ')}.`,
        );
    const fields = table.columns
        .map((item, index) => {
            const rowAt = rows.findIndex((row) => row.index === index);
            const isValue = values.some((value) => value.index === index);
            const format = styles.format(formatOf(item));
            if (rowAt < 0)
                return `<pivotField${isValue ? ' dataField="1"' : ''} compact="0" outline="0" showAll="0"/>`;
            const common = `name="${escapeXml(item.label)}" axis="axisRow" compact="0" outline="0" showAll="0" sortType="ascending"${format ? ` numFmtId="${format}"` : ''}`;
            return rowAt === 0
                ? `<pivotField ${common}><items count="1"><item t="default"/></items></pivotField>`
                : `<pivotField ${common} defaultSubtotal="0"/>`;
        })
        .join('');
    const dataFields = values
        .map(({ index, column: item }) => {
            const format = styles.format(formatOf(item));
            return `<dataField name="${escapeXml(item.label)}" fld="${index}" baseField="0" baseItem="0"${format ? ` numFmtId="${format}"` : ''}/>`;
        })
        .join('');
    return {
        cache: `${declaration}<pivotCacheDefinition xmlns="${mainNs}" xmlns:r="${relationshipNs}" r:id="rId1" refreshOnLoad="1" createdVersion="3" refreshedVersion="3" minRefreshableVersion="3" recordCount="0"><cacheSource type="worksheet"><worksheetSource name="${table.name}"/></cacheSource><cacheFields count="${table.columns.length}">${table.columns
            .map(
                (item) =>
                    `<cacheField name="${escapeXml(item.name)}" numFmtId="0"><sharedItems containsBlank="1"/></cacheField>`,
            )
            .join('')}</cacheFields></pivotCacheDefinition>`,
        records: `${declaration}<pivotCacheRecords xmlns="${mainNs}" xmlns:r="${relationshipNs}" count="0"/>`,
        table: `${declaration}<pivotTableDefinition xmlns="${mainNs}" name="${name}" cacheId="${cacheId}" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" dataCaption="Nilai" grandTotalCaption="${escapeXml(pivot.grandTotalCaption)}" createdVersion="3" updatedVersion="3" minRefreshableVersion="3" showMemberPropertyTips="0" useAutoFormatting="1" itemPrintTitles="1" indent="0" compact="0" compactData="0" gridDropZones="1"><location ref="${pivot.at}" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/><pivotFields count="${table.columns.length}">${fields}</pivotFields><rowFields count="${rows.length}">${rows.map((row) => `<field x="${row.index}"/>`).join('')}</rowFields>${values.length > 1 ? '<colFields count="1"><field x="-2"/></colFields>' : ''}<dataFields count="${values.length}">${dataFields}</dataFields><pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`,
    };
}

export function excelWorkbook(
    shape: WorkbookShape,
    formats: CellFormats,
    spec: ExcelWorkbook,
): Uint8Array {
    const names = new Map(shape.names.map((name) => [name.name, name]));
    const tables = new Map(shape.tables.map((table) => [table.name, table]));
    const tableOf = (name: string) => {
        const table = tables.get(name);
        if (!table)
            throw new Error(
                `Layout bawaan memakai tabel ${name} yang tidak ada.`,
            );
        return table;
    };
    const styles = builtinStyles(formats);
    const pack = new Package(new PizZip());
    const overrides: string[] = [];
    const workbookRels: string[] = [];
    const sheetEntries: string[] = [];
    const definedNames: string[] = [];
    const pivotCaches: string[] = [];
    spec.sheets.forEach((sheet, sheetIndex) => {
        const index = sheetIndex + 1;
        const cells = sheet.cells
            .map((item) => {
                const at = parseAddress(item.at);
                if (!at) throw new Error(`Alamat sel ${item.at} tidak sah.`);
                return { ...item, ...at };
            })
            .sort((a, b) => a.row - b.row || a.column - b.column);
        const pivotAt = sheet.pivot ? parseAddress(sheet.pivot.at) : null;
        if (pivotAt && cells.some((item) => item.row >= pivotAt.row))
            throw new Error(
                `Sel layout bawaan ${sheet.name} menimpa pivot di ${sheet.pivot?.at ?? ''}.`,
            );
        const rowsXml = [...new Set(cells.map((item) => item.row))]
            .map(
                (row) =>
                    `<row r="${row}">${cells
                        .filter((item) => item.row === row)
                        .map((item) => {
                            const content = item.content;
                            if ('text' in content)
                                return textCell(
                                    item.at,
                                    content.text,
                                    styles.xf(item.style, 'general'),
                                );
                            if ('name' in content) {
                                const name = names.get(content.name);
                                if (!name)
                                    throw new Error(
                                        `Layout bawaan memakai nama ${content.name} yang tidak ada.`,
                                    );
                                return `<c r="${item.at}" s="${styles.xf(item.style, formatOf(name))}"><f>${valuePrefix}${name.name}</f></c>`;
                            }
                            return `<c r="${item.at}" s="${styles.xf(item.style, 'general')}"><f>${escapeXml(content.formula)}</f></c>`;
                        })
                        .join('')}</row>`,
            )
            .join('');
        const path = `xl/worksheets/sheet${index}.xml`;
        if (sheet.pivot) {
            const cacheId = pivotCaches.length + 1;
            const pivot = pivotXml(
                `Pivot${cacheId}`,
                cacheId,
                tableOf(sheet.pivot.table),
                sheet.pivot,
                styles,
            );
            const cachePath = `xl/pivotCache/pivotCacheDefinition${cacheId}.xml`;
            const recordsPath = `xl/pivotCache/pivotCacheRecords${cacheId}.xml`;
            const pivotPath = `xl/pivotTables/pivotTable${cacheId}.xml`;
            pack.write(cachePath, pivot.cache);
            pack.write(recordsPath, pivot.records);
            pack.write(pivotPath, pivot.table);
            pack.relate(cachePath, 'pivotCacheRecords', recordsPath);
            pack.relate(pivotPath, 'pivotCacheDefinition', cachePath);
            pack.relate(path, 'pivotTable', pivotPath);
            overrides.push(
                `<Override PartName="/${cachePath}" ContentType="${contentType('pivotCacheDefinition')}"/>`,
                `<Override PartName="/${recordsPath}" ContentType="${contentType('pivotCacheRecords')}"/>`,
                `<Override PartName="/${pivotPath}" ContentType="${contentType('pivotTable')}"/>`,
            );
            const relation = `rIdPivot${cacheId}`;
            workbookRels.push(
                `<Relationship Id="${relation}" Type="${relationshipType('pivotCacheDefinition')}" Target="pivotCache/pivotCacheDefinition${cacheId}.xml"/>`,
            );
            pivotCaches.push(
                `<pivotCache cacheId="${cacheId}" r:id="${relation}"/>`,
            );
        }
        const cols = sheet.widths
            .map(
                (width, column) =>
                    `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`,
            )
            .join('');
        pack.write(
            path,
            `${declaration}<worksheet xmlns="${mainNs}" xmlns:r="${relationshipNs}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"${sheetIndex === 0 ? ' tabSelected="1"' : ''}/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rowsXml}</sheetData><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${sheet.orientation}" fitToWidth="1" fitToHeight="0"/></worksheet>`,
        );
        overrides.push(
            `<Override PartName="/${path}" ContentType="${contentType('worksheet')}"/>`,
        );
        workbookRels.push(
            `<Relationship Id="rId${index}" Type="${relationshipType('worksheet')}" Target="worksheets/sheet${index}.xml"/>`,
        );
        sheetEntries.push(
            `<sheet name="${escapeXml(sheet.name)}" sheetId="${index}" r:id="rId${index}"/>`,
        );
        if (sheet.printTitleRows)
            definedNames.push(
                `<definedName name="_xlnm.Print_Titles" localSheetId="${sheetIndex}">${escapeXml(quotedSheet(sheet.name))}!$${sheet.printTitleRows[0]}:$${sheet.printTitleRows[1]}</definedName>`,
            );
    });
    pack.write(
        '[Content_Types].xml',
        `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${contentType('sheet.main')}"/><Override PartName="/xl/styles.xml" ContentType="${contentType('styles')}"/>${overrides.join('')}</Types>`,
    );
    pack.write(
        '_rels/.rels',
        `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationshipType('officeDocument')}" Target="xl/workbook.xml"/></Relationships>`,
    );
    pack.write(
        'xl/_rels/workbook.xml.rels',
        `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="${relationshipType('styles')}" Target="styles.xml"/>${workbookRels.join('')}</Relationships>`,
    );
    pack.write(
        'xl/workbook.xml',
        `${declaration}<workbook xmlns="${mainNs}" xmlns:r="${relationshipNs}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheetEntries.join('')}</sheets>${definedNames.length ? `<definedNames>${definedNames.join('')}</definedNames>` : ''}<calcPr fullCalcOnLoad="1"/>${pivotCaches.length ? `<pivotCaches>${pivotCaches.join('')}</pivotCaches>` : ''}</workbook>`,
    );
    const book = new Book(pack);
    const engine = {
        general: 0,
        money: styles.xf(undefined, 'money'),
        'unit-amount': styles.xf(undefined, 'unit-amount'),
        date: styles.xf(undefined, 'date'),
        datetime: styles.xf(undefined, 'datetime'),
    };
    for (const visible of spec.visibleTables)
        addTableSheet(
            book,
            tableOf(visible.table),
            [],
            engine,
            visible.sheet,
            false,
        );
    pack.write(book.workbookPath, book.workbook);
    pack.write('xl/styles.xml', styles.xml());
    return pack.bytes();
}
