import { ActionButton } from '@operations-metta/ui/action-button';
import { Alert, AlertDescription } from '@operations-metta/ui/alert';
import { Button } from '@operations-metta/ui/button';
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
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import {
    RecordEditBoundary,
    RecordEditControl,
} from '@operations-metta/ui/record-edit-boundary';
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import { Textarea } from '@operations-metta/ui/textarea';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    AddressRegionFields,
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type AddressRegionValue,
    type ApiBody,
} from '@core/platform/shell/index.ts';

export type PatientMetadata = ApiBody<'healthcarePatientMetadata'>;
export type PatientRow = ApiBody<'healthcarePatientList'>['data'][number];
type Patient = ApiBody<'healthcarePatientShow'>['data'];
type PatientType = ApiBody<'healthcarePatientTypeList'>['data'][number];
type Guarantor = ApiBody<'healthcareGuarantorList'>['data'][number];
type Occupation = ApiBody<'healthcarePatientOccupations'>['data'][number];
type Errors = Record<string, string[]>;
type Address = AddressRegionValue & { street: string; rt: string; rw: string };
type Payment = {
    key: string;
    patient_type: { id: string; name: string; behaviors: string[] } | null;
    guarantor: { id: string; name: string } | null;
    card_number: string;
    class: string;
    is_primary: boolean;
};
type Masked = { value: string; masked: string | null };

// Isian kartu pasien: identitas, data tambahan, alamat KTP dan domisili, dan cara bayar, seperti tiga kelompok form
// pasien sistem lama.
type Form = {
    name: string;
    nationality_country_code: string;
    nik: Masked;
    family_card_number: Masked;
    passport_number: string;
    gender: string;
    birth_date: string;
    birth_place: string;
    religion: string;
    education: string;
    marital_status: string;
    anniversary_date: string;
    occupation: { id: string; name: string } | null;
    phone: string;
    email: string;
    identity: Address;
    has_domicile: boolean;
    domicile: Address;
    is_active: boolean;
    document_number: string;
    old_number: string;
    blood_type: string;
    family_status: string;
    institution: string;
    father_name: string;
    mother_name: string;
    mother_nik: Masked;
    // Cara bayar bawaan pasien: tipe pasien, perusahaan, dan nomor asuransi form lama. Cara bayar lain yang mungkin
    // tersimpan lewat API tidak tampil di master pasien, dan dikirim balik apa adanya.
    payment: Payment;
    otherPayments: Payment[];
};

const INDONESIA = 'ID';
// Pilihan kosong pada isian opsional. Select SDK menganggap nilai kosong sebagai belum memilih.
const UNSET = 'unset';
// Kode nilai acuan yang memunculkan isian bersyarat, sama dengan form lama: NIK ibu untuk anak, tanggal menikah untuk
// yang menikah.
const CHILD = 'child';
const MARRIED = 'married';

const text = (value: string | null | undefined) => value ?? '';
const nullable = (value: string) => (value.trim() === '' ? null : value.trim());

function addressOf(address: Patient['identity_address'] | null): Address {
    return {
        country_region_code: address?.country_region_code ?? INDONESIA,
        province_id: text(address?.province_id),
        regency_id: text(address?.regency_id),
        district_id: text(address?.district_id),
        village_id: text(address?.village_id),
        postal_code_id: text(address?.postal_code_id),
        group_of_houses_id: text(address?.group_of_houses_id),
        province: text(address?.province),
        city: text(address?.city),
        district: text(address?.district),
        village: text(address?.village),
        group_of_houses: text(address?.group_of_houses),
        postal_code: text(address?.postal_code),
        street: text(address?.street),
        rt: text(address?.rt),
        rw: text(address?.rw),
    };
}

function masked(number: { number: string | null; masked: boolean }): Masked {
    return number.masked
        ? { value: '', masked: number.number }
        : { value: text(number.number), masked: null };
}

const blankPayment = (): Payment => ({
    key: 'default',
    patient_type: null,
    guarantor: null,
    card_number: '',
    class: '',
    is_primary: true,
});

type DefaultPayment = PatientMetadata['default_payment_method'];

// Kartu pasien baru memakai tipe pasien bawaan beserta penjamin bawaannya, bila tenant menandainya.
function defaultPayment(fallback: DefaultPayment): Payment {
    if (!fallback) return blankPayment();
    return {
        ...blankPayment(),
        patient_type: {
            id: fallback.patient_type_id,
            name: fallback.patient_type_name,
            behaviors: fallback.behaviors,
        },
        guarantor:
            fallback.guarantor_id && fallback.guarantor_name
                ? { id: fallback.guarantor_id, name: fallback.guarantor_name }
                : null,
    };
}

