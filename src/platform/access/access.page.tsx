import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import { PageDialog } from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useRecordTransition } from '@operations-metta/ui/use-record-transition';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { Suspense, useCallback, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage, orpc, type ApiBody } from '../shell/index.ts';
import { limitLabel, StaffAccessCard } from './staff-access-card.tsx';

// Daftar staf tenant beserta role yang dipegangnya di unit kerja mana, dipindah dari daftar anggota layar akses
// CoreERP. Undangan, pengguna baru, SSO, dan 2FA milik control plane dan tidak ada di layar ini.

const route = getRouteApi('/_app/sysadmin/access/staff');
// Pilihan "Semua" pada filter. Select SDK menganggap nilai kosong sebagai belum memilih, jadi pilihan ini butuh nilai
// sendiri.
const ALL = 'all';
const chosen = (value: string | null) =>
    value === null || value === ALL ? undefined : value;
type Member = ApiBody<'accessMemberList'>['data'][number];
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    role: z.string().max(100).optional(),
    organization: z.string().max(100).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    member: z.string().max(100).optional(),
});

function AccessPage(): ReactNode {
    const { data: page } = useSuspenseQuery(
        orpc.accessPage.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const transition = useRecordTransition(dirty, busy);
    const filterPanelId = useId();
    const { role, organization, status } = search;
    const roles = useMemo(
        () => new Map(page.roles.map((item) => [item.id, item])),
        [page.roles],
    );
    const organizations = useMemo(
        () => new Map(page.organizations.map((item) => [item.id, item])),
        [page.organizations],
    );
    const setSearch = (next: Partial<z.infer<typeof searchSchema>>) =>
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

    const loader = useCallback<ListLoader<Member>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.accessMemberList(
                {
                    query: {
                        q: query,
                        ...(role ? { role_id: role } : {}),
                        ...(organization
                            ? { organization_id: organization }
                            : {}),
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
        [role, organization, status],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (item) => item.id,
    });
    const summary = (member: Member) =>
        member.assignments
            .map((assignment) => {
                const limits = [
                    ...new Set(
                        [
                            ...Map.groupBy(
                                assignment.policy_scopes,
                                (scope) =>
                                    `${scope.legal_entity_id}|${scope.organization_id}|${scope.unrestricted}`,
                            ).values(),
                        ].map((scopes) =>
                            limitLabel(
                                scopes,
                                roles.get(assignment.role_id),
                                organizations,
                            ),
                        ),
                    ),
                ];
                return limits.length
                    ? `${assignment.role_name} (${limits.join('; ')})`
                    : assignment.role_name;
            })
            .join(', ') || '—';
    const open = (id: string | undefined) =>
        transition.request(() => {
            setDirty(false);
            setSearch({ member: id });
        });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Staf"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari staf',
                            placeholder: 'Cari nama atau email...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(role || organization || status),
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
                                            label="Role"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua role',
                                                },
                                                ...page.roles.map((item) => ({
                                                    value: item.id,
                                                    label: item.name,
                                                })),
                                            ]}
                                            value={role ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    role: chosen(value),
                                                })
                                            }
                                            searchPlaceholder="Cari role"
                                            emptyMessage="Role tidak ditemukan."
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <Select
                                            label="Perusahaan atau unit kerja"
                                            items={[
                                                { value: ALL, label: 'Semua' },
                                                ...page.organizations.map(
                                                    (item) => ({
                                                        value: item.id,
                                                        label: item.name,
                                                    }),
                                                ),
                                            ]}
                                            value={organization ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    organization: chosen(value),
                                                })
                                            }
                                            searchPlaceholder="Cari organisasi"
                                            emptyMessage="Organisasi tidak ditemukan."
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
                                            onValueChange={(value) => {
                                                const next = chosen(value);
                                                setSearch({
                                                    status:
                                                        next === 'active' ||
                                                        next === 'inactive'
                                                            ? next
                                                            : undefined,
                                                });
                                            }}
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
                        {list.items.length} staf dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(member) => member.id}
                    getRowLabel={(member) => member.name}
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, member) => open(member.id)}
                    activeRowKey={search.member}
                    onRowClick={(member) => open(member.id)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage="Belum ada staf yang cocok."
                    columns={[
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 220,
                            cell: (member) => (
                                <DataTableText>{member.name}</DataTableText>
                            ),
                            sortValue: (member) => member.name,
                        },
                        {
                            id: 'email',
                            header: 'Email',
                            width: 240,
                            cell: (member) => (
                                <DataTableText>{member.email}</DataTableText>
                            ),
                            sortValue: (member) => member.email,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (member) => (
                                <Badge
                                    variant={
                                        member.status === 'active'
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {member.status === 'active'
                                        ? 'Aktif'
                                        : 'Nonaktif'}
                                </Badge>
                            ),
                        },
                        {
                            id: 'roles',
                            header: 'Role dan unit kerja',
                            width: 480,
                            cell: (member) => (
                                <DataTableText>{summary(member)}</DataTableText>
                            ),
                        },
                    ]}
                />
            </ListPageLayout>
            {search.member && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) open(undefined);
                    }}
                >
                    <Suspense fallback={null}>
                        <StaffAccessCard
                            key={search.member}
                            memberId={search.member}
                            page={page}
                            busy={busy}
                            onBusyChange={setBusy}
                            onDirtyChange={setDirty}
                            onSaved={list.reload}
                        />
                    </Suspense>
                </PageDialog>
            )}
            {transition.confirmation}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/access/staff',
    previousPaths: ['/settings/access'],
    layout: 'app',
    title: 'Staf',
    validateSearch: searchSchema,
    component: AccessPage,
});
