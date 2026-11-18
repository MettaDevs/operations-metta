import { blankName, inventoryDocument } from '../../inventory/index.ts';
import {
    paragraph,
    type BuiltinLayout,
} from '../../../platform/reporting/index.ts';

function a4(): Uint8Array {
    return inventoryDocument({
        title: 'BUKTI PEMBAYARAN KE VENDOR',
        orientation: 'portrait',
        marks: [
            { flag: 'is_draft', text: 'BELUM DIPOSTING' },
            { flag: 'is_cancelled', text: 'PEMBAYARAN DIBATALKAN' },
        ],
        details: [
            ['Nomor', '{number}'],
            ['Tanggal bayar', '{posting_date}'],
            ['Vendor', '{vendor_name}'],
            ['Cara bayar', '{payment_method}'],
            ['Rekening bank', '{bank}'],
            ['No. referensi', '{reference}'],
            ['Keterangan', '{description}'],
        ],
        lines: 'lines',
        columns: [
            { header: 'Faktur', value: '{document_number}', width: 18 },
            {
                header: 'No. dokumen vendor',
                value: '{vendor_document_number}',
                width: 24,
            },
            { header: 'Jatuh tempo', value: '{due_date}', width: 16 },
            {
                header: 'Nilai faktur',
                value: '{invoice_amount}',
                width: 19,
                align: 'right',
            },
            { header: 'Dibayar', value: '{amount}', width: 19, align: 'right' },
        ],
        totals: [['Total dibayar', '{total}']],
        notes: [paragraph('Terbilang: {total_words} Rupiah')],
        parties: [
            { caption: 'Yang membayar', name: '{paid_by}' },
            { caption: 'Vendor yang menerima', name: blankName },
        ],
        dated: '{posting_date}',
        signersCaption: 'Mengetahui,',
    });
}

export const vendorPaymentLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        key: 'a4',
        name: 'Bukti pembayaran ke vendor A4',
        language: 'id',
        document: a4,
    },
];
