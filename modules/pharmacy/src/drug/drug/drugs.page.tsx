import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
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
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { FilterX } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage, orpc } from '@core/platform/shell/index.ts';
import { DrugCard, type Drug } from './drug-card.tsx';

// Data obat farmasi untuk setiap barang persediaan legal entity tempat kerja. Barang dibuat dan diubah di Persediaan
// Core; di sini farmasi menandai golongan, generik, dan formularium.

const route = getRouteApi('/_app/pharmacy/drug/drugs');
const ALL = 'all';
const NONE = 'none';
const flag = z.enum(['true', 'false']).optional();
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    drug_class: z.string().max(100).optional(),
    generic: flag,
    formulary: flag,
});
type Search = z.infer<typeof searchSchema>;
const flagItems = (yes: string, no: string) => [
    { value: ALL, label: 'Semua' },
    { value: 'true', label: yes },
    { value: 'false', label: no },
];
const flagOf = (value: string | null) =>
    value === 'true' || value === 'false' ? value : undefined;

function DrugsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Drug | null>(null);
    const [canManage, setCanManage] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { drug_class: drugClass, generic, formulary } = search;
    const classes = useQuery(
        orpc.pharmacyDrugClassList.queryOptions({
            input: { query: { per_page: '100' } },
            select: (response) => response.body.data,
        }),
    );
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
            const { body } = await api.pharmacyDrugList(
                {
                    query: {
                        q: query,
                        ...(drugClass ? { drug_class: drugClass } : {}),
                        ...(generic ? { generic } : {}),
                        ...(formulary ? { formulary } : {}),
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
        [drugClass, generic, formulary],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (drug) => drug.id,
    });
    const filtered = Boolean(drugClass || generic || formulary);

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Data obat farmasi"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari obat',
                            placeholder: 'Cari kode atau nama barang...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: filtered,
                            controls: filterPanelId,
                        }}
                    />
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
                                            label="Golongan obat"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua golongan',
                                                },
                                                {
                                                    value: NONE,
                                                    label: 'Belum digolongkan',
                                                },
                                                ...(classes.data ?? []).map(
                                                    (row) => ({
                                                        value: row.id,
                                                        label: row.name,
                                                    }),
                                                ),
                                            ]}
                                            value={drugClass ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    drug_class:
                                                        value === null ||
                                                        value === ALL
                                                            ? undefined
                                                            : value,
                                                })
                                            }
                                            searchPlaceholder="Cari golongan"
                                            emptyMessage="Golongan tidak ditemukan."
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <Select
                                            label="Generik"
                                            items={flagItems(
                                                'Obat generik',
                                                'Bukan obat generik',
                                            )}
                                            value={generic ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    generic: flagOf(value),
                                                })
                                            }
                                            searchPlaceholder="Cari pilihan"
                                            emptyMessage="Pilihan tidak ditemukan."
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <Select
                                            label="Formularium"
                                            items={flagItems(
                                                'Masuk formularium',
                                                'Di luar formularium',
                                            )}
                                            value={formulary ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    formulary: flagOf(value),
                                                })
                                            }
                                            searchPlaceholder="Cari pilihan"
                                            emptyMessage="Pilihan tidak ditemukan."
                                        />
                                    </FormControl>
                                    {filtered && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="command"
                                            className="justify-self-start"
                                            onClick={() =>
                                                setSearch({
                                                    drug_class: undefined,
                                                    generic: undefined,
                                                    formulary: undefined,
                                                })
                                            }
                                        >
                                            <FilterX aria-hidden="true" />
                                            Hapus filter
                                        </Button>
                                    )}
                                </FormGrid>
                            </div>
                        </FilterPane>
                    ) : null
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} barang dimuat
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
                    emptyMessage="Belum ada barang yang cocok. Barang dibuat di Persediaan."
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 120,
                            cell: (drug) => (
                                <DataTableText>{drug.code}</DataTableText>
                            ),
                            sortValue: (drug) => drug.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 320,
                            cell: (drug) => (
                                <DataTableText>{drug.name}</DataTableText>
                            ),
                            sortValue: (drug) => drug.name,
                        },
                        {
                            id: 'base_unit_name',
                            header: 'Satuan dasar',
                            width: 120,
                            cell: (drug) => (
                                <DataTableText>
                                    {drug.base_unit_name}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'drug_class',
                            header: 'Golongan',
                            width: 180,
                            cell: (drug) => (
                                <DataTableText>
                                    {drug.drug_class?.name ?? '—'}
                                </DataTableText>
                            ),
                            sortValue: (drug) => drug.drug_class?.code ?? '',
                        },
                        {
                            id: 'flags',
                            header: 'Keterangan',
                            width: 220,
                            cell: (drug) => (
                                <span className="flex flex-wrap gap-1">
                                    {drug.is_generic && (
                                        <Badge variant="secondary">
                                            Generik
                                        </Badge>
                                    )}
                                    {drug.is_formulary && (
                                        <Badge variant="secondary">
                                            Formularium
                                        </Badge>
                                    )}
                                    {drug.is_blocked && (
                                        <Badge variant="outline">
                                            Diblokir
                                        </Badge>
                                    )}
                                </span>
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
                    <PageDialogContent title="Data obat farmasi">
                        <DrugCard
                            key={`${open.id}:${open.version}`}
                            drug={open}
                            canManage={canManage}
                            onSaved={(drug) => {
                                setOpen(drug);
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
    path: '/pharmacy/drug/drugs',
    layout: 'app',
    title: 'Data obat farmasi',
    validateSearch: searchSchema,
    component: DrugsPage,
});
