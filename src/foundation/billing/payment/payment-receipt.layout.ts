import {
    cell,
    letterheadBlocks,
    paragraph,
    wordDocument,
    type BuiltinLayout,
    type Language,
    type Row,
    when,
} from '../../../platform/reporting/index.ts';

// Layout bawaan kuitansi. Ini titik awal: klinik yang ingin rupa lain mengunduh layout ini dari Sys Admin › Layout
// cetak, mengubahnya di Word, lalu mengunggahnya untuk legal entity-nya.

const labels = {
    id: {
        title: 'KUITANSI',
        cancelled: 'DIBATALKAN',
        number: 'No. Kuitansi',
        date: 'Tanggal',
        from: 'Telah terima dari',
        record: 'No. RM / No. Reg',
        type: 'Tipe pasien',
        section: 'Poli / unit',
        purpose: 'Untuk pembayaran',
        service: 'Jenis pelayanan',
        amount: 'Nilai',
        value: 'Jumlah',
        discount: 'Diskon',
        surcharge: 'Biaya kartu',
        total: 'Total',
        words: 'Terbilang',
        currency: 'Rupiah',
        paidWith: 'Dibayar dengan',
        received: 'Uang diterima',
        change: 'Kembalian',
        payer: 'Penyetor',
        cashier: 'Kasir',
        printed: 'Dicetak',
        by: 'oleh',
    },
    en: {
        title: 'RECEIPT',
        cancelled: 'CANCELLED',
        number: 'Receipt no.',
        date: 'Date',
        from: 'Received from',
        record: 'Medical record / Reg. no.',
        type: 'Patient type',
        section: 'Clinic / unit',
        purpose: 'For payment of',
        service: 'Service',
        amount: 'Amount',
        value: 'Subtotal',
        discount: 'Discount',
        surcharge: 'Card fee',
        total: 'Total',
        words: 'In words',
        currency: 'Rupiah',
        paidWith: 'Paid with',
        received: 'Amount received',
        change: 'Change',
        payer: 'Payer',
        cashier: 'Cashier',
        printed: 'Printed',
        by: 'by',
    },
} as const;

function amountRow(label: string, value: string, bold = false): Row {
    return {
        cells: [cell(label, { bold }), cell(value, { align: 'right', bold })],
    };
}

// Baris yang hanya tampil bila flag-nya benar: tag pembuka dan penutup syarat ada di satu baris tabel, jadi baris itu
// hilang seluruhnya bila flag-nya salah.
function optionalRow(flag: string, label: string, value: string): Row {
    return {
        cells: [
            cell(`{#${flag}}${label}`),
            cell(`${value}{/${flag}}`, { align: 'right' }),
        ],
    };
}

