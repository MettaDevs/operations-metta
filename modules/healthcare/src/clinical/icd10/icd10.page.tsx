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
import { Icd10Card, type Icd10 } from './icd10-card.tsx';

// Kode ICD-10 milik klinik, dipilih di baris diagnosa pemeriksaan. Daftarnya dimulai kosong.

const route = getRouteApi('/_app/healthcare/clinical/icd10');
const ALL = 'all';
type Search = z.infer<typeof searchSchema>;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    status: z.enum(['active', 'inactive']).optional(),
});

function Icd10Page(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareIcd10Metadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const { permissions } = metadata;
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Icd10 | 'new' | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { status } = search;
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
    const loader = useCallback<ListLoader<Icd10>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareIcd10List(
                {
                    query: {
                        q: query,
                        ...(status ? { status } : {}),
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
        [status],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (icd10) => icd10.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="ICD-10"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari ICD-10',
                            placeholder: 'Cari kode atau nama diagnosa...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(status),
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
                        {list.items.length} kode dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(icd10) => icd10.id}
                    getRowLabel={(icd10) => `${icd10.code} ${icd10.name}`}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, icd10) => setOpen(icd10)}
                    onRowClick={(icd10) => setOpen(icd10)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        permissions.create
                            ? 'Belum ada kode ICD-10 yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada kode ICD-10 yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 110,
                            cell: (icd10) => (
                                <DataTableText>{icd10.code}</DataTableText>
                            ),
                            sortValue: (icd10) => icd10.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 420,
                            cell: (icd10) => (
                                <DataTableText>{icd10.name}</DataTableText>
                            ),
                            sortValue: (icd10) => icd10.name,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (icd10) => (
                                <Badge
                                    variant={
                                        icd10.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {icd10.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent title="ICD-10">
                        <Icd10Card
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            icd10={open === 'new' ? null : open}
                            permissions={permissions}
                            onSaved={(icd10) => {
                                setOpen(icd10);
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
    path: '/healthcare/clinical/icd10',
    layout: 'app',
    title: 'ICD-10',
    validateSearch: searchSchema,
    component: Icd10Page,
});
