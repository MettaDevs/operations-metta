import type { ReactNode } from 'react';
import { api, type ApiBody } from '../../../platform/shell/index.ts';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
} from '../master-lookup.tsx';

export type TrackingCode = ApiBody<'inventoryTrackingCodeList'>['data'][number];

const loadTrackingCodes = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.inventoryTrackingCodeList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};

const yesNo = (value: boolean) => (value ? 'Ya' : 'Tidak');

export function TrackingCodeLookup(
    props: MasterLookupProps<TrackingCode>,
): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Profil pelacakan"
            load={loadTrackingCodes}
            columns={[
                codeColumn(),
                nameColumn(200),
                {
                    id: 'batch_required',
                    header: 'Wajib batch',
                    width: 110,
                    cell: (row) => yesNo(row.batch_required),
                },
                {
                    id: 'expiry_required',
                    header: 'Wajib kedaluwarsa',
                    width: 140,
                    cell: (row) => yesNo(row.expiry_required),
                },
            ]}
        />
    );
}
