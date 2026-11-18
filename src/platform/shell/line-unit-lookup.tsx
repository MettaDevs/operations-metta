import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { displayNumber } from '@operations-metta/ui/display-number';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { ComponentProps, ReactNode } from 'react';

export type LineUnit = {
    id: string;
    code: string;
    name?: string;
    quantity_per_unit: string;
};

export function LineUnitLookup<Unit extends LineUnit>({
    units,
    value,
    onPick,
    required = false,
    portalContainer,
}: {
    units: Unit[];
    value: string | null;
    onPick: (unit: Unit) => void;
    required?: boolean;
    portalContainer?: ComponentProps<typeof InlineLookup>['portalContainer'];
}): ReactNode {
    const columns: DataTableColumn<Unit>[] = [
        { id: 'code', header: 'Kode', width: 90, cell: (unit) => unit.code },
        {
            id: 'name',
            header: 'Nama',
            width: 160,
            cell: (unit) => unit.name ?? '',
        },
        {
            id: 'quantity_per_unit',
            header: 'Isi',
            width: 80,
            align: 'right',
            cell: (unit) => displayNumber(unit.quantity_per_unit),
        },
    ];
    return (
        <InlineLookup<Unit>
            label="Satuan"
            required={required}
            items={units}
            value={units.find((unit) => unit.id === value) ?? null}
            onValueChange={onPick}
            getItemValue={(unit) => unit.id}
            getItemLabel={(unit) =>
                `${unit.code} · isi ${displayNumber(unit.quantity_per_unit)}`
            }
            getSearchText={(unit) => `${unit.code} ${unit.name ?? ''}`}
            placeholder="Cari satuan…"
            emptyMessage="Satuan tidak ditemukan."
            columns={columns}
            portalContainer={portalContainer}
        />
    );
}
