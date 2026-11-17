import type { BuiltinLayout } from '../../../platform/reporting/index.ts';
import { blankName, inventoryDocument } from '../document-layout.ts';

// Layout bawaan LPLPO, urutan kolom ekspor Excel sistem lama: stok awal, penerimaan, persediaan, pemakaian, sisa stok,
// stok optimum, dan permintaan. Rincian penerimaan per sumber dana satu kolom berisi daftar "nama jumlah", karena
// sumber dana datang dari master tiap legal entity dan layout Word tidak bisa menambah kolom tabel per data.
function a4(): Uint8Array {
    return inventoryDocument({
        title: 'LAPORAN PEMAKAIAN DAN LEMBAR PERMINTAAN OBAT',
        orientation: 'landscape',
        marks: [],
        details: [
            ['Lokasi', '{location_code} {location_name}'],
            ['Periode', '{date_from} s.d. {date_to}'],
        ],
        lines: 'lines',
        columns: [
            { header: 'Kode', value: '{item_code}', width: 9 },
            { header: 'Nama barang', value: '{item_name}', width: 20 },
            { header: 'Satuan', value: '{unit}', width: 6 },
            {
                header: 'Stok awal',
                value: '{opening}',
                width: 8,
                align: 'right',
            },
            {
                header: 'Penerimaan',
                value: '{received}',
                width: 8,
                align: 'right',
            },
            {
                header: 'Penerimaan per sumber dana',
                value: '{#received_by_funding_source}{funding_source} {quantity}{^$last}, {/$last}{/received_by_funding_source}',
                width: 14,
            },
            {
                header: 'Persediaan',
                value: '{available}',
                width: 8,
                align: 'right',
            },
            { header: 'Pemakaian', value: '{used}', width: 8, align: 'right' },
            {
                header: 'Sisa stok',
                value: '{closing}',
                width: 8,
                align: 'right',
            },
            {
                header: 'Stok optimum',
                value: '{optimum}',
                width: 8,
                align: 'right',
            },
            {
                header: 'Permintaan',
                value: '{requested}',
                width: 8,
                align: 'right',
            },
        ],
        parties: [
            { caption: 'Yang melaporkan', name: blankName },
            { caption: 'Yang menyerahkan', name: blankName },
        ],
        dated: '{date_to}',
        signersCaption: 'Mengetahui,',
    });
}

export const lplpoLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    { key: 'a4', name: 'LPLPO A4', language: 'id', document: a4 },
];