function paymentsOf(patient: Patient | null, fallback: DefaultPayment) {
    const methods = (patient?.payment_methods ?? []).map((method): Payment => ({
        key: method.id,
        patient_type: {
            id: method.patient_type_id,
            name: method.patient_type_name,
            behaviors: method.behaviors,
        },
        guarantor:
            method.guarantor_id && method.guarantor_name
                ? { id: method.guarantor_id, name: method.guarantor_name }
                : null,
        card_number: text(method.card_number),
        class: text(method.class),
        is_primary: method.is_primary,
    }));
    const primary =
        methods.find((method) => method.is_primary) ?? methods[0] ?? null;
    return {
        payment:
            primary ?? (patient ? blankPayment() : defaultPayment(fallback)),
        otherPayments: methods.filter((method) => method !== primary),
    };
}

function formOf(patient: Patient | null, fallback: DefaultPayment): Form {
    return {
        name: text(patient?.name),
        nationality_country_code: patient
            ? text(patient.nationality_country_code)
            : INDONESIA,
        nik: patient ? masked(patient.nik) : { value: '', masked: null },
        family_card_number: patient
            ? masked(patient.family_card_number)
            : { value: '', masked: null },
        passport_number: text(patient?.passport_number.number),
        gender: text(patient?.gender),
        birth_date: text(patient?.birth_date),
        birth_place: text(patient?.birth_place),
        religion: text(patient?.religion),
        education: text(patient?.education),
        marital_status: text(patient?.marital_status),
        anniversary_date: text(patient?.anniversary_date),
        occupation:
            patient?.occupation_id && patient.occupation_name
                ? { id: patient.occupation_id, name: patient.occupation_name }
                : null,
        phone: text(patient?.phone),
        email: text(patient?.email),
        identity: addressOf(patient?.identity_address ?? null),
        has_domicile: Boolean(patient?.domicile_address),
        domicile: addressOf(patient?.domicile_address ?? null),
        // Pasien baru langsung aktif; pasien lama mengikuti record.
        is_active: patient?.is_active ?? true,
        document_number: text(patient?.document_number),
        old_number: text(patient?.old_number),
        blood_type: text(patient?.blood_type),
        family_status: text(patient?.family_status),
        institution: text(patient?.institution),
        father_name: text(patient?.father_name),
        mother_name: text(patient?.mother_name),
        mother_nik: patient
            ? patient.mother_nik_masked
                ? { value: '', masked: patient.mother_nik }
                : { value: text(patient.mother_nik), masked: null }
            : { value: '', masked: null },
        ...paymentsOf(patient, fallback),
    };
}

// Umur dihitung dari tanggal lahir setiap kali ditampilkan, dengan cara hitung form lama (getAge): tahun, bulan, dan
// hari sejak tanggal lahir sampai hari ini.
export function ageOf(birthDate: string, today = new Date()): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
    if (!match) return '';
    const born = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
    );
    let years = today.getFullYear() - born.getFullYear();
    let months = today.getMonth() - born.getMonth();
    let days = today.getDate() - born.getDate();
    if (months < 0 || (months === 0 && days < 0)) {
        years--;
        months += 12;
    }
    if (days < 0) {
        days += new Date(today.getFullYear(), today.getMonth(), 0).getDate();
        months--;
    }
    return `${years} thn ${months} bln ${days} hari`;
}

function addressBody(address: Address) {
    return {
        country_region_code: address.country_region_code || INDONESIA,
        province_id: nullable(address.province_id),
        regency_id: nullable(address.regency_id),
        district_id: nullable(address.district_id),
        village_id: nullable(address.village_id),
        postal_code_id: nullable(address.postal_code_id),
        group_of_houses_id: nullable(address.group_of_houses_id),
        group_of_houses: nullable(address.group_of_houses),
        street: nullable(address.street),
        rt: nullable(address.rt),
        rw: nullable(address.rw),
    };
}

