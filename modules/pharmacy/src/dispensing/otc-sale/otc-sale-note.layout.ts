import {
    cell,
    letterheadBlocks,
    paragraph,
    when,
    wordDocument,
    type Block,
    type BuiltinLayout,
    type Row,
} from '@core/platform/reporting/index.ts';

// Layout bawaan nota penjualan obat bebas, dengan kertas yang sama dengan kuitansi kasir: A4 sebagai bawaan dan struk
// 76 mm untuk printer thermal di loket. Apotek yang ingin rupa lain mengunduhnya dari Sys Admin › Layout cetak,
// mengubahnya di Word, lalu mengunggahnya untuk legal entity-nya.

const text = {
    title: 'NOTA PENJUALAN',
    number: 'No. Nota',
    date: 'Tanggal',
    location: 'Lokasi',
    buyer: 'Pembeli',
    generalBuyer: 'Pembeli umum',
    seller: 'Petugas',
    drug: 'Obat',
    quantity: 'Jumlah',
    unitPrice: 'Harga',
    discount: 'Disk %',
    amount: 'Nilai',
    returned: 'diretur',
    billed: 'ditagih',
    total: 'Total',
    words: 'Terbilang',
    currency: 'Rupiah',
    unpaid: 'BELUM DIBAYAR',
    paidWith: 'Dibayar dengan',
    payment: 'No. Bukti',
    surcharge: 'Biaya kartu',
    paidTotal: 'Total dibayar',
    received: 'Uang diterima',
    change: 'Kembalian',
    cashier: 'Kasir',
    printed: 'Dicetak',
    by: 'oleh',
};

const buyer = `{^buyer_name}${text.generalBuyer}{/buyer_name}{buyer_name}`;
const returnedNote = `{#returned} (${text.returned} {returned_quantity}, ${text.billed} {net_quantity}){/returned}`;

function amountRow(label: string, value: string, bold = false): Row {
    return {
        cells: [cell(label, { bold }), cell(value, { align: 'right', bold })],
    };
}

// Baris yang hanya tampil bila flag-nya benar: tag syaratnya dibuka di sel pertama dan ditutup di sel kedua, jadi
// seluruh baris tabel hilang bila flag-nya salah.
function optionalRow(flag: string, label: string, value: string): Row {
    return {
        cells: [
            cell(`{#${flag}}${label}`),
            cell(`${value}{/${flag}}`, { align: 'right' }),
        ],
    };
}

const paidRow = (label: string, value: string) =>
    optionalRow('paid', label, value);
const surchargeRow = optionalRow(
    'has_surcharge',
    text.surcharge,
    '{surcharge}',
);

const tenderRow: Row = {
    cells: [
        cell('{#tenders}{name}'),
        cell('{amount}{/tenders}', { align: 'right' }),
    ],
};

const unpaid: Block[] = [
    paragraph('{^paid}'),
    paragraph(text.unpaid, { bold: true }),
    paragraph('{/paid}'),
];

function a4(): Uint8Array {
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
            paragraph('', { spaceAfter: 6 }),
            {
                kind: 'table',
                widths: [20, 80],
                borders: 'none',
                rows: [
                    detail(text.number, '{number}'),
                    detail(text.date, '{sold_at}'),
                    detail(text.location, '{location}'),
                    detail(text.buyer, buyer),
                    detail(text.seller, '{seller}'),
                ],
            },
            paragraph('', { spaceAfter: 6 }),
            {
                kind: 'table',
                widths: [46, 14, 15, 10, 15],
                borders: 'lines',
                rows: [
                    {
                        header: true,
                        cells: [
                            cell(text.drug, { bold: true }),
                            cell(text.quantity, { bold: true, align: 'right' }),
                            cell(text.unitPrice, {
                                bold: true,
                                align: 'right',
                            }),
                            cell(text.discount, { bold: true, align: 'right' }),
                            cell(text.amount, { bold: true, align: 'right' }),
                        ],
                    },
                    {
                        cells: [
                            cell(`{#lines}{code} {name}${returnedNote}`),
                            cell('{quantity} {unit}', { align: 'right' }),
                            cell('{unit_price}', { align: 'right' }),
                            cell('{discount_percent}', { align: 'right' }),
                            cell('{amount}{/lines}', { align: 'right' }),
                        ],
                    },
                    {
                        cells: [
                            cell('{#fees}{name}', { span: 4 }),
                            cell('{amount}{/fees}', { align: 'right' }),
                        ],
                    },
                    {
                        cells: [
                            cell(text.total, { span: 4, bold: true }),
                            cell('{total}', { align: 'right', bold: true }),
                        ],
                    },
                ],
            },
            paragraph([
                { text: `${text.words}: `, bold: true },
                `{total_words} ${text.currency}`,
            ]),
            paragraph('', { spaceAfter: 6 }),
            ...unpaid,
            ...when('paid', [paragraph(`${text.paidWith}:`)]),
            {
                kind: 'table',
                widths: [70, 30],
                borders: 'none',
                rows: [
                    paidRow(text.payment, '{payment_number}'),
                    tenderRow,
                    surchargeRow,
                    paidRow(text.paidTotal, '{paid_total}'),
                    paidRow(text.received, '{received}'),
                    paidRow(text.change, '{change}'),
                    paidRow(text.cashier, '{cashier}'),
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

function thermal(): Uint8Array {
    return wordDocument({
        paper: { widthMm: 76, heightMm: 200 },
        marginMm: 3,
        font: 'Arial',
        fontSize: 8,
        body: [
            ...letterheadBlocks({ name: 10, detail: 7 }),
            paragraph(text.title, { align: 'center', bold: true, size: 10 }),
            paragraph('{number}'),
            paragraph('{sold_at}'),
            paragraph(`{location} · ${buyer}`),
            {
                kind: 'table',
                widths: [65, 35],
                borders: 'lines',
                rows: [
                    {
                        cells: [
                            cell([
                                paragraph(`{#lines}{name}`),
                                paragraph(
                                    `{quantity} {unit} x {unit_price}{#discounted} -{discount_percent}%{/discounted}${returnedNote}`,
                                    { size: 7 },
                                ),
                            ]),
                            cell('{amount}{/lines}', { align: 'right' }),
                        ],
                    },
                    {
                        cells: [
                            cell('{#fees}{name}'),
                            cell('{amount}{/fees}', { align: 'right' }),
                        ],
                    },
                    amountRow(text.total, '{total}', true),
                ],
            },
            paragraph(`{total_words} ${text.currency}`, { size: 7 }),
            ...unpaid,
            {
                kind: 'table',
                widths: [60, 40],
                borders: 'none',
                rows: [
                    tenderRow,
                    surchargeRow,
                    paidRow(text.received, '{received}'),
                    paidRow(text.change, '{change}'),
                ],
            },
            ...when('paid', [
                paragraph(`{payment_number} · ${text.cashier}: {cashier}`, {
                    size: 7,
                }),
            ]),
            paragraph('{letterhead.footer}', { size: 7, align: 'center' }),
        ],
    });
}

export const otcSaleNoteLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    { key: 'a4', name: 'Nota A4', language: 'id', document: a4 },
    {
        key: 'thermal-76',
        name: 'Struk 76 mm',
        language: 'id',
        document: thermal,
    },
];
