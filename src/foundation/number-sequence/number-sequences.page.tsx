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
import { Eraser, ListChecks } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import type { Key, ReactNode } from 'react';
import { z } from 'zod';
import {
    api,
    definePage,
    orpc,
    type ApiBody,
} from '../../platform/shell/index.ts';
import {
    appliesTo,
    NumberSequenceCard,
    scopeLabels,
    statusLabels,
} from './number-sequence-card.tsx';
import {
    StatusListDialog,
    useCleanup,
} from './number-sequence-status-list.tsx';

// Nomor dokumen, layar Number sequences F&O: setiap baris satu pengaturan nomor untuk satu jenis nomor (reference)
// dan satu nilai scope, dengan kolom Smallest, Largest, Next, dan Format seperti daftar F&O. Saringan Area dan
// Reference di panel kiri (aturan layar repo ini), dan Status list serta Manual cleanup di grup Administrasi toolbar.

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
    const [selected, setSelected] = useState<Key[]>([]);
    const [statusFor, setStatusFor] = useState<{
        id: string;
        title: string;
    } | null>(null);
    const { cleanup, busy: cleaning, confirmation } = useCleanup();
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
    const title = (row: {
        reference_name: string;
        scope_value_name: string | null;
        fiscal_period_name: string | null;
    }) => `${row.reference_name} · ${appliesTo(row)}`;
    const selectedRows = list.items.filter((row) => selected.includes(row.id));
    const [onlySelected] = selectedRows;
    const cleanupRows = async (ids: string[]) => {
        if (await cleanup(ids)) list.reload();
    };

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
                        groups={[
                            {
                                id: 'administration',
                                label: 'Administrasi',
                                actions: [
                                    {
                                        id: 'status-list',
                                        label: 'Status list',
                                        icon: <ListChecks aria-hidden="true" />,
                                        disabled: selectedRows.length !== 1,
                                        title: 'Pilih satu pengaturan nomor untuk melihat nomor yang sedang dipesan.',
                                        onSelect: () => {
                                            if (onlySelected)
                                                setStatusFor({
                                                    id: onlySelected.id,
                                                    title: title(onlySelected),
                                                });
                                        },
                                    },
                                    ...(metadata.canManage
                                        ? [
                                              {
                                                  id: 'cleanup',
                                                  label: 'Bersihkan manual',
                                                  icon: (
                                                      <Eraser aria-hidden="true" />
                                                  ),
                                                  disabled:
                                                      cleaning ||
                                                      selectedRows.length === 0,
                                                  title: 'Pilih pengaturan nomor yang nomor lewat batas waktunya akan dikembalikan.',
                                                  onSelect: () =>
                                                      void cleanupRows(
                                                          selectedRows.map(
                                                              (row) => row.id,
                                                          ),
                                                      ),
                                              },
                                          ]
                                        : []),
                                ],
                            },
                        ]}
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
                    getRowLabel={title}
                    actionsPlacement="inline"
                    selection={{
                        selectedKeys: selected,
                        onSelectedKeysChange: setSelected,
                    }}
                    actions={[
                        { id: 'open', label: 'Buka' },
                        { id: 'status-list', label: 'Status list' },
                        ...(metadata.canManage
                            ? [{ id: 'cleanup', label: 'Bersihkan manual' }]
                            : []),
                    ]}
                    onRowAction={(action, row) => {
                        if (action === 'status-list')
                            setStatusFor({ id: row.id, title: title(row) });
                        else if (action === 'cleanup')
                            void cleanupRows([row.id]);
                        else open(row.id);
                    }}
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
                            width: 180,
                            header: 'Jenis nomor',
                            cell: (row) => (
                                <DataTableText>
                                    {row.reference_name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.reference_name,
                        },
                        {
                            id: 'scope_value_name',
                            width: 200,
                            header: 'Berlaku untuk',
                            cell: (row) => (
                                <DataTableText>{appliesTo(row)}</DataTableText>
                            ),
                            sortValue: (row) => row.scope_value_name ?? '',
                        },
                        {
                            id: 'format',
                            width: 170,
                            header: 'Format',
                            cell: (row) => (
                                <DataTableText>{row.format}</DataTableText>
                            ),
                        },
                        {
                            id: 'minimum_number',
                            width: 100,
                            header: 'Terkecil',
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>
                                    {row.minimum_number}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.minimum_number,
                        },
                        {
                            id: 'maximum_number',
                            width: 110,
                            header: 'Terbesar',
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>
                                    {row.maximum_number ?? 'Tanpa batas'}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.maximum_number ?? 0,
                        },
                        {
                            id: 'next_number',
                            width: 110,
                            header: 'Berikutnya',
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>{row.next_number}</DataTableText>
                            ),
                            sortValue: (row) => row.next_number,
                        },
                        {
                            id: 'scope',
                            width: 160,
                            header: 'Scope',
                            cell: (row) => (
                                <DataTableText>
                                    {scopeLabels[row.scope_type]}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'area_name',
                            width: 150,
                            header: 'Area',
                            cell: (row) => (
                                <DataTableText>{row.area_name}</DataTableText>
                            ),
                            sortValue: (row) => row.area_name,
                        },
                        {
                            id: 'status',
                            width: 120,
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
                    onOpenSequence={(id) => {
                        setCreating(false);
                        open(id);
                    }}
                    onStatusList={(stored) =>
                        setStatusFor({ id: stored.id, title: title(stored) })
                    }
                    onCleanup={(stored) => void cleanupRows([stored.id])}
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
            {statusFor && (
                <StatusListDialog
                    key={statusFor.id}
                    sequenceId={statusFor.id}
                    title={statusFor.title}
                    canManage={metadata.canManage}
                    onClose={() => setStatusFor(null)}
                />
            )}
            {confirmation}
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
