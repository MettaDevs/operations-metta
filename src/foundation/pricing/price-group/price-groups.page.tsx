import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
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
import { api, definePage } from '../../../platform/shell/index.ts';
import { PriceGroupCard, type PriceGroup } from './price-group-card.tsx';

// Kelompok harga (Customer Price Groups di BC): kunci harga yang ditunjuk tipe pasien. Beberapa tipe pasien boleh
// berbagi satu kelompok, misalnya Umum dan Pemda dengan tarif yang sama.

const route = getRouteApi('/_app/sysadmin/pricing/price-groups');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function PriceGroupsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<PriceGroup | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<PriceGroup>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.pricingPriceGroupList(
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
        getKey: (group) => group.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Kelompok harga"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: { q: q || undefined },
                                    replace: true,
                                }),
                            label: 'Cari kelompok harga',
                            placeholder: 'Cari kode atau nama...',
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
                        {list.items.length} kelompok harga dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(group) => group.id}
                    getRowLabel={(group) => `${group.code} ${group.name}`}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, group) => setOpen(group)}
                    onRowClick={(group) => setOpen(group)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada kelompok harga yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada kelompok harga yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 140,
                            cell: (group) => (
                                <DataTableText>{group.code}</DataTableText>
                            ),
                            sortValue: (group) => group.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 280,
                            cell: (group) => (
                                <DataTableText>{group.name}</DataTableText>
                            ),
                            sortValue: (group) => group.name,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (group) => (
                                <Badge
                                    variant={
                                        group.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {group.is_active ? 'Aktif' : 'Nonaktif'}
                                </Badge>
                            ),
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
                    <PageDialogContent title="Kelompok harga">
                        <PriceGroupCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(group) => {
                                setOpen(group);
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
    path: '/sysadmin/pricing/price-groups',
    layout: 'app',
    title: 'Kelompok harga',
    validateSearch: searchSchema,
    component: PriceGroupsPage,
});
