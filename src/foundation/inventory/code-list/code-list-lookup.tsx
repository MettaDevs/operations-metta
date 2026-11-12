import type { ReactNode } from 'react';
import { api, type ApiBody } from '../../../platform/shell/index.ts';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
} from '@operations-metta/ui/master-lookup';

export type UnitOfMeasure =
    ApiBody<'inventoryUnitOfMeasureList'>['data'][number];
export type ReasonCode = ApiBody<'inventoryReasonCodeList'>['data'][number];

const loadUnits = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.inventoryUnitOfMeasureList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data,
        nextCursor: body.next_cursor,
        canCreate: body.can_manage,
    };
};

const loadReasons = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.inventoryReasonCodeList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data,
        nextCursor: body.next_cursor,
        canCreate: body.can_manage,
    };
};

// Satuan tampil dengan kodenya, karena kode seperti TAB atau BOX yang dikenal orang di gudang.
export function UnitOfMeasureLookup(
    props: MasterLookupProps<UnitOfMeasure>,
): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Satuan"
            load={loadUnits}
            display={(unit) => `${unit.code} · ${unit.name}`}
            columns={[codeColumn(), nameColumn()]}
        />
    );
}

export function ReasonCodeLookup(
    props: MasterLookupProps<ReasonCode>,
): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Alasan"
            load={loadReasons}
            columns={[codeColumn(140), nameColumn()]}
        />
    );
}
