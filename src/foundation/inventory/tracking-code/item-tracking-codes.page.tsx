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
import { api, definePage } from '../../../platform/shell/index.ts';
import { TrackingCodeCard } from './tracking-code-card.tsx';
import type { TrackingCode } from './tracking-code-lookup.tsx';

// Profil pelacakan barang (Item Tracking Codes di BC): batch dan tanggal kedaluwarsa apa yang wajib dicatat.

const route = getRouteApi('/_app/sysadmin/inventory/item-tracking-codes');
const searchSchema = z.object({ q: z.string().max(200).optional() });

const yesNo = (value: boolean) => (value ? 'Ya' : 'Tidak');

function ItemTrackingCodesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<TrackingCode | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<TrackingCode>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.inventoryTrackingCodeList(
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
        getKey: (profile) => profile.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Profil pelacakan"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: { q: q || undefined },
                                    replace: true,
                                }),
                            label: 'Cari profil pelacakan',
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
                        {list.items.length} profil dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(profile) => profile.id}
                    getRowLabel={(profile) => profile.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, profile) => setOpen(profile)}
                    onRowClick={(profile) => setOpen(profile)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada profil pelacakan yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada profil pelacakan yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 140,
                            cell: (profile) => (
                                <DataTableText>{profile.code}</DataTableText>
                            ),
                            sortValue: (profile) => profile.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 260,
                            cell: (profile) => (
                                <DataTableText>{profile.name}</DataTableText>
                            ),
                            sortValue: (profile) => profile.name,
                        },
                        {
                            id: 'batch_required',
                            header: 'Wajib nomor batch',
                            width: 140,
                            cell: (profile) => (
                                <DataTableText>
                                    {yesNo(profile.batch_required)}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'expiry_required',
                            header: 'Wajib tanggal kedaluwarsa',
                            width: 170,
                            cell: (profile) => (
                                <DataTableText>
                                    {yesNo(profile.expiry_required)}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'strict_expiry',
                            header: 'Tolak keluar setelah kedaluwarsa',
                            width: 190,
                            cell: (profile) => (
                                <DataTableText>
                                    {yesNo(profile.strict_expiry)}
                                </DataTableText>
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
                    <PageDialogContent title="Profil pelacakan">
                        <TrackingCodeCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(profile) => {
                                setOpen(profile);
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
    path: '/sysadmin/inventory/item-tracking-codes',
    layout: 'app',
    title: 'Profil pelacakan',
    validateSearch: searchSchema,
    component: ItemTrackingCodesPage,
});
