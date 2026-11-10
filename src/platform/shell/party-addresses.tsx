import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import { Checkbox } from '@operations-metta/ui/checkbox';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import {
    Field,
    FieldLabel,
    FieldLegend,
    FieldSet,
} from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { api, ApiError, errorText, type ApiBody } from './api.ts';
import { FormErrorHeader } from './form-error-header.tsx';

/**
 * Alamat dan informasi kontak satu party, dipindah dari address-book-section CoreERP: dipakai kartu party di Buku
 * alamat dan detail organisasi. Satu alamat adalah tautan party ke sebuah tempat, dan tempat dapat dipakai beberapa
 * pihak. Kontak menempel ke tempat. Alamat privat dan kontak di tempatnya hanya dikirim API kepada pemegang izin
 * melihatnya, jadi layar tidak menyaringnya lagi.
 *
 * Bagian ini ada di Shell karena dipakai dua folder fitur (Buku alamat dan Organization), dan pintu folder fitur lain
 * hanya index.ts miliknya, yang berisi kode server.
 */

export type PartyLocation = ApiBody<'partyLocations'>['data'][number];
export type PartyContact = ApiBody<'partyContacts'>['data'][number];
type Sharable = ApiBody<'partySharableLocations'>['data'][number];
type Option = { code: string; name: string };
export type AddressOwner = { kind: 'party' | 'organization'; id: string };

/** Pilihan form alamat dan kontak untuk party yang belum disimpan, dari `GET /api/v1/parties/metadata`. */
export type DraftOptions = {
    locationPurposes: Option[];
    countries: Option[];
    contactTypes: string[];
};
export type PartyDraft = {
    locations: PartyLocation[];
    contacts: PartyContact[];
};
export type PartyDraftDetails = {
    value: PartyDraft;
    onChange: (value: PartyDraft) => void;
    options: DraftOptions;
};
export const emptyPartyDraft: PartyDraft = { locations: [], contacts: [] };

export function newDraftKey(): string {
    return globalThis.crypto.randomUUID();
}

type Errors = Record<string, string[]>;
const first = (errors: Errors, key: string) => errors[key]?.[0];

const regionFields = [
    ['province_id', 'province', 'province'],
    ['regency_id', 'city', 'regency'],
    ['district_id', 'district', 'district'],
    ['village_id', 'village', 'village'],
] as const;
type RegionId = (typeof regionFields)[number][0] | 'postal_code_id';
type RegionText = (typeof regionFields)[number][1] | 'postal_code';

type LocationForm = {
    location_id: string;
    name: string;
    purposes: string[];
    is_primary: boolean;
    is_private: boolean;
    country_region_code: string;
    province_id: string;
    regency_id: string;
    district_id: string;
    village_id: string;
    postal_code_id: string;
    group_of_houses_id: string;
    province: string;
    city: string;
    district: string;
    village: string;
    group_of_houses: string;
    postal_code: string;
    street: string;
    building: string;
    rt: string;
    rw: string;
    postbox: string;
};

const blankLocation = (countryCode: string): LocationForm => ({
    location_id: '',
    name: '',
    purposes: [],
    is_primary: false,
    is_private: false,
    country_region_code: countryCode,
    province_id: '',
    regency_id: '',
    district_id: '',
    village_id: '',
    postal_code_id: '',
    group_of_houses_id: '',
    province: '',
    city: '',
    district: '',
    village: '',
    group_of_houses: '',
    postal_code: '',
    street: '',
    building: '',
    rt: '',
    rw: '',
    postbox: '',
});

function formOf(
    location: Omit<
        Sharable,
        'id' | 'name' | 'formatted' | 'country_region_code'
    > & {
        name?: string;
        country_region_code: string | null;
        purposes?: string[];
        is_primary?: boolean;
        is_private?: boolean;
    },
): LocationForm {
    const text = (value: string | null) => value ?? '';
    return {
        location_id: '',
        name: location.name ?? '',
        purposes: location.purposes ?? [],
        is_primary: location.is_primary ?? false,
        is_private: location.is_private ?? false,
        country_region_code: location.country_region_code ?? 'ID',
        province_id: text(location.province_id),
        regency_id: text(location.regency_id),
        district_id: text(location.district_id),
        village_id: text(location.village_id),
        postal_code_id: text(location.postal_code_id),
        group_of_houses_id: text(location.group_of_houses_id),
        province: text(location.province),
        city: text(location.city),
        district: text(location.district),
        village: text(location.village),
        group_of_houses: text(location.group_of_houses),
        postal_code: text(location.postal_code),
        street: text(location.street),
        building: text(location.building),
        rt: text(location.rt),
        rw: text(location.rw),
        postbox: text(location.postbox),
    };
}

// Kiriman satu alamat: teks kosong menjadi null, supaya isian yang dikosongkan benar-benar terhapus.
function locationBody(form: LocationForm) {
    const { location_id, purposes, is_primary, is_private, ...rest } = form;
    return {
        ...Object.fromEntries(
            Object.entries(rest).map(([key, value]) => [key, value || null]),
        ),
        location_id: location_id || null,
        purposes,
        is_primary,
        is_private,
    };
}

/** Kiriman `party_details` untuk party atau organisasi baru: alamat draft dan kontak yang menunjuk alamat itu. */
export function draftPayload(draft: PartyDraft) {
    if (!draft.locations.length && !draft.contacts.length) return undefined;
    const draftIds = new Set(draft.locations.map((location) => location.id));
    return {
        locations: draft.locations.map((location) => ({
            ...locationBody({
                ...formOf(location),
                location_id: location.location_id,
            }),
            key: location.id,
        })),
        contacts: draft.contacts.map((contact) => ({
            type: contact.type,
            value: contact.value,
            purpose: contact.purpose,
            is_primary: contact.is_primary,
            ...(contact.address_id && draftIds.has(contact.address_id)
                ? { address_key: contact.address_id }
                : { address_id: contact.address_id }),
        })),
    };
}

