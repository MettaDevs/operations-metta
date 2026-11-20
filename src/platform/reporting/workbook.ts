import {
    cellOf,
    linesValue,
    recordValue,
    type Cell,
    type Locale,
} from './format.ts';
import type { Fields, ScalarField } from './report.ts';

// Wajah Excel sebuah dataset, padanan tag Word. Diturunkan dari peta field yang sama, tidak pernah ditulis sendiri:
//   - Field skalar di akar menjadi nama `Report.<kunci>` (`=Report.location_name`). Bagian yang diisi mesin memakai
//     kunci yang sama dengan tag Word-nya: `=Report.letterhead.name`, `=Report.printed.at`.
//   - Label setiap field menjadi nama `Caption.<kunci>`, kolom tabel `Caption.<tabel>.<kolom>`.
//   - Setiap field.lines, di kedalaman berapa pun, menjadi satu tabel Excel bernama kuncinya: `lines[closing_value]`.
//     Kolomnya kolom skalar semua baris induknya lalu kolomnya sendiri, supaya baris bersarang bisa dipivot tanpa kunci
//     penghubung. Bila nama kolom sendiri sama dengan kolom induk, kolom sendiri yang dipakai.
//   - Uang dengan terbilang menambah `<kunci>_words`, teks dalam bahasa layout.
// Awalan `Report.` dan `Caption.` meniru `ReportRequest.*` dan `Caption.*` Business Central: nama tidak bisa tertukar
// dengan alamat sel atau nama fungsi Excel, dan mesin tahu nama mana miliknya.

export const valuePrefix = 'Report.';
export const captionPrefix = 'Caption.';

export type WorkbookColumn = {
    // Kunci kolom tabel atau nama tanpa awalan, misalnya `closing_value` atau `letterhead.name`.
    readonly name: string;
    readonly label: string;
    readonly spec: ScalarField;
    readonly words: boolean;
    // Field yang dibaca, di baris tabel itu sendiri (0) atau di baris induknya (1, 2, ...).
    readonly key: string;
    readonly depth: number;
};

export type WorkbookTable = {
    readonly name: string;
    readonly label: string;
    // Kunci field.lines dari akar dataset sampai tabel ini.
    readonly path: readonly string[];
    readonly columns: readonly WorkbookColumn[];
};

// Semua yang boleh dirujuk layout Excel sebuah laporan: pemeriksaan unggahan, pemeriksaan katalog saat mulai, layout
// bawaan, dan daftar field di Sys Admin › Layout cetak membaca bentuk yang sama.
export type WorkbookShape = {
    readonly names: readonly WorkbookColumn[];
    readonly tables: readonly WorkbookTable[];
};

// Isi workbook untuk satu cetak, urutannya sama dengan bentuknya.
export type WorkbookData = {
    readonly names: readonly Cell[];
    readonly tables: readonly (readonly (readonly Cell[])[])[];
};

// Jenis format sel sebuah kolom: terbilang selalu teks.
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
            key,
            depth: 0,
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
                .map((column) => ({ ...column, depth: column.depth + 1 })),
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

// Semua nama yang ditulis mesin ke workbook, untuk pemeriksaan bentrok.
export function definedNames(shape: WorkbookShape): string[] {
    return [
        ...shape.names.flatMap((name) => [
            valuePrefix + name.name,
            captionPrefix + name.name,
        ]),
        ...shape.tables.flatMap((table) => [
            captionPrefix + table.name,
            ...table.columns.map(
                (column) => `${captionPrefix}${table.name}.${column.name}`,
            ),
        ]),
    ];
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

// Bentuk Excel dari peta field. Melempar bila sebuah kunci tidak bisa menjadi nama Excel atau dua nama bertabrakan
// tanpa peduli huruf besar, karena Excel menolak workbook seperti itu. Dipanggil katalog untuk setiap laporan saat
// proses mulai: legal entity mana pun boleh mengunggah layout Excel untuk laporan mana pun.
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

// Setiap baris sebuah tabel beserta baris induknya, dari akar sampai baris itu sendiri.
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

// Nilai bertipe untuk setiap nama dan baris tabel. Nilai yang tidak sesuai field-nya menggagalkan unduhan, sama dengan
// Word: pemeriksaannya satu, di format.ts.
export function workbookData(
    shape: WorkbookShape,
    values: unknown,
    locale: Locale,
): WorkbookData {
    const root = recordValue(values, '');
    const cell = (column: WorkbookColumn, row: object, at: string) =>
        cellOf(
            column.spec,
            Reflect.get(row, column.key),
            at ? `${at}.${column.key}` : column.key,
            locale,
            column.words,
        );
    return {
        names: shape.names.map((name) => cell(name, root, '')),
        tables: shape.tables.map((table) =>
            rowChains(root, table.path).map(({ rows, at }) =>
                table.columns.map((column) => {
                    const row = rows[rows.length - 1 - column.depth];
                    if (!row) throw new Error(`Baris induk ${at} tidak ada.`);
                    return cell(column, row, at);
                }),
            ),
        ),
    };
}

// Jumlah baris semua tabel tanpa membangun sel, supaya unduhan yang terlalu besar ditolak sebelum memakan memori.
export function workbookRowCount(shape: WorkbookShape, values: unknown) {
    const root = recordValue(values, '');
    return shape.tables.reduce(
        (count, table) => count + rowChains(root, table.path).length,
        0,
    );
}
