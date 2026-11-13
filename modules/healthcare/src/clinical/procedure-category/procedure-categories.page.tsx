import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
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

// Kategori tindakan (Kategori jasa di Setup Jasa sistem lama): subkelompok di bawah satu kelompok tindakan. Pilihan
// kategori di kartu tindakan mengikuti kelompok tindakannya.

const route = getRouteApi('/_app/healthcare/clinical/procedure-categories');
const searchSchema = z.object({ q: z.string().max(200).optional() });
type Category = ApiBody<'healthcareProcedureCategoryList'>['data'][number];
type Metadata = ApiBody<'healthcareProcedureMetadata'>;
type Group = Metadata['groups'][number];

function CategoryCard({
    category,
    metadata,
    onSaved,
    onClose,
}: {
    category: Category | null;
    metadata: Metadata;
    onSaved: (category: Category) => void;
    onClose: () => void;
}): ReactNode {
    const editing = metadata.permissions.update;
    const blank = {
        group_id: category?.group_id ?? null,
        code: category?.code ?? '',
        name: category?.name ?? '',
        international_name: category?.international_name ?? '',
        is_active: category?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const { confirm, confirmation } = useConfirmation();
    const activeId = useId();
    const portalContainer = useRef<HTMLFormElement>(null);
    const dirty = JSON.stringify(form) !== JSON.stringify(blank);
    usePageDialogRecord({
        recordTitle: category
            ? `${category.code} ${category.name}`
            : 'Kategori tindakan baru',
        editing,
        dirty,
    });
    const groups = metadata.groups.filter(
        (group) => group.active || group.id === category?.group_id,
    );
    const group: Group | null =
        groups.find((item) => item.id === form.group_id) ?? null;

    const save = async () => {
        setLastAction('save');
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = category
                ? await api.healthcareProcedureCategoryUpdate({
                      params: { id: category.id },
                      body: { ...form, version: category.version },
                  })
                : await api.healthcareProcedureCategoryCreate({ body: form });
            toast.success(
                category
                    ? 'Kategori tindakan diperbarui.'
                    : 'Kategori tindakan dibuat.',
            );
            onSaved(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Kategori tindakan belum disimpan.'),
                );
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!category) return;
        if (
            !(await confirm({
                title: `Delete kategori ${category.name}?`,
                description:
                    'Kategori ini tidak bisa dipilih lagi untuk tindakan.',
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
            await api.healthcareProcedureCategoryDelete({
                params: { id: category.id },
                body: { version: category.version },
            });
            toast.success('Kategori tindakan dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Kategori tindakan belum dihapus.'),
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
                                if (!category) {
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
                {category && metadata.permissions.delete && (
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
                        ? 'Kategori tindakan belum dihapus'
                        : 'Kategori tindakan belum disimpan'
                }
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl error={errors.code?.[0]}>
                        <Input
                            label="Kode"
                            required
                            maxLength={20}
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
                            maxLength={150}
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
                        error={errors.group_id?.[0]}
                        data-error-field="group_id"
                    >
                        <InlineLookup
                            label="Kelompok"
                            required
                            disabled={!editing}
                            items={groups}
                            value={group}
                            displayValue={
                                group?.name ?? category?.group_name ?? ''
                            }
                            onValueChange={(item) =>
                                setForm({ ...form, group_id: item.id })
                            }
                            getItemValue={(item) => item.id}
                            getItemLabel={(item) => item.name}
                            getSearchText={(item) =>
                                `${item.code} ${item.name}`
                            }
                            placeholder="Cari kelompok…"
                            emptyMessage="Kelompok tidak ditemukan. Tambahkan di layar Kelompok tindakan."
                            showDetails={false}
                            showFullList={false}
                            portalContainer={portalContainer}
                            columns={[
                                {
                                    id: 'code',
                                    header: 'Kode',
                                    width: 120,
                                    cell: (item) => item.code,
                                },
                                {
                                    id: 'name',
                                    header: 'Nama',
                                    width: 220,
                                    cell: (item) => item.name,
                                },
                            ]}
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

function ProcedureCategoriesPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareProcedureMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Category | 'new' | null>(null);
    const loader = useCallback<ListLoader<Category>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareProcedureCategoryList(
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
        getKey: (category) => category.id,
    });
    const canManage = metadata.permissions.update;

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Kategori tindakan"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: { q: q || undefined },
                                    replace: true,
                                }),
                            label: 'Cari kategori tindakan',
                            placeholder: 'Cari kode, nama, atau kelompok...',
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
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} kategori dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(category) => category.id}
                    getRowLabel={(category) =>
                        `${category.code} ${category.name}`
                    }
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, category) => setOpen(category)}
                    onRowClick={(category) => setOpen(category)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada kategori tindakan yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada kategori tindakan yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 120,
                            cell: (category) => (
                                <DataTableText>{category.code}</DataTableText>
                            ),
                        },
                        {
                            id: 'group_name',
                            header: 'Kelompok',
                            width: 220,
                            cell: (category) => (
                                <DataTableText>
                                    {category.group_name}
                                </DataTableText>
                            ),
                            sortValue: (category) => category.group_name,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 300,
                            cell: (category) => (
                                <DataTableText>{category.name}</DataTableText>
                            ),
                            sortValue: (category) => category.name,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (category) => (
                                <Badge
                                    variant={
                                        category.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {category.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent title="Kategori tindakan">
                        <CategoryCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            category={open === 'new' ? null : open}
                            metadata={metadata}
                            onSaved={(category) => {
                                setOpen(category);
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
    path: '/healthcare/clinical/procedure-categories',
    layout: 'app',
    title: 'Kategori tindakan',
    validateSearch: searchSchema,
    component: ProcedureCategoriesPage,
});
