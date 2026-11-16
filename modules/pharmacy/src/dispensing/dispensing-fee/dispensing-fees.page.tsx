import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayNumber } from '@operations-metta/ui/display-number';
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
    DispensingFeeCard,
    feeKindLabel,
    type DispensingFee,
} from './dispensing-fee-card.tsx';

// Biaya racik dan resep: nilai per legal entity, boleh dipersempit ke lokasi dan kelompok harga. Tanpa baris yang cocok,
// biaya itu tidak ditagih.

const route = getRouteApi('/_app/pharmacy/dispensing/dispensing-fees');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function DispensingFeesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<DispensingFee | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<DispensingFee>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.pharmacyDispensingFeeList(
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
                        title="Biaya racik dan resep"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari biaya racik dan resep',
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
                    getRowLabel={(row) => feeKindLabel(row.kind)}
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
                            ? 'Belum ada biaya racik atau resep, jadi keduanya tidak ditagih. Pilih Baru untuk mengaturnya.'
                            : 'Belum ada biaya racik atau resep, jadi keduanya tidak ditagih.'
                    }
                    columns={[
                        {
                            id: 'kind',
                            header: 'Jenis biaya',
                            width: 160,
                            cell: (row) => (
                                <DataTableText>
                                    {feeKindLabel(row.kind)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.kind,
                        },
                        {
                            id: 'location',
                            header: 'Lokasi',
                            width: 240,
                            cell: (row) => (
                                <DataTableText>
                                    {row.location
                                        ? locationLabel(row.location)
                                        : 'Semua lokasi'}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.location?.code ?? '',
                        },
                        {
                            id: 'price_group',
                            header: 'Kelompok harga',
                            width: 220,
                            cell: (row) => (
                                <DataTableText>
                                    {row.price_group
                                        ? `${row.price_group.code} · ${row.price_group.name}`
                                        : 'Semua kelompok harga'}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.price_group?.code ?? '',
                        },
                        {
                            id: 'amount',
                            header: 'Nilai',
                            width: 140,
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>
                                    {displayNumber(row.amount)}
                                </DataTableText>
                            ),
                            sortValue: (row) => Number(row.amount),
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
                    <PageDialogContent title="Biaya racik dan resep">
                        <DispensingFeeCard
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
    path: '/pharmacy/dispensing/dispensing-fees',
    layout: 'app',
    title: 'Biaya racik dan resep',
    validateSearch: searchSchema,
    component: DispensingFeesPage,
});
