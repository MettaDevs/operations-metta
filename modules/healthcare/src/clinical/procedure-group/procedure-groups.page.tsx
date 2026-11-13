import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useId, useRef, useState } from 'react';
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
} from '@core/platform/shell/index.ts';
import { treatmentGroups } from './procedure-group.options.ts';

// Kelompok tindakan (Group Jasa di Setup Jasa sistem lama, admin/service/views/group/form.php). Kartu mengikuti urutan
// form sistem lama, lalu Urutan dan Aktif. Daftar menampilkan kode Kelompok Perawatan apa adanya seperti daftar Group
// Jasa sistem lama.

const route = getRouteApi('/_app/healthcare/clinical/procedure-groups');
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    status: z.enum(['active', 'inactive']).optional(),
});
type Group = ApiBody<'healthcareProcedureGroupList'>['data'][number];
type Permissions = ApiBody<'healthcareProcedureMetadata'>['permissions'];
const ALL = 'all';
const treatmentGroupItems = Object.entries(treatmentGroups).map(
    ([value, label]) => ({ value, label }),
);

function GroupCard({
    group,
    permissions,
    onSaved,
    onClose,
}: {
    group: Group | null;
    permissions: Permissions;
    onSaved: (group: Group) => void;
    onClose: () => void;
}): ReactNode {
    const editing = permissions.update;
    const blank = {
        code: group?.code ?? '',
        name: group?.name ?? '',
        international_name: group?.international_name ?? '',
        treatment_group: group?.treatment_group ?? 'ALL',
        sort_order: String(group?.sort_order ?? 0),
        is_active: group?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const { confirm, confirmation } = useConfirmation();
    const activeId = useId();
    const portalContainer = useRef<HTMLFormElement>(null);
    usePageDialogRecord({
        recordTitle: group
            ? `${group.code} ${group.name}`
            : 'Kelompok tindakan baru',
        editing,
    });

    const save = async () => {
        setLastAction('save');
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            ...form,
            sort_order: Number(form.sort_order) || 0,
        };
        try {
            const { body: saved } = group
                ? await api.healthcareProcedureGroupUpdate({
                      params: { id: group.id },
                      body: { ...body, version: group.version },
                  })
                : await api.healthcareProcedureGroupCreate({ body });
            toast.success(
                group
                    ? 'Kelompok tindakan diperbarui.'
                    : 'Kelompok tindakan dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Kelompok tindakan belum disimpan.'),
                );
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!group) return;
        if (
            !(await confirm({
                title: `Delete kelompok ${group.name}?`,
                description:
                    'Kelompok ini tidak bisa dipilih lagi untuk tindakan dan kategori tindakan.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setLastAction('delete');
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            await api.healthcareProcedureGroupDelete({
                params: { id: group.id },
                body: { version: group.version },
            });
            toast.success('Kelompok tindakan dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Kelompok tindakan belum dihapus.'),
                );
        } finally {
            setBusy(false);
        }
    };

    return (
        <form
            ref={portalContainer}
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void save();
            }}
        >
            <PageDialogToolbar>
                {editing && (
                    <>
                        <ActionButton
                            action="save"
                            type="submit"
                            disabled={busy}
                            pending={busy}
                        />
                        <ActionButton
                            action="cancel"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                                if (!group) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                                setMessage(null);
                            }}
                        />
                    </>
                )}
                {group && permissions.delete && (
                    <ActionButton
                        action="archive"
                        disabled={busy}
                        onClick={() => void remove()}
                    />
                )}
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation={
                    lastAction === 'delete'
                        ? 'Kelompok tindakan belum dihapus'
                        : 'Kelompok tindakan belum disimpan'
                }
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl error={errors.code?.[0]}>
                        <Input
                            label="Kode"
                            required
                            maxLength={40}
                            data-error-field="code"
                            value={form.code}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, code: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl error={errors.name?.[0]}>
                        <Input
                            label="Nama"
                            required
                            maxLength={150}
                            data-error-field="name"
                            value={form.name}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl error={errors.international_name?.[0]}>
                        <Input
                            label="Nama internasional"
                            maxLength={200}
                            data-error-field="international_name"
                            value={form.international_name}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    international_name: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    <FormControl
                        error={errors.treatment_group?.[0]}
                        data-error-field="treatment_group"
                    >
                        {editing ? (
                            <Select
                                label="Kelompok Perawatan"
                                required
                                items={treatmentGroupItems}
                                value={form.treatment_group}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        treatment_group:
                                            value ?? form.treatment_group,
                                    })
                                }
                                searchPlaceholder="Cari kelompok perawatan"
                                emptyMessage="Pilihan tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Kelompok Perawatan"
                                value={
                                    treatmentGroupItems.find(
                                        (item) =>
                                            item.value === form.treatment_group,
                                    )?.label ?? form.treatment_group
                                }
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl error={errors.sort_order?.[0]}>
                        <Input
                            label="Urutan"
                            inputMode="numeric"
                            data-error-field="sort_order"
                            value={form.sort_order}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    sort_order: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id={activeId}
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor={activeId}>Aktif</FieldLabel>
                    </Field>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function ProcedureGroupsPage(): ReactNode {
    const { data: permissions } = useSuspenseQuery(
        orpc.healthcareProcedureMetadata.queryOptions({
            select: (response) => response.body.permissions,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Group | 'new' | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { status } = search;
    const loader = useCallback<ListLoader<Group>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareProcedureGroupList(
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
        getKey: (group) => group.id,
    });
    const canManage = permissions.update;
    const changeSearch = (next: Partial<z.infer<typeof searchSchema>>) =>
        void navigate({
            search: (current) => ({ ...current, ...next }),
            replace: true,
        });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Kelompok tindakan"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                changeSearch({ q: q || undefined }),
                            label: 'Cari kelompok tindakan',
                            placeholder: 'Cari kode atau nama...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(status),
                            controls: filterPanelId,
                        }}
                    >
                        {canManage && (
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
                                                changeSearch({
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
                        {list.items.length} kelompok dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(group) => group.id}
                    getRowLabel={(group) => `${group.code} ${group.name}`}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, group) => setOpen(group)}
                    onRowClick={(group) => setOpen(group)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada kelompok tindakan yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada kelompok tindakan yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 140,
                            cell: (group) => (
                                <DataTableText>{group.code}</DataTableText>
                            ),
                            sortValue: (group) => group.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 320,
                            cell: (group) => (
                                <DataTableText>{group.name}</DataTableText>
                            ),
                            sortValue: (group) => group.name,
                        },
                        {
                            id: 'treatment_group',
                            header: 'Kelompok Perawatan',
                            width: 170,
                            cell: (group) => (
                                <DataTableText>
                                    {group.treatment_group}
                                </DataTableText>
                            ),
                            sortValue: (group) => group.treatment_group,
                        },
                        {
                            id: 'sort_order',
                            header: 'Urutan',
                            width: 90,
                            cell: (group) => (
                                <DataTableText>
                                    {group.sort_order}
                                </DataTableText>
                            ),
                            sortValue: (group) => group.sort_order,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (group) => (
                                <Badge
                                    variant={
                                        group.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {group.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent title="Kelompok tindakan">
                        <GroupCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            group={open === 'new' ? null : open}
                            permissions={permissions}
                            onSaved={(group) => {
                                setOpen(group);
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
    path: '/healthcare/clinical/procedure-groups',
    layout: 'app',
    title: 'Kelompok tindakan',
    validateSearch: searchSchema,
    component: ProcedureGroupsPage,
});
