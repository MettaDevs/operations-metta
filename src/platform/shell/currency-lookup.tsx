import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { FormControl } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { ReactNode, RefObject } from 'react';

type CurrencyChoice = { value: string; code: string; kind: string };

const columns: DataTableColumn<CurrencyChoice>[] = [
    { id: 'code', header: 'Kode', width: 100, cell: (choice) => choice.code },
    { id: 'kind', header: 'Jenis', width: 160, cell: (choice) => choice.kind },
];

export function CurrencyLookup({
    local,
    foreign,
    value,
    onChange,
    required = false,
    error,
    hint,
    portalContainer,
    onCreate,
}: {
    local?: string;
    foreign: string[];
    value: string;
    onChange: (value: string) => void;
    required?: boolean;
    error: string | undefined;
    hint?: ReactNode;
    portalContainer: RefObject<HTMLElement | null>;
    onCreate?: () => void;
}): ReactNode {
    const choices: CurrencyChoice[] = [
        ...(local ? [{ value: '', code: local, kind: 'Mata uang lokal' }] : []),
        ...foreign.map((code) => ({
            value: code,
            code,
            kind: 'Mata uang asing',
        })),
    ];
    const selected = choices.find((choice) => choice.value === value) ?? null;
    return (
        <FormControl error={error} hint={hint} data-error-field="currency_code">
            <InlineLookup<CurrencyChoice>
                label="Mata uang"
                required={required}
                items={choices}
                value={selected}
                displayValue={
                    selected
                        ? selected.value
                            ? selected.code
                            : `${selected.code} (mata uang lokal)`
                        : ''
                }
                onValueChange={(choice) => onChange(choice.value)}
                getItemValue={(choice) => choice.code}
                getItemLabel={(choice) => choice.code}
                placeholder="Cari kode mata uang…"
                emptyMessage={
                    onCreate
                        ? 'Mata uang tidak ditemukan. Pilih Baru untuk menambahkan.'
                        : 'Mata uang tidak ditemukan. Tambahkan dulu di Mata uang.'
                }
                portalContainer={portalContainer}
                columns={columns}
                onCreate={onCreate}
            />
        </FormControl>
    );
}
