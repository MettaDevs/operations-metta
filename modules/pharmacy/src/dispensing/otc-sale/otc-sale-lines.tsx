import { Button } from '@operations-metta/ui/button';
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
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ReactNode, RefObject } from 'react';
import { api, type ApiBody } from '@core/platform/shell/index.ts';
import { FeeLines } from '../dispensing-fee/fee-lines.tsx';
import { typed } from './otc-sale-tender.tsx';
import {
    BatchLookup,
    type PickedBatch,
} from '../service-location/pharmacy-lookups.tsx';

export type Drug = ApiBody<'pharmacyOtcSaleItems'>['data'][number];
export type QuotedLine =
    ApiBody<'pharmacyOtcSaleQuote'>['data']['lines'][number];

export type QuotedFee = ApiBody<'pharmacyOtcSaleQuote'>['data']['fees'][number];

// Satu baris obat di loket. Jumlah disimpan sebagai teks yang tampil di isian (12,5) dan baru diubah ke angka API saat
// dikirim. Batch kosong berarti diambil otomatis saat disimpan. Harga satuan, diskon, dan biaya resep hanya diisi pemegang
// izin ubah harga; kosong berarti hitungan sistem.
export type SaleLine = {
    key: string;
    drug: Drug | null;
    unitId: string;
    quantity: string;
    batch: PickedBatch | null;
    unitPrice: string;
    discount: string;
    feeAmount: string;
};

export const newLine = (): SaleLine => ({
    key: crypto.randomUUID(),
    drug: null,
    unitId: '',
    quantity: '',
    batch: null,
    unitPrice: '',
    discount: '',
    feeAmount: '',
});

