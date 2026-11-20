import PizZip from 'pizzip';

// Pembaca .xlsx untuk test: menjawab apa yang dilihat Excel di sebuah berkas, yaitu nama yang menunjuk sel, isi dan
// format sel, tabel beserta barisnya, dan sheet yang tampil. Bukan pembaca umum; cukup untuk berkas mesin laporan.

export type WorkbookCell = {
    kind: 'empty' | 'text' | 'number' | 'flag' | 'formula';
    value: string;
    format: string;
    // Hasil rumus yang tersimpan di berkas; Excel di Protected View dan LibreOffice menampilkannya apa adanya.
    cached?: string;
};

const builtinFormats: Record<string, string> = {
    '0': 'General',
    '14': 'date',
    '22': 'datetime',
};

function attribute(tag: string, name: string): string | undefined {
    return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

function unescape(text: string): string {
    return text
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&');
}

function resolve(from: string, target: string): string {
    if (target.startsWith('/')) return target.slice(1);
    const parts = from.split('/').slice(0, -1);
    for (const segment of target.split('/'))
        if (segment === '..') parts.pop();
        else parts.push(segment);
    return parts.join('/');
}

export function readWorkbook(bytes: Uint8Array) {
    const zip = new PizZip(bytes);
    const part = (path: string) => zip.file(path)?.asText() ?? '';
    const relationships = (owner: string) => {
        const slash = owner.lastIndexOf('/');
        const path = `${owner.slice(0, slash)}/_rels/${owner.slice(slash + 1)}.rels`;
        return [...part(path).matchAll(/<Relationship\b[^>]*>/g)].map(
            ([tag]) => ({
                id: attribute(tag, 'Id') ?? '',
                type: (attribute(tag, 'Type') ?? '').split('/').pop() ?? '',
                path: resolve(owner, attribute(tag, 'Target') ?? ''),
            }),
        );
    };
    const workbook = part('xl/workbook.xml');
    const workbookRelations = relationships('xl/workbook.xml');
    const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map(([tag]) => ({
        name: unescape(attribute(tag, 'name') ?? ''),
        hidden: attribute(tag, 'state') === 'hidden',
        path:
            workbookRelations.find(
                (relation) => relation.id === attribute(tag, 'r:id'),
            )?.path ?? '',
    }));
    const shared = [
        ...part('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g),
    ].map(([, item]) => unescape((item ?? '').replace(/<[^>]+>/g, '')));
    const styles = part('xl/styles.xml');
    const numberFormats = new Map(
        [...styles.matchAll(/<numFmt\b[^>]*>/g)].map(([tag]) => [
            attribute(tag, 'numFmtId') ?? '',
            unescape(attribute(tag, 'formatCode') ?? ''),
        ]),
    );
    const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1];
    const xfFormats = [...(cellXfs ?? '').matchAll(/<xf\b[^>]*>/g)].map(
        ([tag]) => {
            const id = attribute(tag, 'numFmtId') ?? '0';
            return numberFormats.get(id) ?? builtinFormats[id] ?? id;
        },
    );

    const cells = (path: string) => {
        const found = new Map<string, WorkbookCell>();
        for (const [element] of part(path).matchAll(
            /<c\b[^>]*\/>|<c\b(?:[^>]*[^/>])?>(?:(?!<\/c>)[\s\S])*<\/c>/g,
        )) {
            const tag = /<c\b[^>]*>/.exec(element)?.[0] ?? '';
            const format = xfFormats[Number(attribute(tag, 's') ?? 0)] ?? '';
            const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(element)?.[1];
            const value = /<v>([\s\S]*?)<\/v>/.exec(element)?.[1];
            const type = attribute(tag, 't');
            const cell: WorkbookCell =
                formula !== undefined
                    ? {
                          kind: 'formula',
                          value: unescape(formula),
                          format,
                          ...(value === undefined ? {} : { cached: value }),
                      }
                    : type === 'inlineStr'
                      ? {
                            kind: 'text',
                            value: unescape(
                                /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(
                                    element,
                                )?.[1] ?? '',
                            ),
                            format,
                        }
                      : type === 's'
                        ? {
                              kind: 'text',
                              value: shared[Number(value)] ?? '',
                              format,
                          }
                        : type === 'b'
                          ? { kind: 'flag', value: value ?? '', format }
                          : value === undefined
                            ? { kind: 'empty', value: '', format }
                            : { kind: 'number', value, format };
            found.set(attribute(tag, 'r') ?? '', cell);
        }
        return found;
    };
    const sheetNamed = (name: string) => {
        const sheet = sheets.find((item) => item.name === name);
        if (!sheet) throw new Error(`Sheet ${name} tidak ada.`);
        return sheet;
    };
    const cell = (sheet: string, address: string): WorkbookCell =>
        cells(sheetNamed(sheet).path).get(address) ?? {
            kind: 'empty',
            value: '',
            format: '',
        };
    const names = new Map(
        [
            ...workbook.matchAll(
                /<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g,
            ),
        ].map(([, attributes, reference]) => [
            attribute(attributes ?? '', 'name') ?? '',
            unescape(reference ?? ''),
        ]),
    );
    const column = (name: string) =>
        name
            .split('')
            .reduce(
                (total, letter) => total * 26 + letter.charCodeAt(0) - 64,
                0,
            );
    const letters = (index: number) => {
        let name = '';
        for (let rest = index; rest > 0; rest = Math.floor((rest - 1) / 26))
            name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
        return name;
    };
    const tables = sheets.flatMap((sheet) =>
        relationships(sheet.path)
            .filter((relation) => relation.type === 'table')
            .map((relation) => {
                const xml = part(relation.path);
                const root = /<table\b[^>]*>/.exec(xml)?.[0] ?? '';
                return {
                    name: attribute(root, 'displayName') ?? '',
                    ref: attribute(root, 'ref') ?? '',
                    totalsRow: Number(attribute(root, 'totalsRowCount') ?? 0),
                    columns: [...xml.matchAll(/<tableColumn\b[^>]*>/g)].map(
                        ([tag]) => attribute(tag, 'name') ?? '',
                    ),
                    sheet,
                };
            }),
    );

    return {
        sheets,
        names,
        paths: () =>
            Object.keys(zip.files).filter((path) => !zip.files[path]?.dir),
        part,
        cell,
        // Nilai yang dibaca rumus `=<nama>`: sel yang ditunjuk nama itu.
        value(name: string): WorkbookCell {
            const reference = names.get(name);
            const match = /^'?(.*?)'?!\$([A-Z]+)\$(\d+)$/.exec(reference ?? '');
            if (!match?.[1] || !match[2] || !match[3])
                throw new Error(
                    `Nama ${name} tidak menunjuk satu sel: ${reference}.`,
                );
            return cell(
                match[1].replaceAll("''", "'"),
                `${match[2]}${match[3]}`,
            );
        },
        // Header dan baris data sebuah tabel Excel, dibaca dari sel di dalam rentangnya.
        table(name: string) {
            const table = tables.find((item) => item.name === name);
            if (!table) throw new Error(`Tabel ${name} tidak ada.`);
            const [from = '', to = ''] = table.ref.split(':');
            const start = /^([A-Z]+)(\d+)$/.exec(from);
            const end = /^([A-Z]+)(\d+)$/.exec(to);
            if (!start?.[1] || !start[2] || !end?.[1] || !end[2])
                throw new Error(`Rentang tabel ${name} tidak terbaca.`);
            const sheetCells = cells(table.sheet.path);
            const rows: WorkbookCell[][] = [];
            for (let row = Number(start[2]) + 1; row <= Number(end[2]); row++) {
                const line: WorkbookCell[] = [];
                for (
                    let index = column(start[1]);
                    index <= column(end[1]);
                    index++
                )
                    line.push(
                        sheetCells.get(`${letters(index)}${row}`) ?? {
                            kind: 'empty',
                            value: '',
                            format: '',
                        },
                    );
                rows.push(line);
            }
            const header = [];
            for (let index = column(start[1]); index <= column(end[1]); index++)
                header.push(
                    sheetCells.get(`${letters(index)}${start[2]}`)?.value ?? '',
                );
            return { ...table, header, rows };
        },
    };
}
