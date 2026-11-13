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
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiBody,
} from '@core/platform/shell/index.ts';

// Daftar dan kartu yang sama untuk semua daftar pendek klinis (jenis diagnosa sampai alat penunjang): kode, nama, urutan,
// dan status aktif. Tiap halaman memberi nama daftarnya, judulnya, dan label urutan bila sistem lama menamainya lain.

type List = Parameters<
    typeof api.healthcareDiagnosisReferenceList
>[0]['params']['list'];
type Entry = ApiBody<'healthcareDiagnosisReferenceList'>['data'][number];
type Permissions =
    ApiBody<'healthcareDiagnosisReferenceMetadata'>['permissions'];
const ALL = 'all';

export const referenceSearchSchema = z.object({
    q: z.string().max(200).optional(),
    status: z.enum(['active', 'inactive']).optional(),
});
type Search = z.infer<typeof referenceSearchSchema>;

function EntryCard({
    list,
    title,
    sortOrderLabel,
    entry,
    permissions,
    onSaved,
    onClose,
}: {
    list: List;
    title: string;
    sortOrderLabel: string;
    entry: Entry | null;
    permissions: Permissions;
    onSaved: (entry: Entry) => void;
    onClose: () => void;
}): ReactNode {
    const editing = entry === null ? permissions.create : permissions.update;
    const blank = {
        code: entry?.code ?? '',
        name: entry?.name ?? '',
        sort_order: String(entry?.sort_order ?? 0),
        is_active: entry?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    usePageDialogRecord({
        recordTitle: entry ? `${entry.code} ${entry.name}` : `${title} baru`,
        editing,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            code: form.code,
            name: form.name,
            sort_order: Number(form.sort_order) || 0,
            is_active: form.is_active,
        };
        try {
            const { body: saved } = entry
                ? await api.healthcareDiagnosisReferenceUpdate({
                      params: { list, id: entry.id },
                      body: { ...body, version: entry.version },
                  })
                : await api.healthcareDiagnosisReferenceCreate({
                      params: { list },
                      body,
                  });
            toast.success(entry ? `${title} diperbarui.` : `${title} dibuat.`);
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, `${title} belum disimpan.`));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!entry) return;
        if (
            !(await confirm({
                title: `Delete ${entry.name}?`,
                description: 'Baris ini tidak bisa dipilih lagi.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcareDiagnosisReferenceDelete({
                params: { list, id: entry.id },
                body: { version: entry.version },
            });
            toast.success(`${title} dihapus.`);
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, `${title} belum dihapus.`));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
                event.preventDefault();
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
                                if (!entry) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {entry && permissions.delete && (
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
                operation={`${title} belum disimpan`}
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
                    <FormControl error={errors.sort_order?.[0]}>
                        <Input
                            label={sortOrderLabel}
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
                            id={`${list}-active`}
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor={`${list}-active`}>
                            Aktif
                        </FieldLabel>
                    </Field>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

export function DiagnosisReferenceList({
    list,
    title,
    sortOrderLabel = 'Urutan',
    search,
    onSearchChange,
}: {
    list: List;
    title: string;
    sortOrderLabel?: string;
    search: Search;
    onSearchChange: (next: Partial<Search>) => void;
}): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareDiagnosisReferenceMetadata.queryOptions({
            input: { params: { list } },
            select: (response) => response.body,
        }),
    );
    const { permissions } = metadata;
    const [open, setOpen] = useState<Entry | 'new' | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { status } = search;
    const noun = title.toLowerCase();
    const loader = useCallback<ListLoader<Entry>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareDiagnosisReferenceList(
                {
                    params: { list },
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
        [list, status],
    );
    const items = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (entry) => entry.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title={title}
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                onSearchChange({ q: q || undefined }),
                            label: `Cari ${noun}`,
                            placeholder: 'Cari kode atau nama...',
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
                                                onSearchChange({
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
                        {items.items.length} baris dimuat
                    </p>
                }
            >
                <DataTable
                    data={items.items}
                    getRowKey={(entry) => entry.id}
                    getRowLabel={(entry) => entry.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, entry) => setOpen(entry)}
                    onRowClick={(entry) => setOpen(entry)}
                    sort={items.sort}
                    onSortChange={items.onSortChange}
                    serverSort
                    incremental={items}
                    emptyMessage={
                        permissions.create
                            ? `Belum ada ${noun} yang cocok. Pilih Baru untuk menambahkan.`
                            : `Belum ada ${noun} yang cocok.`
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 160,
                            cell: (entry) => (
                                <DataTableText>{entry.code}</DataTableText>
                            ),
                            sortValue: (entry) => entry.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 420,
                            cell: (entry) => (
                                <DataTableText>{entry.name}</DataTableText>
                            ),
                            sortValue: (entry) => entry.name,
                        },
                        {
                            id: 'sort_order',
                            header: sortOrderLabel,
                            width: 90,
                            cell: (entry) => (
                                <DataTableText>
                                    {entry.sort_order}
                                </DataTableText>
                            ),
                            sortValue: (entry) => entry.sort_order,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (entry) => (
                                <Badge
                                    variant={
                                        entry.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {entry.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent title={title}>
                        <EntryCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            list={list}
                            title={title}
                            sortOrderLabel={sortOrderLabel}
                            entry={open === 'new' ? null : open}
                            permissions={permissions}
                            onSaved={(entry) => {
                                setOpen(entry);
                                items.reload();
                            }}
                            onClose={() => {
                                setOpen(null);
                                items.reload();
                            }}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}
