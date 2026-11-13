import { ActionButton } from '@operations-metta/ui/action-button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import {
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import { Input } from '@operations-metta/ui/input';
import { MultiSelect } from '@operations-metta/ui/multi-select';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import {
    isProcedureFlag,
    procedureFlags,
    procedureOptions,
    type ProcedureOption,
} from './procedure.options.ts';
import { priceDrafts, priceInputs } from './procedure-price-draft.ts';
import { ProcedurePriceTab } from './procedure-price-tab.tsx';

export type Procedure = ApiBody<'healthcareProcedureShow'>['data'];
export type ProcedurePermissions =
    ApiBody<'healthcareProcedureMetadata'>['permissions'];
type Metadata = ApiBody<'healthcareProcedureMetadata'>;
type Group = Metadata['groups'][number];
type Category = Metadata['categories'][number];
type ChoiceField = 'benefit_limit_category_id' | 'supporting_device_id';
const NONE = '__none__';

const flags = Object.entries(procedureFlags).flatMap(([flag, { label }]) =>
    isProcedureFlag(flag) ? [{ flag, label }] : [],
);
const optionItems = (option: ProcedureOption) =>
    Object.entries(procedureOptions[option]).map(([value, label]) => ({
        value,
        label,
    }));
// Dua pilihan master sesudah Kategori, masing-masing dengan pilihan kosong seperti "-- None --" kartu Jasa sistem lama.
const choices: {
    field: ChoiceField;
    list: 'benefit_limit_categories' | 'supporting_devices';
    heldName: 'benefit_limit_category_name' | 'supporting_device_name';
    label: string;
}[] = [
    {
        field: 'benefit_limit_category_id',
        list: 'benefit_limit_categories',
        heldName: 'benefit_limit_category_name',
        label: 'Kategori Plafon',
    },
    {
        field: 'supporting_device_id',
        list: 'supporting_devices',
        heldName: 'supporting_device_name',
        label: 'Menggunakan Alat',
    },
];
const options: { option: ProcedureOption; label: string }[] = [
    { option: 'posting_group', label: 'Kelompok Posting' },
    { option: 'incentive_source', label: 'Sumber Insentif' },
    { option: 'polyclinic', label: 'Poliklinik' },
];