// Harga yang diketik pemegang izin ubah harga, untuk quote dan Simpan dan bayar. Isian kosong tidak dikirim.
export const typedPrices = (
    line: SaleLine,
    typed: (text: string) => string,
) => ({
    ...(line.unitPrice.trim() ? { unit_price: typed(line.unitPrice) } : {}),
    ...(line.discount.trim() ? { discount_percent: typed(line.discount) } : {}),
    ...(line.feeAmount.trim() ? { fee_amount: typed(line.feeAmount) } : {}),
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

function shortOfStock(line: SaleLine): boolean {
    const stock = Number(line.drug?.stock ?? NaN);
    const perUnit = Number(
        line.drug?.units.find((unit) => unit.id === line.unitId)
            ?.quantity_per_unit ?? NaN,
    );
    const quantity = Number(typed(line.quantity));
    return quantity * perUnit > stock;
}

function SubstituteSuggestion({
    line,
    locationId,
    onPick,
}: {
    line: SaleLine;
    locationId: string;
    onPick: (drug: Drug) => void;
}): ReactNode {
    const itemId = line.drug?.id ?? '';
    const substitutes = useQuery({
        queryKey: ['pharmacy-otc-sale-substitutes', itemId, locationId],
        queryFn: async ({ signal }) =>
            (
                await api.pharmacyOtcSaleItems(
                    {
                        query: {
                            substitutes_of: itemId,
                            location_id: locationId,
                        },
                    },
                    { signal },
                )
            ).body.data.filter((drug) => Number(drug.stock ?? 0) > 0),
    });
    if (!substitutes.data?.length) return null;
    return (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>Stok kurang. Obat pengganti:</span>
            {substitutes.data.map((drug) => (
                <Button
                    key={drug.id}
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0 py-0 text-left text-xs whitespace-normal"
                    title={drugLabel(drug)}
                    onClick={() => onPick(drug)}
                >
                    {`${drug.name} · stok ${displayNumber(drug.stock ?? '0')} ${drug.units[0]?.code ?? ''}`}
                </Button>
            ))}
        </div>
    );
}

// Isian harga untuk pemegang izin ubah harga. Kosong berarti hitungan sistem, yang tampil sebagai placeholder.
function PriceInput({
    label,
    field,
    value,
    computed,
    error,
    onChange,
}: {
    label: string;
    field: string;
    value: string;
    computed: string | undefined;
    error: string | undefined;
    onChange: (value: string) => void;
}): ReactNode {
    return (
        <FormControl error={error}>
            <Input
                label={label}
                inputMode="decimal"
                data-error-field={field}
                placeholder={
                    computed === undefined ? '' : displayNumber(computed)
                }
                value={value}
                onChange={(event) => onChange(event.target.value)}
            />
        </FormControl>
    );
}

// Biaya resep yang bisa diubah per obat. Kosong berarti nilai dari setelan Biaya racik dan resep.
function EditableFees({
    fees,
    lines,
    onChange,
    errors,
}: {
    fees: (QuotedFee & { lineKey: string | null })[];
    lines: SaleLine[];
    onChange: (lineKey: string, feeAmount: string) => void;
    errors: Record<string, string[]>;
}): ReactNode {
    if (!fees.length) return null;
    return (
        <ul aria-label="Biaya racik dan resep" className="space-y-1 text-sm">
            {fees.map((fee, index) => {
                const row = lines.findIndex((line) => line.key === fee.lineKey);
                const line = lines[row];
                const field = `lines.${String(row)}.fee_amount`;
                return (
                    <li
                        key={`${fee.name}:${String(index)}`}
                        className="flex items-center justify-end gap-6"
                    >
                        <span>{fee.name}</span>
                        {line ? (
                            <div className="w-36">
                                <PriceInput
                                    label={fee.name}
                                    field={field}
                                    value={line.feeAmount}
                                    computed={fee.computed_amount}
                                    error={errors[field]?.[0]}
                                    onChange={(value) =>
                                        onChange(line.key, value)
                                    }
                                />
                            </div>
                        ) : (
                            <span className="min-w-24 text-right tabular-nums">
                                {displayNumber(fee.amount)}
                            </span>
                        )}
                    </li>
                );
            })}
        </ul>
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
    fees,
    total,
    errors,
    portalContainer,
    canOverridePrice,
}: {
    lines: SaleLine[];
    onChange: (lines: SaleLine[]) => void;
    locationId: string;
    // Harga per kunci baris, dari quote terakhir.
    priced: Map<string, QuotedLine>;
    pricesCurrent: boolean;
    // Biaya resep dari quote terakhir, dengan kunci baris obatnya.
    fees: (QuotedFee & { lineKey: string | null })[];
    canOverridePrice: boolean;
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
    const pick = (line: SaleLine, drug: Drug) =>
        update(line.key, {
            drug,
            unitId: drug.units.some((unit) => unit.id === drug.sales_unit_id)
                ? drug.sales_unit_id
                : (drug.units[0]?.id ?? ''),
            quantity: line.quantity || '1',
            batch: null,
        });
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
                <>
                    <DrugLookup
                        locationId={locationId}
                        field={field(index, 'item_id')}
                        value={line.drug}
                        onChange={(drug) => pick(line, drug)}
                        error={error(index, 'item_id')}
                        portalContainer={portalContainer}
                    />
                    {shortOfStock(line) && (
                        <SubstituteSuggestion
                            line={line}
                            locationId={locationId}
                            onPick={(drug) => pick(line, drug)}
                        />
                    )}
                </>
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
        canOverridePrice
            ? {
                  id: 'unit_price',
                  header: 'Harga satuan',
                  content: 'control',
                  minWidth: 130,
                  cell: ({ line, index }) => (
                      <PriceInput
                          label="Harga satuan"
                          field={field(index, 'unit_price')}
                          value={line.unitPrice}
                          computed={priced.get(line.key)?.computed_unit_price}
                          error={error(index, 'unit_price')}
                          onChange={(unitPrice) =>
                              update(line.key, { unitPrice })
                          }
                      />
                  ),
              }
            : {
                  id: 'unit_price',
                  header: 'Harga satuan',
                  width: 120,
                  align: 'right',
                  cell: ({ line }) => money(priced.get(line.key)?.unit_price),
              },
        canOverridePrice
            ? {
                  id: 'discount_percent',
                  header: 'Diskon %',
                  content: 'control',
                  minWidth: 100,
                  cell: ({ line, index }) => (
                      <PriceInput
                          label="Diskon %"
                          field={field(index, 'discount_percent')}
                          value={line.discount}
                          computed={
                              priced.get(line.key)?.computed_discount_percent
                          }
                          error={error(index, 'discount_percent')}
                          onChange={(discount) =>
                              update(line.key, { discount })
                          }
                      />
                  ),
              }
            : {
                  id: 'discount_percent',
                  header: 'Diskon %',
                  width: 90,
                  align: 'right',
                  cell: ({ line }) =>
                      money(priced.get(line.key)?.discount_percent),
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
                <div className="space-y-2">
                    {canOverridePrice ? (
                        <EditableFees
                            fees={fees}
                            lines={lines}
                            onChange={(key, feeAmount) =>
                                update(key, { feeAmount })
                            }
                            errors={errors}
                        />
                    ) : (
                        <FeeLines fees={fees} muted={!pricesCurrent} />
                    )}
                    <div className="flex justify-end gap-6 text-base font-semibold">
                        <span>Total</span>
                        <span
                            className={
                                pricesCurrent
                                    ? undefined
                                    : 'text-muted-foreground'
                            }
                        >
                            {total === null ? '-' : displayNumber(total)}
                        </span>
                    </div>
                </div>
            }
            columns={columns}
        />
    );
}
