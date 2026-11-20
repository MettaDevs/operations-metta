import type { BuiltinLayout } from '../../../platform/reporting/index.ts';
import { blankName, inventoryDocument } from '../document-layout.ts';

function a4(): Uint8Array {
    return inventoryDocument({
        title: 'KARTU STOK',
        orientation: 'landscape',
        marks: [],
        details: [
            ['Barang', '{item_code} {item_name}'],
            ['Lokasi', '{location_code} {location_name}'],
            ['Satuan', '{unit}'],
            ['Periode', '{date_from} s.d. {date_to}'],
            ['Saldo awal', '{opening_balance} {unit}'],
        ],
        lines: 'lines',
        columns: [
            { header: 'Tanggal', value: '{posting_date}', width: 11 },
            { header: 'No. dokumen', value: '{document_number}', width: 15 },
            { header: 'Jenis gerak', value: '{movement}', width: 22 },
            { header: 'Batch', value: '{batch_number}', width: 12 },
            { header: 'Kedaluwarsa', value: '{expiry_date}', width: 11 },
            {
                header: 'Masuk',
                value: '{quantity_in}',
                width: 9,
                align: 'right',
            },
            {
                header: 'Keluar',
                value: '{quantity_out}',
                width: 9,
                align: 'right',
            },
            { header: 'Saldo', value: '{balance}', width: 9, align: 'right' },
        ],
        totals: [
            ['Jumlah masuk', '{total_in} {unit}'],
            ['Jumlah keluar', '{total_out} {unit}'],
            ['Saldo akhir', '{closing_balance} {unit}'],
        ],
        parties: [{ caption: 'Petugas gudang', name: blankName }],
        dated: '{date_to}',
        signersCaption: 'Mengetahui,',
    });
}

export const stockCardLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        format: 'docx',
        key: 'a4',
        name: 'Kartu stok A4',
        language: 'id',
        document: a4,
    },
];
