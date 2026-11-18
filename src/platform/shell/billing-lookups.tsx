import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { FormControl } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { ReactNode, RefObject } from 'react';

type BillingChoice = { id: string; code: string; name: string };

type BillingLookupProps = {
    items: BillingChoice[];
    value: string;
    onChange: (id: string) => void;
    required?: boolean;
    error: string | undefined;
    hint?: ReactNode;
    field: string;
    portalContainer: RefObject<HTMLElement | null>;
};

const codeColumn: DataTableColumn<BillingChoice> = {
    id: 'code',
    header: 'Kode',
    width: 120,
    cell: (choice) => choice.code,
};
const nameColumn: DataTableColumn<BillingChoice> = {
    id: 'name',
    header: 'Nama',
    width: 240,
    cell: (choice) => choice.name,
};

function BillingLookup({
    label,
    noun,
    items,
    value,
    onChange,
    required = false,
    error,
    hint,
    field,
    portalContainer,
}: BillingLookupProps & { label: string; noun: string }): ReactNode {
    const coded = items.some((choice) => choice.code);
    return (
        <FormControl error={error} hint={hint} data-error-field={field}>
            <InlineLookup<BillingChoice>
                label={label}
                required={required}
                items={items}
                value={items.find((choice) => choice.id === value) ?? null}
                onValueChange={(choice) => onChange(choice.id)}
                getItemValue={(choice) => choice.id}
                getItemLabel={(choice) =>
                    choice.code
                        ? `${choice.code} · ${choice.name}`
                        : choice.name
                }
                placeholder={coded ? 'Cari kode atau nama…' : 'Cari nama…'}
                emptyMessage={`${noun} tidak ditemukan.`}
                portalContainer={portalContainer}
                columns={coded ? [codeColumn, nameColumn] : [nameColumn]}
            />
        </FormControl>
    );
}

export function MerchantLookup(props: BillingLookupProps): ReactNode {
    return <BillingLookup {...props} label="Merchan" noun="Merchan" />;
}

export function PaymentMethodLookup(
    props: BillingLookupProps & { label: string },
): ReactNode {
    return <BillingLookup {...props} noun="Jenis bayar" />;
}
