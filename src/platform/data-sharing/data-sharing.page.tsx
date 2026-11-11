import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
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
import { TransferList } from '@operations-metta/ui/transfer-list';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useQuery } from '@tanstack/react-query';
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
} from '../shell/index.ts';

// Data sharing antar legal entity, pola "Configure cross-company data sharing" F&O. Bawaannya setiap
// legal entity hanya melihat datanya sendiri; legal entity yang dipilih dalam satu kebijakan aktif saling melihat satu
// jenis data sejak tanggal berlakunya. Jenis datanya didaftarkan module pemiliknya, misalnya Master pasien.

const route = getRouteApi('/_app/sysadmin/data-sharing');
const ALL = 'all';
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    data_type: z.string().max(160).optional(),
});
type Search = z.infer<typeof searchSchema>;
type Policy = ApiBody<'dataSharingPolicyList'>['data'][number];
type DataType = ApiBody<'dataSharingTypes'>['data'][number];
type Errors = Record<string, string[]>;

const today = () => new Date().toISOString().slice(0, 10);

function DataSharingPolicyCard({
    policy,
    dataTypes,
    canManage,
    portalContainer,
    onSaved,
    onClose,
}: {
    policy: Policy | null;
    dataTypes: DataType[];
    canManage: boolean;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (policy: Policy) => void;
    onClose: () => void;
}): ReactNode {
    // Kebijakan tersimpan langsung terbuka untuk diubah bila pengguna berhak mengubahnya.
    const editing = policy === null || canManage;
    const blank = {
        name: policy?.name ?? '',
        // Bila hanya ada satu jenis data, kebijakan baru langsung memakainya.
        data_type_code:
            policy?.data_type.code ??
            (dataTypes.length === 1 ? (dataTypes[0]?.code ?? '') : ''),
        // Kebijakan baru langsung aktif dan berlaku hari ini.
        is_active: policy?.is_active ?? true,
        effective_from: policy?.effective_from ?? today(),
        legal_entity_ids:
            policy?.legal_entities.map((entity) => entity.id) ?? [],
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const legalEntities = useQuery(
        orpc.dataSharingLegalEntities.queryOptions({
            input: { query: { data_type: form.data_type_code } },
            select: (response) => response.body.data,
        }),
    );
    usePageDialogRecord({
        recordTitle: policy?.name ?? 'Kebijakan data sharing baru',
        editing,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = policy
                ? await api.dataSharingPolicyUpdate({
                      params: { id: policy.id },
                      body: { ...form, version: policy.version },
                  })
                : await api.dataSharingPolicyCreate({ body: form });
            toast.success(
                policy
                    ? 'Kebijakan sharing diperbarui.'
                    : 'Kebijakan sharing dibuat.',
            );
            onSaved(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Kebijakan sharing belum disimpan.'),
                );
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!policy) return;
        if (
            !(await confirm({
                title: `Delete kebijakan ${policy.name}?`,
                description:
                    'Legal entity di kebijakan ini kembali hanya melihat datanya sendiri. Datanya tidak berubah.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.dataSharingPolicyDelete({
                params: { id: policy.id },
                body: { version: policy.version },
            });
            toast.success('Kebijakan sharing dihapus.');
            onClose();
        } catch (caught) {
            setMessage(errorText(caught, 'Kebijakan sharing belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    const chosen = new Set(form.legal_entity_ids);
    const item = (entity: NonNullable<typeof legalEntities.data>[number]) => ({
        id: entity.id,
        label: entity.company_code
            ? `${entity.name} (${entity.company_code})`
            : entity.name,
        // Legal entity yang sudah ikut kebijakan aktif lain diberi tahu sebelum dipilih.
        ...(entity.policy_id && entity.policy_id !== policy?.id
            ? { description: `Sudah ikut kebijakan "${entity.policy_name}"` }
            : {}),
    });
    const entities = legalEntities.data ?? [];

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
                                if (!policy) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {policy && canManage && (
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
                operation="Kebijakan sharing belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl error={errors.name?.[0]}>
                        <Input
                            label="Nama"
                            required
                            maxLength={100}
                            data-error-field="name"
                            value={form.name}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl
                        error={errors.data_type_code?.[0]}
                        hint={
                            dataTypes.find(
                                (type) => type.code === form.data_type_code,
                            )?.description ?? undefined
                        }
                    >
                        {editing ? (
                            <div data-error-field="data_type_code">
                                <Select
                                    label="Data yang di-share"
                                    required
                                    items={dataTypes.map((type) => ({
                                        value: type.code,
                                        label: type.name,
                                    }))}
                                    value={form.data_type_code || null}
                                    onValueChange={(value) =>
                                        setForm({
                                            ...form,
                                            data_type_code: value ?? '',
                                        })
                                    }
                                    placeholder="Pilih data"
                                    searchPlaceholder="Cari data"
                                    emptyMessage="Data tidak ditemukan."
                                    portalContainer={portalContainer}
                                />
                            </div>
                        ) : (
                            <Input
                                label="Data yang di-share"
                                value={policy.data_type.name}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl
                        error={errors.effective_from?.[0]}
                        hint="Sejak tanggal ini legal entity yang dipilih saling melihat data itu."
                    >
                        <DatePicker
                            label="Berlaku mulai"
                            required
                            data-error-field="effective_from"
                            value={form.effective_from}
                            readOnly={!editing}
                            onValueChange={(value) =>
                                setForm({ ...form, effective_from: value })
                            }
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="data-sharing-policy-active"
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor="data-sharing-policy-active">
                            Aktif
                        </FieldLabel>
                    </Field>
                </FormGrid>
                <div className="mt-4" data-error-field="legal_entity_ids">
                    {legalEntities.isError ? (
                        <p role="alert" className="text-sm text-destructive">
                            Daftar legal entity belum berhasil dimuat. Tutup
                            kartu ini lalu buka lagi.
                        </p>
                    ) : legalEntities.isPending ? (
                        <p
                            role="status"
                            className="text-sm text-muted-foreground"
                        >
                            Memuat daftar legal entity…
                        </p>
                    ) : (
                        <TransferList
                            remainingTitle="Legal entity lain"
                            selectedTitle="Saling sharing data ini"
                            remaining={entities
                                .filter((entity) => !chosen.has(entity.id))
                                .map(item)}
                            selected={entities
                                .filter((entity) => chosen.has(entity.id))
                                .map(item)}
                            onChange={(next) =>
                                setForm({
                                    ...form,
                                    legal_entity_ids: next.selected.map(
                                        (entry) => entry.id,
                                    ),
                                })
                            }
                            disabled={!editing || busy}
                            remainingEmptyLabel="Tidak ada legal entity lain."
                            selectedEmptyLabel="Belum ada legal entity. Pindahkan sedikitnya dua dari daftar kiri."
                        />
                    )}
                    {errors.legal_entity_ids?.map((text) => (
                        <p
                            key={text}
                            role="alert"
                            className="mt-2 text-sm text-destructive"
                        >
                            {text}
                        </p>
                    ))}
                </div>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function DataSharingPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<Policy | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { status, data_type: dataType } = search;
    const dataTypes = useQuery(
        orpc.dataSharingTypes.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    const loader = useCallback<ListLoader<Policy>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.dataSharingPolicyList(
                {
                    query: {
                        q: query,
                        ...(status ? { status } : {}),
                        ...(dataType ? { data_type: dataType } : {}),
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            setCanManage(body.can_manage);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [status, dataType],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (policy) => policy.id,
    });
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

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Data sharing"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari kebijakan data sharing',
                            placeholder: 'Cari nama kebijakan...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(status ?? dataType),
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
                                            label="Data yang di-share"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua data',
                                                },
                                                ...(dataTypes.data ?? []).map(
                                                    (type) => ({
                                                        value: type.code,
                                                        label: type.name,
                                                    }),
                                                ),
                                            ]}
                                            value={dataType ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    data_type:
                                                        value === ALL ||
                                                        value === null
                                                            ? undefined
                                                            : value,
                                                })
                                            }
                                            searchPlaceholder="Cari data"
                                            emptyMessage="Data tidak ditemukan."
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
                        {list.items.length} kebijakan dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(policy) => policy.id}
                    getRowLabel={(policy) => policy.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, policy) => setOpen(policy)}
                    onRowClick={(policy) => setOpen(policy)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada kebijakan. Setiap legal entity hanya melihat datanya sendiri. Pilih Baru untuk memilih data dan legal entity yang saling sharing.'
                            : 'Belum ada kebijakan. Setiap legal entity hanya melihat datanya sendiri.'
                    }
                    columns={[
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 240,
                            cell: (policy) => (
                                <DataTableText>{policy.name}</DataTableText>
                            ),
                            sortValue: (policy) => policy.name,
                        },
                        {
                            id: 'data_type',
                            header: 'Data',
                            width: 180,
                            cell: (policy) => (
                                <DataTableText>
                                    {policy.data_type.name}
                                </DataTableText>
                            ),
                            sortValue: (policy) => policy.data_type.name,
                        },
                        {
                            id: 'legal_entities',
                            header: 'Legal entity',
                            width: 320,
                            cell: (policy) => (
                                <DataTableText>
                                    {policy.legal_entities
                                        .map((entity) => entity.name)
                                        .join(', ') || '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'effective_from',
                            header: 'Berlaku mulai',
                            width: 130,
                            cell: (policy) => (
                                <DataTableText>
                                    {displayDate(policy.effective_from)}
                                </DataTableText>
                            ),
                            sortValue: (policy) => policy.effective_from,
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (policy) => (
                                <Badge
                                    variant={
                                        policy.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {policy.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent
                        ref={contentRef}
                        title="Kebijakan data sharing"
                    >
                        <DataSharingPolicyCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            policy={open === 'new' ? null : open}
                            dataTypes={dataTypes.data ?? []}
                            canManage={canManage}
                            portalContainer={contentRef}
                            onSaved={(policy) => {
                                setOpen(policy);
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
    path: '/sysadmin/data-sharing',
    previousPaths: [
        '/healthcare/sharing-policies',
        '/healthcare/patient/sharing-policies',
    ],
    layout: 'app',
    title: 'Data sharing',
    validateSearch: searchSchema,
    component: DataSharingPage,
});
