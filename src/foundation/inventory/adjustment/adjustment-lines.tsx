import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { useCallback, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { api } from '../../../platform/shell/index.ts';
import {
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import { ItemLookup, selectItems, type Item } from '../item/item-lookup.tsx';
import {
    MasterLookup,
    type LookupRequest,
    type Reference,
} from '@operations-metta/ui/master-lookup';
import type { Adjustment, Direction } from './adjustment-labels.tsx';

// Baris penyesuaian stok (baris Item Journal BC). Isian stok masuk (nomor batch baru, kedaluwarsa, harga satuan) dan
// stok keluar (batch yang diambil) ada berdampingan di draf, dan hanya yang sesuai arah dokumen yang dikirim.

export type LineItem = Adjustment['lines'][number]['item'];
type PickedBatch = NonNullable<Adjustment['lines'][number]['batch']>;

// key adalah id baris tersimpan, atau kunci lokal untuk baris yang belum disimpan. Jumlah dan harga satuan disimpan
// sebagai teks yang tampil di isian (12.500, 1,5) dan baru diubah ke angka API saat Simpan.
export type LineDraft = {
    key: string;
    id: string | null;
    item: LineItem | null;
    quantity: string;
    batchNumber: string;
    expiryDate: string;
    unitCost: string;
    batch: PickedBatch | null;
};

export const linesOf = (lines: Adjustment['lines']): LineDraft[] =>
    lines.map((line) => ({
        key: line.id,
        id: line.id,
        item: line.item,
        quantity: displayNumber(line.quantity),
        batchNumber: line.batch_number ?? '',
        expiryDate: line.expiry_date ?? '',
        unitCost: line.unit_cost === null ? '' : displayNumber(line.unit_cost),
        batch: line.batch,
    }));

export const blankLine = (): LineDraft => ({
    key: crypto.randomUUID(),
    id: null,
    item: null,
    quantity: '',
    batchNumber: '',
    expiryDate: '',
    unitCost: '',
    batch: null,
});

export const withoutDirectionValues = (line: LineDraft): LineDraft => ({
    ...line,
    batchNumber: '',
    expiryDate: '',
    unitCost: '',
    batch: null,
});

// Batch dan kedaluwarsa milik barang, jadi ikut kosong saat barang baris diganti.
export const withItem = (line: LineDraft, item: Item): LineDraft => ({
    ...line,
    item: {
        id: item.id,
        code: item.code,
        name: item.name,
        unit: item.base_unit.code,
        batch_required: item.batch_required,
        expiry_required: item.expiry_required,
    },
    batchNumber: '',
    expiryDate: '',
    batch: null,
});

const numberFormat =
    'Tulis angka seperti 12.500 atau 1,5. Titik untuk ribuan, koma untuk desimal.';

// Isi baris untuk API. Angka yang tidak bisa dibaca dengan pasti ditahan di layar dengan kesalahan per sel, karena API
// membaca titik sebagai tanda desimal. Isian kosong tetap dikirim kosong, supaya pesan wajib isi datang dari server.
export function linesBody(direction: Direction, lines: LineDraft[]) {
    const errors: Record<string, string[]> = {};
    const amount = (index: number, name: string, text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return '';
        const parsed = parseDisplayNumber(trimmed);
        if (parsed === null) errors[`lines.${index}.${name}`] = [numberFormat];
        return parsed ?? trimmed;
    };
    const body = lines.map((line, index) => {
        const common = {
            id: line.id,
            item_id: line.item?.id ?? '',
            quantity: amount(index, 'quantity', line.quantity),
        };
        switch (direction) {
            case 'masuk':
                return {
                    ...common,
                    batch_number: line.batchNumber.trim() || null,
                    expiry_date: line.expiryDate || null,
                    unit_cost:
                        amount(index, 'unit_cost', line.unitCost) || null,
                };
            case 'keluar':
                return { ...common, batch_id: line.batch?.id ?? null };
            default: {
                const unknown: never = direction;
                throw new Error(`Unknown direction: ${String(unknown)}`);
            }
        }
    });
    return { lines: body, errors };
}

// Kolom batch dan kedaluwarsa tampil untuk barang yang profil pelacakannya mewajibkannya, dan untuk baris yang sudah
// terisi, supaya tidak ada isian tersimpan yang tersembunyi.
const needsBatchNumber = (line: LineDraft) =>
    Boolean(line.item?.batch_required) || line.batchNumber !== '';
const needsExpiry = (line: LineDraft) =>
    Boolean(line.item?.expiry_required) || line.expiryDate !== '';
const needsBatch = (line: LineDraft) =>
    Boolean(line.item?.batch_required) || line.batch !== null;

type BatchStock = Reference & {
    expiry_date: string | null;
    quantity: string;
    unit: string;
};

type StockRow = Awaited<
    ReturnType<typeof api.inventoryStock>
>['body']['data'][number];

// Stok tanpa batch atau yang minus tidak bisa dipilih sebagai batch yang diambil.
const batchesOf = (rows: StockRow[]): BatchStock[] =>
    rows.flatMap((row) =>
        row.batch && Number(row.quantity) > 0
            ? [
                  {
                      id: row.batch.id,
                      code: row.batch.batch_number,
                      name: row.batch.batch_number,
                      expiry_date: row.batch.expiry_date,
                      quantity: row.quantity,
                      unit: row.item.unit,
                  },
              ]
            : [],
    );

// Batch yang masih punya stok untuk barang ini di lokasi dokumen, kedaluwarsa terdekat lebih dulu. Batch lahir dari
// stok masuk, jadi pilihan ini tidak punya Baru.
function BatchLookup({
    itemId,
    locationId,
    value,
    onChange,
    error,
    field,
}: {
    itemId: string;
    locationId: string | null;
    value: PickedBatch | null;
    onChange: (batch: PickedBatch) => void;
    error: string | undefined;
    field: string;
}): ReactNode {
    const load = useCallback(
        async ({ query, cursor, signal }: LookupRequest) => {
            const page = async (from: string | null) =>
                (
                    await api.inventoryStock(
                        {
                            query: {
                                item_id: itemId,
                                ...(locationId
                                    ? { location_id: locationId }
                                    : {}),
                                q: query,
                                ...(from ? { cursor: from } : {}),
                            },
                        },
                        { signal },
                    )
                ).body;
            let body = await page(cursor);
            let items = batchesOf(body.data);
            while (!items.length && body.next_cursor) {
                body = await page(body.next_cursor);
                items = batchesOf(body.data);
            }
            return { items, nextCursor: body.next_cursor };
        },
        [itemId, locationId],
    );
    return (
        <MasterLookup<BatchStock>
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
            hint="Boleh dikosongkan: batch diambil otomatis saat posting, menurut cara pengambilan yang berlaku di lokasi ini. Bila caranya Pilih batch manual, batch wajib dipilih di sini."
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
                    width: 110,
                    align: 'right',
                    cell: (row) => `${displayNumber(row.quantity)} ${row.unit}`,
                },
            ]}
        />
    );
}

