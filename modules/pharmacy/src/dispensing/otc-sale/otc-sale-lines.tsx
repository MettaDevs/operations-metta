import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { DataTableText } from '@operations-metta/ui/data-table';
import { displayNumber } from '@operations-metta/ui/display-number';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
} from '@operations-metta/ui/master-lookup';
import { Select } from '@operations-metta/ui/select';
import { useCallback } from 'react';
import type { ReactNode, RefObject } from 'react';
import { api, type ApiBody } from '@core/platform/shell/index.ts';
import {
    BatchLookup,
    type PickedBatch,
} from '../service-location/pharmacy-lookups.tsx';

export type Drug = ApiBody<'pharmacyOtcSaleItems'>['data'][number];
export type QuotedLine =
    ApiBody<'pharmacyOtcSaleQuote'>['data']['lines'][number];

// Satu baris obat di loket. Jumlah disimpan sebagai teks yang tampil di isian (12,5) dan baru diubah ke angka API saat
// dikirim. Batch kosong berarti diambil otomatis saat disimpan.
export type SaleLine = {
    key: string;
    drug: Drug | null;
    unitId: string;
    quantity: string;
    batch: PickedBatch | null;
};

export const newLine = (): SaleLine => ({
    key: crypto.randomUUID(),
    drug: null,
    unitId: '',
    quantity: '',
    batch: null,
});

const drugLabel = (drug: { code: string; name: string }) =>
    `${drug.code} · ${drug.name}`;

