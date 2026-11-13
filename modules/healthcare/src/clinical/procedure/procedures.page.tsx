import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage, orpc } from '@core/platform/shell/index.ts';
import { ProcedureCard, type Procedure } from './procedure-card.tsx';

// Tindakan milik klinik, dipilih di baris Biaya Tindakan pemeriksaan.

const route = getRouteApi('/_app/healthcare/clinical/procedures');
const ALL = 'all';
type Search = z.infer<typeof searchSchema>;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    group: z.string().max(40).optional(),
});

function ProceduresPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareProcedureMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const { permissions } = metadata;
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Procedure | 'new' | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { status, group } = search;
    const setSearch = (next: Partial<Search>) =>
        void navigate({
            search: (current) =>
                Object.fromEntries(
                    Object.entries<string | undefined>({
                        ...current,
                        ...next,
                    }).filter(
                        ([, value]) => value !== undefined && value !== '',
                    ),
                ),
            replace: true,
        });
    const loader = useCallback<ListLoader<Procedure>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareProcedureList(
                {
                    query: {
                        q: query,
                        ...(status ? { status } : {}),
                        ...(group ? { group } : {}),
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [status, group],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (procedure) => procedure.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Tindakan"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari tindakan',
                            placeholder: 'Cari kode atau nama tindakan...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(status || group),
                            controls: filterPanelId,
                        }}
                    >
                        {permissions.create && (
                            <ActionButton
                                action="create"
                                onClick={() => setOpen('new')}
                            />
                        )}
                    </RecordActionBar>
                }
                filterPanel={
                    filtersOpen ? (
                        <FilterPane
                            id={filterPanelId}
                            title="Filter"
                            description="Hasil diperbarui otomatis saat filter diubah."
                            onClose={() => setFiltersOpen(false)}
                        >
                            <div className="p-4">
                                <FormGrid columns={1}>
                                    <FormControl>
                                        <Select
                                            label="Kelompok"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua kelompok',
                                                },
                                                ...metadata.groups.map(
                                                    (item) => ({
                                                        value: item.id,
                                                        label: item.name,
                                                    }),
                                                ),
                                            ]}
                                            value={group ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    group:
                                                        value === null ||
                                                        value === ALL
                                                            ? undefined
                                                            : value,
                                                })
                                            }
                                            searchPlaceholder="Cari kelompok"
                                            emptyMessage="Kelompok tidak ditemukan."
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <Select
                                            label="Status"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua status',
                                                },
                                                {
                                                    value: 'active',
                                                    label: 'Aktif',
                                                },
                                                {
                                                    value: 'inactive',
                                                    label: 'Nonaktif',
                                                },
                                            ]}
                                            value={status ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    status:
                                                        value === 'active' ||
                                                        value === 'inactive'
                                                            ? value
                                                            : undefined,
                                                })
                                            }
                                            searchPlaceholder="Cari status"
                                            emptyMessage="Status tidak ditemukan."
                                        />
                                    </FormControl>
                                </FormGrid>
                            </div>
                        </FilterPane>
                    ) : null
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} tindakan dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(procedure) => procedure.id}
                    getRowLabel={(procedure) =>
                        `${procedure.code} ${procedure.name}`
                    }
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, procedure) => setOpen(procedure)}
                    onRowClick={(procedure) => setOpen(procedure)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        permissions.create
                            ? 'Belum ada tindakan yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada tindakan yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 110,
                            cell: (procedure) => (
                                <DataTableText>{procedure.code}</DataTableText>
                            ),
                            sortValue: (procedure) => procedure.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 360,
                            cell: (procedure) => (
                                <DataTableText>{procedure.name}</DataTableText>
                            ),
                            sortValue: (procedure) => procedure.name,
                        },
                        {
                            id: 'group_name',
                            header: 'Kelompok',
                            width: 200,
                            cell: (procedure) => (
                                <DataTableText>
                                    {procedure.group_name ?? ''}
                                </DataTableText>
                            ),
                            sortValue: (procedure) =>
                                procedure.group_name ?? '',
                        },
                        {
                            id: 'category_name',
                            header: 'Kategori',
                            width: 200,
                            cell: (procedure) => (
                                <DataTableText>
                                    {procedure.category_name ?? ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (procedure) => (
                                <Badge
                                    variant={
                                        procedure.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {procedure.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent title="Tindakan">
                        <ProcedureCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            procedure={open === 'new' ? null : open}
                            permissions={permissions}
                            onSaved={(procedure) => {
                                setOpen(procedure);
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
    path: '/healthcare/clinical/procedures',
    layout: 'app',
    title: 'Tindakan',
    validateSearch: searchSchema,
    component: ProceduresPage,
});
