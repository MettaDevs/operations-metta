import {
    paragraph,
    type BuiltinLayout,
} from '../../../platform/reporting/index.ts';
import { blankName, inventoryDocument } from '../document-layout.ts';

// Layout bawaan penyesuaian stok. Satu rupa untuk semua alasan: pemakaian sendiri, pemusnahan, dan koreksi. Kolom
// saksi menjadikannya berita acara pemusnahan bila alasannya pemusnahan.
function a4(): Uint8Array {
    return inventoryDocument({
        title: 'PENYESUAIAN STOK',
        orientation: 'portrait',
        marks: [
            { flag: 'is_draft', text: 'DRAF, BELUM DIPOSTING' },
            { flag: 'is_cancelled', text: 'POSTING DIBATALKAN' },
        ],
        details: [
            ['Nomor', '{number}'],
            ['Tanggal', '{posting_date}'],
            [
                'Arah',
                '{#is_inbound}Stok masuk{/is_inbound}{^is_inbound}Stok keluar{/is_inbound}',
            ],
            ['Alasan', '{reason}'],
            ['Lokasi', '{location}'],
            ['Diposting', '{posted_at}'],
        ],
        lines: 'lines',
        columns: [
            { header: 'Kode', value: '{item_code}', width: 11 },
            { header: 'Nama barang', value: '{item_name}', width: 25 },
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
        totals: [['Total nilai', '{total_amount}']],
        notes: [paragraph('Terbilang: {total_amount_words} Rupiah')],
        parties: [
            { caption: 'Petugas', name: '{posted_by}' },
            { caption: 'Saksi', name: blankName },
        ],
        dated: '{posting_date}',
        signersCaption: 'Mengetahui,',
    });
}

export const adjustmentLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        key: 'a4',
        name: 'Penyesuaian stok A4',
        language: 'id',
        document: a4,
    },
];
