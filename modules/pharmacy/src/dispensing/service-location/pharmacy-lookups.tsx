import { displayDate } from '@operations-metta/ui/date-picker';
import { displayNumber } from '@operations-metta/ui/display-number';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
    type Reference,
} from '@operations-metta/ui/master-lookup';
import { useCallback } from 'react';
import type { ReactNode, RefObject } from 'react';
import { api } from '@core/platform/shell/index.ts';

// Pilihan lokasi stok, operating unit, section asal, dan batch untuk layar farmasi. Semuanya master milik Core, dikenal
// dari resep, atau lahir dari stok masuk, jadi tidak ada Baru di sini: lokasi dibuat di Persediaan Core.

const locationsWhere =
    (accessible: boolean) =>
    async ({ query, cursor, signal }: LookupRequest) => {
        const { body } = await api.pharmacyLocationLookup(
            {
                query: {
                    q: query,
                    ...(accessible ? { accessible: 'true' as const } : {}),
                    ...(cursor ? { cursor } : {}),
                },
            },
            { signal },
        );
        return { items: body.data, nextCursor: body.next_cursor };
    };
const loadLocations = locationsWhere(false);
const loadAccessibleLocations = locationsWhere(true);

export const locationLabel = (location: Reference) =>
    `${location.code} · ${location.name}`;

export function LocationLookup({
    accessible,
    ...props
}: MasterLookupProps<Reference> & { accessible?: boolean }): ReactNode {
    return (
        <MasterLookup
            {...props}
            noun="Lokasi"
            load={accessible ? loadAccessibleLocations : loadLocations}
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

export type PickedBatch = {
    id: string;
    batch_number: string;
    expiry_date: string | null;
};

type BatchRow = Reference & { expiry_date: string | null; quantity: string };

// Batch yang masih punya stok untuk obat ini di lokasi farmasi, kedaluwarsa terdekat lebih dulu. Batch lahir dari stok
// masuk, jadi pilihan ini tidak punya Baru.
export function BatchLookup({
    itemId,
    locationId,
    value,
    onChange,
    error,
    field,
    hint,
    portalContainer,
}: {
    itemId: string;
    locationId: string | null;
    value: PickedBatch | null;
    onChange: (batch: PickedBatch) => void;
    error: string | undefined;
    field: string;
    hint: string;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    const load = useCallback(
        async ({ query, signal }: LookupRequest) => {
            const { body } = await api.pharmacyBatchLookup(
                {
                    query: {
                        q: query,
                        item_id: itemId,
                        ...(locationId ? { location_id: locationId } : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [itemId, locationId],
    );
    return (
        <MasterLookup<BatchRow>
            label="Batch"
            field={field}
            value={
                value
                    ? {
                          id: value.id,
                          code: value.batch_number,
                          name: value.batch_number,
                      }
                    : null
            }
            onChange={(row) =>
                onChange({
                    id: row.id,
                    batch_number: row.code,
                    expiry_date: row.expiry_date,
                })
            }
            disabled={locationId === null}
            error={error}
            hint={hint}
            portalContainer={portalContainer}
            noun="Batch"
            placeholder="Cari nomor batch…"
            load={load}
            display={(batch) => batch.code}
            columns={[
                {
                    id: 'code',
                    header: 'Batch',
                    width: 140,
                    cell: (row) => row.code,
                },
                {
                    id: 'expiry_date',
                    header: 'Kedaluwarsa',
                    width: 120,
                    cell: (row) =>
                        row.expiry_date ? displayDate(row.expiry_date) : '',
                },
                {
                    id: 'quantity',
                    header: 'Stok',
                    width: 100,
                    align: 'right',
                    cell: (row) => displayNumber(row.quantity),
                },
            ]}
        />
    );
}