// Kiriman simpan. Nomor yang tampil tersamar hanya dikirim bila diketik ulang, supaya nomor tersamar tidak pernah
// tertulis balik.
function patientBody(form: Form) {
    const domestic = form.nationality_country_code === INDONESIA;
    const number = (field: Masked) =>
        field.masked !== null && field.value.trim() === ''
            ? undefined
            : nullable(field.value);
    const nik = domestic ? number(form.nik) : null;
    const familyCard = number(form.family_card_number);
    const motherNik =
        form.family_status === CHILD ? number(form.mother_nik) : null;
    return {
        name: nullable(form.name),
        nationality_country_code: nullable(form.nationality_country_code),
        ...(nik === undefined ? {} : { nik }),
        ...(familyCard === undefined ? {} : { family_card_number: familyCard }),
        passport_number: domestic ? null : nullable(form.passport_number),
        gender: nullable(form.gender),
        birth_date: nullable(form.birth_date),
        birth_place: nullable(form.birth_place),
        religion: nullable(form.religion),
        education: nullable(form.education),
        marital_status: nullable(form.marital_status),
        anniversary_date:
            form.marital_status === MARRIED
                ? nullable(form.anniversary_date)
                : null,
        occupation_id: form.occupation?.id ?? null,
        phone: nullable(form.phone),
        email: nullable(form.email),
        identity_address: domestic ? addressBody(form.identity) : null,
        domicile_address:
            form.has_domicile || !domestic ? addressBody(form.domicile) : null,
        is_active: form.is_active,
        document_number: nullable(form.document_number),
        old_number: nullable(form.old_number),
        blood_type: nullable(form.blood_type),
        family_status: nullable(form.family_status),
        institution: nullable(form.institution),
        father_name: nullable(form.father_name),
        mother_name: nullable(form.mother_name),
        ...(motherNik === undefined ? {} : { mother_nik: motherNik }),
        payment_methods: [form.payment, ...form.otherPayments].flatMap(
            (payment) =>
                payment.patient_type
                    ? [
                          {
                              patient_type_id: payment.patient_type.id,
                              guarantor_id:
                                  payment.patient_type.behaviors.includes(
                                      'requires_guarantor',
                                  )
                                      ? (payment.guarantor?.id ?? null)
                                      : null,
                              card_number:
                                  payment.patient_type.behaviors.includes(
                                      'requires_card_number',
                                  )
                                      ? nullable(payment.card_number)
                                      : null,
                              class: nullable(payment.class),
                              is_primary: payment === form.payment,
                          },
                      ]
                    : [],
        ),
    };
}

// Kesalahan satu bagian alamat dari server (`identity_address.province_id`) untuk isian wilayah bersama.
function addressErrors(errors: Errors, prefix: string): Errors {
    return Object.fromEntries(
        Object.entries(errors).flatMap(([field, messages]) =>
            field.startsWith(`${prefix}.`)
                ? [[field.slice(prefix.length + 1), messages]]
                : [],
        ),
    );
}