function locationEndpoints(owner: AddressOwner) {
    return owner.kind === 'party'
        ? {
              list: () => api.partyLocations({ params: { id: owner.id } }),
              sharable: (
                  query: { q: string; cursor?: string },
                  signal: AbortSignal,
              ) =>
                  api.partySharableLocations(
                      { params: { id: owner.id }, query },
                      { signal },
                  ),
              create: (body: unknown) =>
                  api.partyLocationCreate({ params: { id: owner.id }, body }),
              update: (child: string, body: unknown) =>
                  api.partyLocationUpdate({
                      params: { id: owner.id, child },
                      body,
                  }),
              remove: (child: string, version: number) =>
                  api.partyLocationDelete({
                      params: { id: owner.id, child },
                      body: { version },
                  }),
          }
        : {
              list: () =>
                  api.organizationLocations({ params: { id: owner.id } }),
              sharable: (
                  query: { q: string; cursor?: string },
                  signal: AbortSignal,
              ) =>
                  api.organizationSharableLocations(
                      { params: { id: owner.id }, query },
                      { signal },
                  ),
              create: (body: unknown) =>
                  api.organizationLocationCreate({
                      params: { id: owner.id },
                      body,
                  }),
              update: (child: string, body: unknown) =>
                  api.organizationLocationUpdate({
                      params: { id: owner.id, child },
                      body,
                  }),
              remove: (child: string, version: number) =>
                  api.organizationLocationDelete({
                      params: { id: owner.id, child },
                      body: { version },
                  }),
          };
}

function contactEndpoints(owner: AddressOwner) {
    return owner.kind === 'party'
        ? {
              list: () => api.partyContacts({ params: { id: owner.id } }),
              create: (body: unknown) =>
                  api.partyContactCreate({ params: { id: owner.id }, body }),
              update: (child: string, body: unknown) =>
                  api.partyContactUpdate({
                      params: { id: owner.id, child },
                      body,
                  }),
              remove: (child: string, version: number) =>
                  api.partyContactDelete({
                      params: { id: owner.id, child },
                      body: { version },
                  }),
          }
        : {
              list: () =>
                  api.organizationContacts({ params: { id: owner.id } }),
              create: (body: unknown) =>
                  api.organizationContactCreate({
                      params: { id: owner.id },
                      body,
                  }),
              update: (child: string, body: unknown) =>
                  api.organizationContactUpdate({
                      params: { id: owner.id, child },
                      body,
                  }),
              remove: (child: string, version: number) =>
                  api.organizationContactDelete({
                      params: { id: owner.id, child },
                      body: { version },
                  }),
          };
}

// Kegagalan simpan: error per field untuk 422, selain itu satu pesan yang tetap terlihat.
function failure(caught: unknown, fallback: string) {
    return caught instanceof ApiError && caught.status === 422
        ? { errors: caught.errors, message: null }
        : { errors: {}, message: errorText(caught, fallback) };
}

function Notice({ children }: { children: ReactNode }) {
    return (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {children}
        </p>
    );
}

function LoadState({
    loading,
    error,
    retry,
    what,
}: {
    loading: boolean;
    error: unknown;
    retry: () => void;
    what: string;
}) {
    if (loading)
        return (
            <p role="status" className="text-sm text-muted-foreground">
                Memuat {what}…
            </p>
        );
    return (
        <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-destructive">
                {errorText(
                    error,
                    `${what[0]!.toUpperCase()}${what.slice(1)} belum dapat dimuat.`,
                )}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
                Coba lagi
            </Button>
        </div>
    );
}

// Nama tingkat wilayah datang dari data (`ref_country_hierarchy_levels`), termasuk tingkat dusun/banjar. Negara tanpa
// data tingkat memakai label umum.
const fallbackLevelNames: Record<string, string> = {
    province: 'Provinsi / negara bagian',
    regency: 'Kota / kabupaten',
    district: 'Kecamatan / distrik',
    village: 'Kelurahan / desa',
};

export function useLevelNames(countryCode: string) {
    const levels = useQuery({
        queryKey: ['region-levels', countryCode],
        queryFn: async () =>
            (
                await api.regionLevels({
                    query: { country_code: countryCode },
                })
            ).body.data,
        enabled: countryCode.length === 2,
        staleTime: 5 * 60_000,
    });
    const names = new Map(
        (levels.data ?? []).map((level) => [
            level.level_code,
            level.level_name,
        ]),
    );
    return {
        name: (code: string) =>
            names.get(code) ?? fallbackLevelNames[code] ?? code,
        has: (code: string) => names.has(code),
        loading: levels.isPending && countryCode.length === 2,
    };
}

type RegionOption = { value: string; label: string };

// Pilihan satu tingkat wilayah di bawah induknya (lookup top-down).
export function useRegionOptions(
    parentType: 'country' | 'province' | 'regency' | 'district' | 'village',
    parentId: string,
) {
    return useQuery({
        queryKey: ['regions', parentType, parentId],
        queryFn: async ({ signal }): Promise<RegionOption[]> => {
            const { body } = await api.regionLookup(
                { query: { parent_type: parentType, parent_id: parentId } },
                { signal },
            );
            if (!Array.isArray(body)) return [];
            return body.map((row) =>
                'postal_code' in row && !('name' in row)
                    ? {
                          value: row.id,
                          label: [row.postal_code, row.area_name]
                              .filter(Boolean)
                              .join(' '),
                      }
                    : { value: row.id, label: 'name' in row ? row.name : '' },
            );
        },
        enabled: parentId !== '',
        staleTime: 5 * 60_000,
    });
}

type GroupOfHouses = ApiBody<'groupOfHousesList'>['data'][number];

