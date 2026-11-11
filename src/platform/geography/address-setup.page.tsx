import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from '@operations-metta/ui/empty';
import { Field, FieldLabel, FieldSet } from '@operations-metta/ui/field';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import { MasterDetailLayout } from '@operations-metta/ui/master-detail-layout';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import {
    RecordEditBoundary,
    RecordEditControl,
} from '@operations-metta/ui/record-edit-boundary';
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
    useLevelNames,
    useRegionOptions,
    type ApiBody,
} from '../shell/index.ts';

// Setup alamat: master tingkat wilayah di bawah desa (dusun, banjar, atau sebutan setempat lain) milik tenant.
// CoreERP tidak punya pintu tulis untuk master ini, jadi bentuk layarnya mengikuti layar setup Organization: daftar di
// kiri, rincian di kanan, dan kartu Baru. Nama tingkatnya dibaca dari data. Bagian Address setup CoreERP yang lain
// belum dipindah.

const route = getRouteApi('/_app/sysadmin/geography/address-setup');
type Row = ApiBody<'groupOfHousesList'>['data'][number];
type Errors = Record<string, string[]>;
type Village = {
    province_id: string;
    regency_id: string;
    district_id: string;
    village_id: string;
};

function failure(caught: unknown, fallback: string) {
    return caught instanceof ApiError && caught.status === 422
        ? { errors: caught.errors, message: null }
        : { errors: {}, message: errorText(caught, fallback) };
}

/** Pilihan provinsi sampai desa, berlabel nama tingkat dari data. */
function VillageCascade({
    value,
    onChange,
    required = false,
    error,
    portalContainer,
}: {
    value: Village;
    onChange: (value: Village) => void;
    required?: boolean;
    error?: string;
    portalContainer?: RefObject<HTMLElement | null>;
}) {
    const levels = useLevelNames('ID');
    const options = [
        useRegionOptions('country', 'ID'),
        useRegionOptions('province', value.province_id),
        useRegionOptions('regency', value.regency_id),
        useRegionOptions('district', value.district_id),
    ];
    const fields = [
        ['province_id', 'province'],
        ['regency_id', 'regency'],
        ['district_id', 'district'],
        ['village_id', 'village'],
    ] as const;
    return (
        <>
            {fields.map(([field, level], index) => {
                const label = levels.name(level);
                const previous = fields[index - 1];
                const parent = previous ? value[previous[0]] : 'ID';
                const query = options[index];
                if (!query) return null;
                return (
                    <FormControl
                        key={field}
                        error={
                            field === 'village_id'
                                ? error
                                : query.error
                                  ? errorText(
                                        query.error,
                                        'Pilihan wilayah belum dapat dimuat.',
                                    )
                                  : undefined
                        }
                    >
                        <FieldSet
                            data-error-field={field}
                            disabled={!parent || query.isFetching}
                        >
                            <Select
                                label={label}
                                required={required}
                                portalContainer={portalContainer}
                                items={query.data ?? []}
                                value={value[field] || null}
                                searchPlaceholder={`Cari ${label.toLocaleLowerCase()}`}
                                emptyMessage="Belum ada pilihan."
                                onValueChange={(next) => {
                                    const reset = Object.fromEntries(
                                        fields
                                            .slice(index + 1)
                                            .map(([child]) => [child, '']),
                                    );
                                    onChange({
                                        ...value,
                                        ...reset,
                                        [field]: next ?? '',
                                    });
                                }}
                            />
                        </FieldSet>
                    </FormControl>
                );
            })}
        </>
    );
}

type Form = {
    code: string;
    name: string;
    active: boolean;
    override_postal_code: boolean;
    postal_code: string;
};

const formOf = (row: Row | null): Form => ({
    code: row?.code ?? '',
    name: row?.name ?? '',
    active: row?.active ?? true,
    override_postal_code: row?.override_postal_code ?? false,
    postal_code: row?.override_postal_code ? (row.postal_code ?? '') : '',
});

const bodyOf = (form: Form, villageId: string) => ({
    village_id: villageId || null,
    code: form.code.trim() || null,
    name: form.name.trim() || null,
    active: form.active,
    override_postal_code: form.override_postal_code,
    postal_code: form.override_postal_code
        ? form.postal_code.trim() || null
        : null,
});

