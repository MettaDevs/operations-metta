import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { Textarea } from '@operations-metta/ui/textarea';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    draftPayload,
    emptyPartyDraft,
    errorText,
    FormErrorHeader,
    PartyAddressesSection,
    PartyContactsSection,
    type ApiBody,
    type PartyDraft,
} from '../shell/index.ts';
import {
    PartyDuplicatesSection,
    type DuplicateCandidate,
} from './party-duplicates.tsx';
import {
    PartyIdentifications,
    type DraftIdentification,
} from './party-identifications.tsx';
import { PartyRelationships } from './party-relationships.tsx';

export type Metadata = ApiBody<'partyMetadata'>['data'];
type Party = ApiBody<'partyShow'>['data'];
export type PartyRow = ApiBody<'partyList'>['data'][number];
type Occupation = ApiBody<'occupationList'>['data'][number];
type Errors = Record<string, string[]>;

// Isian identitas party yang diubah lewat form. Nomor identitas, alamat, kontak, dan hubungan punya bagian sendiri.
type PartyForm = {
    type: string;
    name: string;
    search_name: string;
    status: string;
    tax_number: string;
    organization_number: string;
    gender: string;
    birth_place: string;
    birth_date: string;
    nationality_country_code: string;
    religion: string;
    marital_status: string;
    anniversary_date: string;
    number_of_children: string;
    education: string;
    occupation_id: string;
    occupation_name: string;
    interests: string;
    language: string;
    memo: string;
};

// Pilihan kosong pada rujukan opsional. Select SDK menganggap nilai kosong sebagai belum memilih, jadi pilihan ini butuh
// nilai sendiri.
const UNSET = 'unset';

function formOf(party: Party | null): PartyForm {
    const text = (value: string | null | undefined) => value ?? '';
    return {
        type: party?.type ?? 'person',
        name: text(party?.name),
        search_name: text(party?.search_name),
        // Pihak baru langsung aktif; status pihak lama tetap mengikuti record.
        status: party?.status ?? 'active',
        tax_number: text(party?.tax_number),
        organization_number: text(party?.organization_number),
        gender: text(party?.gender),
        birth_place: text(party?.birth_place),
        birth_date: text(party?.birth_date),
        nationality_country_code: party
            ? text(party.nationality_country_code)
            : 'ID',
        religion: text(party?.religion),
        marital_status: text(party?.marital_status),
        anniversary_date: text(party?.anniversary_date),
        number_of_children:
            party?.number_of_children == null
                ? ''
                : String(party.number_of_children),
        education: text(party?.education),
        occupation_id: text(party?.occupation_id),
        occupation_name: text(party?.occupation_name),
        interests: text(party?.interests),
        language: party ? text(party.language) : 'id',
        memo: text(party?.memo),
    };
}

const personFields = [
    'gender',
    'birth_place',
    'birth_date',
    'nationality_country_code',
    'religion',
    'marital_status',
    'anniversary_date',
    'number_of_children',
    'education',
    'occupation_id',
    'interests',
] as const;

// Kiriman simpan party: teks kosong menjadi null, dan isian orang hanya dikirim untuk orang.
function partyBody(form: PartyForm, searchEdited: boolean) {
    const nullable = (value: string) => (value.trim() === '' ? null : value);
    const person = form.type === 'person';
    return {
        type: form.type,
        name: form.name,
        status: form.status,
        ...(searchEdited ? { search_name: nullable(form.search_name) } : {}),
        tax_number: nullable(form.tax_number),
        language: nullable(form.language),
        memo: nullable(form.memo),
        ...(person
            ? {
                  ...Object.fromEntries(
                      personFields.map((field) => [
                          field,
                          nullable(form[field]),
                      ]),
                  ),
                  number_of_children:
                      form.number_of_children.trim() === ''
                          ? null
                          : Number(form.number_of_children),
              }
            : { organization_number: nullable(form.organization_number) }),
    };
}

