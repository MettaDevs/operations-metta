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
import { DrugCard, type Drug } from './drug-card.tsx';

// Obat legal entity tempat kerja, dipilih di baris E-Resep pemeriksaan. Setiap obat adalah barang persediaan.

const route = getRouteApi('/_app/healthcare/clinical/drugs');
const ALL = 'all';
type Search = z.infer<typeof searchSchema>;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    prescribable: z.enum(['true', 'false']).optional(),
});

function status(drug: Drug): { label: string; active: boolean } {
    if (drug.is_blocked) return { label: 'Diblokir', active: false };
    return drug.is_prescribable
        ? { label: 'Boleh diresepkan', active: true }
        : { label: 'Tidak diresepkan', active: false };
}

function DrugsPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareDrugMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const { permissions } = metadata;
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Drug | 'new' | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { prescribable } = search;
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
    const loader = useCallback<ListLoader<Drug>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareDrugList(
                {
                    query: {
                        q: query,
                        ...(prescribable ? { prescribable } : {}),
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
        [prescribable],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (drug) => drug.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Obat"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari obat',
                            placeholder: 'Cari kode atau nama obat...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(prescribable),
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
                                                    value: 'true',
                                                    label: 'Bisa dipilih di resep',
                                                },
                                                {
                                                    value: 'false',
                                                    label: 'Tidak bisa dipilih di resep',
                                                },
                                            ]}
                                            value={prescribable ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    prescribable:
                                                        value === 'true' ||
                                                        value === 'false'
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
                        {list.items.length} obat dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(drug) => drug.id}
                    getRowLabel={(drug) => `${drug.code} ${drug.name}`}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, drug) => setOpen(drug)}
                    onRowClick={(drug) => setOpen(drug)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        permissions.create
                            ? 'Belum ada obat yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada obat yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 110,
                            cell: (drug) => (
                                <DataTableText>{drug.code}</DataTableText>
                            ),
                            sortValue: (drug) => drug.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 360,
                            cell: (drug) => (
                                <DataTableText>{drug.name}</DataTableText>
                            ),
                            sortValue: (drug) => drug.name,
                        },
                        {
                            id: 'base_unit_name',
                            header: 'Satuan dasar',
                            width: 140,
                            cell: (drug) => (
                                <DataTableText>
                                    {drug.base_unit_name}
                                </DataTableText>
                            ),
                            sortValue: (drug) => drug.base_unit_name,
                        },
                        {
                            id: 'dosage_form_name',
                            header: 'Bentuk sediaan',
                            width: 180,
                            cell: (drug) => (
                                <DataTableText>
                                    {drug.dosage_form_name ?? ''}
                                </DataTableText>
                            ),
                            sortValue: (drug) => drug.dosage_form_name ?? '',
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 150,
                            cell: (drug) => (
                                <Badge
                                    variant={
                                        status(drug).active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {status(drug).label}
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
                    <PageDialogContent title="Obat">
                        <DrugCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            drug={open === 'new' ? null : open}
                            permissions={permissions}
                            onSaved={(drug) => {
                                setOpen(drug);
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
    path: '/healthcare/clinical/drugs',
    layout: 'app',
    title: 'Obat',
    validateSearch: searchSchema,
    component: DrugsPage,
});
