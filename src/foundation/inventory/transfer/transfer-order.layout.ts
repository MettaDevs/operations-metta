import type { BuiltinLayout } from '../../../platform/reporting/index.ts';
import { blankName, inventoryDocument } from '../document-layout.ts';

// Layout bawaan permintaan barang. Klinik yang ingin rupa lain mengunduhnya dari Sys Admin › Layout cetak.
function a4(): Uint8Array {
    return inventoryDocument({
        title: 'PERMINTAAN BARANG',
        orientation: 'portrait',
        marks: [
            { flag: 'is_draft', text: 'DRAF, BELUM DIAJUKAN' },
            { flag: 'is_cancelled', text: 'DIBATALKAN' },
        ],
        details: [
            ['Nomor', '{number}'],
            ['Tanggal', '{posting_date}'],
            ['Diminta oleh', '{requesting_location}'],
            ['Diminta ke', '{supplying_location}'],
            ['Diajukan', '{submitted_at}'],
            ['Keterangan', '{description}'],
        ],
        lines: 'lines',
        columns: [
            { header: 'Kode', value: '{item_code}', width: 14 },
            { header: 'Nama barang', value: '{item_name}', width: 38 },
            { header: 'Satuan', value: '{unit}', width: 10 },
            {
                header: 'Diminta',
                value: '{quantity}',
                width: 12,
                align: 'right',
            },
            {
                header: 'Dikirim',
                value: '{quantity_shipped}',
                width: 11,
                align: 'right',
            },
            {
                header: 'Diterima',
                value: '{quantity_received}',
                width: 11,
                align: 'right',
            },
        ],
        parties: [
            { caption: 'Yang meminta', name: '{requested_by}' },
            { caption: 'Yang menyetujui', name: blankName },
        ],
        dated: '{posting_date}',
        signersCaption: 'Mengetahui,',
    });
}

export const transferOrderLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        format: 'docx',
        key: 'a4',
        name: 'Permintaan barang A4',
        language: 'id',
        document: a4,
    },
];