// Kartu satu tindakan, susunan kartu Jasa sistem lama: kode, nama, nama internasional, kelompok, dan kategori di
// Umum, lalu tab Detail Harga, lalu section yang menawarkannya (tab Detail Section). Dipakai daftar tindakan di Setup
// dan tombol Baru pada pilihan tindakan baris Biaya Tindakan pemeriksaan. Kartu memuat pilihannya sendiri supaya bisa
// dibuka dari mana saja.
export function ProcedureCard({
    procedure,
    permissions,
    defaultSectionIds = [],
    onSaved,
    onClose,
}: {
    procedure: Procedure | null;
    permissions: ProcedurePermissions;
    // Section bawaan tindakan baru, misalnya section pemeriksaan yang membuka Baru dari Biaya Tindakan.
    defaultSectionIds?: string[];
    onSaved: (procedure: Procedure) => void;
    onClose: () => void;
}): ReactNode {
    const editing =
        procedure === null ? permissions.create : permissions.update;
    const blank = {
        code: procedure?.code ?? '',
        name: procedure?.name ?? '',
        international_name: procedure?.international_name ?? '',
        group_id: procedure?.group_id ?? null,
        category_id: procedure?.category_id ?? null,
        benefit_limit_category_id: procedure?.benefit_limit_category_id ?? null,
        supporting_device_id: procedure?.supporting_device_id ?? null,
        section_ids: procedure
            ? procedure.sections.map((section) => section.id)
            : defaultSectionIds,
        hospital_cost_percent: displayNumber(
            procedure?.hospital_cost_percent ?? '0',
        ),
        hospital_cost_amount: displayNumber(
            procedure?.hospital_cost_amount ?? '0',
        ),
        posting_group: procedure?.posting_group ?? 'GROUP JASA',
        incentive_source: procedure?.incentive_source ?? 'NONE',
        polyclinic: procedure?.polyclinic ?? 'NONE',
        is_active: procedure?.is_active ?? true,
        flags: Object.fromEntries(
            flags.map(({ flag }) => [flag, procedure?.[flag] ?? false]),
        ),
        prices: priceDrafts(procedure?.prices ?? []),
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const idPrefix = useId();
    // Popup pilihan dipasang di dalam kartu, karena pemanggil tidak selalu memberi ref isi dialognya.
    const portalContainer = useRef<HTMLDivElement>(null);
    const { data: metadata } = useQuery(
        orpc.healthcareProcedureMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    usePageDialogRecord({
        recordTitle: procedure
            ? `${procedure.code} ${procedure.name}`
            : 'Tindakan baru',
        editing,
    });
    const groups = (metadata?.groups ?? []).filter(
        (group) => group.active || group.id === procedure?.group_id,
    );
    const group: Group | null =
        groups.find((item) => item.id === form.group_id) ??
        (form.group_id !== null && form.group_id === procedure?.group_id
            ? {
                  id: form.group_id,
                  code: '',
                  name: procedure.group_name ?? '',
                  active: false,
              }
            : null);
    const categories = (metadata?.categories ?? []).filter(
        (item) =>
            item.group_id === form.group_id &&
            (item.active || item.id === procedure?.category_id),
    );
    const category: Category | null =
        categories.find((item) => item.id === form.category_id) ??
        (form.category_id !== null &&
        form.category_id === procedure?.category_id &&
        form.group_id !== null
            ? {
                  id: form.category_id,
                  group_id: form.group_id,
                  name: procedure.category_name ?? '',
                  active: false,
              }
            : null);
    // Pilihan nonaktif hanya ditawarkan kepada tindakan yang sudah memegangnya.
    const choiceItems = (
        list: (typeof choices)[number]['list'],
        field: ChoiceField,
    ) => [
        { value: NONE, label: 'Tidak ada' },
        ...(metadata?.[list] ?? [])
            .filter((item) => item.active || item.id === procedure?.[field])
            .map((item) => ({
                value: item.id,
                label: `${item.name}${item.active ? '' : ' (nonaktif)'}`,
            })),
    ];
    const held = new Set(procedure?.sections.map((section) => section.id));
    const sections = (metadata?.sections ?? [])
        .filter((section) => section.active || held.has(section.id))
        .map((section) => ({
            value: section.id,
            label: `${section.name} · ${section.operating_unit_name}${section.active ? '' : ' (nonaktif)'}`,
        }));

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        // Angka diketik cara Indonesia (12.500); yang tidak terbaca dikirim apa adanya supaya ditolak di isiannya.
        const { flags: flagValues, prices, ...fields } = form;
        const body = {
            ...fields,
            ...flagValues,
            prices: priceInputs(prices),
            hospital_cost_percent:
                parseDisplayNumber(form.hospital_cost_percent) ??
                form.hospital_cost_percent,
            hospital_cost_amount:
                parseDisplayNumber(form.hospital_cost_amount) ??
                form.hospital_cost_amount,
        };
        try {
            const { body: saved } = procedure
                ? await api.healthcareProcedureUpdate({
                      params: { id: procedure.id },
                      body: { ...body, version: procedure.version },
                  })
                : await api.healthcareProcedureCreate({ body });
            toast.success(
                procedure ? 'Tindakan diperbarui.' : 'Tindakan dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Tindakan belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!procedure) return;
        if (
            !(await confirm({
                title: `Delete tindakan ${procedure.code}?`,
                description:
                    'Tindakan ini tidak bisa dipilih lagi di pemeriksaan.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcareProcedureDelete({
                params: { id: procedure.id },
                body: { version: procedure.version },
            });
            toast.success('Tindakan dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Tindakan belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div ref={portalContainer} className="flex min-h-0 flex-1 flex-col">
            <form
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
                                    if (!procedure) {
                                        onClose();
                                        return;
                                    }
                                    setForm(blank);
                                    setErrors({});
                                }}
                            />
                        </>
                    )}
                    {procedure && permissions.delete && (
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
                    operation="Tindakan belum disimpan"
                />
                <PageDialogBody className="py-3">
                    <CollapsibleSectionGroup
                        defaultValue={['general', 'prices', 'sections']}
                    >
                        <CollapsibleSection
                            value="general"
                            title="Umum"
                            summary={[group?.name, category?.name]
                                .filter(Boolean)
                                .join(' · ')}
                        >
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
                                            setForm({
                                                ...form,
                                                code: event.target.value,
                                            })
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
                                            setForm({
                                                ...form,
                                                name: event.target.value,
                                            })
                                        }
                                    />
                                </FormControl>
                                <FormControl
                                    error={errors.international_name?.[0]}
                                    hint="Nama tindakan dalam bahasa lain, misalnya untuk pasien turis. Boleh kosong."
                                >
                                    <Input
                                        label="Nama internasional"
                                        maxLength={200}
                                        data-error-field="international_name"
                                        value={form.international_name}
                                        readOnly={!editing}
                                        onChange={(event) =>
                                            setForm({
                                                ...form,
                                                international_name:
                                                    event.target.value,
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
                                        disabled={!editing}
                                        items={groups}
                                        value={group}
                                        displayValue={group?.name ?? ''}
                                        onValueChange={(item) =>
                                            setForm({
                                                ...form,
                                                group_id: item.id,
                                                category_id:
                                                    item.id === form.group_id
                                                        ? form.category_id
                                                        : null,
                                            })
                                        }
                                        getItemValue={(item) => item.id}
                                        getItemLabel={(item) => item.name}
                                        getSearchText={(item) =>
                                            `${item.code} ${item.name}`
                                        }
                                        placeholder="Cari kelompok…"
                                        emptyMessage="Kelompok tidak ditemukan."
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
                                <FormControl
                                    error={errors.category_id?.[0]}
                                    data-error-field="category_id"
                                    hint="Pilihan kategori mengikuti kelompok yang dipilih."
                                >
                                    <InlineLookup
                                        label="Kategori"
                                        disabled={!editing || !form.group_id}
                                        items={categories}
                                        value={category}
                                        displayValue={category?.name ?? ''}
                                        onValueChange={(item) =>
                                            setForm({
                                                ...form,
                                                category_id: item.id,
                                            })
                                        }
                                        getItemValue={(item) => item.id}
                                        getItemLabel={(item) => item.name}
                                        placeholder="Cari kategori…"
                                        emptyMessage="Kategori kelompok ini belum ada. Tambahkan di layar Kategori tindakan."
                                        showDetails={false}
                                        showFullList={false}
                                        portalContainer={portalContainer}
                                        columns={[
                                            {
                                                id: 'name',
                                                header: 'Nama',
                                                width: 260,
                                                cell: (item) => item.name,
                                            },
                                        ]}
                                    />
                                </FormControl>
                                {choices.map(
                                    ({ field, list, heldName, label }) => (
                                        <FormControl
                                            key={field}
                                            error={errors[field]?.[0]}
                                            data-error-field={field}
                                        >
                                            {editing ? (
                                                <Select
                                                    label={label}
                                                    items={choiceItems(
                                                        list,
                                                        field,
                                                    )}
                                                    value={form[field] ?? NONE}
                                                    onValueChange={(value) =>
                                                        setForm({
                                                            ...form,
                                                            [field]:
                                                                value ===
                                                                    null ||
                                                                value === NONE
                                                                    ? null
                                                                    : value,
                                                        })
                                                    }
                                                    searchPlaceholder={`Cari ${label.toLowerCase()}`}
                                                    emptyMessage="Pilihan tidak ditemukan."
                                                    portalContainer={
                                                        portalContainer
                                                    }
                                                />
                                            ) : (
                                                <Input
                                                    label={label}
                                                    value={
                                                        procedure?.[heldName] ??
                                                        ''
                                                    }
                                                    readOnly
                                                />
                                            )}
                                        </FormControl>
                                    ),
                                )}
                                <FormControl
                                    error={errors.hospital_cost_percent?.[0]}
                                >
                                    <Input
                                        label="Cost RS (%)"
                                        inputMode="decimal"
                                        data-error-field="hospital_cost_percent"
                                        value={form.hospital_cost_percent}
                                        readOnly={!editing}
                                        onChange={(event) =>
                                            setForm({
                                                ...form,
                                                hospital_cost_percent:
                                                    event.target.value,
                                            })
                                        }
                                    />
                                </FormControl>
                                <FormControl
                                    error={errors.hospital_cost_amount?.[0]}
                                >
                                    <Input
                                        label="Cost RS (Rp)"
                                        inputMode="decimal"
                                        data-error-field="hospital_cost_amount"
                                        value={form.hospital_cost_amount}
                                        readOnly={!editing}
                                        onChange={(event) =>
                                            setForm({
                                                ...form,
                                                hospital_cost_amount:
                                                    event.target.value,
                                            })
                                        }
                                    />
                                </FormControl>
                                {options.map(({ option, label }) => (
                                    <FormControl
                                        key={option}
                                        error={errors[option]?.[0]}
                                        data-error-field={option}
                                    >
                                        {editing ? (
                                            <Select
                                                label={label}
                                                required
                                                items={optionItems(option)}
                                                value={form[option]}
                                                onValueChange={(value) =>
                                                    setForm({
                                                        ...form,
                                                        [option]:
                                                            value ??
                                                            form[option],
                                                    })
                                                }
                                                searchPlaceholder={`Cari ${label.toLowerCase()}`}
                                                emptyMessage="Pilihan tidak ditemukan."
                                                portalContainer={
                                                    portalContainer
                                                }
                                            />
                                        ) : (
                                            <Input
                                                label={label}
                                                value={
                                                    optionItems(option).find(
                                                        (item) =>
                                                            item.value ===
                                                            form[option],
                                                    )?.label ?? form[option]
                                                }
                                                readOnly
                                            />
                                        )}
                                    </FormControl>
                                ))}
                            </FormGrid>
                            <FormGrid className="mt-4">
                                <Field
                                    orientation="horizontal"
                                    className="w-auto"
                                >
                                    <Switch
                                        id={`${idPrefix}-active`}
                                        checked={form.is_active}
                                        disabled={!editing}
                                        onCheckedChange={(checked) =>
                                            setForm({
                                                ...form,
                                                is_active: checked,
                                            })
                                        }
                                    />
                                    <FieldLabel htmlFor={`${idPrefix}-active`}>
                                        Aktif
                                    </FieldLabel>
                                </Field>
                                {flags.map(({ flag, label }) => (
                                    <Field
                                        key={flag}
                                        orientation="horizontal"
                                        className="w-auto"
                                    >
                                        <Switch
                                            id={`${idPrefix}-${flag}`}
                                            checked={form.flags[flag] ?? false}
                                            disabled={!editing}
                                            onCheckedChange={(checked) =>
                                                setForm({
                                                    ...form,
                                                    flags: {
                                                        ...form.flags,
                                                        [flag]: checked,
                                                    },
                                                })
                                            }
                                        />
                                        <FieldLabel
                                            htmlFor={`${idPrefix}-${flag}`}
                                            className="font-normal"
                                        >
                                            {label}
                                        </FieldLabel>
                                    </Field>
                                ))}
                            </FormGrid>
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="prices"
                            title="Detail Harga"
                            summary={`${form.prices.length} baris harga`}
                        >
                            <ProcedurePriceTab
                                prices={form.prices}
                                saved={procedure?.prices ?? []}
                                metadata={metadata}
                                editing={editing}
                                onChange={(prices) =>
                                    setForm((current) => ({
                                        ...current,
                                        prices,
                                    }))
                                }
                            />
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="sections"
                            title="Section"
                            summary={`${form.section_ids.length} section`}
                        >
                            <FormGrid columns={1}>
                                <FormControl
                                    error={errors.section_ids?.[0]}
                                    data-error-field="section_ids"
                                    hint="Tindakan hanya muncul di pilihan Biaya Tindakan pemeriksaan section yang dipilih di sini, kecuali pemeriksa menyalakan Tampil semua."
                                >
                                    {editing ? (
                                        <MultiSelect
                                            label="Ditawarkan di section"
                                            items={sections}
                                            value={form.section_ids}
                                            onValueChange={(sectionIds) =>
                                                setForm({
                                                    ...form,
                                                    section_ids: sectionIds,
                                                })
                                            }
                                            placeholder="Belum ada section"
                                            searchPlaceholder="Cari section"
                                            emptyMessage="Section tidak ditemukan."
                                            portalContainer={portalContainer}
                                        />
                                    ) : (
                                        <Input
                                            label="Ditawarkan di section"
                                            value={(procedure?.sections ?? [])
                                                .map((section) => section.name)
                                                .join(', ')}
                                            readOnly
                                        />
                                    )}
                                </FormControl>
                            </FormGrid>
                        </CollapsibleSection>
                    </CollapsibleSectionGroup>
                </PageDialogBody>
                {confirmation}
            </form>
        </div>
    );
}
