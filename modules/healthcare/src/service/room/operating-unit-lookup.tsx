import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { ReactNode, RefObject } from 'react';

type OperatingUnit = { id: string; name: string };

export function OperatingUnitLookup({
    units,
    value,
    onChange,
    portalContainer,
}: {
    units: OperatingUnit[];
    value: string | null;
    onChange: (id: string) => void;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    const selected = units.find((unit) => unit.id === value) ?? null;
    return (
        <InlineLookup
            label="Unit"
            required
            items={units}
            value={selected}
            displayValue={selected?.name ?? ''}
            onValueChange={(unit) => onChange(unit.id)}
            getItemValue={(unit) => unit.id}
            getItemLabel={(unit) => unit.name}
            placeholder="Cari unit…"
            emptyMessage="Unit tidak ditemukan."
            portalContainer={portalContainer}
            columns={[
                {
                    id: 'name',
                    header: 'Nama',
                    width: 240,
                    cell: (unit) => unit.name,
                    sortValue: (unit) => unit.name,
                },
            ]}
        />
    );
}
