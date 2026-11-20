import { blankName, inventoryDocument } from '../../inventory/index.ts';
import {
    paragraph,
    when,
    type BuiltinLayout,
} from '../../../platform/reporting/index.ts';

function a4(): Uint8Array {
    return inventoryDocument({
        title: 'PURCHASE ORDER',
        orientation: 'portrait',
        marks: [{ flag: 'is_open', text: 'BELUM DIRILIS' }],
        details: [
            ['Nomor', '{number}'],
            ['Tanggal order', '{order_date}'],
            ['Vendor', '{vendor_name}'],
            ['Diharapkan datang', '{expected_receipt_date}'],
            ['Dikirim ke', '{location}'],
            ['Keterangan', '{description}'],
        ],
        lines: 'lines',
        columns: [
            { header: 'Kode', value: '{item_code}', width: 11 },
            { header: 'Nama barang', value: '{item_name}', width: 25 },
            { header: 'Jumlah', value: '{quantity}', width: 8, align: 'right' },
            { header: 'Satuan', value: '{unit}', width: 8 },
            {
                header: 'Harga satuan',
                value: '{unit_cost}',
                width: 12,
                align: 'right',
            },
            {
                header: 'Diskon %',
                value: '{discount_percent}',
                width: 8,
                align: 'right',
            },
            {
                header: 'PPN %',
                value: '{vat_percent}',
                width: 7,
                align: 'right',
            },
            { header: 'Nilai', value: '{amount}', width: 13, align: 'right' },
        ],
        totals: [
            ['Jumlah', '{subtotal}'],
            ['PPN', '{vat_amount}'],
            ['Total', '{total}'],
        ],
        notes: [
            paragraph('Terbilang: {total_words} Rupiah'),
            ...when('prices_including_vat', [
                paragraph('Harga sudah termasuk PPN.', { size: 8 }),
            ]),
        ],
        parties: [
            { caption: 'Vendor', name: blankName },
            { caption: 'Yang memesan', name: '{ordered_by}' },
        ],
        dated: '{order_date}',
        signersCaption: 'Mengetahui,',
    });
}

export const purchaseOrderLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        format: 'docx',
        key: 'a4-portrait',
        name: 'Purchase order A4 tegak',
        language: 'id',
        document: a4,
    },
];
