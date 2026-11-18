import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { RefObject } from 'react';

export type ReferenceOption = { code: string; name: string };

type ReferenceLookupProps = {
    label: string;
    items: ReferenceOption[];
    value: string;
    onChange: (code: string) => void;
    required?: boolean;
    portalContainer?: RefObject<HTMLElement | null>;
};

export function CountryLookup({
    label,
    items,
    value,
    onChange,
    required = false,
    portalContainer,
}: ReferenceLookupProps) {
    return (
        <InlineLookup
            label={label}
            required={required}
            items={items}
            value={items.find((item) => item.code === value) ?? null}
            onValueChange={(item) => onChange(item.code)}
            getItemValue={(item) => item.code}
            getItemLabel={(item) => item.name}
            getSearchText={(item) => `${item.code} ${item.name}`}
            placeholder="Cari kode atau nama negara…"
            emptyMessage="Negara tidak ditemukan."
            columns={[
                {
                    id: 'code',
                    header: 'Kode',
                    width: 80,
                    cell: (item) => item.code,
                },
                {
                    id: 'name',
                    header: 'Negara',
                    width: 240,
                    cell: (item) => item.name,
                },
            ]}
            portalContainer={portalContainer}
        />
    );
}

export function ReferenceValueLookup({
    label,
    items,
    value,
    onChange,
    required = false,
    portalContainer,
}: ReferenceLookupProps) {
    const choices = required
        ? items
        : [{ code: '', name: 'Belum diisi' }, ...items];
    return (
        <InlineLookup
            label={label}
            required={required}
            items={choices}
            value={choices.find((item) => item.code === value) ?? null}
            onValueChange={(item) => onChange(item.code)}
            getItemValue={(item) => item.code}
            getItemLabel={(item) => item.name}
            placeholder={`Cari ${label.toLocaleLowerCase()}…`}
            columns={[
                {
                    id: 'name',
                    header: label,
                    width: 240,
                    cell: (item) => item.name,
                },
            ]}
            portalContainer={portalContainer}
        />
    );
}