function PatientTypeLookup({
    value,
    onChange,
    portalContainer,
    error,
}: {
    value: Payment['patient_type'];
    onChange: (type: PatientType) => void;
    portalContainer: RefObject<HTMLElement | null>;
    error?: string;
}): ReactNode {
    const loader = useCallback<LookupLoader<PatientType>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcarePatientTypeList(
                {
                    query: {
                        q: query,
                        active: '1',
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    return (
        <FormControl error={error}>
            <InlineLookup
                label="Tipe pasien"
                required
                loadItems={loader}
                value={
                    value
                        ? {
                              ...value,
                              code: '',
                              is_active: true,
                              is_default: false,
                              version: 0,
                          }
                        : null
                }
                onValueChange={onChange}
                getItemValue={(item) => item.id}
                getItemLabel={(item) => item.name}
                placeholder="Cari tipe pasien…"
                emptyMessage="Tipe pasien tidak ditemukan. Tambahkan di Tipe pasien."
                columns={[
                    { id: 'code', header: 'Kode', cell: (item) => item.code },
                    { id: 'name', header: 'Nama', cell: (item) => item.name },
                ]}
                portalContainer={portalContainer}
                showDetails={false}
            />
        </FormControl>
    );
}

function GuarantorLookup({
    patientTypeId,
    value,
    onChange,
    portalContainer,
    error,
}: {
    patientTypeId: string;
    value: Payment['guarantor'];
    onChange: (guarantor: Guarantor) => void;
    portalContainer: RefObject<HTMLElement | null>;
    error?: string;
}): ReactNode {
    // Penjamin disaring per tipe pasien, seperti pilihan Perusahaan form lama.
    const loader = useCallback<LookupLoader<Guarantor>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcareGuarantorList(
                {
                    query: {
                        q: query,
                        active: '1',
                        patient_type_id: patientTypeId,
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [patientTypeId],
    );
    return (
        <FormControl error={error}>
            <InlineLookup
                key={patientTypeId}
                label="Perusahaan"
                required
                loadItems={loader}
                value={
                    value
                        ? {
                              id: value.id,
                              name: value.name,
                              party_id: '',
                              patient_type_id: patientTypeId,
                              patient_type_name: '',
                              is_active: true,
                              is_default: false,
                              version: 0,
                          }
                        : null
                }
                onValueChange={onChange}
                getItemValue={(item) => item.id}
                getItemLabel={(item) => item.name}
                placeholder="Cari penjamin…"
                emptyMessage="Belum ada penjamin untuk tipe pasien ini. Tambahkan di Penjamin."
                columns={[
                    {
                        id: 'name',
                        header: 'Penjamin',
                        cell: (item) => item.name,
                    },
                ]}
                portalContainer={portalContainer}
                showDetails={false}
            />
        </FormControl>
    );
}

function OccupationLookup({
    value,
    editing,
    onChange,
    portalContainer,
    error,
}: {
    value: Form['occupation'];
    editing: boolean;
    onChange: (occupation: Occupation) => void;
    portalContainer: RefObject<HTMLElement | null>;
    error?: string;
}): ReactNode {
    const loader = useCallback<LookupLoader<Occupation>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcarePatientOccupations(
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
                    label="Pekerjaan"
                    loadItems={loader}
                    value={value}
                    onValueChange={onChange}
                    getItemValue={(item) => item.id}
                    getItemLabel={(item) => item.name}
                    placeholder="Cari pekerjaan…"
                    emptyMessage="Pekerjaan tidak ditemukan."
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
                <Input label="Pekerjaan" value={value?.name ?? ''} readOnly />
            )}
        </FormControl>
    );
}

/**
 * Kartu satu pasien: identitas, data tambahan, alamat, dan cara bayar. Tanpa `patientId`, kartu adalah pendaftaran
 * pasien baru; semua bagian diisi lalu disimpan sekali. NIK yang sudah tercatat di buku alamat dicari lebih dulu,
 * dan bila ada, penyimpanan hanya menambah peran pasien untuk orang itu.
 */
export function PatientCard({
    patientId,
    metadata,
    portalContainer,
    onCreated,
    onUpdated,
    onDeleted,
    onCancelNew,
    onBusyChange,
    onDirtyChange,
}: {
    patientId: string | null;
    metadata: PatientMetadata;
    portalContainer: RefObject<HTMLElement | null>;
    onCreated: (patient: Patient) => void;
    onUpdated: () => void;
    onDeleted: () => void;
    onCancelNew: () => void;
    onBusyChange: (busy: boolean) => void;
    onDirtyChange: (dirty: boolean) => void;
}): ReactNode {
    const creating = patientId === null;
    const stored = useQuery({
        queryKey: ['healthcare-patient', patientId],
        queryFn: async () => {
            if (patientId === null) throw new Error('Pasien belum tersimpan.');
            return (
                await api.healthcarePatientShow({ params: { id: patientId } })
            ).body.data;
        },
        enabled: !creating,
    });
    const patient = stored.data ?? null;
    if (!creating && !patient)
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
                        ? errorText(stored.error, 'Pasien belum dapat dimuat.')
                        : 'Memuat pasien…'}
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
        <PatientCardBody
            key={patient ? `${patient.id}:${patient.version}` : 'new'}
            patient={patient}
            metadata={metadata}
            portalContainer={portalContainer}
            onCreated={onCreated}
            onUpdated={() => {
                void stored.refetch();
                onUpdated();
            }}
            onDeleted={onDeleted}
            onCancelNew={onCancelNew}
            onBusyChange={onBusyChange}
            onDirtyChange={onDirtyChange}
        />
    );
}

function PatientCardBody({
    patient,
    metadata,
    portalContainer,
    onCreated,
    onUpdated,
    onDeleted,
    onCancelNew,
    onBusyChange,
    onDirtyChange,
}: {
    patient: Patient | null;
    metadata: PatientMetadata;
    portalContainer: RefObject<HTMLElement | null>;
    onCreated: (patient: Patient) => void;
    onUpdated: () => void;
    onDeleted: () => void;
    onCancelNew: () => void;
    onBusyChange: (busy: boolean) => void;
    onDirtyChange: (dirty: boolean) => void;
}): ReactNode {
    const permissions = metadata.permissions;
    const [editing, setEditing] = useState(patient === null);
    const fallback = metadata.default_payment_method;
    const [form, setForm] = useState(() => formOf(patient, fallback));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const domestic = form.nationality_country_code === INDONESIA;
    const dirty =
        editing &&
        JSON.stringify(form) !== JSON.stringify(formOf(patient, fallback));
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

    const set = <K extends keyof Form>(field: K, value: Form[K]) =>
        setForm((current) => ({ ...current, [field]: value }));
    const error = (field: string) => errors[field]?.[0];
    const references = (category: string) =>
        metadata.reference_values[category] ?? [];
    const referenceName = (category: string, code: string) =>
        references(category).find((value) => value.code === code)?.name ?? code;
    const countryName = (code: string) =>
        metadata.countries.find((country) => country.code === code)?.name ??
        code;

    const cancel = () => {
        if (patient === null) {
            onCancelNew();
            return;
        }
        setForm(formOf(patient, fallback));
        setErrors({});
        setMessage(null);
        setEditing(false);
    };

    const save = async () => {
        if (usesGuarantor || usesCard) {
            const missing: Errors = {};
            if (usesGuarantor && !form.payment.guarantor)
                missing['payment_methods.0.guarantor_id'] = [
                    'Pilih perusahaan penjamin.',
                ];
            if (usesCard && form.payment.card_number.trim() === '')
                missing['payment_methods.0.card_number'] = [
                    'Isi nomor asuransi.',
                ];
            if (Object.keys(missing).length) {
                setErrors(missing);
                return;
            }
        }
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            if (patient === null) {
                const { body } = await api.healthcarePatientCreate({
                    body: patientBody(form),
                });
                toast.success(
                    body.party_reused
                        ? `Peran pasien ditambahkan dengan NRM ${body.data.nrm}.`
                        : `Pasien didaftarkan dengan NRM ${body.data.nrm}.`,
                );
                onCreated(body.data);
            } else {
                await api.healthcarePatientUpdate({
                    params: { id: patient.id },
                    body: { ...patientBody(form), version: patient.version },
                });
                toast.success('Data pasien diperbarui.');
                setEditing(false);
                onUpdated();
            }
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422) {
                setErrors(caught.errors);
                if (!Object.keys(caught.errors).length)
                    setMessage(caught.message);
            } else
                setMessage(
                    errorText(
                        caught,
                        patient
                            ? 'Perubahan belum disimpan.'
                            : 'Pasien belum didaftarkan.',
                    ),
                );
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!patient) return;
        const confirmed = await confirm({
            title: `Delete pasien ${patient.nrm}?`,
            description:
                'Pasien disembunyikan dari daftar. Data orangnya tetap ada di buku alamat, dan NRM ini tidak dipakai pasien lain.',
            confirmLabel: 'Delete',
            destructive: true,
        });
        if (!confirmed) return;
        setBusy(true);
        setMessage(null);
        try {
            await api.healthcarePatientDelete({
                params: { id: patient.id },
                body: { version: patient.version },
            });
            toast.success('Pasien dihapus.');
            onDeleted();
        } catch (caught) {
            setMessage(errorText(caught, 'Pasien belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    usePageDialogRecord({
        recordTitle: patient
            ? `${patient.nrm} · ${patient.name}`
            : form.name || 'Pasien baru',
        editing,
        recordUrl: patient
            ? `/healthcare/patient/patients?patient=${patient.id}`
            : undefined,
    });

    // Kelompok aksi kartu pasien di toolbar. Aksi yang endpoint-nya belum ada tidak ditampilkan; tempatnya:
    // - Pelayanan: Registrasi kunjungan dan Riwayat pemeriksaan;
    // - Dokumen: Cetak general consent dan Tambah dokumen;
    // - Administrasi: Merge NRM.
    // Kelompok tanpa aksi tidak dirender.
    const groups: {
        id: string;
        label: string;
        actions: {
            id: string;
            label: string;
            onSelect: () => void;
        }[];
    }[] = [
        { id: 'service', label: 'Pelayanan', actions: [] },
        { id: 'documents', label: 'Dokumen', actions: [] },
        { id: 'administration', label: 'Administrasi', actions: [] },
    ];

    const select = (
        field:
            | 'gender'
            | 'religion'
            | 'education'
            | 'marital_status'
            | 'blood_type'
            | 'family_status',
        label: string,
        options: { required?: boolean } = {},
    ) => (
        <FormControl key={field} error={error(field)} data-error-field={field}>
            {editing ? (
                <Select
                    label={label}
                    required={options.required}
                    items={[
                        ...(options.required
                            ? []
                            : [{ value: UNSET, label: 'Belum diisi' }]),
                        ...references(field).map((value) => ({
                            value: value.code,
                            label: value.name,
                        })),
                    ]}
                    value={form[field] || (options.required ? null : UNSET)}
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
                    value={form[field] ? referenceName(field, form[field]) : ''}
                    readOnly
                />
            )}
        </FormControl>
    );
    const input = (
        field:
            | 'name'
            | 'passport_number'
            | 'birth_place'
            | 'phone'
            | 'email'
            | 'document_number'
            | 'old_number'
            | 'institution'
            | 'father_name'
            | 'mother_name',
        label: string,
        options: {
            required?: boolean;
            maxLength?: number;
            inputMode?: 'numeric' | 'tel' | 'email';
        } = {},
    ) => (
        <FormControl key={field} error={error(field)}>
            <Input
                label={label}
                required={options.required}
                maxLength={options.maxLength}
                inputMode={options.inputMode}
                data-error-field={field}
                value={form[field]}
                readOnly={!editing}
                onChange={(event) => set(field, event.target.value)}
            />
        </FormControl>
    );
    const numberInput = (
        field: 'nik' | 'family_card_number' | 'mother_nik',
        label: string,
        required = false,
    ) => {
        const value = form[field];
        return (
            <FormControl
                key={field}
                error={error(field)}
                hint={
                    value.masked !== null && editing
                        ? `Nomor tersimpan ${value.masked} tidak ditampilkan utuh. Kosongkan untuk mempertahankannya, atau ketik nomor lengkap untuk menggantinya.`
                        : undefined
                }
            >
                <Input
                    label={label}
                    required={required && value.masked === null}
                    inputMode="numeric"
                    maxLength={16}
                    data-error-field={field}
                    value={
                        !editing && value.masked !== null
                            ? value.masked
                            : value.value
                    }
                    placeholder={value.masked ?? undefined}
                    readOnly={!editing}
                    onChange={(event) =>
                        set(field, { ...value, value: event.target.value })
                    }
                />
            </FormControl>
        );
    };
    const date = (field: 'birth_date' | 'anniversary_date', label: string) => (
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
    const addressSection = (
        prefix: 'identity_address' | 'domicile_address',
        field: 'identity' | 'domicile',
    ) => {
        const address = form[field];
        const update = (next: Partial<Address>) =>
            set(field, { ...address, ...next });
        const sectionErrors = addressErrors(errors, prefix);
        return (
            <FormGrid columns={1}>
                {editing ? (
                    <AddressRegionFields
                        value={address}
                        onChange={(value) => update(value)}
                        errors={sectionErrors}
                        portalContainer={portalContainer}
                        required={domestic}
                        showPostalCode={false}
                    />
                ) : (
                    <>
                        {(
                            [
                                ['province', 'Provinsi'],
                                ['city', 'Kabupaten/kota'],
                                ['district', 'Kecamatan'],
                                ['village', 'Kelurahan/desa'],
                                ['group_of_houses', 'Dusun/banjar'],
                            ] as const
                        ).map(([key, label]) => (
                            <FormControl key={key}>
                                <Input
                                    label={label}
                                    value={address[key]}
                                    readOnly
                                />
                            </FormControl>
                        ))}
                    </>
                )}
                <FormControl error={sectionErrors.street?.[0] ?? error(prefix)}>
                    <Textarea
                        label="Alamat"
                        required
                        data-error-field={`${prefix}.street`}
                        placeholder="Jalan, gang, nomor rumah, gedung, kompleks, atau kampung"
                        maxLength={250}
                        value={address.street}
                        readOnly={!editing}
                        onChange={(event) =>
                            update({ street: event.target.value })
                        }
                    />
                </FormControl>
                <FormControl error={sectionErrors.rt?.[0]}>
                    <Input
                        label="RT"
                        inputMode="numeric"
                        maxLength={3}
                        value={address.rt}
                        readOnly={!editing}
                        onChange={(event) => update({ rt: event.target.value })}
                    />
                </FormControl>
                <FormControl error={sectionErrors.rw?.[0]}>
                    <Input
                        label="RW"
                        inputMode="numeric"
                        maxLength={3}
                        value={address.rw}
                        readOnly={!editing}
                        onChange={(event) => update({ rw: event.target.value })}
                    />
                </FormControl>
            </FormGrid>
        );
    };

    const updatePayment = (next: Partial<Payment>) =>
        set('payment', { ...form.payment, ...next });
    // Isian cara bayar mengikuti perilaku tipe pasien, bukan nama atau id tipenya.
    const behaviors = form.payment.patient_type?.behaviors ?? [];
    const usesGuarantor = behaviors.includes('requires_guarantor');
    const usesCard = behaviors.includes('requires_card_number');

    return (
        <RecordEditBoundary
            editing={editing}
            canEdit={permissions.update}
            disabled={busy}
            onEdit={() => setEditing(true)}
            className="flex min-h-0 flex-1 flex-col"
        >
            <form
                noValidate
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                }}
            >
                {editing ? (
                    <PageDialogToolbar>
                        <ActionButton
                            action="save"
                            type="submit"
                            disabled={
                                busy ||
                                (patient === null &&
                                    metadata.registering_unit === null)
                            }
                            pending={busy}
                        />
                        <ActionButton
                            action="cancel"
                            type="button"
                            disabled={busy}
                            onClick={cancel}
                        />
                    </PageDialogToolbar>
                ) : (
                    <RecordActionBar
                        groups={groups.filter((group) => group.actions.length)}
                    >
                        {permissions.update && (
                            <ActionButton
                                action="edit"
                                disabled={busy}
                                onClick={() => setEditing(true)}
                            />
                        )}
                        {permissions.delete && (
                            <ActionButton
                                action="archive"
                                disabled={busy}
                                onClick={() => void remove()}
                            />
                        )}
                    </RecordActionBar>
                )}
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation={
                        patient
                            ? 'Perubahan belum disimpan'
                            : 'Pasien belum didaftarkan'
                    }
                />
                <PageDialogBody className="space-y-3 py-3">
                    {patient === null && metadata.registering_unit === null && (
                        <Alert variant="destructive">
                            <AlertDescription>
                                Pilih unit kerja di tempat kerja yang termasuk
                                akses Anda sebelum mendaftarkan pasien.
                            </AlertDescription>
                        </Alert>
                    )}
                    {/* Tiga kelompok form pasien sistem lama, diisi dari atas ke bawah per kelompok. Di layar lebar
                        ketiganya berdampingan; di layar sempit menumpuk dengan urutan yang sama. */}
                    <div className="grid gap-x-6 gap-y-4 xl:grid-cols-3">
                        <section aria-label="Identitas pasien">
                            <FormGrid columns={1}>
                                <FormControl
                                    hint={
                                        patient
                                            ? `Dari pengaturan nomor ${patient.nrm_unit_name ?? patient.legal_entity_name}. Pasien didaftarkan di ${patient.org_unit_name}.`
                                            : 'Diisi otomatis saat disimpan, dari pengaturan nomor perusahaan, atau unit pemilik kelompok sharing pasien bila unit Anda ditempatkan di kelompok.'
                                    }
                                >
                                    <Input
                                        label="NRM"
                                        value={patient?.nrm ?? ''}
                                        placeholder={
                                            patient ? undefined : 'Otomatis'
                                        }
                                        readOnly
                                        editActivation={false}
                                    />
                                </FormControl>
                                <FormControl
                                    error={error('nationality_country_code')}
                                >
                                    {editing ? (
                                        <Select
                                            label="Warga negara"
                                            portalContainer={portalContainer}
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
                                                setForm((current) => ({
                                                    ...current,
                                                    nationality_country_code:
                                                        value ?? '',
                                                    // Warga negara asing memakai alamat domisili, seperti form
                                                    // lama.
                                                    has_domicile:
                                                        value !== INDONESIA ||
                                                        current.has_domicile,
                                                }))
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
                                {input('name', 'Nama', {
                                    required: true,
                                    maxLength: 200,
                                })}
                                {domestic
                                    ? numberInput('nik', 'NIK', true)
                                    : input('passport_number', 'No. paspor', {
                                          required: true,
                                          maxLength: 20,
                                      })}
                                {numberInput('family_card_number', 'No. KK')}
                                {editing ? (
                                    <PatientTypeLookup
                                        value={form.payment.patient_type}
                                        portalContainer={portalContainer}
                                        error={
                                            error(
                                                'payment_methods.0.patient_type_id',
                                            ) ?? error('payment_methods')
                                        }
                                        onChange={(type) =>
                                            updatePayment({
                                                patient_type: {
                                                    id: type.id,
                                                    name: type.name,
                                                    behaviors: type.behaviors,
                                                },
                                                guarantor: null,
                                            })
                                        }
                                    />
                                ) : (
                                    <FormControl>
                                        <Input
                                            label="Tipe pasien"
                                            required
                                            value={
                                                form.payment.patient_type
                                                    ?.name ?? ''
                                            }
                                            readOnly
                                        />
                                    </FormControl>
                                )}
                                {usesGuarantor &&
                                    form.payment.patient_type &&
                                    (editing ? (
                                        <GuarantorLookup
                                            patientTypeId={
                                                form.payment.patient_type.id
                                            }
                                            value={form.payment.guarantor}
                                            portalContainer={portalContainer}
                                            error={error(
                                                'payment_methods.0.guarantor_id',
                                            )}
                                            onChange={(guarantor) =>
                                                updatePayment({
                                                    guarantor: {
                                                        id: guarantor.id,
                                                        name: guarantor.name,
                                                    },
                                                })
                                            }
                                        />
                                    ) : (
                                        <FormControl>
                                            <Input
                                                label="Perusahaan"
                                                required
                                                value={
                                                    form.payment.guarantor
                                                        ?.name ?? ''
                                                }
                                                readOnly
                                            />
                                        </FormControl>
                                    ))}
                                {usesCard && (
                                    <FormControl
                                        error={error(
                                            'payment_methods.0.card_number',
                                        )}
                                    >
                                        <Input
                                            label="No. asuransi"
                                            required
                                            maxLength={50}
                                            inputMode="numeric"
                                            data-error-field="payment_methods.0.card_number"
                                            value={form.payment.card_number}
                                            readOnly={!editing}
                                            onChange={(event) =>
                                                updatePayment({
                                                    card_number:
                                                        event.target.value,
                                                })
                                            }
                                        />
                                    </FormControl>
                                )}
                                {select('family_status', 'Status di KK')}
                                {form.family_status === CHILD &&
                                    numberInput('mother_nik', 'NIK ibu')}
                                {select('gender', 'Jenis kelamin', {
                                    required: true,
                                })}
                                {date('birth_date', 'Tanggal lahir')}
                                <FormControl>
                                    <Input
                                        label="Umur"
                                        value={ageOf(form.birth_date)}
                                        readOnly
                                        editActivation={false}
                                    />
                                </FormControl>
                                {input('birth_place', 'Tempat lahir', {
                                    maxLength: 120,
                                })}
                                <RecordEditControl label="Aktif">
                                    <Field
                                        orientation="horizontal"
                                        className="w-auto"
                                    >
                                        <Switch
                                            id="patient-active"
                                            checked={form.is_active}
                                            disabled={
                                                !editing && !permissions.update
                                            }
                                            onCheckedChange={(checked) =>
                                                set('is_active', checked)
                                            }
                                        />
                                        <FieldLabel htmlFor="patient-active">
                                            Aktif
                                        </FieldLabel>
                                    </Field>
                                </RecordEditControl>
                            </FormGrid>
                        </section>
                        <section aria-label="Data tambahan pasien">
                            <FormGrid columns={1}>
                                {input('document_number', 'No. dokumen RM', {
                                    maxLength: 50,
                                })}
                                {input('old_number', 'No. RM lama', {
                                    maxLength: 50,
                                })}
                                {select('blood_type', 'Golongan darah')}
                                {input('email', 'Email', {
                                    maxLength: 250,
                                    inputMode: 'email',
                                })}
                                {input('phone', 'No. HP', {
                                    required: true,
                                    maxLength: 30,
                                    inputMode: 'tel',
                                })}
                                <OccupationLookup
                                    value={form.occupation}
                                    editing={editing}
                                    error={error('occupation_id')}
                                    portalContainer={portalContainer}
                                    onChange={(occupation) =>
                                        set('occupation', occupation)
                                    }
                                />
                                {input('institution', 'Instansi', {
                                    maxLength: 50,
                                })}
                                {select('religion', 'Agama')}
                                {select('education', 'Pendidikan')}
                                {select('marital_status', 'Status perkawinan')}
                                {form.marital_status === MARRIED &&
                                    date('anniversary_date', 'Tanggal menikah')}
                                {input('father_name', 'Nama ayah/KK/suami', {
                                    maxLength: 50,
                                })}
                                {input('mother_name', 'Nama ibu', {
                                    maxLength: 50,
                                })}
                            </FormGrid>
                        </section>
                        <section
                            aria-labelledby="patient-address-title"
                            className="space-y-4"
                        >
                            {domestic && (
                                <>
                                    <h3
                                        id="patient-address-title"
                                        className="text-sm font-semibold"
                                    >
                                        Alamat pada KTP
                                    </h3>
                                    {addressSection(
                                        'identity_address',
                                        'identity',
                                    )}
                                </>
                            )}
                            {domestic ? (
                                <RecordEditControl label="Alamat domisili berbeda">
                                    <Field
                                        orientation="horizontal"
                                        className="w-auto pb-3"
                                    >
                                        <Switch
                                            id="patient-domicile"
                                            checked={form.has_domicile}
                                            disabled={
                                                !editing && !permissions.update
                                            }
                                            onCheckedChange={(checked) =>
                                                set('has_domicile', checked)
                                            }
                                        />
                                        <FieldLabel htmlFor="patient-domicile">
                                            Alamat domisili berbeda dengan KTP
                                        </FieldLabel>
                                    </Field>
                                </RecordEditControl>
                            ) : (
                                <h3
                                    id="patient-address-title"
                                    className="text-sm font-semibold"
                                >
                                    Alamat domisili
                                </h3>
                            )}
                            {(form.has_domicile || !domestic) &&
                                addressSection('domicile_address', 'domicile')}
                        </section>
                    </div>
                </PageDialogBody>
            </form>
            {confirmation}
        </RecordEditBoundary>
    );
}