function OccupationField({
    value,
    label,
    editing,
    portalContainer,
    error,
    onChange,
}: {
    value: { id: string; name: string } | null;
    label: string;
    editing: boolean;
    portalContainer: RefObject<HTMLElement | null>;
    error?: string;
    onChange: (occupation: Occupation) => void;
}) {
    const loader = useCallback<LookupLoader<Occupation>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.occupationList(
                { query: { q: query, ...(cursor ? { cursor } : {}) } },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    return (
        <FormControl error={error}>
            {editing ? (
                <InlineLookup
                    label={label}
                    loadItems={loader}
                    value={
                        value
                            ? { id: value.id, name: value.name, version: 0 }
                            : null
                    }
                    onValueChange={onChange}
                    getItemValue={(item) => item.id}
                    getItemLabel={(item) => item.name}
                    placeholder="Cari pekerjaan…"
                    emptyMessage="Pekerjaan tidak ditemukan. Tambahkan di Pekerjaan."
                    columns={[
                        {
                            id: 'name',
                            header: 'Pekerjaan',
                            cell: (item) => item.name,
                        },
                    ]}
                    portalContainer={portalContainer}
                    showDetails={false}
                />
            ) : (
                <Input label={label} value={value?.name ?? ''} readOnly />
            )}
        </FormControl>
    );
}

/**
 * Kartu satu party di Buku alamat: identitas, nomor identitas, alamat, kontak, hubungan, peran, dan kandidat data
 * ganda. Tanpa `partyId`, kartu adalah form party baru: nomor identitas, alamat, dan kontak diisi sebagai draft lalu
 * disimpan bersama party dalam satu permintaan.
 */
export function PartyCard({
    partyId,
    metadata,
    portalContainer,
    onCreated,
    onUpdated,
    onDeleted,
    onCancelNew,
    onOpenParty,
    onBusyChange,
    onDirtyChange,
}: {
    partyId: string | null;
    metadata: Metadata;
    portalContainer: RefObject<HTMLElement | null>;
    onCreated: (party: PartyRow, duplicates: DuplicateCandidate[]) => void;
    onUpdated: (party: PartyRow) => void;
    onDeleted: () => void;
    onCancelNew: () => void;
    onOpenParty: (id: string) => void;
    onBusyChange: (busy: boolean) => void;
    onDirtyChange: (dirty: boolean) => void;
}): ReactNode {
    const creating = partyId === null;
    const stored = useQuery({
        queryKey: ['party', partyId],
        queryFn: async () => {
            if (partyId === null) throw new Error('Pihak belum tersimpan.');
            return (await api.partyShow({ params: { id: partyId } })).body.data;
        },
        enabled: !creating,
    });
    const party = stored.data ?? null;

    if (!creating && !party)
        return (
            <div className="space-y-3 p-6">
                <p
                    role={stored.isError ? 'alert' : 'status'}
                    className={
                        stored.isError
                            ? 'text-sm text-destructive'
                            : 'text-sm text-muted-foreground'
                    }
                >
                    {stored.isError
                        ? errorText(stored.error, 'Pihak belum dapat dimuat.')
                        : 'Memuat pihak…'}
                </p>
                {stored.isError && (
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void stored.refetch()}
                    >
                        Coba lagi
                    </Button>
                )}
            </div>
        );

    return (
        <PartyCardBody
            key={party ? `${party.id}:${party.version}` : 'new'}
            party={party}
            metadata={metadata}
            portalContainer={portalContainer}
            onReload={() => void stored.refetch()}
            onCreated={onCreated}
            onUpdated={(saved) => {
                void stored.refetch();
                onUpdated(saved);
            }}
            onDeleted={onDeleted}
            onCancelNew={onCancelNew}
            onOpenParty={onOpenParty}
            onBusyChange={onBusyChange}
            onDirtyChange={onDirtyChange}
        />
    );
}

