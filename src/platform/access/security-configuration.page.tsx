import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from '@operations-metta/ui/empty';
import { FieldDescription } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import { MasterDetailLayout } from '@operations-metta/ui/master-detail-layout';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { RecordEditBoundary } from '@operations-metta/ui/record-edit-boundary';
import { TransferList } from '@operations-metta/ui/transfer-list';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import {
    useQuery,
    useQueryClient,
    useSuspenseQuery,
} from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiBody,
} from '../shell/index.ts';

// Layar lanjutan untuk menyusun role sendiri dari tanggung jawab (duty), dipindah dari layar konfigurasi keamanan
// CoreERP. Rincian tugas akses (privilege) dan izin setiap tanggung jawab tampil hanya baca. Menyusun tanggung jawab
// dan tugas akses buatan tenant sendiri belum dipindah.

const route = getRouteApi('/_app/sysadmin/access/security-configuration');
type Catalog = ApiBody<'securityConfiguration'>['data'];
type RoleRow = ApiBody<'roleList'>['data'][number];
type Role = ApiBody<'roleShow'>['data'];
type Errors = Record<string, string[]>;

function RoleComposer({
    catalog,
    role,
    onSaved,
    onDeleted,
    onCancelNew,
}: {
    catalog: Catalog;
    role: Role | null;
    onSaved: (role: Role) => void;
    onDeleted: () => void;
    onCancelNew: () => void;
}): ReactNode {
    const creating = role === null;
    const canEdit = catalog.canManage && !role?.is_owner;
    const [editing, setEditing] = useState(creating);
    const [name, setName] = useState(role?.name ?? '');
    const [duties, setDuties] = useState<string[]>(role?.duty_codes ?? []);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const apps = useMemo(
        () => new Map(catalog.apps.map((app) => [app.id, app.name])),
        [catalog.apps],
    );
    const privileges = useMemo(
        () => new Map(catalog.privileges.map((item) => [item.code, item])),
        [catalog.privileges],
    );
    const permissions = useMemo(
        () => new Map(catalog.permissions.map((item) => [item.code, item])),
        [catalog.permissions],
    );
    const item = (duty: Catalog['duties'][number]) => ({
        id: duty.code,
        label: duty.name,
        description: duty.app_id ? apps.get(duty.app_id) : undefined,
    });
    const chosen = new Set(duties);
    const details = catalog.duties
        .filter((duty) => chosen.has(duty.code))
        .flatMap((duty) =>
            duty.privilege_codes.map((code) => ({
                key: `${duty.code}:${code}`,
                duty: duty.name,
                privilege: privileges.get(code)?.name ?? code,
                permissions: (privileges.get(code)?.permission_codes ?? [])
                    .map((permission) => permissions.get(permission)?.name)
                    .filter(Boolean)
                    .join(', '),
            })),
        );
    const formId = `role-${role?.id ?? 'new'}`;

    const cancel = () => {
        if (creating) {
            onCancelNew();
            return;
        }
        setName(role.name);
        setDuties(role.duty_codes);
        setErrors({});
        setMessage(null);
        setEditing(false);
    };

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        // Role turunan tidak disusun dari layar ini; susunannya dikirim lagi apa adanya supaya tidak terhapus.
        const body = {
            name,
            duty_codes: duties,
            child_role_ids: role?.child_roles.map((child) => child.id) ?? [],
        };
        try {
            const { body: saved } = creating
                ? await api.roleCreate({ body })
                : await api.roleUpdate({
                      params: { id: role.id },
                      body: { ...body, version: role.version },
                  });
            toast.success('Role disimpan.');
            setEditing(false);
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Role belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!role) return;
        const confirmed = await confirm({
            title: `Delete ${role.name}?`,
            description:
                'Staf yang memegang role ini kehilangan haknya seketika, dan role tidak lagi ditawarkan.',
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
            onDeleted();
        } catch (caught) {
            setMessage(errorText(caught, 'Role belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <RecordEditBoundary
            editing={editing}
            canEdit={canEdit}
            disabled={busy}
            onEdit={() => setEditing(true)}
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-card text-foreground"
        >
            <RecordActionBar title={role?.name ?? 'Role baru'}>
                {canEdit &&
                    (!editing ? (
                        <>
                            <ActionButton
                                action="edit"
                                onClick={() => setEditing(true)}
                            />
                            <ActionButton
                                action="delete"
                                disabled={busy}
                                onClick={() => void remove()}
                            />
                        </>
                    ) : (
                        <>
                            <ActionButton
                                action="save"
                                type="submit"
                                form={formId}
                                disabled={busy}
                                pending={busy}
                            />
                            <ActionButton
                                action="cancel"
                                disabled={busy}
                                onClick={cancel}
                            />
                        </>
                    ))}
            </RecordActionBar>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <form
                    noValidate
                    id={formId}
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Role belum disimpan"
                    />
                    {role?.is_owner && (
                        <FieldDescription className="mb-4">
                            Role Pemilik diatur otomatis dan selalu memegang
                            semua tanggung jawab, jadi tidak dapat diubah.
                        </FieldDescription>
                    )}
                    <FormGrid columns={1}>
                        <FormControl error={errors.name?.[0]}>
                            <Input
                                label="Nama role"
                                required
                                maxLength={100}
                                data-error-field="name"
                                value={name}
                                readOnly={!editing}
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                            />
                        </FormControl>
                    </FormGrid>
                    <div className="mt-4" data-error-field="duty_codes">
                        <TransferList
                            remainingTitle="Tanggung jawab tersedia"
                            selectedTitle="Tanggung jawab role ini"
                            remaining={catalog.duties
                                .filter((duty) => !chosen.has(duty.code))
                                .map(item)}
                            selected={catalog.duties
                                .filter((duty) => chosen.has(duty.code))
                                .map(item)}
                            onChange={(next) =>
                                setDuties(
                                    next.selected.map((entry) => entry.id),
                                )
                            }
                            disabled={!editing || busy}
                            selectedEmptyLabel="Belum ada tanggung jawab. Pindahkan dari daftar kiri."
                        />
                        {errors.duty_codes?.[0] && (
                            <p
                                role="alert"
                                className="mt-2 text-sm text-destructive"
                            >
                                {errors.duty_codes[0]}
                            </p>
                        )}
                    </div>
                    {role && role.child_roles.length > 0 && (
                        <FieldDescription className="mt-4">
                            Role ini juga mewarisi hak dari:{' '}
                            {role.child_roles
                                .map((child) => child.name)
                                .join(', ')}
                            .
                        </FieldDescription>
                    )}
                    <h3 className="mt-6 mb-2 text-sm font-semibold">
                        Rincian hak
                    </h3>
                    <DataTable
                        data={details}
                        getRowKey={(row) => row.key}
                        scrollMode="inline"
                        showRowNumbers={false}
                        emptyMessage="Pilih tanggung jawab untuk melihat rincian haknya."
                        columns={[
                            {
                                id: 'duty',
                                header: 'Tanggung jawab',
                                width: 200,
                                cell: (row) => (
                                    <DataTableText>{row.duty}</DataTableText>
                                ),
                            },
                            {
                                id: 'privilege',
                                header: 'Tugas akses',
                                width: 220,
                                cell: (row) => (
                                    <DataTableText>
                                        {row.privilege}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'permissions',
                                header: 'Izin',
                                width: 280,
                                cell: (row) => (
                                    <DataTableText>
                                        {row.permissions || '—'}
                                    </DataTableText>
                                ),
                            },
                        ]}
                    />
                </form>
            </div>
            {confirmation}
        </RecordEditBoundary>
    );
}

function SelectedRole({
    catalog,
    roleId,
    onSaved,
    onDeleted,
    onCancelNew,
}: {
    catalog: Catalog;
    roleId: string;
    onSaved: (role: Role) => void;
    onDeleted: () => void;
    onCancelNew: () => void;
}): ReactNode {
    const query = useQuery({
        ...orpc.roleShow.queryOptions({
            input: { params: { id: roleId } },
            select: (response) => response.body.data,
        }),
        enabled: roleId !== 'new',
    });
    if (roleId === 'new')
        return (
            <RoleComposer
                key="new"
                catalog={catalog}
                role={null}
                onSaved={onSaved}
                onDeleted={onDeleted}
                onCancelNew={onCancelNew}
            />
        );
    if (query.isError)
        return (
            <p role="alert" className="p-6 text-sm text-destructive">
                {errorText(query.error, 'Role belum dapat dimuat.')}
            </p>
        );
    if (!query.data)
        return <p className="p-6 text-sm text-muted-foreground">Memuat…</p>;
    return (
        <RoleComposer
            key={`${query.data.id}:${query.data.version}`}
            catalog={catalog}
            role={query.data}
            onSaved={onSaved}
            onDeleted={onDeleted}
            onCancelNew={onCancelNew}
        />
    );
}

function SecurityConfigurationPage(): ReactNode {
    const { data: catalog } = useSuspenseQuery(
        orpc.securityConfiguration.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const queryClient = useQueryClient();
    const setSearch = (next: { q?: string; role?: string }) =>
        void navigate({
            search: (previous) =>
                Object.fromEntries(
                    Object.entries<string | undefined>({
                        ...previous,
                        ...next,
                    }).filter(
                        ([, value]) => value !== undefined && value !== '',
                    ),
                ),
            replace: true,
        });
    const loader = useCallback<ListLoader<RoleRow>>(
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

    return (
        <ListPageLayout
            header={
                <RecordActionBar
                    title="Susun role"
                    search={{
                        value: search.q ?? '',
                        onValueChange: (q) => setSearch({ q }),
                        label: 'Cari role',
                        placeholder: 'Cari nama...',
                    }}
                >
                    {catalog.canManage && (
                        <ActionButton
                            action="create"
                            onClick={() => setSearch({ role: 'new' })}
                        />
                    )}
                </RecordActionBar>
            }
        >
            <MasterDetailLayout
                detailOpen={Boolean(search.role)}
                onDetailOpenChange={(open) =>
                    !open && setSearch({ role: undefined })
                }
                list={
                    <aside className="flex h-full min-h-0 min-w-0 flex-col">
                        <DataTable
                            data={list.items}
                            getRowKey={(item) => item.id}
                            columns={[
                                {
                                    id: 'name',
                                    header: 'Role',
                                    cell: (item) => (
                                        <DataTableText>
                                            {item.name}
                                        </DataTableText>
                                    ),
                                    sortValue: (item) => item.name,
                                },
                            ]}
                            activeRowKey={search.role}
                            rowActivation="single-click"
                            onRowClick={(item) => setSearch({ role: item.id })}
                            sort={list.sort}
                            onSortChange={list.onSortChange}
                            serverSort
                            incremental={list}
                            emptyMessage="Belum ada role yang cocok."
                        />
                    </aside>
                }
            >
                <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                    {search.role ? (
                        <SelectedRole
                            catalog={catalog}
                            roleId={search.role}
                            onSaved={(role) => {
                                void queryClient.invalidateQueries({
                                    queryKey: orpc.roleShow.key(),
                                });
                                setSearch({ role: role.id });
                                list.reload();
                            }}
                            onDeleted={() => {
                                setSearch({ role: undefined });
                                list.reload();
                            }}
                            onCancelNew={() => setSearch({ role: undefined })}
                        />
                    ) : (
                        <Empty>
                            <EmptyHeader>
                                <EmptyTitle>Pilih role</EmptyTitle>
                                <EmptyDescription>
                                    Pilih role dari daftar untuk melihat atau
                                    menyusun tanggung jawabnya.
                                </EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    )}
                </div>
            </MasterDetailLayout>
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/sysadmin/access/security-configuration',
    previousPaths: ['/settings/security-configuration'],
    layout: 'app',
    title: 'Susun role',
    validateSearch: z.object({
        q: z.string().max(200).optional(),
        role: z.string().max(100).optional(),
    }),
    component: SecurityConfigurationPage,
});
