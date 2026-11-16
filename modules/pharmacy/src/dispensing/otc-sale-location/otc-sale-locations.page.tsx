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
import { locationLabel } from '../service-location/pharmacy-lookups.tsx';
import {
    OtcSaleLocationCard,
    type OtcSaleLocation,
} from './otc-sale-location-card.tsx';

// Lokasi penjualan obat bebas: lokasi stok yang boleh menjual obat bebas di loket, dengan kelompok harga bawaannya.

const route = getRouteApi('/_app/pharmacy/dispensing/otc-sale-locations');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function OtcSaleLocationsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<OtcSaleLocation | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<OtcSaleLocation>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.pharmacyOtcSaleLocationList(
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
                        title="Lokasi penjualan obat bebas"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari lokasi penjualan obat bebas',
                            placeholder: 'Cari lokasi atau kelompok harga...',
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
                    getRowLabel={(row) => locationLabel(row.location)}
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
                            ? 'Belum ada lokasi yang boleh menjual obat bebas. Pilih Baru untuk mengaturnya.'
                            : 'Belum ada lokasi yang boleh menjual obat bebas.'
                    }
                    columns={[
                        {
                            id: 'location',
                            header: 'Lokasi',
                            width: 280,
                            cell: (row) => (
                                <DataTableText>
                                    {locationLabel(row.location)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.location.code,
                        },
                        {
                            id: 'price_group',
                            header: 'Kelompok harga',
                            width: 240,
                            cell: (row) => (
                                <DataTableText>
                                    {row.price_group
                                        ? `${row.price_group.code} · ${row.price_group.name}`
                                        : 'Harga dasar'}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.price_group?.code ?? '',
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
                    <PageDialogContent title="Lokasi penjualan obat bebas">
                        <OtcSaleLocationCard
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
    path: '/pharmacy/dispensing/otc-sale-locations',
    layout: 'app',
    title: 'Lokasi penjualan obat bebas',
    validateSearch: searchSchema,
    component: OtcSaleLocationsPage,
});