function GroupOfHousesField({
    villageId,
    value,
    label,
    current,
    onChange,
    portalContainer,
}: {
    villageId: string;
    value: string;
    label: string;
    current: string;
    onChange: (id: string, name: string) => void;
    portalContainer: React.RefObject<HTMLElement | null>;
}) {
    const [query, setQuery] = useState('');
    const loader = useCallback(
        async ({
            query,
            cursor,
            signal,
        }: {
            query: string;
            cursor: string | null;
            signal: AbortSignal;
        }) => {
            const { body } = await api.groupOfHousesList(
                {
                    query: {
                        village_id: villageId,
                        q: query,
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [villageId],
    );
    const list = useIncrementalList<GroupOfHouses>({
        loadItems: loader,
        query,
        active: villageId !== '',
        getKey: (item) => item.id,
    });
    const items = list.items.map((item) => ({
        value: item.id,
        label: item.name,
    }));
    if (value && !items.some((item) => item.value === value))
        items.unshift({ value, label: current });

    return (
        <Select
            label={label}
            portalContainer={portalContainer}
            items={items}
            value={value || null}
            onValueChange={(next) =>
                onChange(
                    next ?? '',
                    items.find((item) => item.value === next)?.label ?? '',
                )
            }
            onSearchChange={setQuery}
            searchPlaceholder={`Cari ${label.toLocaleLowerCase()}`}
            emptyMessage="Belum ada pilihan untuk desa ini."
            incremental={list}
        />
    );
}

function RegionFields({
    form,
    setForm,
    errors,
    portalContainer,
}: {
    form: LocationForm;
    setForm: (update: (current: LocationForm) => LocationForm) => void;
    errors: Errors;
    portalContainer: React.RefObject<HTMLElement | null>;
}) {
    const levels = useLevelNames(form.country_region_code);
    const indonesia = form.country_region_code === 'ID';
    const options = {
        province_id: useRegionOptions(
            'country',
            indonesia ? form.country_region_code : '',
        ),
        regency_id: useRegionOptions('province', form.province_id),
        district_id: useRegionOptions('regency', form.regency_id),
        village_id: useRegionOptions('district', form.district_id),
        postal_code_id: useRegionOptions('village', form.village_id),
    };
    const children: [RegionId, RegionText][] = [
        ...regionFields.map(
            ([id, text]) => [id, text] as [RegionId, RegionText],
        ),
        ['postal_code_id', 'postal_code'],
    ];
    const choose = (index: number, value: string | null) => {
        const [field, text] = children[index]!;
        const label =
            options[field].data?.find((item) => item.value === value)?.label ??
            '';
        setForm((current) => {
            const next: LocationForm = {
                ...current,
                [field]: value ?? '',
                [text]:
                    field === 'postal_code_id'
                        ? (label.split(' ')[0] ?? '')
                        : label,
            };
            for (const [child, childText] of children.slice(index + 1)) {
                next[child] = '';
                next[childText] = '';
            }
            if (index < 4) {
                next.group_of_houses_id = '';
                next.group_of_houses = '';
            }
            return next;
        });
    };

    if (levels.loading)
        return (
            <p role="status" className="text-sm text-muted-foreground">
                Memuat pilihan wilayah…
            </p>
        );
    if (!indonesia)
        return (
            <>
                {regionFields.map(([, text, level]) => (
                    <FormControl key={text} error={first(errors, text)}>
                        <Input
                            label={levels.name(level)}
                            value={form[text]}
                            data-error-field={text}
                            onChange={(event) =>
                                setForm((current) => ({
                                    ...current,
                                    [text]: event.target.value,
                                }))
                            }
                        />
                    </FormControl>
                ))}
                <FormControl error={first(errors, 'postal_code')}>
                    <Input
                        label="Kode pos"
                        value={form.postal_code}
                        data-error-field="postal_code"
                        onChange={(event) =>
                            setForm((current) => ({
                                ...current,
                                postal_code: event.target.value,
                            }))
                        }
                    />
                </FormControl>
            </>
        );

    return (
        <>
            {children.map(([field, text], index) => {
                const level = regionFields[index]?.[2];
                const label = level ? levels.name(level) : 'Kode pos';
                const query = options[field];
                const parent =
                    index === 0 ? 'ID' : form[children[index - 1]![0]];
                const items = query.data ?? [];
                if (
                    form[field] &&
                    !items.some((item) => item.value === form[field])
                )
                    items.unshift({ value: form[field], label: form[text] });
                return (
                    <FormControl
                        key={field}
                        error={
                            first(errors, field) ??
                            (query.error
                                ? errorText(
                                      query.error,
                                      'Pilihan wilayah belum dapat dimuat.',
                                  )
                                : undefined)
                        }
                    >
                        <FieldSet
                            data-error-field={field}
                            disabled={!parent || query.isFetching}
                        >
                            <Select
                                label={label}
                                portalContainer={portalContainer}
                                items={items}
                                value={form[field] || null}
                                onValueChange={(value) => choose(index, value)}
                                searchPlaceholder={`Cari ${label.toLocaleLowerCase()}`}
                                emptyMessage="Belum ada pilihan."
                            />
                        </FieldSet>
                    </FormControl>
                );
            })}
            {levels.has('group_of_houses') && (
                <FormControl
                    error={first(errors, 'group_of_houses_id')}
                    hint="Pilihan ini diisi di Setup alamat. Kosongkan bila tidak ada."
                >
                    <FieldSet
                        data-error-field="group_of_houses_id"
                        disabled={!form.village_id}
                    >
                        <GroupOfHousesField
                            key={form.village_id}
                            villageId={form.village_id}
                            value={form.group_of_houses_id}
                            current={form.group_of_houses}
                            label={levels.name('group_of_houses')}
                            portalContainer={portalContainer}
                            onChange={(id, name) =>
                                setForm((current) => ({
                                    ...current,
                                    group_of_houses_id: id,
                                    group_of_houses: name,
                                }))
                            }
                        />
                    </FieldSet>
                </FormControl>
            )}
        </>
    );
}

function LocationDialog({
    owner,
    editing,
    purposes,
    countries,
    draftMode,
    onClose,
    onSaved,
}: {
    owner: AddressOwner | null;
    editing: PartyLocation | 'new';
    purposes: Option[];
    countries: Option[];
    draftMode: boolean;
    onClose: () => void;
    onSaved: (form: LocationForm, chosen: Sharable | null) => Promise<void>;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [form, setFormState] = useState<LocationForm>(() =>
        editing === 'new' ? blankLocation('ID') : formOf(editing),
    );
    const [chosen, setChosen] = useState<Sharable | null>(null);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const setForm = (update: (current: LocationForm) => LocationForm) =>
        setFormState(update);
    const sharing = editing === 'new' && owner !== null && !draftMode;
    const loadShared = useCallback<LookupLoader<Sharable>>(
        async ({ query, cursor, signal }) => {
            if (!owner) return { items: [], nextCursor: null };
            const { body } = await locationEndpoints(owner).sharable(
                { q: query, ...(cursor ? { cursor } : {}) },
                signal,
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [owner],
    );

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            await onSaved(form, chosen);
        } catch (caught) {
            const failed = failure(caught, 'Alamat belum disimpan.');
            setErrors(failed.errors);
            setMessage(failed.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <PageDialog
            open
            onOpenChange={(open) => {
                if (!open && !busy) onClose();
            }}
        >
            <PageDialogContent
                ref={contentRef}
                title="Alamat"
                recordTitle={form.name || 'Alamat baru'}
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
                        // Dialog dirender lewat portal di dalam form induk; React tetap meneruskan submit ke form
                        // induk bila tidak dihentikan.
                        event.preventDefault();
                        event.stopPropagation();
                        void submit();
                    }}
                >
                    <PageDialogToolbar>
                        {draftMode ? (
                            editing === 'new' ? (
                                <ActionButton action="add" type="submit" />
                            ) : (
                                <Button type="submit" variant="ghost">
                                    <Check aria-hidden="true" />
                                    Selesai
                                </Button>
                            )
                        ) : (
                            <ActionButton
                                action={chosen ? 'add' : 'save'}
                                type="submit"
                                disabled={busy}
                                pending={busy}
                            />
                        )}
                        <ActionButton
                            action="cancel"
                            type="button"
                            disabled={busy}
                            onClick={onClose}
                        />
                    </PageDialogToolbar>
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Alamat belum disimpan"
                    />
                    <PageDialogBody className="space-y-4 py-3">
                        {sharing && (
                            <FormGrid columns={1}>
                                <FormControl hint="Pilih alamat yang sudah tercatat bila tempatnya sama. Alamat itu dipakai bersama, jadi perubahan alamatnya berlaku untuk semua pihak yang memakainya.">
                                    <InlineLookup
                                        label="Pakai alamat yang sudah ada"
                                        loadItems={loadShared}
                                        value={chosen}
                                        placeholder="Cari nama atau alamat…"
                                        emptyMessage="Alamat tidak ditemukan."
                                        getItemValue={(item) => item.id}
                                        getItemLabel={(item) => item.name}
                                        getSearchText={(item) =>
                                            `${item.name} ${item.formatted}`
                                        }
                                        columns={[
                                            {
                                                id: 'name',
                                                header: 'Keterangan',
                                                cell: (item) => item.name,
                                                width: 180,
                                            },
                                            {
                                                id: 'address',
                                                header: 'Alamat',
                                                cell: (item) =>
                                                    item.formatted.replaceAll(
                                                        '\n',
                                                        ', ',
                                                    ),
                                                width: 400,
                                            },
                                        ]}
                                        portalContainer={contentRef}
                                        showDetails={false}
                                        onValueChange={(item) => {
                                            setChosen(item);
                                            setForm((current) => ({
                                                ...formOf(item),
                                                purposes: current.purposes,
                                                is_primary: current.is_primary,
                                                is_private: current.is_private,
                                                location_id: item.id,
                                            }));
                                        }}
                                    />
                                </FormControl>
                                {chosen && (
                                    <div className="flex flex-wrap items-center gap-3">
                                        <p className="text-sm text-muted-foreground">
                                            Alamat ini dipakai bersama pihak
                                            lain.
                                        </p>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setChosen(null);
                                                setForm((current) => ({
                                                    ...blankLocation('ID'),
                                                    purposes: current.purposes,
                                                    is_primary:
                                                        current.is_primary,
                                                    is_private:
                                                        current.is_private,
                                                }));
                                            }}
                                        >
                                            Tulis alamat baru
                                        </Button>
                                    </div>
                                )}
                            </FormGrid>
                        )}
                        {editing !== 'new' && editing.shared_with > 0 && (
                            <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                                Alamat ini dipakai juga oleh{' '}
                                {editing.shared_with} pihak lain. Perubahan
                                alamatnya berlaku untuk semua pihak itu.
                            </p>
                        )}
                        <FieldSet disabled={Boolean(chosen)}>
                            <FormGrid>
                                <FormControl error={first(errors, 'name')}>
                                    <Input
                                        label="Keterangan alamat"
                                        required
                                        maxLength={120}
                                        data-error-field="name"
                                        placeholder="Contoh: Rumah sesuai KTP"
                                        value={form.name}
                                        onChange={(event) =>
                                            setForm((current) => ({
                                                ...current,
                                                name: event.target.value,
                                            }))
                                        }
                                    />
                                </FormControl>
                                <FormControl
                                    error={first(errors, 'country_region_code')}
                                >
                                    <Select
                                        label="Negara"
                                        required
                                        portalContainer={contentRef}
                                        items={countries.map((country) => ({
                                            value: country.code,
                                            label: country.name,
                                        }))}
                                        value={form.country_region_code || null}
                                        searchPlaceholder="Cari negara"
                                        onValueChange={(value) =>
                                            setForm((current) => ({
                                                ...blankLocation(value ?? ''),
                                                name: current.name,
                                                purposes: current.purposes,
                                                is_primary: current.is_primary,
                                                is_private: current.is_private,
                                                street: current.street,
                                                building: current.building,
                                            }))
                                        }
                                    />
                                </FormControl>
                                <RegionFields
                                    form={form}
                                    setForm={setForm}
                                    errors={errors}
                                    portalContainer={contentRef}
                                />
                                {(
                                    [
                                        ['street', 'Jalan dan nomor', 250],
                                        [
                                            'building',
                                            'Gedung / blok / lantai',
                                            120,
                                        ],
                                        ['rt', 'RT', 3],
                                        ['rw', 'RW', 3],
                                        ['postbox', 'PO Box', 60],
                                    ] as const
                                ).map(([field, label, max]) => (
                                    <FormControl
                                        key={field}
                                        error={first(errors, field)}
                                    >
                                        <Input
                                            label={label}
                                            maxLength={max}
                                            inputMode={
                                                field === 'rt' || field === 'rw'
                                                    ? 'numeric'
                                                    : undefined
                                            }
                                            data-error-field={field}
                                            value={form[field]}
                                            onChange={(event) =>
                                                setForm((current) => ({
                                                    ...current,
                                                    [field]: event.target.value,
                                                }))
                                            }
                                        />
                                    </FormControl>
                                ))}
                            </FormGrid>
                        </FieldSet>
                        <FieldSet data-error-field="purposes">
                            <FieldLegend hint="Satu alamat boleh punya beberapa keperluan, misalnya alamat KTP sekaligus rumah.">
                                Keperluan
                            </FieldLegend>
                            <div className="flex flex-wrap gap-x-5 gap-y-2">
                                {purposes.map((purpose) => (
                                    <Field
                                        key={purpose.code}
                                        orientation="horizontal"
                                        className="w-auto"
                                    >
                                        <Checkbox
                                            id={`purpose-${purpose.code}`}
                                            checked={form.purposes.includes(
                                                purpose.code,
                                            )}
                                            onCheckedChange={(checked) =>
                                                setForm((current) => ({
                                                    ...current,
                                                    purposes: checked
                                                        ? [
                                                              ...current.purposes,
                                                              purpose.code,
                                                          ]
                                                        : current.purposes.filter(
                                                              (code) =>
                                                                  code !==
                                                                  purpose.code,
                                                          ),
                                                }))
                                            }
                                        />
                                        <FieldLabel
                                            htmlFor={`purpose-${purpose.code}`}
                                        >
                                            {purpose.name}
                                        </FieldLabel>
                                    </Field>
                                ))}
                            </div>
                            {first(errors, 'purposes') && (
                                <p className="text-sm text-destructive">
                                    {first(errors, 'purposes')}
                                </p>
                            )}
                        </FieldSet>
                        <div className="flex flex-col gap-3">
                            <Field orientation="horizontal" className="w-auto">
                                <Switch
                                    id="location-primary"
                                    checked={form.is_primary}
                                    onCheckedChange={(checked) =>
                                        setForm((current) => ({
                                            ...current,
                                            is_primary: checked,
                                        }))
                                    }
                                />
                                <FieldLabel htmlFor="location-primary">
                                    Jadikan alamat utama
                                </FieldLabel>
                            </Field>
                            <Field orientation="horizontal" className="w-auto">
                                <Switch
                                    id="location-private"
                                    checked={form.is_private}
                                    onCheckedChange={(checked) =>
                                        setForm((current) => ({
                                            ...current,
                                            is_private: checked,
                                        }))
                                    }
                                />
                                <FieldLabel htmlFor="location-private">
                                    Alamat privat
                                </FieldLabel>
                            </Field>
                            {form.is_private && (
                                <p className="text-sm text-muted-foreground">
                                    Alamat privat dan kontak di alamat ini hanya
                                    terlihat oleh pengguna yang diberi izin
                                    melihat alamat privat, dan tidak ditawarkan
                                    untuk dipakai pihak lain.
                                </p>
                            )}
                        </div>
                    </PageDialogBody>
                </form>
            </PageDialogContent>
        </PageDialog>
    );
}

/**
 * Daftar alamat satu party. Tanpa `draft`, daftar dibaca dan disimpan langsung lewat API pemiliknya. Dengan `draft`,
 * alamat ditahan di form induk lalu dikirim bersama party atau organisasi baru dalam satu transaksi.
 */
export function PartyAddressesSection({
    owner,
    canManage,
    draft,
}: {
    owner: AddressOwner | null;
    canManage: boolean;
    draft?: PartyDraftDetails;
}): ReactNode {
    const stored = useQuery({
        queryKey: ['party-locations', owner?.kind, owner?.id],
        queryFn: async () => (await locationEndpoints(owner!).list()).body,
        enabled: !draft && owner !== null,
    });
    const [editing, setEditing] = useState<PartyLocation | 'new' | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const purposes = draft
        ? draft.options.locationPurposes
        : (stored.data?.meta.purposes ?? []);
    const countries = draft
        ? draft.options.countries
        : (stored.data?.meta.countries ?? []);
    const items = draft ? draft.value.locations : (stored.data?.data ?? []);
    const purposeNames = (codes: string[]) =>
        codes
            .map(
                (code) =>
                    purposes.find((purpose) => purpose.code === code)?.name ??
                    code,
            )
            .join(', ');
    const countryName = (code: string | null) =>
        countries.find((country) => country.code === code)?.name ?? code;

    const saveDraft = async (form: LocationForm, chosen: Sharable | null) => {
        const id = editing === 'new' || !editing ? newDraftKey() : editing.id;
        const others = draft!.value.locations.filter((row) => row.id !== id);
        const primary = form.is_primary || others.length === 0;
        // Pemeriksaan isian wajib yang sama dengan server, supaya kesalahan tampil sebelum party disimpan.
        const errors: Errors = {};
        if (!chosen && !form.name.trim()) errors.name = ['Wajib diisi.'];
        if (!form.purposes.length)
            errors.purposes = ['Pilih minimal satu keperluan alamat.'];
        if (!chosen && !form.country_region_code)
            errors.country_region_code = ['Pilih negara.'];
        if (Object.keys(errors).length) throw new ApiError(422, { errors });
        const value = (text: string) => text || null;
        const row: PartyLocation = {
            id,
            version: 0,
            location_id: chosen?.id ?? '',
            is_location_owner: !chosen,
            owner_party_name: null,
            name: form.name,
            purposes: form.purposes,
            is_primary: primary,
            is_private: form.is_private,
            valid_from: null,
            valid_to: null,
            shared_with: 0,
            country_region_code: value(form.country_region_code),
            province_id: value(form.province_id),
            regency_id: value(form.regency_id),
            district_id: value(form.district_id),
            village_id: value(form.village_id),
            postal_code_id: value(form.postal_code_id),
            group_of_houses_id: value(form.group_of_houses_id),
            province: value(form.province),
            city: value(form.city),
            district: value(form.district),
            village: value(form.village),
            group_of_houses: value(form.group_of_houses),
            rt: value(form.rt),
            rw: value(form.rw),
            street: value(form.street),
            building: value(form.building),
            postbox: value(form.postbox),
            postal_code: value(form.postal_code),
            formatted:
                chosen?.formatted ??
                [
                    [form.street, form.building].filter(Boolean).join(', '),
                    form.postbox && `PO Box ${form.postbox}`,
                    [form.rt && `RT ${form.rt}`, form.rw && `RW ${form.rw}`]
                        .filter(Boolean)
                        .join(' / '),
                    form.group_of_houses,
                    form.village,
                    form.district,
                    [
                        [form.city, form.province].filter(Boolean).join(', '),
                        form.postal_code,
                    ]
                        .filter(Boolean)
                        .join(' '),
                    form.country_region_code !== 'ID'
                        ? countryName(form.country_region_code)
                        : '',
                ]
                    .filter((line) => line && line.trim())
                    .join('\n'),
        };
        draft!.onChange({
            ...draft!.value,
            locations: [
                ...others.map((other) =>
                    primary ? { ...other, is_primary: false } : other,
                ),
                row,
            ],
        });
        setEditing(null);
    };

    const saveStored = async (form: LocationForm, chosen: Sharable | null) => {
        const endpoints = locationEndpoints(owner!);
        if (editing === 'new') {
            await endpoints.create(
                chosen
                    ? {
                          location_id: chosen.id,
                          purposes: form.purposes,
                          is_primary: form.is_primary,
                          is_private: form.is_private,
                      }
                    : locationBody(form),
            );
            toast.success('Alamat ditambahkan.');
        } else if (editing) {
            await endpoints.update(editing.id, {
                ...locationBody(form),
                location_id: null,
                version: editing.version,
            });
            toast.success('Alamat disimpan.');
        }
        setEditing(null);
        await stored.refetch();
    };

    const remove = async (location: PartyLocation) => {
        const confirmed = await confirm({
            title: `Delete alamat ${location.name}?`,
            description: location.is_primary
                ? 'Ini alamat utama. Alamat tertua yang tersisa akan menjadi alamat utama.'
                : 'Alamat ini tidak lagi tercatat untuk pihak ini. Pihak lain yang memakai alamat yang sama tidak terpengaruh.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!confirmed) return;
        if (draft) {
            const locations = draft.value.locations.filter(
                (row) => row.id !== location.id,
            );
            if (location.is_primary && locations[0])
                locations[0] = { ...locations[0], is_primary: true };
            draft.onChange({
                locations,
                contacts: draft.value.contacts.map((contact) =>
                    contact.address_id === location.id
                        ? { ...contact, address_id: null, address_name: null }
                        : contact,
                ),
            });
            return;
        }
        setFailed(null);
        try {
            await locationEndpoints(owner!).remove(
                location.id,
                location.version,
            );
            toast.success('Alamat dihapus.');
            await stored.refetch();
        } catch (caught) {
            setFailed(errorText(caught, 'Alamat belum dihapus.'));
        }
    };

    const makePrimary = async (location: PartyLocation) => {
        if (draft) {
            draft.onChange({
                ...draft.value,
                locations: draft.value.locations.map((row) => ({
                    ...row,
                    is_primary: row.id === location.id,
                })),
            });
            return;
        }
        setFailed(null);
        try {
            await locationEndpoints(owner!).create({
                location_id: location.location_id,
                purposes: location.purposes,
                is_primary: true,
                is_private: location.is_private,
            });
            toast.success('Alamat utama diganti.');
            await stored.refetch();
        } catch (caught) {
            setFailed(errorText(caught, 'Alamat utama belum diganti.'));
        }
    };

    if (!draft && (stored.isPending || stored.isError))
        return (
            <LoadState
                loading={stored.isPending}
                error={stored.error}
                retry={() => void stored.refetch()}
                what="alamat"
            />
        );

    return (
        <div className="space-y-3">
            {canManage && (
                <RecordActionBar>
                    <ActionButton
                        action="create"
                        type="button"
                        onClick={() => setEditing('new')}
                    />
                </RecordActionBar>
            )}
            {failed && (
                <p role="alert" className="text-sm text-destructive">
                    {failed}
                </p>
            )}
            {items.length === 0 ? (
                <Notice>
                    {canManage
                        ? 'Belum ada alamat. Pilih Baru untuk mengisi.'
                        : 'Belum ada alamat.'}
                </Notice>
            ) : (
                <DataTable
                    scrollMode="inline"
                    data={items}
                    getRowKey={(location) => location.id}
                    getRowLabel={(location) => location.name}
                    actionsPlacement="inline"
                    actions={
                        canManage
                            ? [
                                  { id: 'edit', label: 'Ubah' },
                                  { id: 'primary', label: 'Jadikan utama' },
                                  {
                                      id: 'delete',
                                      label: 'Delete',
                                      destructive: true,
                                      separatorBefore: true,
                                  },
                              ]
                            : []
                    }
                    getRowActions={(location) =>
                        canManage
                            ? [
                                  ...(location.is_location_owner
                                      ? [{ id: 'edit', label: 'Ubah' }]
                                      : []),
                                  ...(location.is_primary
                                      ? []
                                      : [
                                            {
                                                id: 'primary',
                                                label: 'Jadikan utama',
                                            },
                                        ]),
                                  {
                                      id: 'delete',
                                      label: 'Delete',
                                      destructive: true,
                                      separatorBefore: true,
                                  },
                              ]
                            : []
                    }
                    onRowAction={(action, location) => {
                        if (action === 'edit') setEditing(location);
                        else if (action === 'primary')
                            void makePrimary(location);
                        else void remove(location);
                    }}
                    columns={[
                        {
                            id: 'name',
                            header: 'Keterangan',
                            width: 180,
                            cell: (location) => (
                                <DataTableText>{location.name}</DataTableText>
                            ),
                        },
                        {
                            id: 'address',
                            header: 'Alamat',
                            width: 340,
                            cell: (location) => (
                                <DataTableText>
                                    {location.formatted.replaceAll(
                                        '\n',
                                        ', ',
                                    ) || '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'purposes',
                            header: 'Keperluan',
                            width: 160,
                            cell: (location) => (
                                <DataTableText>
                                    {purposeNames(location.purposes) || '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'marks',
                            header: 'Penanda',
                            width: 170,
                            cell: (location) => (
                                <div className="flex flex-wrap gap-1">
                                    {location.is_primary && (
                                        <Badge>Utama</Badge>
                                    )}
                                    {location.is_private && (
                                        <Badge variant="outline">Privat</Badge>
                                    )}
                                    {!location.is_location_owner && (
                                        <Badge
                                            variant="outline"
                                            title={`Diubah lewat ${location.owner_party_name ?? 'pihak pemiliknya'}`}
                                        >
                                            Milik pihak lain
                                        </Badge>
                                    )}
                                </div>
                            ),
                        },
                    ]}
                />
            )}
            {editing !== null && (
                <LocationDialog
                    owner={owner}
                    editing={editing}
                    purposes={purposes}
                    countries={countries}
                    draftMode={Boolean(draft)}
                    onClose={() => setEditing(null)}
                    onSaved={draft ? saveDraft : saveStored}
                />
            )}
            {confirmation}
        </div>
    );
}

// Pilihan "Alamat utama": kontak tanpa alamat dicatat pada alamat utama. Select SDK menganggap nilai kosong sebagai
// belum memilih, jadi pilihan ini butuh nilai sendiri.
const PRIMARY = 'primary';

const contactTypeLabel: Record<string, string> = {
    phone: 'Telepon',
    whatsapp: 'WhatsApp',
    email: 'Email',
    fax: 'Faks',
    url: 'Laman web',
};
const contactValueLabel: Record<string, string> = {
    phone: 'Nomor telepon',
    whatsapp: 'Nomor WhatsApp',
    email: 'Alamat email',
    fax: 'Nomor faks',
    url: 'Alamat laman web',
};

type ContactForm = {
    type: string;
    value: string;
    purpose: string;
    is_primary: boolean;
    address_id: string;
};

function ContactDialog({
    editing,
    types,
    locations,
    draftMode,
    onClose,
    onSaved,
}: {
    editing: PartyContact | 'new';
    types: string[];
    locations: PartyLocation[];
    draftMode: boolean;
    onClose: () => void;
    onSaved: (form: ContactForm) => Promise<void>;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [form, setForm] = useState<ContactForm>(() =>
        editing === 'new'
            ? {
                  type: 'phone',
                  value: '',
                  purpose: '',
                  is_primary: false,
                  address_id:
                      locations.find(
                          (location) =>
                              location.is_primary && location.is_location_owner,
                      )?.id ?? '',
              }
            : {
                  type: editing.type,
                  value: editing.value,
                  purpose: editing.purpose ?? '',
                  is_primary: editing.is_primary,
                  address_id: editing.address_id ?? '',
              },
    );
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const owned = locations.filter((location) => location.is_location_owner);

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            await onSaved(form);
        } catch (caught) {
            const failed = failure(caught, 'Kontak belum disimpan.');
            setErrors(failed.errors);
            setMessage(failed.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <PageDialog
            open
            onOpenChange={(open) => {
                if (!open && !busy) onClose();
            }}
        >
            <PageDialogContent
                ref={contentRef}
                title="Kontak"
                recordTitle={form.value || 'Kontak baru'}
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
                        event.stopPropagation();
                        void submit();
                    }}
                >
                    <PageDialogToolbar>
                        {draftMode ? (
                            editing === 'new' ? (
                                <ActionButton action="add" type="submit" />
                            ) : (
                                <Button type="submit" variant="ghost">
                                    <Check aria-hidden="true" />
                                    Selesai
                                </Button>
                            )
                        ) : (
                            <ActionButton
                                action="save"
                                type="submit"
                                disabled={busy}
                                pending={busy}
                            />
                        )}
                        <ActionButton
                            action="cancel"
                            type="button"
                            disabled={busy}
                            onClick={onClose}
                        />
                    </PageDialogToolbar>
                    <FormErrorHeader
                        errors={errors}
                        message={message}
                        operation="Kontak belum disimpan"
                    />
                    <PageDialogBody className="py-3">
                        <FormGrid>
                            <FormControl
                                error={first(errors, 'type')}
                                data-error-field="type"
                            >
                                <Select
                                    label="Jenis"
                                    items={types.map((type) => ({
                                        value: type,
                                        label: contactTypeLabel[type] ?? type,
                                    }))}
                                    value={form.type || null}
                                    onValueChange={(value) =>
                                        value &&
                                        setForm((current) => ({
                                            ...current,
                                            type: value,
                                        }))
                                    }
                                    searchPlaceholder="Cari jenis"
                                    emptyMessage="Jenis tidak ditemukan."
                                    portalContainer={contentRef}
                                />
                            </FormControl>
                            <FormControl error={first(errors, 'value')}>
                                <Input
                                    label={
                                        contactValueLabel[form.type] ??
                                        'Nomor / alamat'
                                    }
                                    required
                                    data-error-field="value"
                                    type={
                                        form.type === 'email'
                                            ? 'email'
                                            : form.type === 'url'
                                              ? 'url'
                                              : 'tel'
                                    }
                                    value={form.value}
                                    onChange={(event) =>
                                        setForm((current) => ({
                                            ...current,
                                            value: event.target.value,
                                        }))
                                    }
                                />
                            </FormControl>
                            <FormControl error={first(errors, 'purpose')}>
                                <Input
                                    label="Keterangan"
                                    maxLength={30}
                                    data-error-field="purpose"
                                    placeholder="Contoh: Pribadi"
                                    value={form.purpose}
                                    onChange={(event) =>
                                        setForm((current) => ({
                                            ...current,
                                            purpose: event.target.value,
                                        }))
                                    }
                                />
                            </FormControl>
                            <FormControl
                                error={
                                    first(errors, 'address_id') ??
                                    first(errors, 'address_key')
                                }
                                hint="Kontak menempel pada satu alamat. Tanpa pilihan, kontak dicatat pada alamat utama."
                                data-error-field="address_id"
                            >
                                <Select
                                    label="Alamat"
                                    items={[
                                        {
                                            value: PRIMARY,
                                            label: 'Alamat utama',
                                        },
                                        ...owned.map((location) => ({
                                            value: location.id,
                                            label: location.name,
                                        })),
                                    ]}
                                    value={form.address_id || PRIMARY}
                                    onValueChange={(value) =>
                                        setForm((current) => ({
                                            ...current,
                                            address_id:
                                                value === null ||
                                                value === PRIMARY
                                                    ? ''
                                                    : value,
                                        }))
                                    }
                                    searchPlaceholder="Cari alamat"
                                    emptyMessage="Alamat tidak ditemukan."
                                    portalContainer={contentRef}
                                />
                            </FormControl>
                        </FormGrid>
                        <Field orientation="horizontal" className="mt-4 w-auto">
                            <Checkbox
                                id="contact-primary"
                                checked={form.is_primary}
                                onCheckedChange={(checked) =>
                                    setForm((current) => ({
                                        ...current,
                                        is_primary: checked === true,
                                    }))
                                }
                            />
                            <FieldLabel htmlFor="contact-primary">
                                Jadikan kontak utama untuk jenis ini
                            </FieldLabel>
                        </Field>
                    </PageDialogBody>
                </form>
            </PageDialogContent>
        </PageDialog>
    );
}

/** Informasi kontak satu party: telepon, WhatsApp, email, faks, dan laman web. */
export function PartyContactsSection({
    owner,
    canManage,
    draft,
}: {
    owner: AddressOwner | null;
    canManage: boolean;
    draft?: PartyDraftDetails;
}): ReactNode {
    const stored = useQuery({
        queryKey: ['party-contacts', owner?.kind, owner?.id],
        queryFn: async () => (await contactEndpoints(owner!).list()).body,
        enabled: !draft && owner !== null,
    });
    const storedLocations = useQuery({
        queryKey: ['party-locations', owner?.kind, owner?.id],
        queryFn: async () => (await locationEndpoints(owner!).list()).body,
        enabled: !draft && owner !== null,
    });
    const [editing, setEditing] = useState<PartyContact | 'new' | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const types = draft
        ? draft.options.contactTypes
        : (stored.data?.meta.types ?? []);
    const items = draft ? draft.value.contacts : (stored.data?.data ?? []);
    const locations = draft
        ? draft.value.locations
        : (storedLocations.data?.data ?? []);

    const saveDraft = async (form: ContactForm) => {
        const id = editing === 'new' || !editing ? newDraftKey() : editing.id;
        const others = draft!.value.contacts.filter((row) => row.id !== id);
        const primary =
            form.is_primary || !others.some((row) => row.type === form.type);
        const row: PartyContact = {
            id,
            version: 0,
            is_location_owner: true,
            type: form.type,
            value: form.value,
            purpose: form.purpose || null,
            is_primary: primary,
            address_id: form.address_id || null,
            address_name:
                locations.find((location) => location.id === form.address_id)
                    ?.name ?? null,
        };
        // Pemeriksaan isian wajib yang sama dengan server, supaya kesalahan tampil sebelum party disimpan.
        if (!form.value.trim())
            throw new ApiError(422, { errors: { value: ['Wajib diisi.'] } });
        draft!.onChange({
            ...draft!.value,
            contacts: [
                ...others.map((other) =>
                    primary && other.type === form.type
                        ? { ...other, is_primary: false }
                        : other,
                ),
                row,
            ],
        });
        setEditing(null);
    };

    const saveStored = async (form: ContactForm) => {
        const endpoints = contactEndpoints(owner!);
        const body = {
            ...form,
            purpose: form.purpose || null,
            address_id: form.address_id || null,
        };
        if (editing === 'new') {
            await endpoints.create(body);
            toast.success('Kontak ditambahkan.');
        } else if (editing) {
            await endpoints.update(editing.id, {
                ...body,
                version: editing.version,
            });
            toast.success('Kontak disimpan.');
        }
        setEditing(null);
        await stored.refetch();
    };

    const remove = async (contact: PartyContact) => {
        const confirmed = await confirm({
            title: `Delete kontak ${contact.value}?`,
            description: contact.is_primary
                ? 'Ini kontak utama untuk jenisnya. Kontak lain dengan jenis yang sama akan menjadi utama.'
                : 'Kontak ini tidak lagi tercatat untuk pihak ini.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!confirmed) return;
        if (draft) {
            const contacts = draft.value.contacts.filter(
                (row) => row.id !== contact.id,
            );
            const replacement = contacts.findIndex(
                (row) => row.type === contact.type,
            );
            if (contact.is_primary && replacement >= 0)
                contacts[replacement] = {
                    ...contacts[replacement]!,
                    is_primary: true,
                };
            draft.onChange({ ...draft.value, contacts });
            return;
        }
        setFailed(null);
        try {
            await contactEndpoints(owner!).remove(contact.id, contact.version);
            toast.success('Kontak dihapus.');
            await stored.refetch();
        } catch (caught) {
            setFailed(errorText(caught, 'Kontak belum dihapus.'));
        }
    };

    if (!draft && (stored.isPending || stored.isError))
        return (
            <LoadState
                loading={stored.isPending}
                error={stored.error}
                retry={() => void stored.refetch()}
                what="informasi kontak"
            />
        );

    return (
        <div className="space-y-3">
            {canManage && (
                <RecordActionBar>
                    <ActionButton
                        action="create"
                        type="button"
                        onClick={() => setEditing('new')}
                    />
                </RecordActionBar>
            )}
            {failed && (
                <p role="alert" className="text-sm text-destructive">
                    {failed}
                </p>
            )}
            {items.length === 0 ? (
                <Notice>
                    {canManage
                        ? 'Belum ada kontak. Pilih Baru untuk mengisi.'
                        : 'Belum ada kontak.'}
                </Notice>
            ) : (
                <DataTable
                    scrollMode="inline"
                    data={items}
                    getRowKey={(contact) => contact.id}
                    getRowLabel={(contact) => contact.value}
                    actionsPlacement="inline"
                    actions={
                        canManage
                            ? [
                                  { id: 'edit', label: 'Ubah' },
                                  {
                                      id: 'delete',
                                      label: 'Delete',
                                      destructive: true,
                                      separatorBefore: true,
                                  },
                              ]
                            : []
                    }
                    getRowActions={(contact) =>
                        canManage && contact.is_location_owner
                            ? [
                                  { id: 'edit', label: 'Ubah' },
                                  {
                                      id: 'delete',
                                      label: 'Delete',
                                      destructive: true,
                                      separatorBefore: true,
                                  },
                              ]
                            : []
                    }
                    onRowAction={(action, contact) =>
                        action === 'edit'
                            ? setEditing(contact)
                            : void remove(contact)
                    }
                    columns={[
                        {
                            id: 'type',
                            header: 'Jenis',
                            width: 120,
                            cell: (contact) => (
                                <DataTableText>
                                    {contactTypeLabel[contact.type] ??
                                        contact.type}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'value',
                            header: 'Nomor / alamat',
                            width: 240,
                            cell: (contact) => (
                                <DataTableText>{contact.value}</DataTableText>
                            ),
                        },
                        {
                            id: 'purpose',
                            header: 'Keterangan',
                            width: 140,
                            cell: (contact) => (
                                <DataTableText>
                                    {contact.purpose || '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'address',
                            header: 'Alamat',
                            width: 160,
                            cell: (contact) => (
                                <DataTableText>
                                    {contact.address_name ?? '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'primary',
                            header: 'Utama',
                            width: 90,
                            cell: (contact) =>
                                contact.is_primary ? <Badge>Utama</Badge> : '—',
                        },
                    ]}
                />
            )}
            {editing !== null && (
                <ContactDialog
                    editing={editing}
                    types={types}
                    locations={locations}
                    draftMode={Boolean(draft)}
                    onClose={() => setEditing(null)}
                    onSaved={draft ? saveDraft : saveStored}
                />
            )}
            {confirmation}
        </div>
    );
}
