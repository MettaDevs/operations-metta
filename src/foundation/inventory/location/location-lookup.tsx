import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { api, type ApiBody } from '../../../platform/shell/index.ts';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
} from '../master-lookup.tsx';

export type Location = ApiBody<'inventoryLocationList'>['data'][number];
type OperatingUnitRow =
    ApiBody<'inventoryLocationOperatingUnits'>['data'][number];
export type OperatingUnit = OperatingUnitRow & { code: string };

// Lokasi tampil dengan kodenya, karena gudang dan apotek dikenal dari kodenya. transit false menyembunyikan lokasi
// transit, yang hanya dipakai mutasi.
export function LocationLookup({
    transit,
    ...props
}: MasterLookupProps<Location> & { transit?: boolean }): ReactNode {
    const load = useCallback(
        async ({ query, cursor, signal }: LookupRequest) => {
            const { body } = await api.inventoryLocationList(
                {
                    query: {
                        q: query,
                        ...(transit === undefined
                            ? {}
                            : { transit: transit ? 'true' : 'false' }),
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
        },
        [transit],
    );
    return (
        <MasterLookup
            {...props}
            noun="Lokasi"
            load={load}
            display={(location) => `${location.code} · ${location.name}`}
            columns={[
                codeColumn(),
                nameColumn(200),
                {
                    id: 'operating_unit',
                    header: 'Operating unit',
                    width: 180,
                    cell: (row) => row.operating_unit.name,
                },
            ]}
        />
    );
}

const loadUnits = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.inventoryLocationOperatingUnits(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data.map((unit): OperatingUnit => ({
            ...unit,
            code: unit.number ?? '',
        })),
        nextCursor: body.next_cursor,
    };
};

export function OperatingUnitLookup(
    props: MasterLookupProps<OperatingUnit>,
): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Operating unit"
            load={loadUnits}
            columns={[{ ...codeColumn(), header: 'Nomor' }, nameColumn()]}
        />
    );
}