function GroupFields({
    form,
    setForm,
    editing,
    canManage = true,
    errors,
}: {
    form: Form;
    setForm: (update: (current: Form) => Form) => void;
    editing: boolean;
    canManage?: boolean;
    errors: Errors;
}) {
    return (
        <>
            <FormControl error={errors.code?.[0]}>
                <Input
                    label="Kode"
                    maxLength={30}
                    data-error-field="code"
                    value={form.code}
                    readOnly={!editing}
                    onChange={(event) =>
                        setForm((current) => ({
                            ...current,
                            code: event.target.value,
                        }))
                    }
                />
            </FormControl>
            <FormControl error={errors.name?.[0]}>
                <Input
                    label="Nama"
                    required
                    maxLength={200}
                    data-error-field="name"
                    value={form.name}
                    readOnly={!editing}
                    onChange={(event) =>
                        setForm((current) => ({
                            ...current,
                            name: event.target.value,
                        }))
                    }
                />
            </FormControl>
            <RecordEditControl label="Kode pos berbeda dari desanya">
                <Field orientation="horizontal" className="w-auto">
                    <Switch
                        id="group-postal-override"
                        checked={form.override_postal_code}
                        disabled={!editing && !canManage}
                        onCheckedChange={(checked) =>
                            setForm((current) => ({
                                ...current,
                                override_postal_code: checked,
                            }))
                        }
                    />
                    <FieldLabel htmlFor="group-postal-override">
                        Kode pos berbeda dari desanya
                    </FieldLabel>
                </Field>
            </RecordEditControl>
            {form.override_postal_code && (
                <FormControl error={errors.postal_code?.[0]}>
                    <Input
                        label="Kode pos"
                        required
                        inputMode="numeric"
                        maxLength={5}
                        data-error-field="postal_code"
                        value={form.postal_code}
                        readOnly={!editing}
                        onChange={(event) =>
                            setForm((current) => ({
                                ...current,
                                postal_code: event.target.value,
                            }))
                        }
                    />
                </FormControl>
            )}
            <RecordEditControl label="Aktif">
                <Field orientation="horizontal" className="w-auto">
                    <Switch
                        id="group-active"
                        checked={form.active}
                        disabled={!editing && !canManage}
                        onCheckedChange={(checked) =>
                            setForm((current) => ({
                                ...current,
                                active: checked,
                            }))
                        }
                    />
                    <FieldLabel htmlFor="group-active">Aktif</FieldLabel>
                </Field>
            </RecordEditControl>
        </>
    );
}

function CreateDialog({
    levelName,
    initialVillage,
    onCreated,
}: {
    levelName: string;
    initialVillage: Village;
    onCreated: (row: Row) => void;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [village, setVillage] = useState(initialVillage);
    const [form, setForm] = useState(() => formOf(null));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const reset = () => {
        setForm(formOf(null));
        setErrors({});
        setMessage(null);
    };

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.groupOfHousesCreate({
                body: bodyOf(form, village.village_id),
            });
            toast.success(`${levelName} ditambahkan.`);
            reset();
            setOpen(false);
            onCreated(body.data);
        } catch (caught) {
            const failed = failure(caught, `${levelName} belum dibuat.`);
            setErrors(failed.errors);
            setMessage(failed.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <ActionButton
                action="create"
                onClick={() => {
                    setVillage(initialVillage);
                    setOpen(true);
                }}
            />
            {open && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (busy) return;
                        if (!next) reset();
                        setOpen(next);
                    }}
                >
                    <PageDialogContent
                        ref={contentRef}
                        title={levelName}
                        recordTitle={form.name || `${levelName} baru`}
                        editing
                        busy={busy}
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
                        <form
                            noValidate
                            className="flex min-h-0 flex-1 flex-col"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void submit();
                            }}
                        >
                            <PageDialogToolbar>
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
                                        reset();
                                        setOpen(false);
                                    }}
                                />
                            </PageDialogToolbar>
                            <FormErrorHeader
                                errors={errors}
                                message={message}
                                operation={`${levelName} belum dibuat`}
                            />
                            <PageDialogBody className="py-3">
                                <FormGrid>
                                    <VillageCascade
                                        value={village}
                                        onChange={setVillage}
                                        required
                                        error={errors.village_id?.[0]}
                                        portalContainer={contentRef}
                                    />
                                    <GroupFields
                                        form={form}
                                        setForm={setForm}
                                        editing
                                        errors={errors}
                                    />
                                </FormGrid>
                            </PageDialogBody>
                        </form>
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

