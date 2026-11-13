import { DatePicker } from '@operations-metta/ui/date-picker';
import {
    Dialog,
    DialogAction,
    DialogBody,
    DialogCancel,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@operations-metta/ui/dialog';
import {
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Decimal } from '@core/platform/money/index.ts';
import {
    componentNumberFields,
    legacyNewPrice,
    priceLocations,
    priceNumberFields,
    priceSumFields,
    type ComponentNumberField,
} from './procedure-price.options.ts';
import {
    nextPriceKey,
    priceTotal,
    type ComponentDraft,
    type PriceDraft,
    type PriceMetadata,
    type SavedPrice,
} from './procedure-price-draft.ts';

type Errors = Record<string, string>;
const NONE = '__none__';

// Isian angka dialog berupa teks tampilan (12.500,5). Kosong berarti 0, seperti mask_number sistem lama.
function parsed(text: string): string | null {
    return text.trim() === '' ? '0' : parseDisplayNumber(text);
}

// Dialog form sistem lama: dua kolom yang dibaca kolom kiri lebih dulu, lalu Tutup dan Simpan. Simpan hanya mengubah
// grid; baris baru tersimpan saat kartu tindakan disimpan.
function DialogFrame({
    title,
    contentRef,
    onClose,
    onConfirm,
    children,
}: {
    title: string;
    contentRef: RefObject<HTMLDivElement | null>;
    onClose: () => void;
    onConfirm: () => void;
    children: ReactNode;
}): ReactNode {
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <DialogContent
                ref={contentRef}
                size="wide"
                aria-describedby={undefined}
                onEscapeKeyDown={(event: Event) => {
                    if (
                        contentRef.current?.querySelector(
                            '[role="combobox"][aria-expanded="true"]',
                        )
                    )
                        event.preventDefault();
                }}
            >
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <DialogBody>
                    <FormGrid>{children}</FormGrid>
                </DialogBody>
                <DialogFooter>
                    <DialogCancel>Tutup</DialogCancel>
                    <DialogAction type="button" onClick={onConfirm}>
                        Simpan
                    </DialogAction>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Toggle({
    label,
    checked,
    onCheckedChange,
}: {
    label: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}): ReactNode {
    const id = useId();
    return (
        <Field orientation="horizontal" className="w-auto">
            <Switch
                id={id}
                checked={checked}
                onCheckedChange={onCheckedChange}
            />
            <FieldLabel htmlFor={id} className="font-normal">
                {label}
            </FieldLabel>
        </Field>
    );
}

function NumberField({
    label,
    value,
    error,
    readOnly = false,
    required = false,
    onChange,
    onBlur,
}: {
    label: string;
    value: string;
    error?: string | undefined;
    readOnly?: boolean;
    required?: boolean;
    onChange?: (value: string) => void;
    onBlur?: () => void;
}): ReactNode {
    return (
        <FormControl error={error}>
            <Input
                label={label}
                inputMode="decimal"
                required={required}
                readOnly={readOnly}
                value={value}
                onChange={(event) => onChange?.(event.target.value)}
                onBlur={onBlur}
            />
        </FormControl>
    );
}

// Pilihan master: yang nonaktif hanya ditawarkan kepada baris yang sudah memegangnya. `none` adalah pilihan kosong
// dengan teks wildcard sistem lama.
function choiceItems(
    list: { id: string; name: string; active?: boolean }[],
    held: string | null,
    heldName: string | null,
    none?: string,
) {
    const items = list
        .filter((item) => item.active !== false || item.id === held)
        .map((item) => ({
            value: item.id,
            label: `${item.name}${item.active === false ? ' (nonaktif)' : ''}`,
        }));
    if (held !== null && heldName !== null && !list.some((i) => i.id === held))
        items.push({ value: held, label: `${heldName} (nonaktif)` });
    return [...(none ? [{ value: NONE, label: none }] : []), ...items];
}

type PriceForm = {
    price_group_id: string | null;
    care_class_id: string | null;
    specialty_id: string | null;
    sub_specialty: boolean;
    doctor_id: string | null;
    operation_category_id: string | null;
    ktp_patient: boolean;
    cito: boolean;
    location: string;
    detail_incentive: string;
    component_incentive: string;
    hc_discount_percent: string;
    new_price_date: string;
    new_bpjs_price_date: string;
};
type PriceNumber = keyof typeof priceNumberFields;
const priceNumberNames: PriceNumber[] = [
    'detail_incentive',
    'component_incentive',
    'hc_discount_percent',
];

// Form Detail Harga sistem lama (views/services/price/form.php), nilai bawaan Price::form: kelas XX, tipe pasien UMUM
// (di sini kelompok harga tipe pasien bawaan), spesialis ALL, dokter None, kategori operasi ALL, Patient KTP dicentang,
// lokasi RJ, tanggal harga baru hari ini. Harga lama dan baru hanya dibaca: nilainya jumlah komponen di grid bawah.
export function PriceDialog({
    price,
    saved,
    metadata,
    onClose,
    onConfirm,
}: {
    price: PriceDraft | null;
    saved: SavedPrice | undefined;
    metadata: PriceMetadata | undefined;
    onClose: () => void;
    onConfirm: (price: PriceDraft) => void;
}): ReactNode {
    const contentRef = useRef<HTMLDivElement>(null);
    const groups = choiceItems(
        metadata?.price_groups ?? [],
        saved?.price_group_id ?? null,
        saved?.price_group_name ?? null,
    );
    const [form, setForm] = useState<PriceForm>(() => ({
        price_group_id:
            price?.price_group_id ??
            metadata?.default_price_group_id ??
            groups[0]?.value ??
            null,
        care_class_id: price?.care_class_id ?? null,
        specialty_id: price?.specialty_id ?? null,
        sub_specialty: price?.sub_specialty ?? false,
        doctor_id: price?.doctor_id ?? null,
        operation_category_id: price?.operation_category_id ?? null,
        ktp_patient: price?.ktp_patient ?? true,
        cito: price?.cito ?? false,
        location: price?.location ?? 'RJ',
        detail_incentive: displayNumber(price?.detail_incentive ?? '0'),
        component_incentive: displayNumber(price?.component_incentive ?? '0'),
        hc_discount_percent: price
            ? displayNumber(price.hc_discount_percent)
            : '',
        new_price_date:
            price?.new_price_date ?? new Date().toLocaleDateString('sv'),
        new_bpjs_price_date: price?.new_bpjs_price_date ?? '',
    }));
    const [errors, setErrors] = useState<Errors>({});
    const components = price?.components ?? [];
    const select = (
        field:
            | 'price_group_id'
            | 'care_class_id'
            | 'specialty_id'
            | 'doctor_id'
            | 'operation_category_id',
        label: string,
        items: { value: string; label: string }[],
        required: boolean,
    ) => (
        <FormControl error={errors[field]}>
            <Select
                label={label}
                required={required}
                items={items}
                value={form[field] ?? NONE}
                onValueChange={(value) =>
                    setForm({
                        ...form,
                        [field]:
                            value === null || value === NONE ? null : value,
                    })
                }
                searchPlaceholder={`Cari ${label.toLowerCase()}`}
                emptyMessage="Pilihan tidak ditemukan."
                portalContainer={contentRef}
            />
        </FormControl>
    );
    const total = (field: keyof typeof priceSumFields) => (
        <NumberField
            label={priceSumFields[field].label}
            value={displayNumber(priceTotal(components, field))}
            readOnly
        />
    );
    const number = (field: PriceNumber) => (
        <NumberField
            label={priceNumberFields[field].label}
            value={form[field]}
            error={errors[field]}
            onChange={(value) => setForm({ ...form, [field]: value })}
        />
    );

    const confirm = () => {
        const next: Errors = {};
        const numbers = Object.fromEntries(
            priceNumberNames.map((field) => {
                const value = parsed(form[field]);
                if (value === null) next[field] = 'Isi angka.';
                return [field, value ?? '0'];
            }),
        );
        if (!form.price_group_id) next.price_group_id = 'Pilih kelompok harga.';
        if (!form.new_price_date)
            next.new_price_date = 'Isi tanggal harga baru.';
        setErrors(next);
        if (Object.keys(next).length || !form.price_group_id) return;
        onConfirm({
            key: price?.key ?? nextPriceKey(),
            id: price?.id ?? null,
            components,
            ...form,
            price_group_id: form.price_group_id,
            detail_incentive: numbers.detail_incentive ?? '0',
            component_incentive: numbers.component_incentive ?? '0',
            hc_discount_percent: numbers.hc_discount_percent ?? '0',
            new_bpjs_price_date: form.new_bpjs_price_date || null,
        });
    };

    return (
        <DialogFrame
            title="Detail Harga"
            contentRef={contentRef}
            onClose={onClose}
            onConfirm={confirm}
        >
            <FormGrid columns={1}>
                {select(
                    'care_class_id',
                    'Kelas',
                    choiceItems(
                        metadata?.care_classes ?? [],
                        saved?.care_class_id ?? null,
                        saved?.care_class_name ?? null,
                        'XX',
                    ),
                    true,
                )}
                {select('price_group_id', 'Kelompok Harga', groups, true)}
                {select(
                    'specialty_id',
                    'Spesialis',
                    choiceItems(
                        metadata?.specialties ?? [],
                        saved?.specialty_id ?? null,
                        saved?.specialty_name ?? null,
                        'ALL',
                    ),
                    true,
                )}
                <Toggle
                    label="Sub Spesialis"
                    checked={form.sub_specialty}
                    onCheckedChange={(checked) =>
                        setForm({ ...form, sub_specialty: checked })
                    }
                />
                {select(
                    'doctor_id',
                    'Dokter',
                    choiceItems(
                        metadata?.doctors ?? [],
                        saved?.doctor_id ?? null,
                        saved?.doctor_name ?? null,
                        'None',
                    ),
                    false,
                )}
                {select(
                    'operation_category_id',
                    'Kategori Operasi',
                    choiceItems(
                        metadata?.operation_categories ?? [],
                        saved?.operation_category_id ?? null,
                        saved?.operation_category_name ?? null,
                        'ALL',
                    ),
                    true,
                )}
                <div className="flex flex-wrap gap-6">
                    <Toggle
                        label="Patient KTP"
                        checked={form.ktp_patient}
                        onCheckedChange={(checked) =>
                            setForm({ ...form, ktp_patient: checked })
                        }
                    />
                    <Toggle
                        label="Cyto"
                        checked={form.cito}
                        onCheckedChange={(checked) =>
                            setForm({ ...form, cito: checked })
                        }
                    />
                </div>
                <FormControl error={errors.location}>
                    <Select
                        label="Lokasi"
                        required
                        items={Object.entries(priceLocations).map(
                            ([value, label]) => ({ value, label }),
                        )}
                        value={form.location}
                        onValueChange={(value) =>
                            setForm({ ...form, location: value ?? 'RJ' })
                        }
                        searchPlaceholder="Cari lokasi"
                        emptyMessage="Pilihan tidak ditemukan."
                        portalContainer={contentRef}
                    />
                </FormControl>
                {number('detail_incentive')}
                {number('component_incentive')}
            </FormGrid>
            <FormGrid columns={1}>
                {total('previous_price')}
                {total('new_price')}
                {total('previous_hc_price')}
                {total('new_hc_price')}
                {number('hc_discount_percent')}
                <FormControl error={errors.new_price_date}>
                    <DatePicker
                        label="Tanggal Harga Baru"
                        value={form.new_price_date}
                        onValueChange={(value) =>
                            setForm({ ...form, new_price_date: value })
                        }
                        portalContainer={contentRef}
                    />
                </FormControl>
                {total('previous_bpjs_price')}
                {total('new_bpjs_price')}
                <FormControl>
                    <DatePicker
                        label="Tanggal Harga Baru BPJS"
                        value={form.new_bpjs_price_date}
                        onValueChange={(value) =>
                            setForm({ ...form, new_bpjs_price_date: value })
                        }
                        portalContainer={contentRef}
                    />
                </FormControl>
            </FormGrid>
        </DialogFrame>
    );
}

type ComponentForm = Record<ComponentNumberField, string> & {
    charge_component_id: string | null;
    includes_incentive: boolean;
};
const componentNumberNames = Object.keys(componentNumberFields).filter(
    (field): field is ComponentNumberField =>
        Object.hasOwn(componentNumberFields, field),
);
// Form komponen baru sistem lama: isian mask-number berisi 0, Insentif HC (%) isian biasa yang kosong.
const blankComponent: Record<ComponentNumberField, string> = {
    quantity: '1',
    initial_price: '0',
    previous_price: '0',
    tax_deposit_percent: '0',
    incentive_percent: '0',
    new_price: '0',
    previous_hc_price: '0',
    new_hc_price: '0',
    hc_incentive_percent: '',
    previous_bpjs_price: '0',
    new_bpjs_price: '0',
};

// Form Komponen Jasa sistem lama (views/services/price/form_component.php), nilai bawaan Price::form_component: Qty 1,
// persen pajak titipan dan persen insentif 0. Rekening HPP dan Rekening Lawan HPP menunggu bagan akun finance.
export function ComponentDialog({
    component,
    heldIds,
    takenIds,
    metadata,
    onClose,
    onConfirm,
}: {
    component: ComponentDraft | null;
    // Komponen yang sudah dipegang baris harga tersimpan; yang nonaktif tetap boleh dipilih kembali.
    heldIds: Set<string>;
    // Komponen lain di baris harga ini; satu komponen sekali per baris harga, kunci SIMdListHargaDetail.
    takenIds: Set<string>;
    metadata: PriceMetadata | undefined;
    onClose: () => void;
    onConfirm: (component: ComponentDraft) => void;
}): ReactNode {
    const contentRef = useRef<HTMLDivElement>(null);
    const [form, setForm] = useState<ComponentForm>(() => ({
        ...componentNumberNames.reduce(
            (numbers, field) =>
                component
                    ? { ...numbers, [field]: displayNumber(component[field]) }
                    : numbers,
            blankComponent,
        ),
        charge_component_id: component?.charge_component_id ?? null,
        includes_incentive: component?.includes_incentive ?? false,
    }));
    const [errors, setErrors] = useState<Errors>({});
    const choices = (metadata?.charge_components ?? []).filter(
        (item) => item.active || heldIds.has(item.id),
    );
    const chosen =
        choices.find((item) => item.id === form.charge_component_id) ?? null;

    // calculate_new_price: Harga Baru diisi ulang dari Harga Awal, Persen Insentif, Persen Pajak Titipan, dan Include
    // Insentif.
    const recalculated = (next: ComponentForm): ComponentForm => ({
        ...next,
        new_price: displayNumber(
            Decimal.of(
                legacyNewPrice(
                    parsed(next.initial_price) ?? '0',
                    parsed(next.incentive_percent) ?? '0',
                    parsed(next.tax_deposit_percent) ?? '0',
                    next.includes_incentive,
                ),
            ).normalized(),
        ),
    });
    const number = (
        field: ComponentNumberField,
        recalculates = false,
    ): ReactNode => (
        <NumberField
            label={componentNumberFields[field].label}
            required={field === 'quantity'}
            value={form[field]}
            error={errors[field]}
            onChange={(value) => setForm({ ...form, [field]: value })}
            onBlur={
                recalculates ? () => setForm(recalculated(form)) : undefined
            }
        />
    );

    const confirm = () => {
        const next: Errors = {};
        const values = componentNumberNames.reduce((numbers, field) => {
            const text = form[field];
            const value =
                field === 'quantity' && text.trim() === ''
                    ? null
                    : parsed(text);
            if (value === null)
                next[field] = text.trim() === '' ? 'Isi Qty.' : 'Isi angka.';
            return { ...numbers, [field]: value ?? '0' };
        }, blankComponent);
        if (!form.charge_component_id)
            next.charge_component_id = 'Pilih komponen.';
        else if (takenIds.has(form.charge_component_id))
            next.charge_component_id =
                'Komponen ini sudah ada di baris harga ini.';
        setErrors(next);
        if (Object.keys(next).length || !form.charge_component_id) return;
        const draft: ComponentDraft = {
            ...values,
            charge_component_id: form.charge_component_id,
            includes_incentive: form.includes_incentive,
        };
        // Mengubah komponen yang sudah ada memindah harga baru ke harga lama setiap kali Simpan ditekan, juga bila tidak
        // ada yang berubah, sama dengan form komponen sistem lama.
        onConfirm(
            component
                ? {
                      ...draft,
                      previous_price: component.new_price,
                      previous_hc_price: component.new_hc_price,
                      previous_bpjs_price: component.new_bpjs_price,
                  }
                : draft,
        );
    };

    return (
        <DialogFrame
            title="Detail Komponen Jasa"
            contentRef={contentRef}
            onClose={onClose}
            onConfirm={confirm}
        >
            <FormGrid columns={1}>
                <FormControl error={errors.charge_component_id}>
                    <InlineLookup
                        label="Komponen"
                        required
                        items={choices}
                        value={chosen}
                        displayValue={chosen?.name ?? ''}
                        onValueChange={(item) =>
                            setForm({ ...form, charge_component_id: item.id })
                        }
                        getItemValue={(item) => item.id}
                        getItemLabel={(item) => item.name}
                        getSearchText={(item) => `${item.code} ${item.name}`}
                        placeholder="Cari komponen…"
                        emptyMessage="Komponen tidak ditemukan."
                        showDetails={false}
                        showFullList={false}
                        portalContainer={contentRef}
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
                {number('quantity')}
                {number('initial_price', true)}
                {number('previous_price')}
                {number('tax_deposit_percent', true)}
                {number('incentive_percent', true)}
                <Toggle
                    label="Include Insentif"
                    checked={form.includes_incentive}
                    onCheckedChange={(checked) =>
                        setForm(
                            recalculated({
                                ...form,
                                includes_incentive: checked,
                            }),
                        )
                    }
                />
                {number('new_price')}
            </FormGrid>
            <FormGrid columns={1}>
                {number('previous_hc_price')}
                {number('new_hc_price')}
                {number('hc_incentive_percent')}
                {number('previous_bpjs_price')}
                {number('new_bpjs_price')}
            </FormGrid>
        </DialogFrame>
    );
}
