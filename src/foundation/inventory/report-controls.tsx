import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, parseDate } from '@operations-metta/ui/date-picker';
import { FormControl } from '@operations-metta/ui/form-control';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ReportRow, ReportTable } from './report-table.ts';

// Tanggal periode tinggal di URL. Ketikan yang belum menjadi tanggal sah ditahan di sini, supaya URL tidak pernah
// menerima teks setengah jadi.
export function ReportDate({
    label,
    value,
    min,
    max,
    onChange,
}: {
    label: string;
    value: string;
    min?: string;
    max?: string;
    onChange: (value: string) => void;
}): ReactNode {
    const [typing, setTyping] = useState({ source: value, text: value });
    return (
        <FormControl>
            <DatePicker
                label={label}
                required
                min={min}
                max={max}
                value={typing.source === value ? typing.text : value}
                onValueChange={(next) => {
                    const valid = parseDate(next) !== undefined;
                    setTyping({ source: valid ? next : value, text: next });
                    if (valid) onChange(next);
                }}
            />
        </FormControl>
    );
}

// Tabel laporan digambar dari teks yang sama dengan unduhan CSV.
export function ReportDataTable({
    table,
    emptyMessage,
}: {
    table: ReportTable;
    emptyMessage: string;
}): ReactNode {
    return (
        <DataTable<ReportRow>
            data={table.rows}
            getRowKey={(row) => row.key}
            getRowLabel={(row) => row.cells.slice(0, 2).join(' ')}
            showRowNumbers
            emptyMessage={emptyMessage}
            columns={table.columns.map((column, index) => ({
                id: column.id,
                header: column.header,
                width: column.width,
                ...(column.description
                    ? { description: column.description }
                    : {}),
                align: column.numeric ? ('right' as const) : ('left' as const),
                cell: (row: ReportRow) => (
                    <span className={row.total ? 'font-semibold' : undefined}>
                        <DataTableText>{row.cells[index] ?? ''}</DataTableText>
                    </span>
                ),
            }))}
        />
    );
}
