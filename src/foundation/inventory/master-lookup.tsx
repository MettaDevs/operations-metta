import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { FormControl } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { useCallback, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

// Pilihan master persediaan di form: ketik untuk mencari di server, gulir untuk memuat berikutnya, Baru di kiri bawah
// bila pemanggil boleh membuat, dan Daftar lengkap di kanan bawah. Field memegang rujukan yang tersimpan (id, kode,
// nama); baris lengkap dari server diteruskan ke onChange, supaya pemanggil bisa memakai isian lainnya (misalnya
// satuan atau profil pelacakan barang) tanpa memuat ulang.

export type Reference = { id: string; code: string; name: string };

export type LookupRequest = {
    query: string;
    cursor: string | null;
    signal: AbortSignal;
};

export type MasterLookupProps<Row extends Reference> = {
    label: string;
    value: Reference | null;
    onChange: (row: Row) => void;
    required?: boolean;
    disabled?: boolean;
    error?: string;
    hint?: ReactNode;
    // Nama field di pesan kesalahan server, supaya klik pada ringkasan kesalahan memfokuskan field ini.
    field: string;
    portalContainer?: RefObject<HTMLElement | null>;
    // Membuka kartu baru milik master itu; record yang tersimpan dipilih pemanggil lewat onChange.
    onCreate?: () => void;
};

export function MasterLookup<Row extends Reference>({
    label,
    value,
    onChange,
    required = false,
    disabled = false,
    error,
    hint,
    field,
    portalContainer,
    onCreate,
    load,
    columns,
    display = (reference) => reference.name,
    noun,
}: MasterLookupProps<Row> & {
    load: (
        request: LookupRequest,
    ) => Promise<{ items: Row[]; nextCursor: string | null }>;
    columns: DataTableColumn<Row>[];
    display?: (reference: Reference) => string;
    noun: string;
}): ReactNode {
    const rows = useRef(new Map<string, Row>());
    const loadItems = useCallback<LookupLoader<Reference>>(
        async (request) => {
            const batch = await load(request);
            for (const row of batch.items) rows.current.set(row.id, row);
            return batch;
        },
        [load],
    );
    const shown = columns.map((column): DataTableColumn<Reference> => ({
        ...column,
        sortValue: undefined,
        cell: (item) => {
            const row = rows.current.get(item.id);
            return row ? column.cell(row) : null;
        },
    }));
    return (
        <FormControl error={error} hint={hint} data-error-field={field}>
            <InlineLookup<Reference>
                label={label}
                required={required}
                disabled={disabled}
                value={value}
                displayValue={value ? display(value) : ''}
                onValueChange={(item) => {
                    const row = rows.current.get(item.id);
                    if (row) onChange(row);
                }}
                loadItems={loadItems}
                getItemValue={(item) => item.id}
                getItemLabel={display}
                placeholder="Cari kode atau nama…"
                emptyMessage={
                    onCreate
                        ? `${noun} tidak ditemukan. Pilih Baru untuk menambahkan.`
                        : `${noun} tidak ditemukan.`
                }
                showDetails={false}
                portalContainer={portalContainer}
                columns={shown}
                onCreate={onCreate}
            />
        </FormControl>
    );
}

export const codeColumn = <Row extends Reference>(
    width = 120,
): DataTableColumn<Row> => ({
    id: 'code',
    header: 'Kode',
    width,
    cell: (row) => row.code,
});

export const nameColumn = <Row extends Reference>(
    width = 240,
): DataTableColumn<Row> => ({
    id: 'name',
    header: 'Nama',
    width,
    cell: (row) => row.name,
});
