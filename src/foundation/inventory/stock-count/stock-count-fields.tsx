import { FormControl } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import type { ReactNode, RefObject } from 'react';
import { api, type ApiBody } from '../../../platform/shell/index.ts';

// Bagian layar opname yang dipakai kartu dan dialog Hitung baris.

export type Position =
    ApiBody<'inventoryStockCountCalculateLines'>['data'][number];
type Item = ApiBody<'inventoryItemList'>['data'][number];
export type ItemChoice = {
    id: string;
    code: string;
    name: string;
    base_unit: string;
    base_unit_id: string;
    batch_required: boolean;
    expiry_required: boolean;
};

export const decimal = new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 4,
});
export const label = (entry: { code: string; name: string }) =>
    `${entry.code} - ${entry.name}`;

const loadItems: LookupLoader<ItemChoice> = async ({
    query,
    cursor,
    signal,
}) => {
    const { body } = await api.inventoryItemList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data.map((item: Item): ItemChoice => ({
            id: item.id,
            code: item.code,
            name: item.name,
            base_unit: item.base_unit.code,
            base_unit_id: item.base_unit.id,
            batch_required: item.batch_required,
            expiry_required: item.expiry_required,
        })),
        nextCursor: body.next_cursor,
    };
};

export function ItemLookup({
    value,
    error,
    field,
    portalContainer,
    onPick,
}: {
    value: ItemChoice | null;
    error: string | undefined;
    field: string;
    portalContainer: RefObject<HTMLElement | null>;
    onPick: (item: ItemChoice) => void;
}): ReactNode {
    return (
        <FormControl error={error} data-error-field={field}>
            <InlineLookup<ItemChoice>
                label="Barang"
                required
                loadItems={loadItems}
                value={value}
                displayValue={value ? label(value) : ''}
                onValueChange={onPick}
                getItemValue={(item) => item.id}
                getItemLabel={label}
                placeholder="Cari kode atau nama barang…"
                emptyMessage="Barang tidak ditemukan."
                popupClassName="w-[36rem]"
                showDetails={false}
                portalContainer={portalContainer}
                columns={[
                    {
                        id: 'code',
                        header: 'Kode',
                        width: 110,
                        cell: (item) => item.code,
                    },
                    {
                        id: 'name',
                        header: 'Nama',
                        width: 260,
                        cell: (item) => item.name,
                    },
                    {
                        id: 'base_unit',
                        header: 'Satuan dasar',
                        width: 110,
                        cell: (item) => item.base_unit,
                    },
                ]}
            />
        </FormControl>
    );
}
