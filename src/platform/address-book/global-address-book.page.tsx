import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    NativeSelect,
    NativeSelectOption,
} from '@operations-metta/ui/native-select';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useRecordNavigation } from '@operations-metta/ui/use-record-navigation';
import { useRecordTransition } from '@operations-metta/ui/use-record-transition';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
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

const route = getRouteApi('/_app/settings/global-address-book');
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
                    Object.entries({ ...current, ...next }).filter(
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
                    <RecordActionBar title="Buku alamat">
                        {metadata.canManage && (
                            <ActionButton action="create" onClick={startNew} />
                        )}
                    </RecordActionBar>
                }
                filters={
                    <div className="flex flex-col gap-3 px-4 pb-3 sm:flex-row sm:flex-wrap">
                        <div className="w-full sm:w-64">
                            <Input
                                type="search"
                                label="Cari nama"
                                value={search.q ?? ''}
                                onChange={(event) =>
                                    setSearch({ q: event.target.value })
                                }
                            />
                        </div>
                        <div className="w-full sm:w-44">
                            <NativeSelect
                                label="Jenis pihak"
                                value={search.type ?? ''}
                                onChange={(event) =>
                                    setSearch({ type: event.target.value })
                                }
                            >
                                <NativeSelectOption value="">
                                    Semua jenis
                                </NativeSelectOption>
                                {metadata.partyTypes.map((type) => (
                                    <NativeSelectOption
                                        key={type.code}
                                        value={type.code}
                                    >
                                        {type.name}
                                    </NativeSelectOption>
                                ))}
                            </NativeSelect>
                        </div>
                        <div className="w-full sm:w-44">
                            <NativeSelect
                                label="Peran"
                                value={search.role ?? ''}
                                onChange={(event) =>
                                    setSearch({ role: event.target.value })
                                }
                            >
                                <NativeSelectOption value="">
                                    Semua peran
                                </NativeSelectOption>
                                {metadata.roles.map((role) => (
                                    <NativeSelectOption
                                        key={role.code}
                                        value={role.code}
                                    >
                                        {role.name}
                                    </NativeSelectOption>
                                ))}
                            </NativeSelect>
                        </div>
                        <div className="w-full sm:w-40">
                            <NativeSelect
                                label="Status"
                                value={search.status ?? ''}
                                onChange={(event) =>
                                    setSearch({
                                        status:
                                            event.target.value === ''
                                                ? undefined
                                                : (event.target.value as
                                                      'active' | 'inactive'),
                                    })
                                }
                            >
                                <NativeSelectOption value="">
                                    Semua status
                                </NativeSelectOption>
                                <NativeSelectOption value="active">
                                    Aktif
                                </NativeSelectOption>
                                <NativeSelectOption value="inactive">
                                    Nonaktif
                                </NativeSelectOption>
                            </NativeSelect>
                        </div>
                        <div className="w-full sm:w-44">
                            <NativeSelect
                                label="Tampilkan"
                                value={archived ? 'only' : ''}
                                onChange={(event) =>
                                    setSearch({
                                        archived:
                                            event.target.value === 'only'
                                                ? 'only'
                                                : undefined,
                                    })
                                }
                            >
                                <NativeSelectOption value="">
                                    Belum dihapus
                                </NativeSelectOption>
                                <NativeSelectOption value="only">
                                    Sudah dihapus
                                </NativeSelectOption>
                            </NativeSelect>
                        </div>
                        {failed && (
                            <p
                                role="alert"
                                className="w-full text-sm text-destructive"
                            >
                                {failed}
                            </p>
                        )}
                    </div>
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
    path: '/settings/global-address-book',
    layout: 'app',
    title: 'Buku alamat',
    validateSearch: searchSchema,
    component: GlobalAddressBookPage,
});
