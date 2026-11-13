import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
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

// Tenaga kesehatan (nakes): orang di buku alamat dengan profesi, spesialis, SIP, dan kode dokter BPJS. Nakes baru memakai
// orang yang sudah ada di buku alamat atau membuat orang baru; nama dan identitasnya sesudah itu diubah di Buku alamat.

const route = getRouteApi('/_app/healthcare/practitioner/practitioners');
const ALL = 'all';
const UNSET = '__unset__';
const NONE = { value: UNSET, label: 'Tidak ada' };
type Practitioner = ApiBody<'healthcarePractitionerList'>['data'][number];
type Metadata = ApiBody<'healthcarePractitionerMetadata'>;
type Person = ApiBody<'partyList'>['data'][number];
type User = ApiBody<'healthcarePractitionerUsers'>['data'][number];
type Search = z.infer<typeof searchSchema>;
type Errors = Record<string, string[]>;
type CardForm = {
    existing: boolean;
    person: Person | null;
    name: string;
    nik: string;
    gender: string;
    phone: string;
    professionId: string;
    specialtyId: string | null;
    subspecialtyId: string | null;
    license_number: string;
    license_valid_until: string;
    bpjs_doctor_code: string;
    user: { id: string; name: string } | null;
    is_active: boolean;
};
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    profession_id: z.string().max(40).optional(),
    status: z.enum(['active', 'inactive']).optional(),
});

