import type { ReactNode } from 'react';
import { api, type ApiBody } from '../../../platform/shell/index.ts';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
} from '../master-lookup.tsx';

export type ItemCategory = ApiBody<'inventoryItemCategoryList'>['data'][number];

const loadCategories = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.inventoryItemCategoryList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};

// Urutan pohon dari server; induk ikut tampil supaya kategori bernama sama di cabang berbeda bisa dibedakan.
export function ItemCategoryLookup(
    props: MasterLookupProps<ItemCategory>,
): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Kategori"
            load={loadCategories}
            columns={[
                codeColumn(),
                nameColumn(200),
                {
                    id: 'parent',
                    header: 'Induk',
                    width: 160,
                    cell: (row) => row.parent?.name ?? '',
                },
            ]}
        />
    );
}
