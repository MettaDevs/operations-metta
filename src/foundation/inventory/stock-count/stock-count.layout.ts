import type { BuiltinLayout } from '../../../platform/reporting/index.ts';
import {
    blankName,
    inventoryDocument,
    type DocumentColumn,
} from '../document-layout.ts';

// Layout bawaan opname. Lembar hitung punya dua rupa seperti opsi Show Qty. (Calculated) di Phys. Inventory List BC:
// dengan stok tercatat, atau hitung buta tanpa angka sistem supaya petugas tidak sekadar menyalin.

const itemColumns: DocumentColumn[] = [
    { header: 'Kode', value: '{item_code}', width: 12 },
    { header: 'Nama barang', value: '{item_name}', width: 26 },
    { header: 'Batch', value: '{batch_number}', width: 12 },
    { header: 'Kedaluwarsa', value: '{expiry_date}', width: 17 },
    { header: 'Satuan', value: '{unit}', width: 9 },
];

const header: [string, string][] = [
    ['Nomor', '{number}'],
    ['Tanggal hitung', '{count_date}'],
    ['Lokasi', '{location}'],
    ['Keterangan', '{description}'],
];

function sheet(withRecorded: boolean) {
    return () =>
        inventoryDocument({
            title: 'LEMBAR HITUNG STOK',
            orientation: 'portrait',
            marks: [{ flag: 'is_cancelled', text: 'OPNAME DIBATALKAN' }],
            details: header,
            lines: 'lines',
            columns: [
                ...itemColumns,
                ...(withRecorded
                    ? [
                          {
                              header: 'Tercatat',
                              value: '{quantity_recorded}',
                              width: 10,
                              align: 'right' as const,
                          },
                      ]
                    : []),
                { header: 'Hasil hitung', value: '', width: 11 },
                { header: 'Catatan', value: '', width: 12 },
            ],
            parties: [
                { caption: 'Petugas hitung', name: blankName },
                { caption: 'Saksi', name: blankName },
            ],
            dated: '{count_date}',
            signersCaption: 'Mengetahui,',
        });
}

function result(): Uint8Array {
    return inventoryDocument({
        title: 'HASIL OPNAME STOK',
        orientation: 'landscape',
        marks: [
            { flag: 'is_draft', text: 'BELUM SELESAI DIHITUNG' },
            { flag: 'is_counted', text: 'BELUM DIPOSTING' },
            { flag: 'is_cancelled', text: 'OPNAME DIBATALKAN' },
        ],
        details: [
            ...header,
            ['Tanggal posting', '{posting_date}'],
            ['Diposting', '{posted_at}'],
        ],
        lines: 'lines',
        columns: [
            ...itemColumns,
            {
                header: 'Tercatat',
                value: '{quantity_recorded}',
                width: 9,
                align: 'right',
            },
            {
                header: 'Dihitung',
                value: '{quantity_counted}',
                width: 9,
                align: 'right',
            },
            {
                header: 'Selisih',
                value: '{difference}',
                width: 8,
                align: 'right',
            },
            {
                header: 'Nilai selisih',
                value: '{difference_amount}',
                width: 11,
                align: 'right',
            },
            { header: 'Keterangan', value: '{note}', width: 14 },
        ],
        totals: [
            ['Selisih lebih', '{increase_amount}'],
            ['Selisih kurang', '{decrease_amount}'],
            ['Selisih bersih', '{net_amount}'],
        ],
        parties: [
            { caption: 'Petugas hitung', name: '{counted_by}' },
            { caption: 'Yang memposting', name: '{posted_by}' },
        ],
        dated: '{posting_date}',
        signersCaption: 'Mengetahui,',
    });
}

export const stockCountSheetLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        key: 'a4',
        name: 'Lembar hitung dengan stok tercatat',
        language: 'id',
        document: sheet(true),
    },
    {
        key: 'a4-blind',
        name: 'Lembar hitung buta (tanpa stok tercatat)',
        language: 'id',
        document: sheet(false),
    },
];

export const stockCountResultLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        key: 'a4-landscape',
        name: 'Hasil opname A4 mendatar',
        language: 'id',
        document: result,
    },
];