function Detail({
    row,
    levelName,
    canManage,
    onSaved,
    onDeleted,
}: {
    row: Row;
    levelName: string;
    canManage: boolean;
    onSaved: (row: Row) => void;
    onDeleted: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState(() => formOf(row));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const formId = `group-of-houses-${row.id}`;

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.groupOfHousesUpdate({
                params: { id: row.id },
                body: { ...bodyOf(form, row.village_id), version: row.version },
            });
            toast.success(`${levelName} disimpan.`);
            setEditing(false);
            onSaved(body.data);
        } catch (caught) {
            const failed = failure(caught, 'Perubahan belum disimpan.');
            setErrors(failed.errors);
            setMessage(failed.message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        const confirmed = await confirm({
            title: `Delete ${row.name}?`,
            description:
                'Tidak lagi ditawarkan di form alamat. Alamat yang sudah memakainya tetap utuh.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!confirmed) return;
        setBusy(true);
        setMessage(null);
        try {
            await api.groupOfHousesDelete({
                params: { id: row.id },
                body: { version: row.version },
            });
            toast.success(`${levelName} dihapus.`);
            onDeleted();
        } catch (caught) {
            setMessage(errorText(caught, `${levelName} belum dihapus.`));
        } finally {
            setBusy(false);
        }
    };

    return (
        <RecordEditBoundary
            editing={editing}
            canEdit={canManage}
            disabled={busy}
            onEdit={() => setEditing(true)}
            className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-card text-foreground"
        >
            <RecordActionBar
                title={row.name}
                trailing={
                    <Badge variant="outline">
                        {row.active ? 'Aktif' : 'Nonaktif'}
                    </Badge>
                }
            >
                {canManage &&
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
                                onClick={() => {
                                    setForm(formOf(row));
                                    setErrors({});
                                    setMessage(null);
                                    setEditing(false);
                                }}
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
                        operation="Perubahan belum disimpan"
                    />
                    <FormGrid>
                        <FormControl>
                            <Input
                                label="Wilayah"
                                value={[
                                    row.village_name,
                                    row.district_name,
                                    row.regency_name,
                                    row.province_name,
                                ].join(', ')}
                                readOnly
                                editActivation={false}
                            />
                        </FormControl>
                        <FormControl>
                            <Input
                                label="Kode pos berlaku"
                                value={row.postal_code ?? ''}
                                readOnly
                                editActivation={false}
                            />
                        </FormControl>
                        <GroupFields
                            form={form}
                            setForm={setForm}
                            editing={editing}
                            canManage={canManage}
                            errors={errors}
                        />
                    </FormGrid>
                </form>
            </div>
            {confirmation}
        </RecordEditBoundary>
    );
}

function AddressSetupPage(): ReactNode {
    const { data: props } = useSuspenseQuery(
        orpc.addressSetupPage.queryOptions({
            select: (response) => response.body,
        }),
    );
    const levels = useLevelNames('ID');
    const levelName = levels.name('group_of_houses');
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const village: Village = {
        province_id: search.province ?? '',
        regency_id: search.regency ?? '',
        district_id: search.district ?? '',
        village_id: search.village ?? '',
    };
    const [selected, setSelected] = useState<Row | null>(null);
    const [showDetail, setShowDetail] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.groupOfHousesList(
                {
                    query: {
                        q: query,
                        ...(search.village
                            ? { village_id: search.village }
                            : {}),
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
        [search.village],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (row) => row.id,
    });
    const saved = (row: Row) => {
        setSelected(row);
        setShowDetail(true);
        list.reload();
    };

    return (
        <ListPageLayout
            header={
                <RecordActionBar
                    title="Setup alamat"
                    search={{
                        value: search.q ?? '',
                        onValueChange: (next) =>
                            void navigate({
                                search: (current) => ({
                                    ...current,
                                    q: next || undefined,
                                }),
                                replace: true,
                            }),
                        label: `Cari ${levelName.toLocaleLowerCase()}`,
                        placeholder: 'Cari nama atau kode...',
                    }}
                    filter={{
                        open: filtersOpen,
                        onOpenChange: setFiltersOpen,
                        active: Boolean(village.province_id),
                        controls: filterPanelId,
                    }}
                >
                    {props.canManage && !levels.loading && (
                        <CreateDialog
                            levelName={levelName}
                            initialVillage={village}
                            onCreated={saved}
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
                                <VillageCascade
                                    value={village}
                                    onChange={(next) =>
                                        void navigate({
                                            search: {
                                                ...(search.q
                                                    ? { q: search.q }
                                                    : {}),
                                                ...(next.province_id
                                                    ? {
                                                          province:
                                                              next.province_id,
                                                      }
                                                    : {}),
                                                ...(next.regency_id
                                                    ? {
                                                          regency:
                                                              next.regency_id,
                                                      }
                                                    : {}),
                                                ...(next.district_id
                                                    ? {
                                                          district:
                                                              next.district_id,
                                                      }
                                                    : {}),
                                                ...(next.village_id
                                                    ? {
                                                          village:
                                                              next.village_id,
                                                      }
                                                    : {}),
                                            },
                                            replace: true,
                                        })
                                    }
                                />
                            </FormGrid>
                        </div>
                    </FilterPane>
                ) : null
            }
        >
            <MasterDetailLayout
                detailOpen={showDetail}
                onDetailOpenChange={setShowDetail}
                list={
                    <aside className="flex h-full min-h-0 min-w-0 flex-col">
                        <DataTable
                            data={list.items}
                            getRowKey={(row) => row.id}
                            columns={[
                                {
                                    id: 'code',
                                    header: 'Kode',
                                    width: 90,
                                    cell: (row) => (
                                        <DataTableText>
                                            {row.code ?? '—'}
                                        </DataTableText>
                                    ),
                                    sortValue: (row) => row.code ?? '',
                                },
                                {
                                    id: 'name',
                                    header: 'Nama',
                                    width: 180,
                                    cell: (row) => (
                                        <DataTableText>
                                            {row.name}
                                        </DataTableText>
                                    ),
                                    sortValue: (row) => row.name,
                                },
                                {
                                    id: 'village',
                                    header: levels.name('village'),
                                    width: 180,
                                    cell: (row) => (
                                        <DataTableText>
                                            {row.village_name}
                                        </DataTableText>
                                    ),
                                },
                            ]}
                            activeRowKey={selected?.id}
                            rowActivation="single-click"
                            onRowClick={(row) => {
                                setShowDetail(true);
                                setSelected(row);
                            }}
                            sort={list.sort}
                            onSortChange={list.onSortChange}
                            serverSort
                            incremental={list}
                            emptyMessage={
                                props.canManage
                                    ? `Belum ada ${levelName.toLocaleLowerCase()} yang cocok. Pilih Baru untuk menambah.`
                                    : `Belum ada ${levelName.toLocaleLowerCase()} yang cocok.`
                            }
                        />
                    </aside>
                }
            >
                <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                    {selected ? (
                        <Detail
                            key={`${selected.id}:${selected.version}`}
                            row={selected}
                            levelName={levelName}
                            canManage={props.canManage}
                            onSaved={saved}
                            onDeleted={() => {
                                setSelected(null);
                                setShowDetail(false);
                                list.reload();
                            }}
                        />
                    ) : (
                        <Empty>
                            <EmptyHeader>
                                <EmptyTitle>Pilih {levelName}</EmptyTitle>
                                <EmptyDescription>
                                    Pilih dari daftar untuk melihat atau
                                    mengubah rinciannya.
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
    path: '/sysadmin/geography/address-setup',
    previousPaths: ['/settings/address-setup'],
    layout: 'app',
    title: 'Setup alamat',
    validateSearch: z.object({
        q: z.string().max(200).optional(),
        province: z.string().max(100).optional(),
        regency: z.string().max(100).optional(),
        district: z.string().max(100).optional(),
        village: z.string().max(100).optional(),
    }),
    component: AddressSetupPage,
});