function DrugLookup({
    locationId,
    value,
    onChange,
    error,
    field,
    portalContainer,
}: {
    locationId: string;
    value: Drug | null;
    onChange: (drug: Drug) => void;
    error: string | undefined;
    field: string;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    const load = useCallback(
        async ({ query, cursor, signal }: LookupRequest) => {
            const { body } = await api.pharmacyOtcSaleItems(
                {
                    query: {
                        q: query,
                        location_id: locationId,
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [locationId],
    );
    return (
        <MasterLookup<Drug>
            label="Obat"
            required
            field={field}
            value={value}
            onChange={onChange}
            error={error}
            portalContainer={portalContainer}
            noun="Obat"
            placeholder="Cari kode atau nama obat…"
            load={load}
            display={drugLabel}
            columns={[
                codeColumn(),
                nameColumn(260),
                {
                    id: 'stock',
                    header: 'Stok',
                    width: 110,
                    align: 'right',
                    cell: (row) =>
                        row.stock === null
                            ? ''
                            : `${displayNumber(row.stock)} ${row.units[0]?.code ?? ''}`,
                },
            ]}
        />
    );
}

// Baris obat loket. Harga satuan, diskon, dan nilai hanya datang dari quote server; selama quote untuk isian terbaru
// belum kembali, angkanya ditampilkan redup.
export function OtcSaleLines({
    lines,
    onChange,
    locationId,
    priced,
    pricesCurrent,
    total,
    errors,
    portalContainer,
}: {
    lines: SaleLine[];
    onChange: (lines: SaleLine[]) => void;
    locationId: string;
    // Harga per kunci baris, dari quote terakhir.
    priced: Map<string, QuotedLine>;
    pricesCurrent: boolean;
    total: string | null;
    errors: Record<string, string[]>;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    const field = (index: number, name: string) => `lines.${index}.${name}`;
    const error = (index: number, name: string) =>
        errors[field(index, name)]?.[0];
    const update = (key: string, change: Partial<SaleLine>) =>
        onChange(
            lines.map((line) =>
                line.key === key ? { ...line, ...change } : line,
            ),
        );
    const rows = lines.map((line, index) => ({ line, index }));
    const money = (value: string | undefined) => (
        <DataTableText>
            <span
                className={pricesCurrent ? undefined : 'text-muted-foreground'}
            >
                {value === undefined ? '' : displayNumber(value)}
            </span>
        </DataTableText>
    );

    const columns: DataTableColumn<(typeof rows)[number]>[] = [
        {
            id: 'item',
            header: 'Obat',
            content: 'control',
            minWidth: 280,
            cell: ({ line, index }) => (
                <DrugLookup
                    locationId={locationId}
                    field={field(index, 'item_id')}
                    value={line.drug}
                    onChange={(drug) =>
                        update(line.key, {
                            drug,
                            unitId: drug.units.some(
                                (unit) => unit.id === drug.sales_unit_id,
                            )
                                ? drug.sales_unit_id
                                : (drug.units[0]?.id ?? ''),
                            quantity: line.quantity || '1',
                            batch: null,
                        })
                    }
                    error={error(index, 'item_id')}
                    portalContainer={portalContainer}
                />
            ),
        },
        {
            id: 'stock',
            header: 'Stok di lokasi',
            width: 120,
            align: 'right',
            cell: ({ line }) =>
                line.drug?.stock == null ? null : (
                    <DataTableText>
                        {`${displayNumber(line.drug.stock)} ${line.drug.units[0]?.code ?? ''}`}
                    </DataTableText>
                ),
        },
        {
            id: 'quantity',
            header: 'Jumlah',
            content: 'control',
            minWidth: 110,
            cell: ({ line, index }) => (
                <FormControl error={error(index, 'quantity')}>
                    <Input
                        label="Jumlah"
                        required
                        inputMode="decimal"
                        data-error-field={field(index, 'quantity')}
                        value={line.quantity}
                        onChange={(event) =>
                            update(line.key, { quantity: event.target.value })
                        }
                    />
                </FormControl>
            ),
        },
        {
            id: 'unit',
            header: 'Satuan',
            content: 'control',
            minWidth: 150,
            cell: ({ line, index }) => (
                <FormControl
                    error={error(index, 'unit_id')}
                    data-error-field={field(index, 'unit_id')}
                >
                    <Select
                        label="Satuan"
                        required
                        placeholder="Pilih satuan"
                        items={(line.drug?.units ?? []).map((unit) => ({
                            value: unit.id,
                            label: `${unit.code} · isi ${displayNumber(unit.quantity_per_unit)}`,
                        }))}
                        value={line.unitId}
                        onValueChange={(value) =>
                            update(line.key, { unitId: value ?? '' })
                        }
                        portalContainer={portalContainer}
                    />
                </FormControl>
            ),
        },
        {
            id: 'batch',
            header: 'Batch',
            content: 'control',
            minWidth: 180,
            cell: ({ line, index }) =>
                line.drug ? (
                    <BatchLookup
                        itemId={line.drug.id}
                        locationId={locationId}
                        field={field(index, 'batch_id')}
                        value={line.batch}
                        onChange={(batch) => update(line.key, { batch })}
                        error={error(index, 'batch_id')}
                        hint="Boleh dikosongkan: batch diambil otomatis saat disimpan, kedaluwarsa terdekat lebih dulu."
                        portalContainer={portalContainer}
                    />
                ) : null,
        },
        {
            id: 'unit_price',
            header: 'Harga satuan',
            width: 120,
            align: 'right',
            cell: ({ line }) => money(priced.get(line.key)?.unit_price),
        },
        {
            id: 'discount_percent',
            header: 'Diskon %',
            width: 90,
            align: 'right',
            cell: ({ line }) => money(priced.get(line.key)?.discount_percent),
        },
        {
            id: 'amount',
            header: 'Nilai',
            width: 130,
            align: 'right',
            cell: ({ line }) => money(priced.get(line.key)?.amount),
        },
    ];

    return (
        <DocumentLines
            title="Obat"
            data={rows}
            getRowKey={(row) => row.line.key}
            getRowLabel={(row) =>
                row.line.drug ? drugLabel(row.line.drug) : 'Obat baru'
            }
            showRowNumbers
            portalContainer={portalContainer}
            onAddRow={() => onChange([...lines, newLine()])}
            onDeleteRows={(removed) =>
                onChange(
                    lines.filter(
                        (line) =>
                            !removed.some((row) => row.line.key === line.key),
                    ),
                )
            }
            emptyMessage="Belum ada obat. Pilih Tambah untuk menambahkan baris."
            footer={
                <div className="flex justify-end gap-6 text-base font-semibold">
                    <span>Total</span>
                    <span
                        className={
                            pricesCurrent ? undefined : 'text-muted-foreground'
                        }
                    >
                        {total === null ? '-' : displayNumber(total)}
                    </span>
                </div>
            }
            columns={columns}
        />
    );
}
