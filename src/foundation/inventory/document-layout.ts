import {
    cell,
    letterheadBlocks,
    paragraph,
    signatureBlocks,
    when,
    wordDocument,
    type Block,
    type Row,
    type SignatureParty,
} from '../../platform/reporting/index.ts';

// Rupa bersama layout bawaan dokumen persediaan dan pembelian (amprah, mutasi, penerimaan, retur, opname,
// penyesuaian): kop, judul, keterangan dokumen dua kolom, tabel baris, jumlah, lalu kotak tanda tangan. Setiap dokumen
// hanya menyatakan isinya sebagai data; pemisahan tata letak dari isi ini membuat semua dokumen gudang tampil seragam.

// Nama pihak yang tidak tercatat di sistem, misalnya penerima barang di lokasi lain: ditulis tangan di garis ini.
export const blankName = '..............................';

export type DocumentColumn = {
    header: string;
    // Isi sel dengan tag field baris, misalnya `{item_name}` atau `{batch_number}`.
    value: string;
    width: number;
    align?: 'left' | 'right' | 'center';
};

export type InventoryDocument = {
    title: string;
    orientation: 'portrait' | 'landscape';
    // Tag flag yang menandai dokumen sebagai draf atau dibatalkan, dicetak di bawah judul.
    marks: { flag: string; text: string }[];
    // Pasangan label dan isi di bawah judul, kiri lalu kanan.
    details: [string, string][];
    // Field baris dataset yang diulang di tabel.
    lines: string;
    columns: DocumentColumn[];
    // Baris jumlah di bawah tabel, rata kanan di kolom terakhir.
    totals?: [string, string][];
    // Paragraf sesudah jumlah, misalnya terbilang atau catatan.
    notes?: Block[];
    parties: SignatureParty[];
    dated: string;
    signersCaption: string;
};

function detailRows(details: [string, string][]): Row[] {
    const rows: Row[] = [];
    for (let index = 0; index < details.length; index += 2) {
        const pair = details.slice(index, index + 2);
        rows.push({
            cells: pair
                .flatMap(([label, value]) => [cell(label), cell(`: ${value}`)])
                .concat(pair.length === 1 ? [cell(''), cell('')] : []),
        });
    }
    return rows;
}

export function inventoryDocument(document: InventoryDocument): Uint8Array {
    const landscape = document.orientation === 'landscape';
    const lastColumn = document.columns.length - 1;
    return wordDocument({
        paper: landscape
            ? { widthMm: 297, heightMm: 210 }
            : { widthMm: 210, heightMm: 297 },
        marginMm: 12,
        font: 'Arial',
        fontSize: 9,
        body: [
            ...letterheadBlocks({ name: 13, detail: 8 }),
            paragraph('', { spaceAfter: 6 }),
            paragraph(document.title, {
                align: 'center',
                bold: true,
                size: 12,
            }),
            ...document.marks.flatMap((mark) =>
                when(mark.flag, [
                    paragraph(mark.text, { align: 'center', bold: true }),
                ]),
            ),
            paragraph('', { spaceAfter: 4 }),
            {
                kind: 'table',
                widths: [16, 34, 16, 34],
                borders: 'none',
                rows: detailRows(document.details),
            },
            paragraph('', { spaceAfter: 4 }),
            {
                kind: 'table',
                widths: [4, ...document.columns.map((column) => column.width)],
                borders: 'grid',
                rows: [
                    {
                        header: true,
                        cells: [
                            cell('No', { bold: true, align: 'center' }),
                            ...document.columns.map((column) =>
                                cell(column.header, {
                                    bold: true,
                                    align: column.align ?? 'left',
                                }),
                            ),
                        ],
                    },
                    {
                        cells: [
                            cell(`{#${document.lines}}{$no}`, {
                                align: 'center',
                            }),
                            // Tag penutup perulangan di sel terakhir, supaya seluruh baris tabel yang diulang.
                            ...document.columns.map((column, index) =>
                                cell(
                                    index === lastColumn
                                        ? `${column.value}{/${document.lines}}`
                                        : column.value,
                                    { align: column.align ?? 'left' },
                                ),
                            ),
                        ],
                    },
                ],
            },
            ...(document.totals?.length
                ? [
                      {
                          kind: 'table' as const,
                          widths: [70, 30],
                          borders: 'none' as const,
                          rows: document.totals.map(([label, value]): Row => ({
                              cells: [
                                  cell(label, {
                                      align: 'right',
                                      bold: true,
                                  }),
                                  cell(value, {
                                      align: 'right',
                                      bold: true,
                                  }),
                              ],
                          })),
                      },
                  ]
                : []),
            ...(document.notes ?? []),
            paragraph('', { spaceAfter: 8 }),
            ...signatureBlocks(document.parties, {
                dated: document.dated,
                signers: document.signersCaption,
            }),
            paragraph('', { spaceAfter: 6 }),
            paragraph('{letterhead.footer}', { size: 7 }),
            paragraph('Dicetak {printed.at} oleh {printed.by}', { size: 7 }),
        ],
    });
}
