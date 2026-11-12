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
import { DrugClassCard, type DrugClass } from './drug-class-card.tsx';

// Golongan obat legal entity tempat kerja. Lima golongan diisi saat module dipasang; isinya data, bukan daftar di kode.

const route = getRouteApi('/_app/pharmacy/drug/drug-classes');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function DrugClassesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<DrugClass | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<DrugClass>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.pharmacyDrugClassList(
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
                        title="Golongan obat"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari golongan obat',
                            placeholder: 'Cari kode atau nama golongan...',
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
                        {list.items.length} golongan dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) => `${row.code} ${row.name}`}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, row) => setOpen(row)}
                    onRowClick={(row) => setOpen(row)}
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada golongan obat. Pilih Baru untuk menambahkan.'
                            : 'Belum ada golongan obat.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 160,
                            cell: (row) => (
                                <DataTableText>{row.code}</DataTableText>
                            ),
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 280,
                            cell: (row) => (
                                <DataTableText>{row.name}</DataTableText>
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
                    <PageDialogContent title="Golongan obat">
                        <DrugClassCard
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
    path: '/pharmacy/drug/drug-classes',
    layout: 'app',
    title: 'Golongan obat',
    validateSearch: searchSchema,
    component: DrugClassesPage,
});
