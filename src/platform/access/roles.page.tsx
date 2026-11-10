import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    definePage,
    errorText,
    orpc,
    type ApiBody,
} from '../shell/index.ts';

// Daftar role tenant, sesederhana daftar permission set Business Central: nama, jumlah staf yang memegangnya, dan
// penanda role Pemilik. Kartu role menampilkan staf pemegangnya. Duty dan privilege hanya tampil di layar Susun role.

const route = getRouteApi('/_app/settings/roles');
type Role = ApiBody<'roleList'>['data'][number];
type Member = ApiBody<'accessMemberList'>['data'][number];

function RoleMembers({ role }: { role: Role }): ReactNode {
    const loader = useCallback<ListLoader<Member>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.accessMemberList(
                {
                    query: {
                        q: query,
                        role_id: role.id,
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [role.id],
    );
    const list = useIncrementalList({
        loadItems: loader,
        getKey: (item) => item.id,
    });
    return (
        <DataTable
            data={list.items}
            getRowKey={(member) => member.id}
            scrollMode="inline"
            incremental={list}
            emptyMessage="Belum ada staf yang memegang role ini."
            columns={[
                {
                    id: 'name',
                    header: 'Nama',
                    width: 220,
                    cell: (member) => (
                        <DataTableText>{member.name}</DataTableText>
                    ),
                },
                {
                    id: 'email',
                    header: 'Email',
                    width: 260,
                    cell: (member) => (
                        <DataTableText>{member.email}</DataTableText>
                    ),
                },
            ]}
        />
    );
}

function RolesPage(): ReactNode {
    const { data: page } = useSuspenseQuery(
        orpc.accessPage.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    const search = route.useSearch();
    const navigate = useNavigate();
    const [selected, setSelected] = useState<Role | null>(null);
    const [busy, setBusy] = useState(false);
    const { confirm, confirmation } = useConfirmation();
    const loader = useCallback<ListLoader<Role>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.roleList(
                {
                    query: {
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
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (item) => item.id,
    });
    const compose = (role: string) =>
        void navigate({
            to: '/settings/security-configuration',
            search: { role },
        });

    const remove = async (role: Role) => {
        const confirmed = await confirm({
            title: `Delete ${role.name}?`,
            description:
                role.member_count > 0
                    ? `${role.member_count} staf kehilangan hak dari role ini seketika. Role tidak lagi ditawarkan.`
                    : 'Role ini tidak lagi ditawarkan saat memberi akses staf.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!confirmed) return;
        setBusy(true);
        try {
            await api.roleDelete({
                params: { id: role.id },
                body: { version: role.version },
            });
            toast.success('Role dihapus.');
            setSelected(null);
            list.reload();
        } catch (caught) {
            toast.error(errorText(caught, 'Role belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Role"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    to: '/settings/roles',
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari role',
                            placeholder: 'Cari nama...',
                        }}
                    >
                        {page.canManage && (
                            <ActionButton
                                action="create"
                                onClick={() => compose('new')}
                            />
                        )}
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} role dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(role) => role.id}
                    getRowLabel={(role) => role.name}
                    actionsPlacement="inline"
                    actions={[
                        { id: 'open', label: 'Buka' },
                        { id: 'compose', label: 'Susun role' },
                        { id: 'delete', label: 'Delete', destructive: true },
                    ]}
                    getRowActions={(role) => [
                        { id: 'open', label: 'Buka' },
                        ...(page.canManage && !role.is_owner
                            ? [
                                  { id: 'compose', label: 'Susun role' },
                                  {
                                      id: 'delete',
                                      label: 'Delete',
                                      destructive: true,
                                  },
                              ]
                            : []),
                    ]}
                    onRowAction={(action, role) => {
                        if (action === 'compose') compose(role.id);
                        else if (action === 'delete') void remove(role);
                        else setSelected(role);
                    }}
                    activeRowKey={selected?.id}
                    onRowClick={setSelected}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        page.canManage
                            ? 'Belum ada role yang cocok. Pilih Baru untuk menyusun role.'
                            : 'Belum ada role yang cocok.'
                    }
                    columns={[
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 260,
                            cell: (role) => (
                                <DataTableText>{role.name}</DataTableText>
                            ),
                            sortValue: (role) => role.name,
                        },
                        {
                            id: 'member_count',
                            header: 'Staf',
                            width: 100,
                            cell: (role) => (
                                <DataTableText>
                                    {role.member_count}
                                </DataTableText>
                            ),
                            sortValue: (role) => role.member_count,
                        },
                        {
                            id: 'kind',
                            header: 'Keterangan',
                            width: 220,
                            cell: (role) =>
                                role.is_owner ? (
                                    <Badge variant="secondary">
                                        Pemilik, memegang semua hak
                                    </Badge>
                                ) : (
                                    <DataTableText>—</DataTableText>
                                ),
                        },
                    ]}
                />
            </ListPageLayout>
            {selected && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next && !busy) setSelected(null);
                    }}
                >
                    <PageDialogContent
                        title="Role"
                        recordTitle={selected.name}
                        busy={busy}
                        onEdit={
                            page.canManage && !selected.is_owner
                                ? () => compose(selected.id)
                                : undefined
                        }
                        onDelete={
                            page.canManage && !selected.is_owner
                                ? () => void remove(selected)
                                : undefined
                        }
                    >
                        <PageDialogBody className="py-3">
                            <h3 className="mb-2 text-sm font-semibold">
                                Staf pemegang role
                            </h3>
                            <RoleMembers role={selected} />
                        </PageDialogBody>
                    </PageDialogContent>
                </PageDialog>
            )}
            {confirmation}
        </>
    );
}

export const page = definePage({
    path: '/settings/roles',
    layout: 'app',
    title: 'Role',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: RolesPage,
});
