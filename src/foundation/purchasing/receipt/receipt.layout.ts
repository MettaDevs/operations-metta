import { blankName, inventoryDocument } from '../../inventory/index.ts';
import {
    paragraph,
    when,
    type BuiltinLayout,
} from '../../../platform/reporting/index.ts';

// Layout bawaan penerimaan barang: A4 mendatar, karena setiap baris membawa batch, kedaluwarsa, harga, diskon, PPN,
// dan sumber dana. Vendor menandatangani sebagai yang menyerahkan, namanya ditulis tangan.
function a4(): Uint8Array {
    return inventoryDocument({
        title: 'PENERIMAAN BARANG',
        orientation: 'landscape',
        marks: [
            { flag: 'is_draft', text: 'DRAF, BELUM DIPOSTING' },
            { flag: 'is_cancelled', text: 'POSTING DIBATALKAN' },
        ],
        details: [
            ['Nomor', '{number}'],
            ['Tanggal terima', '{posting_date}'],
            ['Vendor', '{vendor_name}'],
            ['No. dokumen vendor', '{vendor_document_number}'],
            ['Lokasi', '{location}'],
            ['Keterangan', '{description}'],
        ],
        lines: 'lines',
        columns: [
            { header: 'Kode', value: '{item_code}', width: 9 },
            { header: 'Nama barang', value: '{item_name}', width: 18 },
            { header: 'Batch', value: '{batch_number}', width: 9 },
            { header: 'Kedaluwarsa', value: '{expiry_date}', width: 13 },
            { header: 'Jumlah', value: '{quantity}', width: 7, align: 'right' },
            { header: 'Satuan', value: '{unit}', width: 6 },
            {
                header: 'Harga satuan',
                value: '{unit_cost}',
                width: 8,
                align: 'right',
            },
            {
                header: 'Diskon %',
                value: '{discount_percent}',
                width: 7,
                align: 'right',
            },
            {
                header: 'PPN %',
                value: '{vat_percent}',
                width: 5,
                align: 'right',
            },
            {
                header: 'Sumber dana',
                value: '{funding_source} {budget_year}',
                width: 12,
            },
            { header: 'Nilai', value: '{amount}', width: 10, align: 'right' },
        ],
        totals: [
            ['Jumlah', '{subtotal}'],
            ['PPN', '{vat_amount}'],
            ['Total', '{total}'],
        ],
        notes: [
            paragraph('Terbilang: {total_words} Rupiah'),
            ...when('prices_including_vat', [
                paragraph('Harga vendor sudah termasuk PPN.', { size: 8 }),
            ]),
        ],
        parties: [
            { caption: 'Yang menyerahkan', name: blankName },
            { caption: 'Yang menerima', name: '{received_by}' },
        ],
        dated: '{posting_date}',
        signersCaption: 'Mengetahui,',
    });
}

export const receiptLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        key: 'a4-landscape',
        name: 'Penerimaan barang A4 mendatar',
        language: 'id',
        document: a4,
    },
];
