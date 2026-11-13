import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { Checkbox } from '@operations-metta/ui/checkbox';
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
import { useCallback, useId, useState } from 'react';
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

// Profesi tenaga kesehatan. Dua centangnya menentukan siapa yang muncul di pilihan Dokter / Tenaga Medis dan Perawat /
// Bidan / Nutrisionist / Sanitarian pada pemeriksaan.

const route = getRouteApi('/_app/healthcare/practitioner/professions');
const ALL = 'all';
type Profession = ApiBody<'healthcareProfessionList'>['data'][number];
type Permissions = ApiBody<'healthcareProfessionMetadata'>['permissions'];
type Search = z.infer<typeof searchSchema>;
type Errors = Record<string, string[]>;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    status: z.enum(['active', 'inactive']).optional(),
});

function ProfessionCard({
    profession,
    permissions,
    onSaved,
    onClose,
}: {
    profession: Profession | null;
    permissions: Permissions;
    onSaved: (profession: Profession) => void;
    onClose: () => void;
}): ReactNode {
    const editing =
        profession === null ? permissions.create : permissions.update;
    const blank = {
        code: profession?.code ?? '',
        name: profession?.name ?? '',
        fills_medical_staff: profession?.fills_medical_staff ?? false,
        fills_nurse: profession?.fills_nurse ?? false,
        sort_order: String(profession?.sort_order ?? 0),
        is_active: profession?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const dirty = JSON.stringify(form) !== JSON.stringify(blank);
    usePageDialogRecord({
        recordTitle: profession
            ? `${profession.code} ${profession.name}`
            : 'Profesi baru',
        editing,
        dirty,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            code: form.code,
            name: form.name,
            fills_medical_staff: form.fills_medical_staff,
            fills_nurse: form.fills_nurse,
            sort_order: Number(form.sort_order) || 0,
            is_active: form.is_active,
        };
        try {
            const { body: saved } = profession
                ? await api.healthcareProfessionUpdate({
                      params: { id: profession.id },
                      body: { ...body, version: profession.version },
                  })
                : await api.healthcareProfessionCreate({ body });
            toast.success(
                profession ? 'Profesi diperbarui.' : 'Profesi dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Profesi belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!profession) return;
        if (
            !(await confirm({
                title: `Delete profesi ${profession.name}?`,
                description: 'Profesi tidak bisa dipilih lagi untuk nakes.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcareProfessionDelete({
                params: { id: profession.id },
                body: { version: profession.version },
            });
            toast.success('Profesi dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Profesi belum dihapus.'));
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
                                if (!profession) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {profession && permissions.delete && (
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
                operation="Profesi belum disimpan"
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
                    <FormControl hint="Nakes berprofesi ini muncul di pilihan Dokter / Tenaga Medis pada pemeriksaan.">
                        <Field orientation="horizontal" className="w-auto">
                            <Checkbox
                                id="profession-medical-staff"
                                checked={form.fills_medical_staff}
                                disabled={!editing}
                                onCheckedChange={(checked) =>
                                    setForm({
                                        ...form,
                                        fills_medical_staff: checked === true,
                                    })
                                }
                            />
                            <FieldLabel htmlFor="profession-medical-staff">
                                Dipilih sebagai Dokter / Tenaga Medis
                            </FieldLabel>
                        </Field>
                    </FormControl>
                    <FormControl hint="Nakes berprofesi ini muncul di pilihan Perawat / Bidan / Nutrisionist / Sanitarian pada pemeriksaan. Satu profesi boleh mencentang keduanya.">
                        <Field orientation="horizontal" className="w-auto">
                            <Checkbox
                                id="profession-nurse"
                                checked={form.fills_nurse}
                                disabled={!editing}
                                onCheckedChange={(checked) =>
                                    setForm({
                                        ...form,
                                        fills_nurse: checked === true,
                                    })
                                }
                            />
                            <FieldLabel htmlFor="profession-nurse">
                                Dipilih sebagai Perawat / Bidan / Nutrisionist /
                                Sanitarian
                            </FieldLabel>
                        </Field>
                    </FormControl>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="profession-active"
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor="profession-active">
                            Aktif
                        </FieldLabel>
                    </Field>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function ProfessionsPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareProfessionMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const { permissions } = metadata;
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Profession | 'new' | null>(null);
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
    const loader = useCallback<ListLoader<Profession>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareProfessionList(
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
        getKey: (profession) => profession.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Profesi"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari profesi',
                            placeholder: 'Cari kode atau nama profesi...',
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
                        {list.items.length} profesi dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(profession) => profession.id}
                    getRowLabel={(profession) => profession.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, profession) => setOpen(profession)}
                    onRowClick={(profession) => setOpen(profession)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        permissions.create
                            ? 'Belum ada profesi yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada profesi yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 100,
                            cell: (profession) => (
                                <DataTableText>{profession.code}</DataTableText>
                            ),
                            sortValue: (profession) => profession.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 240,
                            cell: (profession) => (
                                <DataTableText>{profession.name}</DataTableText>
                            ),
                            sortValue: (profession) => profession.name,
                        },
                        {
                            id: 'medical-staff',
                            header: 'Dokter / Tenaga Medis',
                            width: 170,
                            cell: (profession) => (
                                <DataTableText>
                                    {profession.fills_medical_staff
                                        ? 'Ya'
                                        : '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'nurse',
                            header: 'Perawat / Bidan / Nutrisionist / Sanitarian',
                            width: 280,
                            cell: (profession) => (
                                <DataTableText>
                                    {profession.fills_nurse ? 'Ya' : '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (profession) => (
                                <Badge
                                    variant={
                                        profession.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {profession.is_active
                                        ? 'Aktif'
                                        : 'Nonaktif'}
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
                    <PageDialogContent title="Profesi">
                        <ProfessionCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            profession={open === 'new' ? null : open}
                            permissions={permissions}
                            onSaved={(profession) => {
                                setOpen(profession);
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
    path: '/healthcare/practitioner/professions',
    layout: 'app',
    title: 'Profesi',
    validateSearch: searchSchema,
    component: ProfessionsPage,
});
