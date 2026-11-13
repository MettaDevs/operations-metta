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
import { api, definePage } from '@core/platform/shell/index.ts';
import { GradingGroupCard, type GradingGroup } from './grading-group-card.tsx';

// Kelompok grading obat legal entity tempat kerja (SIMmKelompokGrading sistem lama). Grading harga obat memakai
// kelompok ini untuk memberi % naik yang berbeda per kelompok obat.

const route = getRouteApi('/_app/pharmacy/drug/grading-groups');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function GradingGroupsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<GradingGroup | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<GradingGroup>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.pharmacyGradingGroupList(
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
                        title="Kelompok grading"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari kelompok grading',
                            placeholder: 'Cari nama kelompok...',
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
                        {list.items.length} kelompok dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) => row.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, row) => setOpen(row)}
                    onRowClick={(row) => setOpen(row)}
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada kelompok grading. Pilih Baru untuk menambahkan.'
                            : 'Belum ada kelompok grading.'
                    }
                    columns={[
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 280,
                            cell: (row) => (
                                <DataTableText>{row.name}</DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (row) => (
                                <Badge
                                    variant={
                                        row.is_active ? 'secondary' : 'outline'
                                    }
                                >
                                    {row.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent title="Kelompok grading">
                        <GradingGroupCard
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
    path: '/pharmacy/drug/grading-groups',
    layout: 'app',
    title: 'Kelompok grading',
    validateSearch: searchSchema,
    component: GradingGroupsPage,
});
