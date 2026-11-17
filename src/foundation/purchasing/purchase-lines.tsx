import { FormControl } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { api, type ApiBody } from '../../platform/shell/index.ts';
import { Decimal } from '../../platform/money/index.ts';

type Item = ApiBody<'inventoryItemList'>['data'][number];
type ItemUnit = ApiBody<'inventoryItemUnitList'>['data'][number];

export type Reference = { id: string; code: string; name: string };
export type UnitChoice = Reference & { quantity_per_unit: string };
export type ItemChoice = Reference & {
    base_unit: Reference;
    purchase_unit: UnitChoice;
    batch_required: boolean;
    expiry_required: boolean;
};
export type PricedLine = {
    quantity: string;
    unit_cost: string;
    discount_percent: string;
    vat_percent: string;
};

export const label = (entry: { code: string; name: string }) =>
    `${entry.code} - ${entry.name}`;
export const today = () => new Date().toLocaleDateString('sv-SE');
let keys = 0;
export const nextKey = () => `baris-${++keys}`;

const hundred = Decimal.of('100');
const hundredth = Decimal.of('0.01');
export const decimalOf = (text: string) => {
    try {
        return Decimal.of(text.trim() || '0');
    } catch {
        return null;
    }
};

export function amountOf(line: PricedLine): Decimal {
    const quantity = decimalOf(line.quantity);
    const cost = decimalOf(line.unit_cost);
    const discount = decimalOf(line.discount_percent);
    return quantity && cost && discount
        ? quantity
              .multipliedBy(cost)
              .multipliedBy(hundred.minus(discount))
              .multipliedBy(hundredth)
        : Decimal.of('0');
}

export function totalsOf(lines: PricedLine[], decimals: number) {
    let subtotal = Decimal.of('0');
    let vat = Decimal.of('0');
    for (const line of lines) {
        const amount = amountOf(line).rounded(decimals);
        subtotal = subtotal.plus(amount);
        const percent = decimalOf(line.vat_percent);
        if (percent)
            vat = vat.plus(
                amount.multipliedBy(percent).multipliedBy(hundredth),
            );
    }
    return { subtotal, vat: vat.rounded(decimals) };
}

export function useLoader<T>(
    fetch: (
        query: { q: string; cursor?: string },
        signal: AbortSignal,
    ) => Promise<{ items: T[]; nextCursor: string | null }>,
): LookupLoader<T> {
    return useCallback<LookupLoader<T>>(
        ({ query, cursor, signal }) =>
            fetch({ q: query, ...(cursor ? { cursor } : {}) }, signal),
        [fetch],
    );
}

export const loadVendors = async (
    query: { q: string; cursor?: string },
    signal: AbortSignal,
) => {
    const { body } = await api.purchasingVendorList(
        { query: { ...query, status: 'active' } },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};
export const loadLocations = async (
    query: { q: string; cursor?: string },
    signal: AbortSignal,
) => {
    const { body } = await api.inventoryLocationList(
        { query: { ...query, accessible: 'true' } },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};
export const loadItems = async (
    query: { q: string; cursor?: string },
    signal: AbortSignal,
) => {
    const { body } = await api.inventoryItemList({ query }, { signal });
    return {
        items: body.data.map((item: Item): ItemChoice => ({
            id: item.id,
            code: item.code,
            name: item.name,
            base_unit: item.base_unit,
            purchase_unit: item.purchase_unit,
            batch_required: item.batch_required,
            expiry_required: item.expiry_required,
        })),
        nextCursor: body.next_cursor,
    };
};
export const itemColumns: DataTableColumn<ItemChoice>[] = [
    { id: 'code', header: 'Kode', width: 110, cell: (item) => item.code },
    { id: 'name', header: 'Nama', width: 260, cell: (item) => item.name },
    {
        id: 'base_unit',
        header: 'Satuan dasar',
        width: 110,
        cell: (item) => item.base_unit.code,
    },
];

export function UnitLookup({
    itemId,
    value,
    error,
    field,
    onPick,
}: {
    itemId: string;
    value: UnitChoice | null;
    error: string | undefined;
    field: string;
    onPick: (unit: UnitChoice) => void;
}): ReactNode {
    const load = useCallback<LookupLoader<UnitChoice>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.inventoryItemUnitList(
                {
                    query: {
                        item_id: itemId,
                        q: query,
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return {
                items: body.data.map((unit: ItemUnit): UnitChoice => ({
                    id: unit.id,
                    code: unit.code,
                    name: unit.name,
                    quantity_per_unit: unit.quantity_per_unit,
                })),
                nextCursor: body.next_cursor,
            };
        },
        [itemId],
    );
    return (
        <FormControl error={error} data-error-field={field}>
            <InlineLookup<UnitChoice>
                label="Satuan"
                required
                loadItems={load}
                value={value}
                displayValue={value?.code ?? ''}
                onValueChange={onPick}
                getItemValue={(unit) => unit.id}
                getItemLabel={(unit) => unit.code}
                emptyMessage="Satuan tidak ditemukan. Tambahkan satuan kemasan di Satuan barang."
                showDetails={false}
                columns={[
                    {
                        id: 'code',
                        header: 'Satuan',
                        width: 90,
                        cell: (unit) => unit.code,
                    },
                    {
                        id: 'name',
                        header: 'Nama',
                        width: 160,
                        cell: (unit) => unit.name,
                    },
                    {
                        id: 'quantity_per_unit',
                        header: 'Isi',
                        width: 80,
                        align: 'right',
                        cell: (unit) => unit.quantity_per_unit,
                    },
                ]}
            />
        </FormControl>
    );
}

export const unitText = (unit: UnitChoice | null, baseUnit: string) =>
    unit
        ? unit.quantity_per_unit === '1'
            ? unit.code
            : `${unit.code} (${unit.quantity_per_unit} ${baseUnit})`
        : '';
