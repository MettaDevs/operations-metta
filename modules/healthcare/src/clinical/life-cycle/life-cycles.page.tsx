import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FilterPane } from '@operations-metta/ui/filter-pane';
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
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
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

// Siklus hidup: aturan yang memilih siklus hidup dan klaster setiap kunjungan dari jenis kelamin, umur, dan status
// hamil pasien. Umur disimpan dalam bulan; layar menampilkannya dalam tahun bila batasnya tahun genap.

const route = getRouteApi('/_app/healthcare/clinical/life-cycles');
const ALL = 'all';
type LifeCycle = ApiBody<'healthcareLifeCycleList'>['data'][number];
type Metadata = ApiBody<'healthcareLifeCycleMetadata'>;
type Cluster = Metadata['clusters'][number];
type Search = z.infer<typeof searchSchema>;
type Errors = Record<string, string[]>;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    cluster_id: z.string().optional(),
    status: z.enum(['active', 'inactive']).optional(),
});

type AgeUnit = 'years' | 'months';
const ageUnits = [
    { value: 'years', label: 'Tahun' },
    { value: 'months', label: 'Bulan' },
];
const pregnancyChoices = [
    { value: ALL, label: 'Tidak membatasi' },
    { value: 'true', label: 'Hanya pasien hamil' },
    { value: 'false', label: 'Hanya pasien tidak hamil' },
];

function ageText(months: number): string {
    if (months % 12 === 0) return `${String(months / 12)} th`;
    if (months < 12) return `${String(months)} bln`;
    return `${String(Math.floor(months / 12))} th ${String(months % 12)} bln`;
}

function ageRange(row: LifeCycle): string {
    if (row.max_age_months === null)
        return row.min_age_months === 0
            ? 'Semua umur'
            : `${ageText(row.min_age_months)} ke atas`;
    return `${ageText(row.min_age_months)} – di bawah ${ageText(row.max_age_months)}`;
}

