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
import { useRecordNavigation } from '@operations-metta/ui/use-record-navigation';
import { useRecordTransition } from '@operations-metta/ui/use-record-transition';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { api, definePage, errorText, orpc } from '../shell/index.ts';
import { PartyCard, type PartyRow } from './party-card.tsx';
import {
    PartyDuplicatesDialog,
    type DuplicateCandidate,
} from './party-duplicates.tsx';

// Buku alamat global, dipindah dari pages/platform/address-book CoreERP: daftar party yang boleh dilihat pengguna,
// kartu party, dan party baru. Kelompok buku alamat, akun vendor, dan nomor party tidak ditampilkan karena belum ada
// di API.

const route = getRouteApi('/_app/sysadmin/address-book/parties');
// Pilihan "Semua" pada filter. Select SDK menganggap nilai kosong sebagai belum memilih, jadi pilihan ini butuh nilai
// sendiri.
const ALL = 'all';
const chosen = (value: string | null) =>
    value === null || value === ALL ? undefined : value;
type Search = z.infer<typeof searchSchema>;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    type: z.string().max(40).optional(),
    role: z.string().max(40).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    archived: z.literal('only').optional(),
    party: z.string().max(100).optional(),
});

function GlobalAddressBookPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.partyMetadata.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const queryClient = useQueryClient();
    const contentRef = useRef<HTMLDivElement>(null);
    const [creating, setCreating] = useState(false);
    const [createKey, setCreateKey] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [duplicates, setDuplicates] = useState<{
        party: PartyRow;
        candidates: DuplicateCandidate[];
    } | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const transition = useRecordTransition(dirty, busy);
    const archived = search.archived === 'only';
    const { type, role, status } = search;
    const filterKey = JSON.stringify([type, role, status, archived]);

    const loader = useCallback<ListLoader<PartyRow>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.partyList(
                {
                    query: {
                        ...(type ? { type } : {}),
                        ...(role ? { role } : {}),
                        ...(status ? { status } : {}),
                        ...(archived ? { archived: 'only' as const } : {}),
                        q: query,
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
        [type, role, status, archived],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (party) => party.id,
    });
    const setSearch = (next: Partial<Search>, replace = true) =>
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
            replace,
        });
    const openParty = (id: string) => setSearch({ party: id }, false);
    const closeParty = () => setSearch({ party: undefined }, false);
    const startNew = () =>
        transition.request(() => {
            setSearch({ party: undefined });
            setCreateKey((key) => key + 1);
            setCreating(true);
        });
    const navigation = useRecordNavigation({
        items: list.items,
        currentId: search.party ?? null,
        getId: (party) => party.id,
        onNavigate: (id) => transition.request(() => openParty(id)),
        scopeKey: `${filterKey}:${search.q ?? ''}`,
        disabled: busy || dirty,
        hasMore: list.hasMore,
        loading: list.loading,
        loadMore: list.loadMore,
    });
    const roleName = (code: string) =>
        metadata.roles.find((role) => role.code === code)?.name ?? code;
    const typeName = (code: string) =>
        metadata.partyTypes.find((type) => type.code === code)?.name ?? code;

    const restore = async (party: PartyRow) => {
        setFailed(null);
        try {
            await api.partyRestore({
                params: { id: party.id },
                body: { version: party.version },
            });
            toast.success('Pihak dipulihkan.');
            list.reload();
        } catch (caught) {
            setFailed(errorText(caught, 'Pihak belum dipulihkan.'));
        }
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Buku alamat"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari pihak',
                            placeholder: 'Cari nama...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(type || role || status || archived),
                            controls: filterPanelId,
                        }}
                    >
                        {metadata.canManage && (
                            <ActionButton action="create" onClick={startNew} />
                        )}
                    </RecordActionBar>
                }
                filters={
                    failed && (
                        <p
                            role="alert"
                            className="px-4 pb-3 text-sm text-destructive"
                        >
                            {failed}
                        </p>
                    )
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
                                            label="Jenis pihak"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua jenis',
                                                },
                                                ...metadata.partyTypes.map(
                                                    (type) => ({
                                                        value: type.code,
                                                        label: type.name,
                                                    }),
                                                ),
                                            ]}
                                            value={search.type ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    type: chosen(value),
                                                })
                                            }
                                            searchPlaceholder="Cari jenis"
                                            emptyMessage="Jenis tidak ditemukan."
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <Select
                                            label="Peran"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua peran',
                                                },
                                                ...metadata.roles.map(
                                                    (role) => ({
                                                        value: role.code,
                                                        label: role.name,
                                                    }),
                                                ),
                                            ]}
                                            value={search.role ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    role: chosen(value),
                                                })
                                            }
                                            searchPlaceholder="Cari peran"
                                            emptyMessage="Peran tidak ditemukan."
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
                                            value={search.status ?? ALL}
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
                                    <FormControl>
                                        <Select
                                            label="Tampilkan"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Belum dihapus',
                                                },
                                                {
                                                    value: 'only',
                                                    label: 'Sudah dihapus',
                                                },
                                            ]}
                                            value={archived ? 'only' : ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    archived:
                                                        value === 'only'
                                                            ? 'only'
                                                            : undefined,
                                                })
                                            }
                                            searchPlaceholder="Cari pilihan"
                                            emptyMessage="Pilihan tidak ditemukan."
                                        />
                                    </FormControl>
                                </FormGrid>
                            </div>
                        </FilterPane>
                    ) : null
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} pihak dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(party) => party.id}
                    getRowLabel={(party) => party.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={
                        archived
                            ? metadata.canManage
                                ? [{ id: 'restore', label: 'Pulihkan' }]
                                : []
                            : [{ id: 'open', label: 'Buka' }]
                    }
                    onRowAction={(action, party) =>
                        action === 'restore'
                            ? void restore(party)
                            : openParty(party.id)
                    }
                    activeRowKey={search.party}
                    onRowClick={(party) => !archived && openParty(party.id)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        metadata.canManage
                            ? 'Belum ada pihak yang cocok. Pilih Baru atau ubah saringan.'
                            : 'Belum ada pihak yang cocok.'
                    }
                    columns={[
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 260,
                            cell: (party) => (
                                <DataTableText>{party.name}</DataTableText>
                            ),
                            sortValue: (party) => party.name,
                        },
                        {
                            id: 'type',
                            header: 'Jenis',
                            width: 140,
                            cell: (party) => (
                                <DataTableText>
                                    {typeName(party.type)}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'city',
                            header: 'Kota',
                            width: 180,
                            cell: (party) => (
                                <DataTableText>
                                    {party.city ?? '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'roles',
                            header: 'Peran',
                            width: 220,
                            cell: (party) => (
                                <DataTableText>
                                    {[
                                        ...new Set(
                                            party.roles.map((role) =>
                                                roleName(role.code),
                                            ),
                                        ),
                                    ].join(', ') || '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 120,
                            cell: (party) => (
                                <Badge
                                    variant={
                                        !party.deleted_at &&
                                        party.status === 'active'
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {party.deleted_at
                                        ? 'Dihapus'
                                        : party.status === 'active'
                                          ? 'Aktif'
                                          : 'Nonaktif'}
                                </Badge>
                            ),
                        },
                    ]}
                />
            </ListPageLayout>
            {(creating || search.party) && (
                <PageDialog
                    open
                    onOpenChange={(open) => {
                        if (!open && !busy)
                            transition.request(() => {
                                setCreating(false);
                                closeParty();
                            });
                    }}
                >
                    <PageDialogContent
                        ref={contentRef}
                        title="Buku alamat"
                        busy={busy}
                        onNew={metadata.canManage ? startNew : undefined}
                        navigation={creating ? undefined : navigation}
                        onEscapeKeyDown={(event) => {
                            if (
                                busy ||
                                contentRef.current?.querySelector(
                                    '[role="combobox"][aria-expanded="true"]',
                                )
                            )
                                event.preventDefault();
                        }}
                    >
                        <PartyCard
                            key={creating ? `new-${createKey}` : search.party}
                            partyId={creating ? null : (search.party ?? null)}
                            metadata={metadata}
                            portalContainer={contentRef}
                            onBusyChange={setBusy}
                            onDirtyChange={setDirty}
                            onCancelNew={() =>
                                transition.request(() => setCreating(false))
                            }
                            onCreated={(party, candidates) => {
                                setCreating(false);
                                setDirty(false);
                                list.reload();
                                openParty(party.id);
                                if (candidates.length)
                                    setDuplicates({ party, candidates });
                            }}
                            onUpdated={() => list.reload()}
                            onDeleted={() => {
                                list.reload();
                                closeParty();
                            }}
                            onOpenParty={(id) =>
                                transition.request(() => {
                                    void queryClient.invalidateQueries({
                                        queryKey: ['party', id],
                                    });
                                    openParty(id);
                                })
                            }
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
            {duplicates && (
                <PartyDuplicatesDialog
                    partyId={duplicates.party.id}
                    partyName={duplicates.party.name}
                    candidates={duplicates.candidates}
                    canManage={metadata.canManage}
                    onOpen={openParty}
                    onClose={() => {
                        setDuplicates(null);
                        void queryClient.invalidateQueries({
                            queryKey: ['party-duplicates'],
                        });
                    }}
                />
            )}
            {transition.confirmation}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/address-book/parties',
    previousPaths: ['/settings/global-address-book'],
    layout: 'app',
    title: 'Buku alamat',
    validateSearch: searchSchema,
    component: GlobalAddressBookPage,
});
