import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
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
import { useRecordNavigation } from '@operations-metta/ui/use-record-navigation';
import { useRecordTransition } from '@operations-metta/ui/use-record-transition';
import { getRouteApi } from '@tanstack/react-router';
import { FilterX } from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    api,
    definePage,
    useUnsavedChangesGuard,
} from '../../../platform/shell/index.ts';
import { AdjustmentCard } from './adjustment-card.tsx';
import {
    directionLabels,
    isDirection,
    isStatus,
    StatusBadge,
    statusLabels,
    type AdjustmentPermissions,
    type AdjustmentRow,
    type Direction,
    type Status,
} from './adjustment-labels.tsx';

// Daftar penyesuaian stok legal entity yang aktif. Dokumen dibuka lewat `?document=<id>`, supaya layar lain, misalnya
// kartu stok, bisa menautkan dokumennya langsung.

const route = getRouteApi('/_app/sysadmin/inventory/adjustments');
const ALL = 'all';
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    status: z.custom<Status>(isStatus).optional(),
    direction: z.custom<Direction>(isDirection).optional(),
    document: z.string().max(100).optional(),
});
type Search = z.infer<typeof searchSchema>;

const noPermissions: AdjustmentPermissions = {
    update: false,
    post: false,
    reverse: false,
};

function AdjustmentsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [permissions, setPermissions] = useState(noPermissions);
    const [creating, setCreating] = useState(false);
    const [createKey, setCreateKey] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const transition = useRecordTransition(dirty, busy);
    const leaveGuard = useUnsavedChangesGuard(dirty, () => setCreating(false));
    const { status, direction } = search;
    const loader = useCallback<ListLoader<AdjustmentRow>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.inventoryAdjustmentList(
                {
                    query: {
                        q: query,
                        ...(status ? { status } : {}),
                        ...(direction ? { stock_direction: direction } : {}),
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            setPermissions(body.permissions);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [status, direction],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (adjustment) => adjustment.id,
    });
    // Perubahan yang belum disimpan sudah dikonfirmasi lewat transition sebelum alamat berubah.
    const setSearch = (next: Partial<Search>, replace = true) =>
        navigate({
            search: (current) =>
                Object.fromEntries(
                    Object.entries<string | undefined>({
                        ...current,
                        ...next,
                    }).filter(
                        ([, value]) => value !== undefined && value !== '',
                    ),
                ),
            replace,
            ignoreBlocker: true,
        });
    const openDocument = (id: string) =>
        void setSearch({ document: id }, false);
    const closeCard = () => {
        setCreating(false);
        void setSearch({ document: undefined }, false);
    };
    const startNew = () =>
        transition.request(() => {
            void setSearch({ document: undefined });
            setCreateKey((key) => key + 1);
            setCreating(true);
        });
    const navigation = useRecordNavigation({
        items: list.items,
        currentId: search.document ?? null,
        getId: (adjustment) => adjustment.id,
        onNavigate: (id) => transition.request(() => openDocument(id)),
        scopeKey: JSON.stringify([status, direction, search.q]),
        disabled: busy || dirty,
        hasMore: list.hasMore,
        loading: list.loading,
        loadMore: list.loadMore,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Penyesuaian stok"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => void setSearch({ q }),
                            label: 'Cari penyesuaian stok',
                            placeholder:
                                'Cari nomor, kode lokasi, atau kode alasan...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(status || direction),
                            controls: filterPanelId,
                        }}
                    >
                        {permissions.update && (
                            <ActionButton action="create" onClick={startNew} />
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
                                                ...Object.entries(
                                                    statusLabels,
                                                ).map(([value, label]) => ({
                                                    value,
                                                    label,
                                                })),
                                            ]}
                                            value={status ?? ALL}
                                            onValueChange={(value) =>
                                                void setSearch({
                                                    status: isStatus(value)
                                                        ? value
                                                        : undefined,
                                                })
                                            }
                                            searchPlaceholder="Cari status"
                                            emptyMessage="Pilihan tidak ditemukan."
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <Select
                                            label="Arah"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua arah',
                                                },
                                                ...Object.entries(
                                                    directionLabels,
                                                ).map(([value, label]) => ({
                                                    value,
                                                    label,
                                                })),
                                            ]}
                                            value={direction ?? ALL}
                                            onValueChange={(value) =>
                                                void setSearch({
                                                    direction: isDirection(
                                                        value,
                                                    )
                                                        ? value
                                                        : undefined,
                                                })
                                            }
                                            searchPlaceholder="Cari arah"
                                            emptyMessage="Pilihan tidak ditemukan."
                                        />
                                    </FormControl>
                                    {(status || direction) && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="command"
                                            className="justify-self-start"
                                            onClick={() =>
                                                void setSearch({
                                                    status: undefined,
                                                    direction: undefined,
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
                        {list.items.length} dokumen dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(adjustment) => adjustment.id}
                    getRowLabel={(adjustment) => adjustment.number}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, adjustment) => openDocument(adjustment.id)}
                    activeRowKey={search.document}
                    onRowClick={(adjustment) => openDocument(adjustment.id)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        permissions.update
                            ? 'Belum ada penyesuaian stok yang cocok. Pilih Baru untuk membuat.'
                            : 'Belum ada penyesuaian stok yang cocok.'
                    }
                    columns={[
                        {
                            id: 'number',
                            header: 'Nomor',
                            width: 170,
                            cell: (adjustment) => (
                                <DataTableText>
                                    {adjustment.number}
                                </DataTableText>
                            ),
                            sortValue: (adjustment) => adjustment.number,
                        },
                        {
                            id: 'posting_date',
                            header: 'Tanggal',
                            width: 120,
                            cell: (adjustment) => (
                                <DataTableText>
                                    {displayDate(adjustment.posting_date)}
                                </DataTableText>
                            ),
                            sortValue: (adjustment) => adjustment.posting_date,
                        },
                        {
                            id: 'direction',
                            header: 'Arah',
                            width: 120,
                            cell: (adjustment) => (
                                <DataTableText>
                                    {directionLabels[adjustment.direction]}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'location',
                            header: 'Lokasi',
                            width: 220,
                            cell: (adjustment) => (
                                <DataTableText>
                                    {`${adjustment.location.code} · ${adjustment.location.name}`}
                                </DataTableText>
                            ),
                            sortValue: (adjustment) => adjustment.location.code,
                        },
                        {
                            id: 'reason',
                            header: 'Alasan',
                            width: 200,
                            cell: (adjustment) => (
                                <DataTableText>
                                    {adjustment.reason.name}
                                </DataTableText>
                            ),
                            sortValue: (adjustment) => adjustment.reason.code,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 120,
                            cell: (adjustment) => (
                                <StatusBadge status={adjustment.status} />
                            ),
                            sortValue: (adjustment) => adjustment.status,
                        },
                    ]}
                />
            </ListPageLayout>
            {(creating || search.document) && (
                <PageDialog
                    open
                    onOpenChange={(open) => {
                        if (!open) transition.request(closeCard);
                    }}
                >
                    <PageDialogContent
                        ref={contentRef}
                        title="Penyesuaian stok"
                        busy={busy}
                        onNew={permissions.update ? startNew : undefined}
                        navigation={creating ? undefined : navigation}
                    >
                        <AdjustmentCard
                            key={
                                creating
                                    ? `new-${createKey}`
                                    : (search.document ?? '')
                            }
                            documentId={
                                creating ? null : (search.document ?? null)
                            }
                            permissions={permissions}
                            portalContainer={contentRef}
                            onSaved={(saved) => {
                                list.reload();
                                if (creating)
                                    void setSearch(
                                        { document: saved.id },
                                        false,
                                    ).then(() => setCreating(false));
                            }}
                            onCancelNew={() =>
                                transition.request(() => setCreating(false))
                            }
                            onDeleted={() => {
                                list.reload();
                                closeCard();
                            }}
                            onBusyChange={setBusy}
                            onDirtyChange={setDirty}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
            {transition.confirmation}
            {leaveGuard}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/adjustments',
    layout: 'app',
    title: 'Penyesuaian stok',
    validateSearch: searchSchema,
    component: AdjustmentsPage,
});