function LifeCycleCard({
    lifeCycle,
    metadata,
    portalContainer,
    onSaved,
    onClose,
}: {
    lifeCycle: LifeCycle | null;
    metadata: Metadata;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (lifeCycle: LifeCycle) => void;
    onClose: () => void;
}): ReactNode {
    const { permissions } = metadata;
    const editing =
        lifeCycle === null ? permissions.create : permissions.update;
    const min = lifeCycle?.min_age_months ?? 0;
    const max = lifeCycle?.max_age_months ?? null;
    const unit: AgeUnit =
        min % 12 === 0 && (max === null || max % 12 === 0) ? 'years' : 'months';
    const factor = (value: AgeUnit) => (value === 'years' ? 12 : 1);
    const blank = {
        code: lifeCycle?.code ?? '',
        name: lifeCycle?.name ?? '',
        cluster:
            metadata.clusters.find(
                (cluster) => cluster.id === lifeCycle?.cluster_id,
            ) ?? null,
        age_unit: unit,
        min_age: String(min / factor(unit)),
        max_age: max === null ? '' : String(max / factor(unit)),
        gender: lifeCycle?.gender ?? ALL,
        requires_pregnancy:
            lifeCycle?.requires_pregnancy === null ||
            lifeCycle?.requires_pregnancy === undefined
                ? ALL
                : String(lifeCycle.requires_pregnancy),
        priority: String(lifeCycle?.priority ?? 10),
        sort_order: String(lifeCycle?.sort_order ?? 0),
        is_active: lifeCycle?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const dirty = JSON.stringify(form) !== JSON.stringify(blank);
    usePageDialogRecord({
        recordTitle: lifeCycle?.name ?? 'Siklus hidup baru',
        editing,
        dirty,
    });

    const months = (value: string, field: string, local: Errors) => {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0) {
            local[field] = ['Isi angka 0 atau lebih.'];
            return 0;
        }
        return Math.round(number * factor(form.age_unit));
    };
    const save = async () => {
        const local: Errors = {};
        const minAge = months(
            form.min_age.trim() || '0',
            'min_age_months',
            local,
        );
        const maxAge = form.max_age.trim()
            ? months(form.max_age.trim(), 'max_age_months', local)
            : null;
        if (Object.keys(local).length) {
            setErrors(local);
            return;
        }
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            code: form.code,
            name: form.name,
            cluster_id: form.cluster?.id ?? '',
            min_age_months: minAge,
            max_age_months: maxAge,
            gender: form.gender === ALL ? null : form.gender,
            requires_pregnancy:
                form.requires_pregnancy === ALL
                    ? null
                    : form.requires_pregnancy === 'true',
            priority: Number(form.priority) || 0,
            sort_order: Number(form.sort_order) || 0,
            is_active: form.is_active,
        };
        try {
            const { body: saved } = lifeCycle
                ? await api.healthcareLifeCycleUpdate({
                      params: { id: lifeCycle.id },
                      body: { ...body, version: lifeCycle.version },
                  })
                : await api.healthcareLifeCycleCreate({ body });
            toast.success(
                lifeCycle ? 'Siklus hidup diperbarui.' : 'Siklus hidup dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Siklus hidup belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!lifeCycle) return;
        if (
            !(await confirm({
                title: `Delete siklus hidup ${lifeCycle.name}?`,
                description:
                    'Siklus hidup ini tidak dipakai lagi untuk kunjungan baru. Kunjungan yang sudah tercatat tetap menampilkannya.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcareLifeCycleDelete({
                params: { id: lifeCycle.id },
                body: { version: lifeCycle.version },
            });
            toast.success('Siklus hidup dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Siklus hidup belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };
    const text = (
        field:
            'code' | 'name' | 'min_age' | 'max_age' | 'priority' | 'sort_order',
        label: string,
        options: {
            error?: string;
            required?: boolean;
            numeric?: boolean;
            maxLength?: number;
            hint?: string;
        } = {},
    ) => (
        <FormControl
            error={errors[options.error ?? field]?.[0]}
            hint={options.hint}
        >
            <Input
                label={label}
                required={options.required}
                maxLength={options.maxLength}
                inputMode={options.numeric ? 'decimal' : undefined}
                data-error-field={options.error ?? field}
                value={form[field]}
                readOnly={!editing}
                onChange={(event) =>
                    setForm({ ...form, [field]: event.target.value })
                }
            />
        </FormControl>
    );

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
                                if (!lifeCycle) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {lifeCycle && permissions.delete && (
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
                operation="Siklus hidup belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    {text('code', 'Kode', { required: true, maxLength: 20 })}
                    {text('name', 'Nama', { required: true, maxLength: 100 })}
                    {editing ? (
                        <FormControl error={errors.cluster_id?.[0]}>
                            <InlineLookup<Cluster>
                                label="Klaster"
                                required
                                items={metadata.clusters.filter(
                                    (cluster) => cluster.is_active,
                                )}
                                value={form.cluster}
                                onValueChange={(cluster) =>
                                    setForm({ ...form, cluster })
                                }
                                getItemValue={(cluster) => cluster.id}
                                getItemLabel={(cluster) =>
                                    `${cluster.code} ${cluster.name}`
                                }
                                getSearchText={(cluster) =>
                                    `${cluster.code} ${cluster.name}`
                                }
                                placeholder="Cari klaster…"
                                emptyMessage="Klaster tidak ditemukan. Tambahkan di Klaster."
                                columns={[
                                    {
                                        id: 'code',
                                        header: 'Kode',
                                        cell: (cluster) => cluster.code,
                                    },
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        cell: (cluster) => cluster.name,
                                    },
                                ]}
                                portalContainer={portalContainer}
                                showDetails={false}
                            />
                        </FormControl>
                    ) : (
                        <FormControl>
                            <Input
                                label="Klaster"
                                required
                                value={
                                    lifeCycle
                                        ? `${lifeCycle.cluster_code} ${lifeCycle.cluster_name}`
                                        : ''
                                }
                                readOnly
                            />
                        </FormControl>
                    )}
                    <FormControl error={errors.gender?.[0]}>
                        <Select
                            label="Jenis kelamin"
                            items={[
                                { value: ALL, label: 'Semua' },
                                ...metadata.genders.map((gender) => ({
                                    value: gender.code,
                                    label: gender.name,
                                })),
                            ]}
                            value={form.gender}
                            onValueChange={(value) =>
                                editing &&
                                setForm({ ...form, gender: value ?? ALL })
                            }
                            searchPlaceholder="Cari jenis kelamin"
                            emptyMessage="Jenis kelamin tidak ditemukan."
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    <FormControl>
                        <Select
                            label="Satuan umur"
                            items={ageUnits}
                            value={form.age_unit}
                            onValueChange={(value) =>
                                editing &&
                                setForm({
                                    ...form,
                                    age_unit:
                                        value === 'months' ? 'months' : 'years',
                                })
                            }
                            searchPlaceholder="Cari satuan"
                            emptyMessage="Satuan tidak ditemukan."
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    {text('min_age', 'Umur mulai', {
                        error: 'min_age_months',
                        numeric: true,
                        hint: 'Umur pada tanggal kunjungan. Pasien yang tepat berulang tahun ke umur ini sudah termasuk.',
                    })}
                    {text('max_age', 'Umur sampai', {
                        error: 'max_age_months',
                        numeric: true,
                        hint: 'Pasien yang sudah mencapai umur ini tidak termasuk lagi. Kosongkan bila tidak ada batas atas.',
                    })}
                    <FormControl error={errors.requires_pregnancy?.[0]}>
                        <Select
                            label="Status hamil"
                            items={pregnancyChoices}
                            value={form.requires_pregnancy}
                            onValueChange={(value) =>
                                editing &&
                                setForm({
                                    ...form,
                                    requires_pregnancy: value ?? ALL,
                                })
                            }
                            searchPlaceholder="Cari status"
                            emptyMessage="Status tidak ditemukan."
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    {text('priority', 'Prioritas', {
                        required: true,
                        numeric: true,
                        hint: 'Bila beberapa siklus hidup cocok untuk pasien yang sama, angka terkecil yang dipakai.',
                    })}
                    {text('sort_order', 'Urutan', { numeric: true })}
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="life-cycle-active"
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor="life-cycle-active">
                            Aktif
                        </FieldLabel>
                    </Field>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function LifeCyclesPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareLifeCycleMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const { permissions } = metadata;
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<LifeCycle | 'new' | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { status, cluster_id: clusterId } = search;
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
    const loader = useCallback<ListLoader<LifeCycle>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareLifeCycleList(
                {
                    query: {
                        q: query,
                        ...(status ? { status } : {}),
                        ...(clusterId ? { cluster_id: clusterId } : {}),
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
        [status, clusterId],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (row) => row.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Siklus hidup"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari siklus hidup',
                            placeholder: 'Cari kode, nama, atau klaster...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(status || clusterId),
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
                                            label="Klaster"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua klaster',
                                                },
                                                ...metadata.clusters.map(
                                                    (cluster) => ({
                                                        value: cluster.id,
                                                        label: `${cluster.code} ${cluster.name}`,
                                                    }),
                                                ),
                                            ]}
                                            value={clusterId ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    cluster_id:
                                                        value && value !== ALL
                                                            ? value
                                                            : undefined,
                                                })
                                            }
                                            searchPlaceholder="Cari klaster"
                                            emptyMessage="Klaster tidak ditemukan."
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
                        {list.items.length} siklus hidup dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) => row.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, row) => setOpen(row)}
                    onRowClick={(row) => setOpen(row)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        permissions.create
                            ? 'Belum ada siklus hidup yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada siklus hidup yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 100,
                            cell: (row) => (
                                <DataTableText>{row.code}</DataTableText>
                            ),
                            sortValue: (row) => row.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 240,
                            cell: (row) => (
                                <DataTableText>{row.name}</DataTableText>
                            ),
                            sortValue: (row) => row.name,
                        },
                        {
                            id: 'cluster_code',
                            header: 'Klaster',
                            width: 220,
                            cell: (row) => (
                                <DataTableText>
                                    {row.cluster_code} {row.cluster_name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.cluster_code,
                        },
                        {
                            id: 'age',
                            header: 'Umur',
                            width: 170,
                            cell: (row) => (
                                <DataTableText>{ageRange(row)}</DataTableText>
                            ),
                        },
                        {
                            id: 'gender',
                            header: 'Jenis kelamin',
                            width: 120,
                            cell: (row) => (
                                <DataTableText>
                                    {row.gender_name ?? 'Semua'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'pregnancy',
                            header: 'Status hamil',
                            width: 120,
                            cell: (row) => (
                                <DataTableText>
                                    {row.requires_pregnancy === null
                                        ? '—'
                                        : row.requires_pregnancy
                                          ? 'Hamil'
                                          : 'Tidak hamil'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'priority',
                            header: 'Prioritas',
                            width: 90,
                            cell: (row) => (
                                <DataTableText>
                                    {String(row.priority)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.priority,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (row) => (
                                <Badge
                                    variant={
                                        row.is_active ? 'secondary' : 'outline'
                                    }
                                >
                                    {row.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent ref={contentRef} title="Siklus hidup">
                        <LifeCycleCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            lifeCycle={open === 'new' ? null : open}
                            metadata={metadata}
                            portalContainer={contentRef}
                            onSaved={(row) => {
                                setOpen(row);
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
    path: '/healthcare/clinical/life-cycles',
    layout: 'app',
    title: 'Siklus hidup',
    validateSearch: searchSchema,
    component: LifeCyclesPage,
});
