import type { ReactNode } from 'react';
import { api, type ApiBody } from '../../../platform/shell/index.ts';
import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { displayNumber } from '@operations-metta/ui/display-number';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
} from '@operations-metta/ui/master-lookup';
import type { SelectRecords } from '@operations-metta/ui/select-records-dialog';

export type Item = ApiBody<'inventoryItemList'>['data'][number];

// Barang yang diblokir tidak ditawarkan di dokumen, karena posting menolaknya. Saringan kartu stok tetap menawarkannya,
// karena riwayat barang yang sudah diblokir tetap perlu dibaca.
const itemLoader =
    (includeBlocked: boolean) =>
    async ({ query, cursor, signal }: LookupRequest) => {
        const { body } = await api.inventoryItemList(
            {
                query: {
                    q: query,
                    ...(includeBlocked ? {} : { blocked: 'false' as const }),
                    ...(cursor ? { cursor } : {}),
                },
            },
            { signal },
        );
        return {
            items: body.data,
            nextCursor: body.next_cursor,
            canCreate: body.can_manage,
        };
    };
const activeItems = itemLoader(false);
const allItems = itemLoader(true);
const display = (item: { code: string; name: string }) =>
    `${item.code} · ${item.name}`;
const itemColumns: DataTableColumn<Item>[] = [
    codeColumn(),
    nameColumn(260),
    {
        id: 'unit',
        header: 'Satuan',
        width: 90,
        cell: (row) => row.base_unit.code,
    },
    {
        id: 'inventory',
        header: 'Stok',
        width: 90,
        align: 'right',
        cell: (row) => displayNumber(row.inventory),
    },
];

// Tambah banyak pada baris dokumen persediaan: barang yang sama dengan pilihan barang per baris, satu baris per barang.
export const selectItems = (
    onAdd: (items: Item[]) => void,
    focusColumnId?: string,
): SelectRecords<Item> => ({
    noun: 'barang',
    loadItems: activeItems,
    columns: itemColumns,
    getItemValue: (item) => item.id,
    getItemLabel: display,
    onAdd,
    focusColumnId,
});

export function ItemLookup({
    includeBlocked = false,
    ...props
}: MasterLookupProps<Item> & { includeBlocked?: boolean }): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Barang"
            load={includeBlocked ? allItems : activeItems}
            display={display}
            columns={itemColumns}
        />
    );
}
