import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage } from '@core/platform/shell/index.ts';
import {
    ServiceLocationCard,
    type ServiceLocation,
} from './service-location-card.tsx';
import { locationLabel } from './pharmacy-lookups.tsx';

// Lokasi layanan resep: lokasi stok yang melayani resep dari setiap operating unit, dan dari section tertentu di unit
// itu. Pusling dan farmasi biasa hanya beda baris di sini.

const route = getRouteApi('/_app/pharmacy/dispensing/service-locations');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function ServiceLocationsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<ServiceLocation | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<ServiceLocation>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.pharmacyServiceLocationList(
                {
                    query: {
                        q: query,
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            setCanManage(body.can_manage);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (row) => row.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Lokasi layanan resep"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari lokasi layanan resep',
                            placeholder: 'Cari unit, section, atau lokasi...',
                        }}
                    >
                        {canManage && (
                            <ActionButton
                                action="create"
                                onClick={() => setOpen('new')}
                            />
                        )}
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} baris dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) =>
                        `${row.operating_unit.name} ${row.section?.name ?? ''}`
                    }
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, row) => setOpen(row)}
                    onRowClick={(row) => setOpen(row)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada lokasi layanan resep. Pilih Baru untuk mengatur lokasi farmasi setiap unit.'
                            : 'Belum ada lokasi layanan resep.'
                    }
                    columns={[
                        {
                            id: 'operating_unit',
                            header: 'Operating unit',
                            width: 240,
                            cell: (row) => (
                                <DataTableText>
                                    {row.operating_unit.name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.operating_unit.name,
                        },
                        {
                            id: 'section',
                            header: 'Section asal',
                            width: 220,
                            cell: (row) => (
                                <DataTableText>
                                    {row.section?.name ??
                                        'Semua section (bawaan unit)'}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.section?.name ?? '',
                        },
                        {
                            id: 'location',
                            header: 'Lokasi farmasi',
                            width: 260,
                            cell: (row) => (
                                <DataTableText>
                                    {locationLabel(row.location)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.location.code,
                        },
                    ]}
                />
            </ListPageLayout>
            {open && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpen(null);
                    }}
                >
                    <PageDialogContent title="Lokasi layanan resep">
                        <ServiceLocationCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(row) => {
                                setOpen(row);
                                list.reload();
                            }}
                            onClose={() => {
                                setOpen(null);
                                list.reload();
                            }}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/pharmacy/dispensing/service-locations',
    layout: 'app',
    title: 'Lokasi layanan resep',
    validateSearch: searchSchema,
    component: ServiceLocationsPage,
});
