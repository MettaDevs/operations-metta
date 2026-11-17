import {
    paragraph,
    type BuiltinLayout,
} from '../../../platform/reporting/index.ts';
import {
    blankName,
    inventoryDocument,
    type DocumentColumn,
} from '../document-layout.ts';

// Layout bawaan mutasi dan penerimaan mutasi: A4 mendatar, karena setiap baris membawa batch, kedaluwarsa, sumber dana,
// dan nilai. Mutasi langsung berlaku juga sebagai berita acara serah terima: pengirim dan penerima menandatangani
// lembar yang sama.

const columns: DocumentColumn[] = [
    { header: 'Kode', value: '{item_code}', width: 10 },
    { header: 'Nama barang', value: '{item_name}', width: 23 },
    { header: 'Batch', value: '{batch_number}', width: 10 },
    { header: 'Kedaluwarsa', value: '{expiry_date}', width: 14 },
    { header: 'Jumlah', value: '{quantity}', width: 8, align: 'right' },
    { header: 'Satuan', value: '{unit}', width: 7 },
    {
        header: 'Sumber dana',
        value: '{funding_source} {budget_year}',
        width: 12,
    },
    { header: 'Harga satuan', value: '{unit_cost}', width: 9, align: 'right' },
    { header: 'Nilai', value: '{amount}', width: 10, align: 'right' },
];

const totals: [string, string][] = [['Total nilai', '{total_amount}']];
const words = [paragraph('Terbilang: {total_amount_words} Rupiah')];

function shipment(): Uint8Array {
    return inventoryDocument({
        title: 'MUTASI BARANG',
        orientation: 'landscape',
        marks: [{ flag: 'is_cancelled', text: 'POSTING DIBATALKAN' }],
        details: [
            ['Nomor', '{number}'],
            ['Tanggal', '{posting_date}'],
            ['Dari lokasi', '{from_location}'],
            [
                'Ke lokasi',
                '{to_location}{#transit_location}, lewat {transit_location}{/transit_location}',
            ],
            ['Nomor amprah', '{transfer_order_number}'],
            ['Tanggal amprah', '{transfer_order_date}'],
            ['Diposting', '{posted_at}'],
        ],
        lines: 'lines',
        columns,
        totals,
        notes: words,
        parties: [
            { caption: 'Yang menyerahkan', name: '{shipped_by}' },
            { caption: 'Yang menerima', name: blankName },
        ],
        dated: '{posting_date}',
        signersCaption: 'Mengetahui,',
    });
}

function receipt(): Uint8Array {
    return inventoryDocument({
        title: 'PENERIMAAN MUTASI BARANG',
        orientation: 'landscape',
        marks: [{ flag: 'is_cancelled', text: 'POSTING DIBATALKAN' }],
        details: [
            ['Nomor', '{number}'],
            ['Tanggal', '{posting_date}'],
            ['Dari lokasi transit', '{from_location}'],
            ['Ke lokasi', '{to_location}'],
            ['Nomor amprah', '{transfer_order_number}'],
            ['Tanggal amprah', '{transfer_order_date}'],
            ['Diposting', '{posted_at}'],
        ],
        lines: 'lines',
        columns,
        totals,
        notes: words,
        parties: [
            { caption: 'Yang menyerahkan', name: '{shipped_by}' },
            { caption: 'Yang menerima', name: '{received_by}' },
        ],
        dated: '{posting_date}',
        signersCaption: 'Mengetahui,',
    });
}

export const transferShipmentLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        key: 'a4-landscape',
        name: 'Mutasi A4 mendatar',
        language: 'id',
        document: shipment,
    },
];

export const transferReceiptLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        key: 'a4-landscape',
        name: 'Penerimaan mutasi A4 mendatar',
        language: 'id',
        document: receipt,
    },
];
