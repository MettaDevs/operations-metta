import type { BuiltinLayout } from '../../../platform/reporting/index.ts';

export const inventoryValueLayouts: [BuiltinLayout, ...BuiltinLayout[]] = [
    {
        format: 'xlsx',
        key: 'per-funding-source',
        name: 'Nilai persediaan per sumber dana',
        language: 'id',
        workbook: {
            sheets: [
                {
                    name: 'Nilai persediaan',
                    orientation: 'landscape',
                    widths: [
                        24, 18, 30, 12, 14, 14, 16, 14, 16, 14, 16, 14, 16,
                    ],
                    cells: [
                        {
                            at: 'A1',
                            content: { name: 'letterhead.name' },
                            style: 'heading',
                        },
                        {
                            at: 'A2',
                            content: { text: 'NILAI PERSEDIAAN' },
                            style: 'title',
                        },
                        {
                            at: 'A3',
                            content: { text: 'Lokasi' },
                            style: 'label',
                        },
                        { at: 'B3', content: { name: 'location_code' } },
                        { at: 'C3', content: { name: 'location_name' } },
                        {
                            at: 'A4',
                            content: { text: 'Periode' },
                            style: 'label',
                        },
                        { at: 'B4', content: { name: 'date_from' } },
                        { at: 'C4', content: { text: 's.d.' } },
                        { at: 'D4', content: { name: 'date_to' } },
                        {
                            at: 'A5',
                            content: { text: 'Kategori barang' },
                            style: 'label',
                        },
                        {
                            at: 'B5',
                            content: {
                                formula:
                                    'IF(Report.category_name="","Semua kategori",Report.category_name)',
                            },
                        },
                        {
                            at: 'A6',
                            content: { text: 'Dicetak' },
                            style: 'label',
                        },
                        { at: 'B6', content: { name: 'printed.at' } },
                        { at: 'C6', content: { name: 'printed.by' } },
                    ],
                    pivot: {
                        table: 'lines',
                        at: 'A8',
                        rows: [
                            'funding_source_name',
                            'item_code',
                            'item_name',
                            'unit',
                            'unit_cost',
                        ],
                        values: [
                            'opening_quantity',
                            'opening_value',
                            'received_quantity',
                            'received_value',
                            'issued_quantity',
                            'issued_value',
                            'closing_quantity',
                            'closing_value',
                        ],
                        grandTotalCaption: 'TOTAL PERSEDIAAN',
                    },
                    printTitleRows: [8, 9],
                },
            ],
            visibleTables: [
                { table: 'lines', sheet: 'Barang per sumber dana' },
            ],
        },
    },
];
