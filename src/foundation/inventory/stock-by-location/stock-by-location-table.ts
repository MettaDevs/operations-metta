import { displayDate } from '@operations-metta/ui/date-picker';
import type { ApiBody } from '../../../platform/shell/index.ts';
import { displayNumber } from '@operations-metta/ui/display-number';
import type { ReportTable } from '../report-table.ts';

type Stock = ApiBody<'inventoryStockByLocation'>;

// Baris per lokasi dan batch, lalu satu baris total per barang.
export function stockByLocationTable(report: Stock): ReportTable {
    return {
        columns: [
            { id: 'code', header: 'Kode', numeric: false, width: 110 },
            { id: 'name', header: 'Nama barang', numeric: false, width: 240 },
            { id: 'location', header: 'Lokasi', numeric: false, width: 200 },
            { id: 'batch', header: 'Batch', numeric: false, width: 130 },
            {
                id: 'expiry_date',
                header: 'Kedaluwarsa',
                numeric: false,
                width: 120,
            },
            { id: 'quantity', header: 'Jumlah', numeric: true, width: 110 },
            { id: 'unit', header: 'Satuan', numeric: false, width: 80 },
            {
                id: 'value',
                header: 'Nilai',
                numeric: true,
                width: 140,
                description: 'Harga pokok stok itu menurut harga masuknya.',
            },
        ],
        rows: report.items.flatMap((group) => [
            ...group.lines.map((line) => ({
                key: `${group.item.id}:${line.location.id}:${line.batch?.id ?? ''}`,
                total: false,
                cells: [
                    group.item.code,
                    group.item.name,
                    `${line.location.code} · ${line.location.name}`,
                    line.batch?.batch_number ?? '',
                    line.batch?.expiry_date
                        ? displayDate(line.batch.expiry_date)
                        : '',
                    displayNumber(line.quantity),
                    group.item.unit,
                    displayNumber(line.value),
                ],
            })),
            {
                key: `${group.item.id}:total`,
                total: true,
                cells: [
                    group.item.code,
                    group.item.name,
                    'Total',
                    '',
                    '',
                    displayNumber(group.quantity),
                    group.item.unit,
                    displayNumber(group.value),
                ],
            },
        ]),
    };
}
