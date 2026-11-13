import { displayNumber } from '@operations-metta/ui/display-number';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
} from '@operations-metta/ui/master-lookup';
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { api, type ApiBody } from '../../../platform/shell/index.ts';

export type ItemUnit = ApiBody<'inventoryItemUnitList'>['data'][number];

export function ItemUnitLookup({
    itemId,
    ...props
}: Omit<MasterLookupProps<ItemUnit>, 'onCreate'> & {
    itemId: string;
}): ReactNode {
    const load = useCallback(
        async ({ query, cursor, signal }: LookupRequest) => {
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
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [itemId],
    );
    return (
        <MasterLookup
            {...props}
            noun="Satuan"
            load={load}
            display={(unit) => `${unit.code} · ${unit.name}`}
            columns={[
                codeColumn(90),
                nameColumn(180),
                {
                    id: 'quantity_per_unit',
                    header: 'Isi',
                    width: 80,
                    align: 'right',
                    cell: (unit) => displayNumber(unit.quantity_per_unit),
                },
            ]}
        />
    );
}