function a4(language: Language): Uint8Array {
    const text = labels[language];
    const detail = (label: string, value: string): Row => ({
        cells: [cell(label), cell(`: ${value}`)],
    });
    return wordDocument({
        paper: { widthMm: 210, heightMm: 297 },
        marginMm: 15,
        font: 'Arial',
        fontSize: 10,
        body: [
            ...letterheadBlocks({ name: 14, detail: 9 }),
            paragraph('', { spaceAfter: 6 }),
            paragraph(text.title, { align: 'center', bold: true, size: 14 }),
            ...when('cancelled', [
                paragraph(`${text.cancelled}: {cancel_reason}`, {
                    align: 'center',
                    bold: true,
                }),
            ]),
            paragraph('', { spaceAfter: 6 }),
            {
                kind: 'table',
                widths: [30, 70],
                borders: 'none',
                rows: [
                    detail(text.number, '{number}'),
                    detail(text.date, '{paid_at}'),
                    detail(text.from, '{received_from}'),
                    detail(
                        text.record,
                        '{medical_record_number} / {source_number}',
                    ),
                    detail(text.type, '{patient_type} {guarantor}'),
                    detail(text.section, '{section}'),
                ],
            },
            paragraph(`${text.purpose}:`, { spaceAfter: 3 }),
            {
                kind: 'table',
                widths: [70, 30],
                borders: 'lines',
                rows: [
                    {
                        header: true,
                        cells: [
                            cell(text.service, { bold: true }),
                            cell(text.amount, { bold: true, align: 'right' }),
                        ],
                    },
                    {
                        cells: [
                            cell('{#services}{name}'),
                            cell('{amount}{/services}', { align: 'right' }),
                        ],
                    },
                ],
            },
            {
                kind: 'table',
                widths: [70, 30],
                borders: 'none',
                rows: [
                    amountRow(text.value, '{value}'),
                    optionalRow('has_discount', text.discount, '{discount}'),
                    optionalRow('has_surcharge', text.surcharge, '{surcharge}'),
                    amountRow(text.total, '{total}', true),
                ],
            },
            paragraph([
                { text: `${text.words}: `, bold: true },
                `{total_words} ${text.currency}`,
            ]),
            paragraph('', { spaceAfter: 6 }),
            paragraph(`${text.paidWith}:`),
            {
                kind: 'table',
                widths: [70, 30],
                borders: 'none',
                rows: [
                    {
                        cells: [
                            cell('{#tenders}{name}'),
                            cell('{amount}{/tenders}', { align: 'right' }),
                        ],
                    },
                    amountRow(text.received, '{received}'),
                    amountRow(text.change, '{change}'),
                ],
            },
            paragraph('', { spaceAfter: 12 }),
            {
                kind: 'table',
                widths: [50, 50],
                borders: 'none',
                rows: [
                    {
                        cells: [
                            cell(text.payer, { align: 'center' }),
                            cell(`{paid_at_date}`, { align: 'center' }),
                        ],
                    },
                    {
                        cells: [
                            cell('', { spaceAfter: 40 }),
                            cell(text.cashier, {
                                align: 'center',
                                spaceAfter: 40,
                            }),
                        ],
                    },
                    {
                        cells: [
                            cell('( {received_from} )', { align: 'center' }),
                            cell('( {cashier} )', { align: 'center' }),
                        ],
                    },
                ],
            },
            paragraph('', { spaceAfter: 6 }),
            paragraph('{letterhead.footer}', { size: 8 }),
            paragraph(`${text.printed} {printed.at} ${text.by} {printed.by}`, {
                size: 7,
            }),
        ],
    });
}

// Struk kasir 76 mm: satu kolom, huruf kecil, untuk printer thermal. Tinggi halaman 200 mm; kuitansi yang lebih
// panjang berlanjut ke halaman berikutnya.
function thermal(): Uint8Array {
    const text = labels.id;
    return wordDocument({
        paper: { widthMm: 76, heightMm: 200 },
        marginMm: 3,
        font: 'Arial',
        fontSize: 8,
        body: [
            ...letterheadBlocks({ name: 10, detail: 7 }),
            paragraph(text.title, { align: 'center', bold: true, size: 10 }),
            ...when('cancelled', [
                paragraph(text.cancelled, { align: 'center', bold: true }),
            ]),
            paragraph('{number}'),
            paragraph('{paid_at}'),
            paragraph('{received_from} {medical_record_number}'),
            {
                kind: 'table',
                widths: [60, 40],
                borders: 'lines',
                rows: [
                    {
                        cells: [
                            cell('{#services}{name}'),
                            cell('{amount}{/services}', { align: 'right' }),
                        ],
                    },
                    optionalRow('has_discount', text.discount, '{discount}'),
                    amountRow(text.total, '{total}', true),
                    {
                        cells: [
                            cell('{#tenders}{name}'),
                            cell('{amount}{/tenders}', { align: 'right' }),
                        ],
                    },
                    amountRow(text.received, '{received}'),
                    amountRow(text.change, '{change}'),
                ],
            },
            paragraph(`{total_words} ${text.currency}`, { size: 7 }),
            paragraph(`${text.cashier}: {cashier}`, { size: 7 }),
            paragraph('{letterhead.footer}', { size: 7, align: 'center' }),
        ],
    });
}

export const paymentReceiptLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        key: 'a4',
        name: 'Kuitansi A4',
        language: 'id',
        document: () => a4('id'),
    },
    {
        key: 'a4-en',
        name: 'Receipt A4 (English)',
        language: 'en',
        document: () => a4('en'),
    },
    {
        key: 'thermal-76',
        name: 'Struk 76 mm',
        language: 'id',
        document: thermal,
    },
];
