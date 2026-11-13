import {
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
} from '@operations-metta/ui/master-lookup';
import type { ReactNode } from 'react';
import { api, type ApiBody } from '../../../platform/shell/index.ts';

type PartyRow = ApiBody<'partyList'>['data'][number];
export type Party = { id: string; code: string; name: string };

const load = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.partyList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data.map((party: PartyRow): Party => ({
            id: party.id,
            code: '',
            name: party.name,
        })),
        nextCursor: body.next_cursor,
    };
};

// Pihak buku alamat Core untuk jenis bayar yang pihaknya dipilih saat bayar, seperti lookup Dokter/Karyawan Bon di
// modal Kredit / Bon sistem lama.
export function PartyLookup(props: MasterLookupProps<Party>): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Pihak"
            load={load}
            display={(party) => party.name}
            columns={[nameColumn(260)]}
        />
    );
}
