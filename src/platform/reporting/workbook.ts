import {
    cellOf,
    linesValue,
    recordValue,
    type Cell,
    type Locale,
} from './format.ts';
import type { Fields, ScalarField } from './report.ts';

export const valuePrefix = 'Report.';
export const captionPrefix = 'Caption.';

export type WorkbookColumn = {
    readonly name: string;
    readonly label: string;
    readonly spec: ScalarField;
    readonly words: boolean;
    readonly fieldKey: string;
    readonly rowsUp: number;
};

export type WorkbookTable = {
    readonly name: string;
    readonly label: string;
    readonly path: readonly string[];
    readonly columns: readonly WorkbookColumn[];
};

export type WorkbookShape = {
    readonly names: readonly WorkbookColumn[];
    readonly tables: readonly WorkbookTable[];
};

export type WorkbookData = {
    readonly names: ReadonlyMap<string, Cell>;
    readonly tables: ReadonlyMap<string, readonly (readonly Cell[])[]>;
};

export function columnKind(column: WorkbookColumn) {
    return column.words ? 'text' : column.spec.kind;
}

function scalarColumns(fields: Fields): WorkbookColumn[] {
    return Object.entries(fields).flatMap(([key, spec]) => {
        if (spec.kind === 'lines') return [];
        const column = {
            name: key,
            label: spec.label,
            spec,
            words: false,
            fieldKey: key,
            rowsUp: 0,
        };
        return spec.kind === 'money' && spec.words
            ? [
                  column,
                  {
                      ...column,
                      name: `${key}_words`,
                      label: `${spec.label}, dengan huruf`,
                      words: true,
                  },
              ]
            : [column];
    });
}

function tablesOf(
    fields: Fields,
    path: readonly string[],
    inherited: readonly WorkbookColumn[],
): WorkbookTable[] {
    return Object.entries(fields).flatMap(([key, spec]) => {
        if (spec.kind !== 'lines') return [];
        const own = scalarColumns(spec.fields);
        const ownNames = new Set(own.map((column) => column.name));
        const columns = [
            ...inherited
                .filter((column) => !ownNames.has(column.name))
                .map((column) => ({ ...column, rowsUp: column.rowsUp + 1 })),
            ...own,
        ];
        const tablePath = [...path, key];
        return [
            { name: key, label: spec.label, path: tablePath, columns },
            ...tablesOf(spec.fields, tablePath, columns),
        ];
    });
}

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Nama tabel yang terbaca sebagai alamat sel (A1, XFD1048576, R1C1, R, C) ditolak Excel.
const cellLike = /^([A-Za-z]{1,3}\d+|[Rr]\d*[Cc]\d*|[RrCc])$/;

type WorkbookReference = {
    readonly reference: string;
    readonly label: string;
    readonly caption: string;
    readonly value: { readonly name: string; readonly column: string } | null;
};

export function workbookReferences(shape: WorkbookShape): WorkbookReference[] {
    return [
        ...shape.names.map((name) => ({
            reference: `=${valuePrefix}${name.name}`,
            label: name.label,
            caption: captionPrefix + name.name,
            value: { name: valuePrefix + name.name, column: name.name },
        })),
        ...shape.tables.flatMap((table) => [
            {
                reference: table.name,
                label: `${table.label} (tabel)`,
                caption: captionPrefix + table.name,
                value: null,
            },
            ...table.columns.map((column) => ({
                reference: `${table.name}[${column.name}]`,
                label: column.label,
                caption: `${captionPrefix}${table.name}.${column.name}`,
                value: null,
            })),
        ]),
    ];
}

export function definedNames(shape: WorkbookShape): string[] {
    return workbookReferences(shape).flatMap((entry) =>
        entry.value ? [entry.value.name, entry.caption] : [entry.caption],
    );
}

function duplicates(names: readonly string[]): string[] {
    const seen = new Set<string>();
    return names.filter((name) => {
        const key = name.toLowerCase();
        if (seen.has(key)) return true;
        seen.add(key);
        return false;
    });
}

export function workbookShape(fields: Fields): WorkbookShape {
    const shape = {
        names: scalarColumns(fields),
        tables: tablesOf(fields, [], []),
    };
    const badNames = shape.names
        .map((name) => name.name)
        .filter(
            (name) => !name.split('.').every((part) => identifier.test(part)),
        );
    const badTables = shape.tables
        .map((table) => table.name)
        .filter((name) => !identifier.test(name) || cellLike.test(name));
    const badColumns = shape.tables.flatMap((table) =>
        table.columns
            .filter((column) => !identifier.test(column.name))
            .map((column) => `${table.name}.${column.name}`),
    );
    const bad = [...badNames, ...badTables, ...badColumns];
    if (bad.length)
        throw new Error(
            `Kunci ini tidak bisa menjadi nama di Excel: ${bad.join(', ')}.`,
        );
    const taken = [
        ...duplicates(shape.tables.map((table) => table.name)),
        ...duplicates(definedNames(shape)),
    ];
    if (taken.length)
        throw new Error(
            `Nama Excel ini dipakai dua kali: ${taken.join(', ')}.`,
        );
    return shape;
}

type RowChain = { holder: object; rows: readonly object[]; at: string };

function rowChains(root: object, path: readonly string[]): RowChain[] {
    let chains: RowChain[] = [{ holder: root, rows: [], at: '' }];
    for (const key of path)
        chains = chains.flatMap(({ holder, rows, at }) => {
            const where = at ? `${at}.${key}` : key;
            return linesValue(Reflect.get(holder, key), where).map(
                (line, index) => {
                    const lineAt = `${where}[${index}]`;
                    const row = recordValue(line, lineAt);
                    return { holder: row, rows: [...rows, row], at: lineAt };
                },
            );
        });
    return chains;
}

export function workbookData(
    shape: WorkbookShape,
    values: unknown,
    locale: Locale,
): WorkbookData {
    const root = recordValue(values, '');
    const cell = (column: WorkbookColumn, row: object, at: string) =>
        cellOf(
            column.spec,
            Reflect.get(row, column.fieldKey),
            at ? `${at}.${column.fieldKey}` : column.fieldKey,
            locale,
            column.words,
        );
    return {
        names: new Map(
            shape.names.map((name) => [name.name, cell(name, root, '')]),
        ),
        tables: new Map(
            shape.tables.map((table) => [
                table.name,
                rowChains(root, table.path).map(({ rows, at }) =>
                    table.columns.map((column) => {
                        const row = rows[rows.length - 1 - column.rowsUp];
                        if (!row)
                            throw new Error(`Baris induk ${at} tidak ada.`);
                        return cell(column, row, at);
                    }),
                ),
            ]),
        ),
    };
}

export function workbookRowCount(shape: WorkbookShape, values: unknown) {
    const root = recordValue(values, '');
    return shape.tables.reduce(
        (count, table) => count + rowChains(root, table.path).length,
        0,
    );
}