function PractitionerCard({
    practitioner,
    metadata,
    portalContainer,
    onSaved,
    onClose,
}: {
    practitioner: Practitioner | null;
    metadata: Metadata;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (practitioner: Practitioner) => void;
    onClose: () => void;
}): ReactNode {
    // Nakes tersimpan langsung terbuka untuk diubah bila pengguna berhak mengubahnya.
    const editing = practitioner === null || metadata.can_manage;
    const blank: CardForm = {
        existing: false,
        person: null,
        name: practitioner?.name ?? '',
        nik: '',
        gender: '',
        phone: '',
        professionId: practitioner?.profession_id ?? '',
        specialtyId: practitioner?.specialty_id ?? null,
        subspecialtyId: practitioner?.subspecialty_id ?? null,
        license_number: practitioner?.license_number ?? '',
        license_valid_until: practitioner?.license_valid_until ?? '',
        bpjs_doctor_code: practitioner?.bpjs_doctor_code ?? '',
        user:
            practitioner?.user_id && practitioner.user_name
                ? { id: practitioner.user_id, name: practitioner.user_name }
                : null,
        // Nakes baru langsung aktif.
        is_active: practitioner?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const profession =
        metadata.professions.find((item) => item.id === form.professionId) ??
        null;
    // Sub spesialis yang ditawarkan hanya milik spesialis yang dipilih, seperti populate_subspecialist sistem lama.
    const specialty =
        metadata.specialties.find((item) => item.id === form.specialtyId) ??
        null;
    const subspecialties = specialty?.subspecialties ?? [];
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const dirty = JSON.stringify(form) !== JSON.stringify(blank);
    usePageDialogRecord({
        recordTitle: practitioner?.name ?? 'Nakes baru',
        editing,
        dirty,
    });
    const error = (field: string) => errors[field]?.[0];
    const personLoader = useCallback<LookupLoader<Person>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.partyList(
                {
                    query: {
                        q: query,
                        type: 'person',
                        status: 'active',
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const userLoader = useCallback<LookupLoader<User>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcarePractitionerUsers(
                { query: { q: query, ...(cursor ? { cursor } : {}) } },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const nullable = (value: string) => (value.trim() === '' ? null : value);

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const details = {
            profession_id: form.professionId,
            specialty_id: form.specialtyId,
            subspecialty_id: form.subspecialtyId,
            license_number: nullable(form.license_number),
            license_valid_until: nullable(form.license_valid_until),
            bpjs_doctor_code: nullable(form.bpjs_doctor_code),
            user_id: form.user?.id ?? null,
            is_active: form.is_active,
        };
        try {
            const { body } = practitioner
                ? await api.healthcarePractitionerUpdate({
                      params: { id: practitioner.id },
                      body: { ...details, version: practitioner.version },
                  })
                : await api.healthcarePractitionerCreate({
                      body: form.existing
                          ? { ...details, party_id: form.person?.id ?? '' }
                          : {
                                ...details,
                                name: form.name,
                                nik: nullable(form.nik),
                                gender: nullable(form.gender),
                                phone: nullable(form.phone),
                            },
                  });
            toast.success(practitioner ? 'Nakes diperbarui.' : 'Nakes dibuat.');
            onSaved(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Nakes belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!practitioner) return;
        if (
            !(await confirm({
                title: `Delete nakes ${practitioner.name}?`,
                description:
                    'Nakes ini tidak bisa dipilih lagi. Orangnya tetap ada di buku alamat.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcarePractitionerDelete({
                params: { id: practitioner.id },
                body: { version: practitioner.version },
            });
            toast.success('Nakes dihapus.');
            onClose();
        } catch (caught) {
            setMessage(errorText(caught, 'Nakes belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };
    const text = (
        field: 'name' | 'nik' | 'phone' | 'license_number' | 'bpjs_doctor_code',
        label: string,
        options: {
            required?: boolean;
            maxLength: number;
            inputMode?: 'numeric' | 'tel';
            readOnly?: boolean;
            hint?: string;
        },
    ) => (
        <FormControl error={error(field)} hint={options.hint}>
            <Input
                label={label}
                required={options.required}
                maxLength={options.maxLength}
                inputMode={options.inputMode}
                data-error-field={field}
                value={form[field]}
                readOnly={!editing || options.readOnly}
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
                                if (!practitioner) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {practitioner && metadata.can_manage && (
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
                operation="Nakes belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    {practitioner === null && metadata.can_pick_party && (
                        <Field orientation="horizontal" className="w-auto">
                            <Switch
                                id="practitioner-existing"
                                checked={form.existing}
                                onCheckedChange={(checked) =>
                                    setForm({ ...form, existing: checked })
                                }
                            />
                            <FieldLabel htmlFor="practitioner-existing">
                                Orangnya sudah ada di buku alamat
                            </FieldLabel>
                        </Field>
                    )}
                    {practitioner === null && form.existing ? (
                        <FormControl error={error('party_id')}>
                            <InlineLookup
                                label="Orang"
                                required
                                loadItems={personLoader}
                                value={form.person}
                                onValueChange={(person) =>
                                    setForm({ ...form, person })
                                }
                                getItemValue={(item) => item.id}
                                getItemLabel={(item) => item.name}
                                placeholder="Cari nama di buku alamat…"
                                emptyMessage="Orang tidak ditemukan."
                                columns={[
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        cell: (item) => item.name,
                                    },
                                    {
                                        id: 'city',
                                        header: 'Kota',
                                        cell: (item) => item.city ?? '',
                                    },
                                ]}
                                portalContainer={portalContainer}
                                showDetails={false}
                            />
                        </FormControl>
                    ) : (
                        text('name', 'Nama', {
                            required: true,
                            maxLength: 200,
                            readOnly: practitioner !== null,
                            hint: practitioner
                                ? 'Nama dan identitas diubah di Buku alamat, karena orangnya bisa dipakai peran lain.'
                                : 'Orang baru dibuat di buku alamat dengan isian ini.',
                        })
                    )}
                    {practitioner === null && !form.existing && (
                        <>
                            {text('nik', 'NIK', {
                                maxLength: 30,
                                inputMode: 'numeric',
                            })}
                            <FormControl error={error('gender')}>
                                <Select
                                    label="Jenis kelamin"
                                    items={[
                                        { value: UNSET, label: 'Belum diisi' },
                                        ...metadata.genders.map((gender) => ({
                                            value: gender.code,
                                            label: gender.name,
                                        })),
                                    ]}
                                    value={form.gender || UNSET}
                                    onValueChange={(value) =>
                                        setForm({
                                            ...form,
                                            gender:
                                                value === null ||
                                                value === UNSET
                                                    ? ''
                                                    : value,
                                        })
                                    }
                                    searchPlaceholder="Cari jenis kelamin"
                                    emptyMessage="Pilihan tidak ditemukan."
                                    portalContainer={portalContainer}
                                />
                            </FormControl>
                            {text('phone', 'No. HP', {
                                maxLength: 30,
                                inputMode: 'tel',
                            })}
                        </>
                    )}
                    <FormControl
                        error={error('profession_id')}
                        data-error-field="profession_id"
                    >
                        <InlineLookup
                            label="Profesi"
                            required
                            disabled={!editing}
                            items={metadata.professions.filter(
                                (item) =>
                                    item.is_active ||
                                    item.id === form.professionId,
                            )}
                            value={profession}
                            displayValue={profession?.name ?? ''}
                            onValueChange={(item) =>
                                setForm({ ...form, professionId: item.id })
                            }
                            getItemValue={(item) => item.id}
                            getItemLabel={(item) => item.name}
                            getSearchText={(item) =>
                                `${item.code} ${item.name}`
                            }
                            placeholder="Cari profesi…"
                            emptyMessage="Profesi tidak ditemukan."
                            showDetails={false}
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
                                    width: 200,
                                    cell: (item) => item.name,
                                },
                            ]}
                        />
                    </FormControl>
                    <FormControl
                        error={error('specialty_id')}
                        data-error-field="specialty_id"
                    >
                        {editing ? (
                            <Select
                                label="Spesialis"
                                items={[
                                    NONE,
                                    ...metadata.specialties.map((item) => ({
                                        value: item.id,
                                        label: item.name,
                                    })),
                                ]}
                                value={form.specialtyId ?? UNSET}
                                onValueChange={(value) => {
                                    const specialtyId =
                                        value === null || value === UNSET
                                            ? null
                                            : value;
                                    setForm({
                                        ...form,
                                        specialtyId,
                                        subspecialtyId:
                                            specialtyId === form.specialtyId
                                                ? form.subspecialtyId
                                                : null,
                                    });
                                }}
                                searchPlaceholder="Cari spesialis"
                                emptyMessage="Spesialis tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Spesialis"
                                value={practitioner.specialty_name ?? ''}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl
                        error={error('subspecialty_id')}
                        data-error-field="subspecialty_id"
                    >
                        {editing ? (
                            <Select
                                label="Sub Spesialis"
                                items={[
                                    NONE,
                                    ...subspecialties.map((item) => ({
                                        value: item.id,
                                        label: item.name,
                                    })),
                                ]}
                                value={form.subspecialtyId ?? UNSET}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        subspecialtyId:
                                            value === null || value === UNSET
                                                ? null
                                                : value,
                                    })
                                }
                                searchPlaceholder="Cari sub spesialis"
                                emptyMessage="Sub spesialis tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Sub Spesialis"
                                value={practitioner.subspecialty_name ?? ''}
                                readOnly
                            />
                        )}
                    </FormControl>
                    {text('license_number', 'No. SIP', { maxLength: 100 })}
                    <FormControl error={error('license_valid_until')}>
                        {editing ? (
                            <DatePicker
                                label="SIP berlaku sampai"
                                data-error-field="license_valid_until"
                                value={form.license_valid_until}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        license_valid_until: value,
                                    })
                                }
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="SIP berlaku sampai"
                                value={displayDate(form.license_valid_until)}
                                readOnly
                            />
                        )}
                    </FormControl>
                    {text('bpjs_doctor_code', 'Kode dokter BPJS', {
                        maxLength: 50,
                    })}
                    <FormControl
                        error={error('user_id')}
                        hint="Akun yang dipakai nakes ini untuk masuk ke aplikasi. Boleh dikosongkan."
                    >
                        {editing ? (
                            <InlineLookup
                                label="Akun login"
                                loadItems={userLoader}
                                value={
                                    form.user
                                        ? { ...form.user, email: '' }
                                        : null
                                }
                                onValueChange={(user) =>
                                    setForm({
                                        ...form,
                                        user: { id: user.id, name: user.name },
                                    })
                                }
                                getItemValue={(item) => item.id}
                                getItemLabel={(item) => item.name}
                                placeholder="Cari nama atau email…"
                                emptyMessage="Akun tidak ditemukan."
                                columns={[
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        cell: (item) => item.name,
                                    },
                                    {
                                        id: 'email',
                                        header: 'Email',
                                        cell: (item) => item.email,
                                    },
                                ]}
                                portalContainer={portalContainer}
                                showDetails={false}
                            />
                        ) : (
                            <Input
                                label="Akun login"
                                value={form.user?.name ?? ''}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="practitioner-active"
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor="practitioner-active">
                            Aktif
                        </FieldLabel>
                    </Field>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function PractitionersPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcarePractitionerMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<Practitioner | 'new' | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { profession_id: professionId, status } = search;
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
    const loader = useCallback<ListLoader<Practitioner>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcarePractitionerList(
                {
                    query: {
                        q: query,
                        ...(professionId
                            ? { profession_id: professionId }
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
        [professionId, status],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (practitioner) => practitioner.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Nakes"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari nakes',
                            placeholder: 'Cari nama atau no. SIP...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(professionId || status),
                            controls: filterPanelId,
                        }}
                    >
                        {metadata.can_manage && (
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
                                            label="Profesi"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua profesi',
                                                },
                                                ...metadata.professions.map(
                                                    (item) => ({
                                                        value: item.id,
                                                        label: item.name,
                                                    }),
                                                ),
                                            ]}
                                            value={professionId ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    profession_id:
                                                        value === null ||
                                                        value === ALL
                                                            ? undefined
                                                            : value,
                                                })
                                            }
                                            searchPlaceholder="Cari profesi"
                                            emptyMessage="Profesi tidak ditemukan."
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
                        {list.items.length} nakes dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(practitioner) => practitioner.id}
                    getRowLabel={(practitioner) => practitioner.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, practitioner) => setOpen(practitioner)}
                    onRowClick={(practitioner) => setOpen(practitioner)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        metadata.can_manage
                            ? 'Belum ada nakes yang cocok. Pilih Baru atau ubah pencarian.'
                            : 'Belum ada nakes yang cocok.'
                    }
                    columns={[
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 260,
                            cell: (practitioner) => (
                                <DataTableText>
                                    {practitioner.name}
                                </DataTableText>
                            ),
                            sortValue: (practitioner) => practitioner.name,
                        },
                        {
                            id: 'profession',
                            header: 'Profesi',
                            width: 140,
                            cell: (practitioner) => (
                                <DataTableText>
                                    {practitioner.profession_name}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'specialty',
                            header: 'Spesialis',
                            width: 200,
                            cell: (practitioner) => (
                                <DataTableText>
                                    {practitioner.specialty_name ?? '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'license_number',
                            header: 'No. SIP',
                            width: 180,
                            cell: (practitioner) => (
                                <DataTableText>
                                    {practitioner.license_number ?? '—'}
                                </DataTableText>
                            ),
                            sortValue: (practitioner) =>
                                practitioner.license_number ?? '',
                        },
                        {
                            id: 'license_valid_until',
                            header: 'SIP berlaku sampai',
                            width: 150,
                            cell: (practitioner) => (
                                <DataTableText>
                                    {practitioner.license_valid_until
                                        ? displayDate(
                                              practitioner.license_valid_until,
                                          )
                                        : '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (practitioner) => (
                                <Badge
                                    variant={
                                        practitioner.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {practitioner.is_active
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
                    <PageDialogContent ref={contentRef} title="Nakes">
                        <PractitionerCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            practitioner={open === 'new' ? null : open}
                            metadata={metadata}
                            portalContainer={contentRef}
                            onSaved={(practitioner) => {
                                setOpen(practitioner);
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
    path: '/healthcare/practitioner/practitioners',
    layout: 'app',
    title: 'Nakes',
    validateSearch: searchSchema,
    component: PractitionersPage,
});
