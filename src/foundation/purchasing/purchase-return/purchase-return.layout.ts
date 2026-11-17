import { blankName, inventoryDocument } from '../../inventory/index.ts';
import {
    paragraph,
    type BuiltinLayout,
} from '../../../platform/reporting/index.ts';

// Layout bawaan retur ke vendor: surat jalan barang kembali, ditandatangani petugas yang menyerahkan dan vendor yang
// menerima.
function a4(): Uint8Array {
    return inventoryDocument({
        title: 'RETUR BARANG KE VENDOR',
        orientation: 'portrait',
        marks: [{ flag: 'is_cancelled', text: 'RETUR DIBATALKAN' }],
        details: [
            ['Nomor', '{number}'],
            ['Tanggal retur', '{posting_date}'],
            ['Vendor', '{vendor_name}'],
            ['Dari lokasi', '{location}'],
            ['Atas penerimaan', '{receipt_number}'],
            ['Dokumen vendor', '{vendor_document_number}'],
            ['Alasan', '{reason}'],
        ],
        lines: 'lines',
        columns: [
            { header: 'Kode', value: '{item_code}', width: 11 },
            { header: 'Nama barang', value: '{item_name}', width: 24 },
            { header: 'Batch', value: '{batch_number}', width: 11 },
            { header: 'Kedaluwarsa', value: '{expiry_date}', width: 16 },
            { header: 'Jumlah', value: '{quantity}', width: 8, align: 'right' },
            { header: 'Satuan', value: '{unit}', width: 7 },
            {
                header: 'Harga',
                value: '{unit_cost}',
                width: 10,
                align: 'right',
            },
            { header: 'Nilai', value: '{amount}', width: 11, align: 'right' },
        ],
        totals: [['Total nilai', '{total}']],
        notes: [paragraph('Terbilang: {total_words} Rupiah')],
        parties: [
            { caption: 'Yang menyerahkan', name: '{returned_by}' },
            { caption: 'Vendor yang menerima', name: blankName },
        ],
        dated: '{posting_date}',
        signersCaption: 'Mengetahui,',
    });
}

export const purchaseReturnLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        key: 'a4',
        name: 'Retur ke vendor A4',
        language: 'id',
        document: a4,
    },
];
