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
import { SessionCard, type Session } from './practice-session-card.tsx';

// Sesi praktik: rentang jam yang dipakai template dan jadwal, misalnya Pagi 08:00-12:00 atau Malam 20:00-08:00.

const route = getRouteApi('/_app/healthcare/service/practice-sessions');
const ALL = 'all';
type Search = z.infer<typeof searchSchema>;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    status: z.enum(['active', 'inactive']).optional(),
});

const hours = (session: Session) =>
    `${session.start_time}–${session.end_time}${session.crosses_midnight ? ' (besok)' : ''}`;

function PracticeSessionsPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcarePracticeScheduleMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const { permissions } = metadata;
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Session | 'new' | null>(null);
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
    const loader = useCallback<ListLoader<Session>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcarePracticeSessionList(
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
        getKey: (session) => session.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Sesi praktik"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari sesi',
                            placeholder: 'Cari nama sesi...',
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
                        {list.items.length} sesi dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(session) => session.id}
                    getRowLabel={(session) => session.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, session) => setOpen(session)}
                    onRowClick={(session) => setOpen(session)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        permissions.create
                            ? 'Belum ada sesi yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada sesi yang cocok.'
                    }
                    columns={[
                        {
                            id: 'name',
                            header: 'Sesi',
                            width: 200,
                            cell: (session) => (
                                <DataTableText>{session.name}</DataTableText>
                            ),
                            sortValue: (session) => session.name,
                        },
                        {
                            id: 'start_time',
                            header: 'Jam',
                            width: 180,
                            cell: (session) => (
                                <DataTableText>{hours(session)}</DataTableText>
                            ),
                            sortValue: (session) => session.start_time,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (session) => (
                                <Badge
                                    variant={
                                        session.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {session.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent title="Sesi praktik">
                        <SessionCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            session={open === 'new' ? null : open}
                            permissions={permissions}
                            onSaved={(session) => {
                                setOpen(session);
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
    path: '/healthcare/service/practice-sessions',
    layout: 'app',
    title: 'Sesi praktik',
    validateSearch: searchSchema,
    component: PracticeSessionsPage,
});