function PartyCardBody({
    party,
    metadata,
    portalContainer,
    onReload,
    onCreated,
    onUpdated,
    onDeleted,
    onCancelNew,
    onOpenParty,
    onBusyChange,
    onDirtyChange,
}: {
    party: Party | null;
    metadata: Metadata;
    portalContainer: RefObject<HTMLElement | null>;
    onReload: () => void;
    onCreated: (party: PartyRow, duplicates: DuplicateCandidate[]) => void;
    onUpdated: (party: PartyRow) => void;
    onDeleted: () => void;
    onCancelNew: () => void;
    onOpenParty: (id: string) => void;
    onBusyChange: (busy: boolean) => void;
    onDirtyChange: (dirty: boolean) => void;
}): ReactNode {
    const canManage = metadata.canManage;
    // Pihak tersimpan langsung terbuka untuk diubah bila pengguna berhak mengubahnya.
    const editing = party === null || canManage;
    const [form, setForm] = useState(() => formOf(party));
    const [searchEdited, setSearchEdited] = useState(
        () =>
            party !== null &&
            party.search_name !==
                party.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
    );
    const [identifications, setIdentifications] = useState<
        DraftIdentification[]
    >([]);
    const [details, setDetails] = useState<PartyDraft>(emptyPartyDraft);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const person = form.type === 'person';
    const internalOrganization = Boolean(party?.organization_id);
    const dirty =
        editing &&
        (JSON.stringify(form) !== JSON.stringify(formOf(party)) ||
            identifications.length > 0 ||
            details.locations.length > 0 ||
            details.contacts.length > 0);
    useEffect(() => {
        onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);
    useEffect(() => {
        onBusyChange(busy);
    }, [busy, onBusyChange]);
    useEffect(
        () => () => {
            onDirtyChange(false);
            onBusyChange(false);
        },
        [onDirtyChange, onBusyChange],
    );
    const set = (field: keyof PartyForm, value: string) =>
        setForm((current) => ({ ...current, [field]: value }));
    const references = (category: string) =>
        metadata.referenceValues[category] ?? [];
    const referenceName = (category: string, code: string) =>
        references(category).find((value) => value.code === code)?.name ?? code;
    const typeName = (code: string) =>
        metadata.partyTypes.find((type) => type.code === code)?.name ?? code;
    const error = (field: string) => errors[field]?.[0];

    const cancel = () => {
        if (party === null) {
            onCancelNew();
            return;
        }
        setForm(formOf(party));
        setErrors({});
        setMessage(null);
    };

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            if (party === null) {
                const { body } = await api.partyCreate({
                    body: {
                        ...partyBody(form, searchEdited),
                        identifications: identifications.map(
                            ({ type_code, number }) => ({ type_code, number }),
                        ),
                        party_details: draftPayload(details),
                    },
                });
                toast.success('Pihak dibuat.');
                onCreated(body.data, body.duplicates);
            } else {
                const { body } = await api.partyUpdate({
                    params: { id: party.id },
                    body: {
                        ...partyBody(form, searchEdited),
                        version: party.version,
                    },
                });
                toast.success('Pihak diperbarui.');
                onUpdated(body.data);
            }
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(
                        caught,
                        party
                            ? 'Perubahan belum disimpan.'
                            : 'Pihak belum dibuat.',
                    ),
                );
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!party) return;
        const confirmed = await confirm({
            title: `Delete ${party.name}?`,
            description:
                'Pihak disembunyikan dari daftar aktif dan dapat dipulihkan dari daftar terhapus. Pihak yang masih dipakai akun bisnis atau organisasi tidak dapat dihapus; nonaktifkan lewat Ubah.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!confirmed) return;
        setBusy(true);
        setMessage(null);
        try {
            await api.partyDelete({
                params: { id: party.id },
                body: { version: party.version },
            });
            toast.success('Pihak dihapus.');
            onDeleted();
        } catch (caught) {
            setMessage(errorText(caught, 'Pihak belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    usePageDialogRecord({
        recordTitle: editing ? form.name || 'Pihak baru' : party.name,
        editing,
        dirty,
        onDelete: party && canManage ? () => void remove() : undefined,
        recordUrl: party
            ? `/sysadmin/address-book/parties?party=${party.id}`
            : undefined,
    });

    const select = (
        field: keyof PartyForm,
        label: string,
        category: string,
    ) => (
        <FormControl key={field} error={error(field)} data-error-field={field}>
            {editing ? (
                <Select
                    label={label}
                    items={[
                        { value: UNSET, label: 'Belum diisi' },
                        ...references(category).map((value) => ({
                            value: value.code,
                            label: value.name,
                        })),
                    ]}
                    value={form[field] || UNSET}
                    onValueChange={(value) =>
                        set(
                            field,
                            value === null || value === UNSET ? '' : value,
                        )
                    }
                    searchPlaceholder={`Cari ${label.toLocaleLowerCase()}`}
                    emptyMessage="Pilihan tidak ditemukan."
                    portalContainer={portalContainer}
                />
            ) : (
                <Input
                    label={label}
                    value={
                        form[field] ? referenceName(category, form[field]) : ''
                    }
                    readOnly
                />
            )}
        </FormControl>
    );
    const text = (
        field: keyof PartyForm,
        label: string,
        options: {
            required?: boolean;
            maxLength?: number;
            inputMode?: 'numeric';
            hint?: string;
            readOnly?: boolean;
            onChange?: (value: string) => void;
        } = {},
    ) => (
        <FormControl key={field} error={error(field)} hint={options.hint}>
            <Input
                label={label}
                required={options.required}
                maxLength={options.maxLength}
                inputMode={options.inputMode}
                data-error-field={field}
                value={form[field]}
                readOnly={!editing || options.readOnly}
                onChange={(event) =>
                    options.onChange
                        ? options.onChange(event.target.value)
                        : set(field, event.target.value)
                }
            />
        </FormControl>
    );
    const date = (field: keyof PartyForm, label: string) => (
        <FormControl key={field} error={error(field)}>
            {editing ? (
                <DatePicker
                    label={label}
                    data-error-field={field}
                    value={form[field]}
                    onValueChange={(value) => set(field, value)}
                    portalContainer={portalContainer}
                />
            ) : (
                <Input
                    label={label}
                    value={displayDate(form[field])}
                    readOnly
                />
            )}
        </FormControl>
    );
    const countryName = (code: string) =>
        metadata.countries.find((country) => country.code === code)?.name ??
        code;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <form
                noValidate
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                {editing && (
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
                            onClick={cancel}
                        />
                    </PageDialogToolbar>
                )}
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation={
                        party
                            ? 'Perubahan belum disimpan'
                            : 'Pihak belum dibuat'
                    }
                />
                <PageDialogBody className="py-3">
                    <CollapsibleSectionGroup
                        defaultValue={[
                            'general',
                            'person',
                            'identifications',
                            'addresses',
                            'contacts',
                            'relationships',
                        ]}
                        className="space-y-3"
                    >
                        <CollapsibleSection
                            value="general"
                            title="Umum"
                            summary={`${typeName(form.type)} · ${form.name || 'Belum bernama'}`}
                        >
                            <FormGrid>
                                <FormControl
                                    error={error('type')}
                                    data-error-field="type"
                                >
                                    {party === null ? (
                                        <Select
                                            label="Jenis pihak"
                                            required
                                            items={metadata.partyTypes
                                                .filter((type) =>
                                                    [
                                                        'person',
                                                        'organization',
                                                    ].includes(type.code),
                                                )
                                                .map((type) => ({
                                                    value: type.code,
                                                    label: type.name,
                                                }))}
                                            value={form.type || null}
                                            onValueChange={(value) =>
                                                value && set('type', value)
                                            }
                                            searchPlaceholder="Cari jenis"
                                            emptyMessage="Jenis tidak ditemukan."
                                            portalContainer={portalContainer}
                                        />
                                    ) : (
                                        <Input
                                            label="Jenis pihak"
                                            value={typeName(form.type)}
                                            readOnly
                                        />
                                    )}
                                </FormControl>
                                {text(
                                    'name',
                                    person ? 'Nama lengkap' : 'Nama organisasi',
                                    {
                                        required: true,
                                        maxLength: 200,
                                        readOnly: internalOrganization,
                                        hint: internalOrganization
                                            ? 'Nama organisasi diubah dari halaman Legal entity atau Operating unit.'
                                            : undefined,
                                        onChange: (name) =>
                                            setForm((current) => ({
                                                ...current,
                                                name,
                                                ...(!searchEdited
                                                    ? {
                                                          search_name: name
                                                              .trim()
                                                              .replace(
                                                                  /\s+/g,
                                                                  ' ',
                                                              )
                                                              .toLocaleLowerCase(),
                                                      }
                                                    : {}),
                                            })),
                                    },
                                )}
                                {text('search_name', 'Nama pencarian', {
                                    maxLength: 200,
                                    hint: 'Teks yang dicocokkan saat pihak dicari. Bawaannya sama dengan nama; isi nama panggilan atau ejaan lain bila perlu.',
                                    onChange: (value) => {
                                        setSearchEdited(true);
                                        set('search_name', value);
                                    },
                                })}
                                {text('tax_number', 'NPWP', {
                                    maxLength: 32,
                                    inputMode: 'numeric',
                                })}
                                {!person &&
                                    text(
                                        'organization_number',
                                        'NIB (Nomor Induk Berusaha)',
                                        { maxLength: 200 },
                                    )}
                                <Field
                                    orientation="horizontal"
                                    className="w-auto"
                                >
                                    <Switch
                                        id="party-active"
                                        checked={form.status === 'active'}
                                        disabled={!editing}
                                        onCheckedChange={(checked) =>
                                            set(
                                                'status',
                                                checked ? 'active' : 'inactive',
                                            )
                                        }
                                    />
                                    <FieldLabel htmlFor="party-active">
                                        Aktif
                                    </FieldLabel>
                                </Field>
                            </FormGrid>
                        </CollapsibleSection>
                        {person && (
                            <CollapsibleSection
                                value="person"
                                title="Identitas orang"
                                summary={
                                    [
                                        form.gender &&
                                            referenceName(
                                                'gender',
                                                form.gender,
                                            ),
                                        form.birth_date,
                                    ]
                                        .filter(Boolean)
                                        .join(' · ') || 'Belum diisi'
                                }
                            >
                                <FormGrid>
                                    {select(
                                        'gender',
                                        'Jenis kelamin',
                                        'gender',
                                    )}
                                    {text('birth_place', 'Tempat lahir', {
                                        maxLength: 120,
                                    })}
                                    {date('birth_date', 'Tanggal lahir')}
                                    <FormControl
                                        error={error(
                                            'nationality_country_code',
                                        )}
                                    >
                                        {editing ? (
                                            <Select
                                                label="Warga negara"
                                                portalContainer={
                                                    portalContainer
                                                }
                                                items={metadata.countries.map(
                                                    (country) => ({
                                                        value: country.code,
                                                        label: country.name,
                                                    }),
                                                )}
                                                value={
                                                    form.nationality_country_code ||
                                                    null
                                                }
                                                searchPlaceholder="Cari negara"
                                                onValueChange={(value) =>
                                                    set(
                                                        'nationality_country_code',
                                                        value ?? '',
                                                    )
                                                }
                                            />
                                        ) : (
                                            <Input
                                                label="Warga negara"
                                                value={
                                                    form.nationality_country_code
                                                        ? countryName(
                                                              form.nationality_country_code,
                                                          )
                                                        : ''
                                                }
                                                readOnly
                                            />
                                        )}
                                    </FormControl>
                                    {select('religion', 'Agama', 'religion')}
                                    {select(
                                        'marital_status',
                                        'Status perkawinan',
                                        'marital_status',
                                    )}
                                    {date(
                                        'anniversary_date',
                                        'Tanggal pernikahan',
                                    )}
                                    {text('number_of_children', 'Jumlah anak', {
                                        inputMode: 'numeric',
                                        maxLength: 3,
                                    })}
                                    {select(
                                        'education',
                                        'Pendidikan terakhir',
                                        'education',
                                    )}
                                    <OccupationField
                                        label="Pekerjaan"
                                        editing={editing}
                                        error={error('occupation_id')}
                                        portalContainer={portalContainer}
                                        value={
                                            form.occupation_id
                                                ? {
                                                      id: form.occupation_id,
                                                      name: form.occupation_name,
                                                  }
                                                : null
                                        }
                                        onChange={(occupation) =>
                                            setForm((current) => ({
                                                ...current,
                                                occupation_id: occupation.id,
                                                occupation_name:
                                                    occupation.name,
                                            }))
                                        }
                                    />
                                    {text('interests', 'Minat', {
                                        maxLength: 2000,
                                    })}
                                </FormGrid>
                            </CollapsibleSection>
                        )}
                        <CollapsibleSection
                            value="identifications"
                            title="Nomor identitas"
                            summary={
                                party
                                    ? `${party.identifications.length} nomor`
                                    : `${identifications.length} nomor`
                            }
                        >
                            <PartyIdentifications
                                partyId={party?.id ?? null}
                                items={party?.identifications ?? []}
                                types={metadata.identificationTypes}
                                canManage={canManage}
                                draft={
                                    party === null
                                        ? {
                                              value: identifications,
                                              onChange: setIdentifications,
                                          }
                                        : undefined
                                }
                                errors={errors}
                                onChanged={onReload}
                            />
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="addresses"
                            title="Alamat"
                            summary={
                                party
                                    ? (party.address?.split('\n')[0] ??
                                      'Belum ada alamat utama')
                                    : `${details.locations.length} alamat`
                            }
                        >
                            <PartyAddressesSection
                                owner={
                                    party
                                        ? { kind: 'party', id: party.id }
                                        : null
                                }
                                canManage={canManage}
                                draft={
                                    party === null
                                        ? {
                                              value: details,
                                              onChange: setDetails,
                                              options: metadata,
                                          }
                                        : undefined
                                }
                            />
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="contacts"
                            title="Informasi kontak"
                            summary="Telepon, email, dan kontak lain"
                        >
                            <PartyContactsSection
                                owner={
                                    party
                                        ? { kind: 'party', id: party.id }
                                        : null
                                }
                                canManage={canManage}
                                draft={
                                    party === null
                                        ? {
                                              value: details,
                                              onChange: setDetails,
                                              options: metadata,
                                          }
                                        : undefined
                                }
                            />
                        </CollapsibleSection>
                        {party && (
                            <CollapsibleSection
                                value="relationships"
                                title="Hubungan"
                                summary={`${party.relationships.length} hubungan`}
                            >
                                <PartyRelationships
                                    party={party}
                                    types={metadata.relationshipTypes}
                                    canManage={canManage}
                                    onChanged={onReload}
                                />
                            </CollapsibleSection>
                        )}
                        {party && (
                            <CollapsibleSection
                                value="roles"
                                title="Peran"
                                summary={`${party.roles.length} peran`}
                            >
                                {party.roles.length === 0 ? (
                                    <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                                        Belum ada peran. Peran muncul setelah
                                        pihak ini dipakai, misalnya sebagai
                                        pelanggan, vendor, atau pegawai.
                                    </p>
                                ) : (
                                    <DataTable
                                        scrollMode="inline"
                                        data={party.roles}
                                        getRowKey={(role) =>
                                            `${role.code}-${role.legal_entity_id}`
                                        }
                                        columns={[
                                            {
                                                id: 'role',
                                                header: 'Peran',
                                                width: 180,
                                                cell: (role) => (
                                                    <DataTableText>
                                                        {role.name}
                                                    </DataTableText>
                                                ),
                                            },
                                            {
                                                id: 'company',
                                                header: 'Legal entity',
                                                width: 240,
                                                cell: (role) => (
                                                    <DataTableText>
                                                        {role.company ?? '—'}
                                                    </DataTableText>
                                                ),
                                            },
                                        ]}
                                    />
                                )}
                            </CollapsibleSection>
                        )}
                        {party?.type === 'person' && (
                            <CollapsibleSection
                                value="duplicates"
                                title="Kemungkinan data ganda"
                                summary="Orang lain dengan identitas yang mirip"
                            >
                                <PartyDuplicatesSection
                                    partyId={party.id}
                                    canManage={canManage}
                                    onOpen={onOpenParty}
                                />
                            </CollapsibleSection>
                        )}
                        <CollapsibleSection
                            value="additional"
                            title="Informasi tambahan"
                            summary={
                                form.language
                                    ? referenceName('language', form.language)
                                    : 'Bahasa dan catatan'
                            }
                        >
                            <FormGrid>
                                {select('language', 'Bahasa', 'language')}
                                <FormControl error={error('memo')}>
                                    <Textarea
                                        label="Catatan"
                                        data-error-field="memo"
                                        value={form.memo}
                                        readOnly={!editing}
                                        onChange={(event) =>
                                            set('memo', event.target.value)
                                        }
                                    />
                                </FormControl>
                            </FormGrid>
                        </CollapsibleSection>
                    </CollapsibleSectionGroup>
                </PageDialogBody>
            </form>
            {confirmation}
        </div>
    );
}
