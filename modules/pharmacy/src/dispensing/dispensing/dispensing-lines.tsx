import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import { displayNumber } from '@operations-metta/ui/display-number';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    MasterLookup,
    type LookupRequest,
    type Reference,
} from '@operations-metta/ui/master-lookup';
import { Select } from '@operations-metta/ui/select';
import { useCallback } from 'react';
import type { ReactNode, RefObject } from 'react';
import { api } from '@core/platform/shell/index.ts';
import {
    isCompoundHeader,
    type Prescription,
    type PrescriptionLine,
} from '../prescription/prescription-facts.tsx';

export type PickedBatch = {
    id: string;
    batch_number: string;
    expiry_date: string | null;
};
export type Taken = {
    batch_number: string | null;
    expiry_date: string | null;
    quantity: string;
};

export type UnitOption = Reference & { quantity_per_unit: string };

// Isian satu obat resep. Jumlah disimpan sebagai teks yang tampil di isian (12,5) dan baru diubah ke angka API saat
// dikirim.
export type LineDraft = {
    prescriptionLineId: string;
    quantity: string;
    unit: UnitOption;
    batch: PickedBatch | null;
    reason: string;
    taken: Taken[];
};

type BatchRow = Reference & { expiry_date: string | null; quantity: string };

// Batch yang masih punya stok untuk obat ini di lokasi farmasi, kedaluwarsa terdekat lebih dulu. Batch lahir dari stok
// masuk, jadi pilihan ini tidak punya Baru.
function BatchLookup({
    itemId,
    locationId,
    value,
    onChange,
    error,
    field,
    portalContainer,
}: {
    itemId: string;
    locationId: string | null;
    value: PickedBatch | null;
    onChange: (batch: PickedBatch) => void;
    error: string | undefined;
    field: string;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    const load = useCallback(
        async ({ query, signal }: LookupRequest) => {
            const { body } = await api.pharmacyBatchLookup(
                {
                    query: {
                        q: query,
                        item_id: itemId,
                        ...(locationId ? { location_id: locationId } : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [itemId, locationId],
    );
    return (
        <MasterLookup<BatchRow>
            label="Batch"
            field={field}
            value={
                value
                    ? {
                          id: value.id,
                          code: value.batch_number,
                          name: value.batch_number,
                      }
                    : null
            }
            onChange={(row) =>
                onChange({
                    id: row.id,
                    batch_number: row.code,
                    expiry_date: row.expiry_date,
                })
            }
            disabled={locationId === null}
            error={error}
            hint="Boleh dikosongkan: batch diambil otomatis saat disiapkan, menurut cara pengambilan lokasi ini (kedaluwarsa terdekat lebih dulu). Bila caranya Pilih batch manual, batch wajib dipilih."
            portalContainer={portalContainer}
            noun="Batch"
            placeholder="Cari nomor batch…"
            load={load}
            display={(batch) => batch.code}
            columns={[
                {
                    id: 'code',
                    header: 'Batch',
                    width: 140,
                    cell: (row) => row.code,
                },
                {
                    id: 'expiry_date',
                    header: 'Kedaluwarsa',
                    width: 120,
                    cell: (row) =>
                        row.expiry_date ? displayDate(row.expiry_date) : '',
                },
                {
                    id: 'quantity',
                    header: 'Stok',
                    width: 100,
                    align: 'right',
                    cell: (row) => displayNumber(row.quantity),
                },
            ]}
        />
    );
}

type Row = {
    line: PrescriptionLine;
    // Urutan baris obat di antara baris obat saja, sama dengan indeks `lines.N` pada pesan kesalahan server.
    index: number | null;
    draft: LineDraft | null;
};

const unitLabel = (unit: UnitOption) =>
    `${unit.code} · isi ${displayNumber(unit.quantity_per_unit)}`;

// Satu baris per batch yang diambil, supaya batch kedua tidak terpotong di kolom yang sempit.
function TakenBatches({
    taken,
    baseCode,
}: {
    taken: Taken[];
    baseCode: string;
}): ReactNode {
    if (!taken.length) return <DataTableText>—</DataTableText>;
    return (
        <DataTableText multiline>
            {taken.map((part, at) => (
                <span key={at} className="block tabular-nums">
                    {`${part.batch_number ?? 'Tanpa batch'}${part.expiry_date ? ` · ED ${displayDate(part.expiry_date)}` : ''} · ${displayNumber(part.quantity)} ${baseCode}`}
                </span>
            ))}
        </DataTableText>
    );
}

// Baris penyerahan di bawah baris resepnya. Kepala racikan tampil sebagai pengelompok; komponennya adalah obat yang
// disiapkan seperti obat tunggal.
export function DispensingLines({
    prescription,
    lines,
    onChange,
    editing,
    prepared,
    errors,
    stock,
    units,
    locationId,
    portalContainer,
}: {
    prescription: Prescription;
    lines: LineDraft[];
    onChange: (lines: LineDraft[]) => void;
    editing: boolean;
    prepared: boolean;
    errors: Record<string, string[]>;
    stock: Map<string, string>;
    units: Map<string, UnitOption[]>;
    locationId: string | null;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    const content = editing ? 'control' : 'text';
    const field = (index: number, name: string) => `lines.${index}.${name}`;
    const error = (index: number | null, name: string) =>
        index === null ? undefined : errors[field(index, name)]?.[0];
    const byLine = new Map(
        lines.map((line) => [line.prescriptionLineId, line]),
    );
    let position = 0;
    const rows: Row[] = prescription.lines.map((line) => {
        if (isCompoundHeader(line)) return { line, index: null, draft: null };
        const index = position++;
        return { line, index, draft: byLine.get(line.id) ?? null };
    });
    const update = (prescriptionLineId: string, change: Partial<LineDraft>) =>
        onChange(
            lines.map((line) =>
                line.prescriptionLineId === prescriptionLineId
                    ? { ...line, ...change }
                    : line,
            ),
        );
    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    const baseCode = (line: PrescriptionLine) =>
        units.get(line.id)?.[0]?.code ?? '';
    const choices = (draft: LineDraft): UnitOption[] => {
        const options = units.get(draft.prescriptionLineId) ?? [];
        return options.some((unit) => unit.id === draft.unit.id)
            ? options
            : [draft.unit, ...options];
    };

    const columns: DataTableColumn<Row>[] = [
        {
            id: 'item',
            header: 'Obat',
            minWidth: 260,
            cell: ({ line }) =>
                isCompoundHeader(line) ? (
                    <DataTableText>
                        <span className="font-medium">
                            Racikan {line.compound}
                            {line.requested_quantity
                                ? ` · ${displayNumber(line.requested_quantity)} racikan`
                                : ''}
                        </span>
                    </DataTableText>
                ) : (
                    <DataTableText multiline>
                        <span
                            className={
                                line.compound !== null ? 'block ps-4' : 'block'
                            }
                        >
                            {`${line.item?.code ?? ''} · ${line.item?.name ?? ''}`}
                        </span>
                        {(line.signa || line.usage_instruction) && (
                            <span
                                className={
                                    line.compound !== null
                                        ? 'block ps-4 text-muted-foreground'
                                        : 'block text-muted-foreground'
                                }
                            >
                                {[line.signa, line.usage_instruction]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                        )}
                    </DataTableText>
                ),
        },
        {
            id: 'prescribed',
            header: 'Resep',
            width: 100,
            align: 'right',
            cell: ({ line }) =>
                isCompoundHeader(line)
                    ? text(line.signa ?? '')
                    : text(
                          `${displayNumber(line.quantity ?? '0')} ${line.unit?.code ?? ''}`,
                      ),
        },
    ];
    if (!prepared)
        columns.push({
            id: 'stock',
            header: 'Stok di lokasi',
            width: 110,
            align: 'right',
            cell: ({ line }) =>
                line.item
                    ? text(
                          `${displayNumber(stock.get(line.item.id) ?? '0')} ${baseCode(line)}`,
                      )
                    : null,
        });
    columns.push(
        {
            id: 'quantity',
            header: 'Diserahkan',
            content,
            minWidth: 120,
            cell: ({ draft, index }) =>
                draft === null ? null : editing ? (
                    <FormControl error={error(index, 'quantity')}>
                        <Input
                            label="Diserahkan"
                            required
                            inputMode="decimal"
                            data-error-field={field(index ?? 0, 'quantity')}
                            value={draft.quantity}
                            onChange={(event) =>
                                update(draft.prescriptionLineId, {
                                    quantity: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                ) : (
                    text(draft.quantity)
                ),
        },
        {
            id: 'unit',
            header: 'Satuan',
            content,
            minWidth: 150,
            cell: ({ draft, index }) =>
                draft === null ? null : editing ? (
                    <FormControl
                        error={error(index, 'unit_id')}
                        data-error-field={field(index ?? 0, 'unit_id')}
                    >
                        <Select
                            label="Satuan"
                            required
                            items={choices(draft).map((unit) => ({
                                value: unit.id,
                                label: unitLabel(unit),
                            }))}
                            value={draft.unit.id}
                            onValueChange={(value) => {
                                const unit = choices(draft).find(
                                    (option) => option.id === value,
                                );
                                if (unit)
                                    update(draft.prescriptionLineId, {
                                        unit,
                                    });
                            }}
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                ) : (
                    text(draft.unit.code)
                ),
        },
        {
            id: 'batch',
            header: prepared ? 'Batch diambil' : 'Batch',
            content: prepared ? 'text' : content,
            minWidth: prepared ? 240 : 200,
            cell: ({ line, draft, index }) =>
                draft === null || !line.item ? null : prepared ? (
                    <TakenBatches
                        taken={draft.taken}
                        baseCode={baseCode(line)}
                    />
                ) : editing ? (
                    <BatchLookup
                        itemId={line.item.id}
                        locationId={locationId}
                        field={field(index ?? 0, 'batch_id')}
                        value={draft.batch}
                        onChange={(batch) =>
                            update(draft.prescriptionLineId, { batch })
                        }
                        error={error(index, 'batch_id')}
                        portalContainer={portalContainer}
                    />
                ) : (
                    text(draft.batch?.batch_number ?? 'Diambil otomatis')
                ),
        },
        {
            id: 'reason',
            header: 'Alasan bila kurang',
            content,
            minWidth: 200,
            cell: ({ draft, index }) =>
                draft === null ? null : editing ? (
                    <FormControl error={error(index, 'reason')}>
                        <Input
                            label="Alasan"
                            maxLength={200}
                            data-error-field={field(index ?? 0, 'reason')}
                            value={draft.reason}
                            onChange={(event) =>
                                update(draft.prescriptionLineId, {
                                    reason: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                ) : (
                    text(draft.reason)
                ),
        },
    );

    return (
        <DocumentLines
            title="Obat"
            data={rows}
            getRowKey={(row) => row.line.id}
            getRowLabel={(row) =>
                row.line.item?.name ?? `Racikan ${row.line.compound ?? ''}`
            }
            showRowNumbers
            readOnly={!editing}
            portalContainer={portalContainer}
            emptyMessage="Resep ini tidak berisi obat."
            columns={columns}
        />
    );
}
