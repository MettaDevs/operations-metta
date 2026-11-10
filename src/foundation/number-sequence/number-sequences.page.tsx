import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    api,
    definePage,
    orpc,
    type ApiBody,
} from '../../platform/shell/index.ts';
import {
    NumberSequenceCard,
    scopeLabels,
    statusLabels,
} from './number-sequence-card.tsx';

// Nomor dokumen, layar Number sequences F&O: setiap baris satu pengaturan nomor untuk satu jenis nomor (reference)
// dan satu nilai scope. Saringan area dan reference di panel kiri, seperti daftar Number sequences F&O.

const route = getRouteApi('/_app/settings/number-sequences');
const ALL = 'all';
type Row = ApiBody<'numberSequenceList'>['data'][number];
const scopeTypes = [
    'tenant',
    'legal_entity',
    'operating_unit',
    'legal_entity_fiscal_period',
] as const;
const statuses = ['draft', 'active', 'stopped'] as const;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    area: z.string().max(100).optional(),
    reference: z.string().max(100).optional(),
    scope: z.enum(scopeTypes).optional(),
    status: z.enum(statuses).optional(),
    sequence: z.string().max(100).optional(),
});
type Search = z.infer<typeof searchSchema>;

function NumberSequencesPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.numberSequenceMetadata.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    // Naik setiap kali kartu tersimpan, supaya kartu dipasang ulang dalam mode baca.
    const [revision, setRevision] = useState(0);
    const filterPanelId = useId();
    const { area, reference, scope, status } = search;
    const setSearch = (next: Partial<Search>) =>
        void navigate({
            search: (previous) => {
                const merged = { ...previous, ...next };
                return Object.fromEntries(
                    Object.entries<string | undefined>(merged).filter(
                        ([, value]) => value !== undefined && value !== '',
                    ),
                );
            },
            replace: true,
        });
    const areas = [
        ...new Map(
            metadata.references.map((item) => [item.area_id, item.area_name]),
        ),
    ];
    const references = metadata.references.filter(
        (item) => !area || item.area_id === area,
    );

    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.numberSequenceList(
                {
                    query: {
                        q: query,
                        ...(area ? { area_id: area } : {}),
                        ...(reference ? { reference_id: reference } : {}),
                        ...(scope ? { scope_type: scope } : {}),
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
        [area, reference, scope, status],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (item) => item.id,
    });
    const open = (id: string | undefined) => setSearch({ sequence: id });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Nomor dokumen"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari pengaturan nomor',
                            placeholder: 'Cari jenis nomor atau organisasi...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(
                                area || reference || scope || status,
                            ),
                            controls: filterPanelId,
                        }}
                    >
                        {metadata.canManage && (
                            <ActionButton
                                action="create"
                                onClick={() => setCreating(true)}
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
                                            label="Area"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua area',
                                                },
                                                ...areas.map(([id, name]) => ({
                                                    value: id,
                                                    label: name,
                                                })),
                                            ]}
                                            value={area ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    area:
                                                        value === ALL
                                                            ? undefined
                                                            : (value ??
                                                              undefined),
                                                    reference: undefined,
                                                })
                                            }
                                            searchPlaceholder="Cari area"
                                            emptyMessage="Area tidak ditemukan."
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <Select
                                            label="Jenis nomor"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua jenis nomor',
                                                },
                                                ...references.map((item) => ({
                                                    value: item.id,
                                                    label: item.name,
                                                })),
                                            ]}
                                            value={reference ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    reference:
                                                        value === ALL
                                                            ? undefined
                                                            : (value ??
                                                              undefined),
                                                })
                                            }
                                            searchPlaceholder="Cari jenis nomor"
                                            emptyMessage="Jenis nomor tidak ditemukan."
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <Select
                                            label="Scope"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua scope',
                                                },
                                                ...scopeTypes.map((type) => ({
                                                    value: type,
                                                    label: scopeLabels[type],
                                                })),
                                            ]}
                                            value={scope ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    scope: scopeTypes.find(
                                                        (type) =>
                                                            type === value,
                                                    ),
                                                })
                                            }
                                            searchPlaceholder="Cari scope"
                                            emptyMessage="Scope tidak ditemukan."
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
                                                ...statuses.map((item) => ({
                                                    value: item,
                                                    label: statusLabels[item],
                                                })),
                                            ]}
                                            value={status ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    status: statuses.find(
                                                        (item) =>
                                                            item === value,
                                                    ),
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
                        {list.items.length} pengaturan nomor dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) => row.reference_name}
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, row) => open(row.id)}
                    activeRowKey={search.sequence}
                    onRowClick={(row) => open(row.id)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        metadata.canManage
                            ? 'Belum ada pengaturan nomor yang cocok. Pilih Baru untuk membuatnya.'
                            : 'Belum ada pengaturan nomor yang cocok.'
                    }
                    columns={[
                        {
                            id: 'reference_name',
                            header: 'Jenis nomor',
                            cell: (row) => (
                                <DataTableText>
                                    {row.reference_name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.reference_name,
                        },
                        {
                            id: 'area_name',
                            header: 'Area',
                            cell: (row) => (
                                <DataTableText>{row.area_name}</DataTableText>
                            ),
                            sortValue: (row) => row.area_name,
                        },
                        {
                            id: 'scope',
                            header: 'Scope',
                            cell: (row) => (
                                <DataTableText>
                                    {scopeLabels[row.scope_type]}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'scope_value_name',
                            header: 'Berlaku untuk',
                            cell: (row) => (
                                <DataTableText>
                                    {[
                                        row.scope_value_name,
                                        row.fiscal_period_name,
                                    ]
                                        .filter(Boolean)
                                        .join(' · ') || 'Seluruh tenant'}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.scope_value_name ?? '',
                        },
                        {
                            id: 'format',
                            header: 'Format',
                            cell: (row) => (
                                <DataTableText>{row.format}</DataTableText>
                            ),
                        },
                        {
                            id: 'continuous',
                            header: 'Berkelanjutan',
                            cell: (row) => (
                                <DataTableText>
                                    {row.is_continuous ? 'Ya' : 'Tidak'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            cell: (row) => (
                                <Badge
                                    variant={
                                        row.status === 'active'
                                            ? 'default'
                                            : 'secondary'
                                    }
                                >
                                    {statusLabels[row.status]}
                                </Badge>
                            ),
                            sortValue: (row) => row.status,
                        },
                    ]}
                />
            </ListPageLayout>
            {(creating || search.sequence) && (
                <NumberSequenceCard
                    key={creating ? 'new' : `${search.sequence}:${revision}`}
                    sequenceId={creating ? null : (search.sequence ?? null)}
                    metadata={metadata}
                    onClose={() => {
                        setCreating(false);
                        open(undefined);
                    }}
                    onSaved={(saved) => {
                        list.reload();
                        setRevision((current) => current + 1);
                        if (creating) {
                            setCreating(false);
                            open(saved.id);
                        }
                    }}
                />
            )}
        </>
    );
}

export const page = definePage({
    path: '/settings/number-sequences',
    layout: 'app',
    title: 'Nomor dokumen',
    validateSearch: searchSchema,
    component: NumberSequencesPage,
});