type Row = { line: LineDraft; index: number };

export function AdjustmentLines({
    direction,
    lines,
    onChange,
    editing,
    errors,
    locationId,
    portalContainer,
    onCreateItem,
}: {
    direction: Direction;
    lines: LineDraft[];
    onChange: (lines: LineDraft[]) => void;
    editing: boolean;
    errors: Record<string, string[]>;
    locationId: string | null;
    portalContainer: RefObject<HTMLElement | null>;
    // Membuka kartu barang baru untuk baris ini; tanpa ini pilihan barang tidak menawarkan Baru.
    onCreateItem?: (lineKey: string) => void;
}): ReactNode {
    const [selected, setSelected] = useState<string[]>([]);
    const content = editing ? 'control' : 'text';
    const field = (index: number, name: string) => `lines.${index}.${name}`;
    const error = (index: number, name: string) =>
        errors[field(index, name)]?.[0];
    const replace = (key: string, next: (line: LineDraft) => LineDraft) =>
        onChange(lines.map((line) => (line.key === key ? next(line) : line)));
    const update = (key: string, change: Partial<LineDraft>) =>
        replace(key, (line) => ({ ...line, ...change }));
    const text = (value: string) => <DataTableText>{value}</DataTableText>;

    const quantityColumn: DataTableColumn<Row> = {
        id: 'quantity',
        header: 'Jumlah',
        content,
        minWidth: 120,
        cell: ({ line, index }) =>
            editing ? (
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
            ) : (
                text(line.quantity)
            ),
    };
    const batchNumberColumn: DataTableColumn<Row> = {
        id: 'batch_number',
        header: 'No. batch',
        content,
        minWidth: 150,
        cell: ({ line, index }) =>
            !needsBatchNumber(line) ? null : editing ? (
                <FormControl error={error(index, 'batch_number')}>
                    <Input
                        label="No. batch"
                        required={line.item?.batch_required}
                        maxLength={50}
                        data-error-field={field(index, 'batch_number')}
                        value={line.batchNumber}
                        onChange={(event) =>
                            update(line.key, {
                                batchNumber: event.target.value,
                            })
                        }
                    />
                </FormControl>
            ) : (
                text(line.batchNumber)
            ),
    };
    const expiryColumn: DataTableColumn<Row> = {
        id: 'expiry_date',
        header: 'Kedaluwarsa',
        content,
        minWidth: 150,
        cell: ({ line, index }) =>
            !needsExpiry(line) ? null : editing ? (
                <FormControl error={error(index, 'expiry_date')}>
                    <DatePicker
                        label="Kedaluwarsa"
                        required={line.item?.expiry_required}
                        data-error-field={field(index, 'expiry_date')}
                        value={line.expiryDate}
                        onValueChange={(expiryDate) =>
                            update(line.key, { expiryDate })
                        }
                    />
                </FormControl>
            ) : (
                text(line.expiryDate ? displayDate(line.expiryDate) : '')
            ),
    };
    const unitCostColumn: DataTableColumn<Row> = {
        id: 'unit_cost',
        header: 'Harga satuan',
        content,
        minWidth: 140,
        cell: ({ line, index }) =>
            editing ? (
                <FormControl error={error(index, 'unit_cost')}>
                    <Input
                        label="Harga satuan"
                        required
                        inputMode="decimal"
                        data-error-field={field(index, 'unit_cost')}
                        value={line.unitCost}
                        onChange={(event) =>
                            update(line.key, { unitCost: event.target.value })
                        }
                    />
                </FormControl>
            ) : (
                text(line.unitCost)
            ),
    };
    const batchColumn: DataTableColumn<Row> = {
        id: 'batch_id',
        header: 'Batch',
        content,
        minWidth: 200,
        cell: ({ line, index }) =>
            !needsBatch(line) || !line.item ? null : editing ? (
                <BatchLookup
                    itemId={line.item.id}
                    locationId={locationId}
                    field={field(index, 'batch_id')}
                    value={line.batch}
                    onChange={(batch) => update(line.key, { batch })}
                    error={error(index, 'batch_id')}
                />
            ) : (
                text(line.batch?.batch_number ?? 'Diambil otomatis')
            ),
    };
    const directionColumns = (): DataTableColumn<Row>[] => {
        switch (direction) {
            case 'masuk':
                return [
                    ...(lines.some(needsBatchNumber)
                        ? [batchNumberColumn]
                        : []),
                    ...(lines.some(needsExpiry) ? [expiryColumn] : []),
                    unitCostColumn,
                ];
            case 'keluar':
                return lines.some(needsBatch) ? [batchColumn] : [];
            default: {
                const unknown: never = direction;
                throw new Error(`Unknown direction: ${String(unknown)}`);
            }
        }
    };

    return (
        <DocumentLines
            title="Baris penyesuaian"
            data={lines.map((line, index) => ({ line, index }))}
            getRowKey={(row) => row.line.key}
            getRowLabel={(row) =>
                row.line.item?.name ?? `Baris ${row.index + 1}`
            }
            showRowNumbers
            readOnly={!editing}
            portalContainer={portalContainer}
            selection={
                editing
                    ? {
                          selectedKeys: selected,
                          onSelectedKeysChange: (keys) =>
                              setSelected(keys.map(String)),
                      }
                    : undefined
            }
            onAddRow={
                editing ? () => onChange([...lines, blankLine()]) : undefined
            }
            selectRecords={
                editing
                    ? selectItems(
                          (items) =>
                              onChange([
                                  ...lines,
                                  ...items.map((item) =>
                                      withItem(blankLine(), item),
                                  ),
                              ]),
                          'quantity',
                      )
                    : undefined
            }
            onDeleteRows={
                editing
                    ? (removed) =>
                          onChange(
                              lines.filter(
                                  (line) =>
                                      !removed.some(
                                          (row) => row.line.key === line.key,
                                      ),
                              ),
                          )
                    : undefined
            }
            emptyMessage={
                editing
                    ? 'Belum ada barang. Pilih Tambah atau Tambah banyak untuk menambahkan baris.'
                    : 'Dokumen ini tidak berisi baris.'
            }
            columns={[
                {
                    id: 'item_id',
                    header: 'Barang',
                    content,
                    minWidth: 280,
                    cell: ({ line, index }) =>
                        editing ? (
                            <ItemLookup
                                label="Barang"
                                required
                                field={field(index, 'item_id')}
                                value={line.item}
                                onChange={(item) =>
                                    replace(line.key, (current) =>
                                        withItem(current, item),
                                    )
                                }
                                error={error(index, 'item_id')}
                                onCreate={
                                    onCreateItem
                                        ? () => onCreateItem(line.key)
                                        : undefined
                                }
                            />
                        ) : (
                            text(
                                line.item
                                    ? `${line.item.code} · ${line.item.name}`
                                    : '',
                            )
                        ),
                },
                {
                    id: 'unit',
                    header: 'Satuan',
                    width: 90,
                    cell: ({ line }) => text(line.item?.unit ?? ''),
                },
                quantityColumn,
                ...directionColumns(),
            ]}
        />
    );
}
