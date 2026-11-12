import type { ReactNode } from 'react';
import { api, type ApiBody } from '../../../platform/shell/index.ts';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
} from '../master-lookup.tsx';

export type Item = ApiBody<'inventoryItemList'>['data'][number];

// Barang yang diblokir tidak ditawarkan, karena posting menolaknya.
const loadItems = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.inventoryItemList(
        {
            query: {
                q: query,
                blocked: 'false',
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

export function ItemLookup(props: MasterLookupProps<Item>): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Barang"
            load={loadItems}
            display={(item) => `${item.code} · ${item.name}`}
            columns={[
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
                    cell: (row) => row.inventory,
                },
            ]}
        />
    );
}
