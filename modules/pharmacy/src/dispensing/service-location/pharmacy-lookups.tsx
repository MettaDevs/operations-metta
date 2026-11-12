import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
    type Reference,
} from '@operations-metta/ui/master-lookup';
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { api } from '@core/platform/shell/index.ts';

// Pilihan lokasi stok, operating unit, dan section asal untuk layar farmasi. Ketiganya master milik Core atau dikenal
// dari resep, jadi tidak ada Baru di sini: lokasi dibuat di Persediaan Core.

const loadLocations = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.pharmacyLocationLookup(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};

export const locationLabel = (location: Reference) =>
    `${location.code} · ${location.name}`;

export function LocationLookup(props: MasterLookupProps<Reference>): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Lokasi"
            load={loadLocations}
            display={locationLabel}
            columns={[codeColumn(), nameColumn(220)]}
        />
    );
}

const loadUnits = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.pharmacyOperatingUnitLookup(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};

export function OperatingUnitLookup(
    props: MasterLookupProps<Reference>,
): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Operating unit"
            placeholder="Cari nomor atau nama unit…"
            load={loadUnits}
            columns={[codeColumn(), nameColumn(240)]}
        />
    );
}

type Section = Reference & { operating_unit_name: string };

// Section asal resep yang sudah pernah diterima farmasi dari unit itu, karena farmasi tidak membaca master section
// layanan kesehatan.
export function SectionLookup({
    operatingUnitId,
    ...props
}: MasterLookupProps<Section> & { operatingUnitId: string | null }): ReactNode {
    const load = useCallback(
        async ({ query, cursor, signal }: LookupRequest) => {
            const { body } = await api.pharmacySectionLookup(
                {
                    query: {
                        q: query,
                        ...(operatingUnitId
                            ? { operating_unit_id: operatingUnitId }
                            : {}),
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return {
                items: body.data.map((section) => ({ ...section, code: '' })),
                nextCursor: body.next_cursor,
            };
        },
        [operatingUnitId],
    );
    return (
        <MasterLookup<Section>
            {...props}
            noun="Section"
            placeholder="Cari section…"
            load={load}
            columns={[
                nameColumn(220),
                {
                    id: 'operating_unit_name',
                    header: 'Operating unit',
                    width: 200,
                    cell: (row) => row.operating_unit_name,
                },
            ]}
        />
    );
}
