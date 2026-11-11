import { Alert, AlertDescription } from '@operations-metta/ui/alert';
import { Button } from '@operations-metta/ui/button';
import { Checkbox } from '@operations-metta/ui/checkbox';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import { Label } from '@operations-metta/ui/label';
import { RadioGroup, RadioGroupItem } from '@operations-metta/ui/radio-group';
import { Select } from '@operations-metta/ui/select';
import { cn } from '@operations-metta/ui/utils';
import { CheckCircle2, Printer, UserPlus } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import {
    age,
    conditions,
    findPatients,
    guarantors,
    installations,
    patientTypes,
    patients,
    schedules,
    sections,
    triageBands,
    type Installation,
    type MockPatient,
    type VisitKind,
} from './registration-prototype.mock.ts';

export type Draft = {
    patient: MockPatient | null;
    patientType: string;
    guarantor: string;
    card: string;
    height: string;
    weight: string;
    visitKind: VisitKind | null;
    conditions: string[];
    ckg: boolean;
    triage: string[];
    installation: Installation;
    sectionId: string | null;
    scheduleId: string | null;
};

export type Saved = {
    queue: string;
    number: string;
    section: string;
    practitioner: string;
};
type Errors = Partial<Record<keyof Draft, string>>;

const emptyDraft: Draft = {
    patient: null,
    patientType: 'UMUM',
    guarantor: '',
    card: '',
    height: '',
    weight: '',
    visitKind: 'sick',
    conditions: [],
    ckg: false,
    triage: [],
    installation: 'outpatient',
    sectionId: null,
    scheduleId: null,
};

let nextNumber = 61842;

// `?demo=filled` mengisi draft contoh supaya tangkapan layar tidak perlu diketik ulang.
const demoDraft: Draft = {
    ...emptyDraft,
    patient: patients[1] ?? null,
    patientType: 'BPJS',
    guarantor: 'BPJS Kesehatan',
    card: '0001234500001',
    height: '158',
    weight: '62',
    conditions: ['Lansia'],
    triage: ['Lemas'],
    sectionId: 'umum',
    scheduleId: 's1',
};

export function useRegistrationDraft() {
    const [draft, setDraft] = useState<Draft>(() =>
        new URLSearchParams(window.location.search).get('demo') === 'filled'
            ? demoDraft
            : emptyDraft,
    );
    const [errors, setErrors] = useState<Errors>({});
    const [saved, setSaved] = useState<Saved | null>(null);
    const [used, setUsed] = useState<Record<string, number>>({});
    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
        setDraft((current) => ({ ...current, [key]: value }));
        setErrors((current) => ({ ...current, [key]: undefined }));
    };
    const needsGuarantor =
        patientTypes.find((type) => type.id === draft.patientType)
            ?.needsGuarantor ?? false;
    const scheduleUsed = (id: string) =>
        (schedules.find((item) => item.id === id)?.used ?? 0) + (used[id] ?? 0);

    const save = (): boolean => {
        const next: Errors = {};
        if (!draft.patient)
            next.patient = 'Pilih pasien atau buat pasien baru.';
        if (needsGuarantor && !draft.guarantor)
            next.guarantor = 'Pilih penjamin.';
        if (needsGuarantor && !draft.card.trim())
            next.card = 'Isi nomor kartu penjamin.';
        if (!draft.height.trim()) next.height = 'Isi tinggi badan.';
        if (!draft.weight.trim()) next.weight = 'Isi berat badan.';
        if (draft.triage.length === 0)
            next.triage = 'Pilih minimal satu tanda pada skrining visual.';
        if (!draft.sectionId)
            next.sectionId = 'Pilih poli atau ruangan tujuan.';
        const sectionSchedules = schedules.filter(
            (item) => item.section_id === draft.sectionId,
        );
        if (sectionSchedules.length > 0 && !draft.scheduleId)
            next.scheduleId = 'Pilih dokter yang praktik hari ini.';
        setErrors(next);
        if (Object.keys(next).length > 0) return false;
        const section = sections.find((item) => item.id === draft.sectionId);
        const schedule = schedules.find((item) => item.id === draft.scheduleId);
        const queueNumber = schedule ? scheduleUsed(schedule.id) + 1 : 1;
        if (schedule)
            setUsed((current) => ({
                ...current,
                [schedule.id]: (current[schedule.id] ?? 0) + 1,
            }));
        nextNumber += 1;
        setSaved({
            queue: `${(section?.name ?? 'U').replace('Poli ', '').slice(0, 1)}-${String(queueNumber).padStart(3, '0')}`,
            number: `261111REG-${String(nextNumber).padStart(6, '0')}`,
            section: section?.name ?? '',
            practitioner: schedule?.practitioner ?? 'Tanpa jadwal dokter',
        });
        return true;
    };
    const reset = () => {
        setDraft(emptyDraft);
        setErrors({});
        setSaved(null);
    };
    return {
        draft,
        set,
        errors,
        saved,
        save,
        reset,
        needsGuarantor,
        scheduleUsed,
    };
}

export type RegistrationState = ReturnType<typeof useRegistrationDraft>;

export function PatientPicker({
    state,
    portalContainer,
}: {
    state: RegistrationState;
    portalContainer?: RefObject<HTMLElement | null>;
}): ReactNode {
    const loader = useCallback<LookupLoader<MockPatient>>(
        ({ query }) =>
            Promise.resolve({
                items: findPatients(query || '0'),
                nextCursor: null,
            }),
        [],
    );
    return (
        <div className="flex flex-col items-start gap-2">
            <Button type="button" variant="ghost" size="sm">
                <UserPlus aria-hidden="true" />
                Buat pasien baru
            </Button>
            <FormControl className="w-full" error={state.errors.patient}>
                <InlineLookup
                    label="Cari pasien"
                    required
                    loadItems={loader}
                    value={state.draft.patient}
                    onValueChange={(patient) => state.set('patient', patient)}
                    getItemValue={(item) => item.id}
                    getItemLabel={(item) => `${item.nrm} · ${item.name}`}
                    placeholder="Ketik NRM, nama, atau NIK"
                    emptyMessage="Pasien tidak ditemukan. Pilih Buat pasien baru."
                    portalContainer={portalContainer}
                    showDetails={false}
                    columns={[
                        { id: 'nrm', header: 'NRM', cell: (item) => item.nrm },
                        {
                            id: 'name',
                            header: 'Nama',
                            cell: (item) => item.name,
                        },
                        { id: 'nik', header: 'NIK', cell: (item) => item.nik },
                        {
                            id: 'birth',
                            header: 'Tgl. lahir',
                            cell: (item) => displayDate(item.birth_date),
                        },
                    ]}
                />
            </FormControl>
        </div>
    );
}

export function patientFacts(patient: MockPatient): [string, string][] {
    return [
        ['NRM', patient.nrm],
        ['NRM lama', patient.old_nrm ?? '—'],
        ['No. dokumen RM', patient.document_number ?? '—'],
        ['Golongan darah', patient.blood_type ?? '—'],
        ['Nama', patient.name],
        ['E-mail', patient.email ?? '—'],
        ['No. identitas (NIK)', patient.nik],
        ['No. KK', patient.family_card ?? '—'],
        [
            'Tempat, tgl. lahir',
            `${patient.birth_place}, ${displayDate(patient.birth_date)}`,
        ],
        ['Umur', age(patient.birth_date)],
        ['Status perkawinan', patient.marital_status],
        ['Agama', patient.religion],
        ['Pendidikan', patient.education],
        ['Pekerjaan', patient.occupation],
        ['No. HP', patient.phone],
        ['Jenis kelamin', patient.gender],
        ['Status di KK', patient.family_role],
        ['Kewarganegaraan', patient.citizenship],
        ['Alamat', patient.street],
        ['Provinsi', patient.province],
        ['Kab./Kota', patient.regency],
        ['Kecamatan', patient.district],
        ['Kel./Desa', patient.village],
    ];
}

export function PatientFacts({
    patient,
    compact = false,
}: {
    patient: MockPatient | null;
    compact?: boolean;
}): ReactNode {
    if (!patient)
        return (
            <p className="px-1 py-6 text-sm text-muted-foreground">
                Belum ada pasien dipilih. Cari dengan NRM, nama, atau NIK, atau
                pilih Buat pasien baru.
            </p>
        );
    const facts = patientFacts(patient);
    const shown = compact
        ? facts.filter(([label]) =>
              [
                  'NRM',
                  'Nama',
                  'No. identitas (NIK)',
                  'Tempat, tgl. lahir',
                  'Umur',
                  'Jenis kelamin',
                  'No. HP',
                  'Alamat',
              ].includes(label),
          )
        : facts;
    return (
        <dl
            className={cn(
                'grid gap-x-4 gap-y-1.5 text-sm',
                compact
                    ? 'sm:grid-cols-2'
                    : 'grid-cols-[minmax(8rem,auto)_1fr] 2xl:grid-cols-[auto_1fr_auto_1fr]',
            )}
        >
            {shown.map(([label, value]) =>
                compact ? (
                    <div key={label} className="min-w-0">
                        <dt className="text-xs text-muted-foreground">
                            {label}
                        </dt>
                        <dd
                            className={cn(
                                'break-words',
                                label === 'Nama' && 'font-semibold',
                            )}
                        >
                            {value}
                        </dd>
                    </div>
                ) : (
                    <div key={label} className="contents">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd
                            className={cn(
                                'min-w-0 break-words',
                                label === 'Nama' && 'font-semibold',
                            )}
                        >
                            {value}
                        </dd>
                    </div>
                ),
            )}
        </dl>
    );
}

const triageDot: Record<string, string> = {
    Merah: 'bg-red-500',
    Oranye: 'bg-orange-500',
    Kuning: 'bg-yellow-400',
    Hijau: 'bg-green-600',
};

function Dot({ color }: { color: string }): ReactNode {
    return (
        <span
            aria-hidden="true"
            className={cn(
                'inline-block size-2.5 shrink-0 rounded-full',
                triageDot[color],
            )}
        />
    );
}

export function PatientHistory({
    patient,
}: {
    patient: MockPatient | null;
}): ReactNode {
    const history = patient?.history ?? [];
    const diseases = patient?.diseases ?? [];
    const risks = patient?.pregnancy_risks ?? [];
    const last = history[0];
    return (
        <CollapsibleSectionGroup
            defaultValue={history.length ? ['history'] : []}
        >
            <CollapsibleSection
                value="history"
                title="Riwayat pemeriksaan terakhir"
                summary={
                    last
                        ? `${displayDate(last.date)} · ${last.section}`
                        : 'Belum ada'
                }
            >
                <DataTable
                    data={history}
                    getRowKey={(row) => `${row.date}-${row.section}`}
                    emptyMessage="Belum ada pemeriksaan sebelumnya."
                    columns={[
                        {
                            id: 'date',
                            header: 'Tanggal',
                            width: 100,
                            cell: (row) => displayDate(row.date),
                        },
                        {
                            id: 'inst',
                            header: 'Instalasi',
                            width: 120,
                            cell: (row) => row.installation,
                        },
                        {
                            id: 'section',
                            header: 'Poli/Ruangan',
                            width: 130,
                            cell: (row) => row.section,
                        },
                        {
                            id: 'triage',
                            header: 'Skrining',
                            width: 90,
                            cell: (row) => (
                                <DataTableText>
                                    <span className="inline-flex items-center gap-1.5">
                                        <Dot color={row.triage} />
                                        {row.triage}
                                    </span>
                                </DataTableText>
                            ),
                        },
                    ]}
                />
            </CollapsibleSection>
            <CollapsibleSection
                value="triage"
                title="Riwayat skrining"
                summary={
                    history.length
                        ? history.map((row) => row.triage).join(', ')
                        : 'Belum ada'
                }
            >
                <ul className="space-y-1 px-3 py-2 text-sm">
                    {history.length === 0 && (
                        <li className="text-muted-foreground">
                            Belum ada skrining sebelumnya.
                        </li>
                    )}
                    {history.map((row) => (
                        <li key={row.date} className="flex items-center gap-2">
                            <Dot color={row.triage} />
                            {displayDate(row.date)} · {row.triage} ·{' '}
                            {row.section}
                        </li>
                    ))}
                </ul>
            </CollapsibleSection>
            <CollapsibleSection
                value="diseases"
                title="Riwayat penyakit khusus"
                summary={
                    diseases.length
                        ? diseases.map((row) => row.icd).join(', ')
                        : 'Tidak ada'
                }
            >
                <DataTable
                    data={diseases}
                    getRowKey={(row) => row.icd}
                    emptyMessage="Tidak ada penyakit khusus tercatat."
                    columns={[
                        {
                            id: 'color',
                            header: 'Warna',
                            width: 80,
                            cell: (row) => (
                                <DataTableText>
                                    <span className="inline-flex items-center gap-1.5">
                                        <Dot color={row.color} />
                                        {row.color}
                                    </span>
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'icd',
                            header: 'ICD-X',
                            width: 80,
                            cell: (row) => row.icd,
                        },
                        {
                            id: 'name',
                            header: 'Penyakit',
                            width: 220,
                            cell: (row) => row.name,
                        },
                    ]}
                />
            </CollapsibleSection>
            <CollapsibleSection
                value="pregnancy"
                title="Riwayat risiko kehamilan"
                summary={risks.length ? risks.join(', ') : 'Tidak ada'}
            >
                <p className="px-3 py-2 text-sm">
                    {risks.length
                        ? risks.join(', ')
                        : 'Tidak ada risiko kehamilan tercatat.'}
                </p>
            </CollapsibleSection>
        </CollapsibleSectionGroup>
    );
}

export function VisitFields({
    state,
    portalContainer,
    columns = 2,
}: {
    state: RegistrationState;
    portalContainer?: RefObject<HTMLElement | null>;
    columns?: 1 | 2;
}): ReactNode {
    const { draft, set, errors, needsGuarantor } = state;
    return (
        <div className="space-y-4">
            <FormGrid columns={columns}>
                <FormControl>
                    <Select
                        label="Tipe pasien *"
                        items={patientTypes.map((type) => ({
                            value: type.id,
                            label: type.name,
                        }))}
                        value={draft.patientType}
                        onValueChange={(value) =>
                            set('patientType', value ?? 'UMUM')
                        }
                        portalContainer={portalContainer}
                    />
                </FormControl>
                {needsGuarantor ? (
                    <FormControl error={errors.guarantor}>
                        <Select
                            label="Penjamin *"
                            items={guarantors}
                            value={draft.guarantor}
                            onValueChange={(value) =>
                                set('guarantor', value ?? '')
                            }
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                ) : (
                    <div className="hidden sm:block" />
                )}
                {needsGuarantor && (
                    <FormControl error={errors.card}>
                        <Input
                            label="No. kartu penjamin *"
                            value={draft.card}
                            onChange={(event) =>
                                set('card', event.target.value)
                            }
                        />
                    </FormControl>
                )}
                <FormControl error={errors.height}>
                    <Input
                        label="Tinggi badan (cm) *"
                        inputMode="decimal"
                        value={draft.height}
                        onChange={(event) => set('height', event.target.value)}
                    />
                </FormControl>
                <FormControl error={errors.weight}>
                    <Input
                        label="Berat badan (kg) *"
                        inputMode="decimal"
                        value={draft.weight}
                        onChange={(event) => set('weight', event.target.value)}
                    />
                </FormControl>
            </FormGrid>
            <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                    Status kunjungan *
                </legend>
                <RadioGroup
                    className="flex gap-6"
                    value={draft.visitKind ?? ''}
                    onValueChange={(value) =>
                        set(
                            'visitKind',
                            value === 'healthy' ? 'healthy' : 'sick',
                        )
                    }
                >
                    {(
                        [
                            ['sick', 'Kunjungan sakit'],
                            ['healthy', 'Kunjungan sehat'],
                        ] as const
                    ).map(([value, label]) => (
                        <div key={value} className="flex items-center gap-2">
                            <RadioGroupItem
                                id={`visit-${value}`}
                                value={value}
                            />
                            <Label htmlFor={`visit-${value}`}>{label}</Label>
                        </div>
                    ))}
                </RadioGroup>
            </fieldset>
            <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                    Keadaan khusus pasien
                </legend>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {conditions.map((condition) => (
                        <div
                            key={condition}
                            className="flex items-center gap-2"
                        >
                            <Checkbox
                                id={`condition-${condition}`}
                                checked={draft.conditions.includes(condition)}
                                onCheckedChange={(checked) =>
                                    set(
                                        'conditions',
                                        checked === true
                                            ? [...draft.conditions, condition]
                                            : draft.conditions.filter(
                                                  (item) => item !== condition,
                                              ),
                                    )
                                }
                            />
                            <Label htmlFor={`condition-${condition}`}>
                                {condition}
                            </Label>
                        </div>
                    ))}
                </div>
            </fieldset>
            <div className="flex items-center gap-2">
                <Checkbox
                    id="ckg"
                    checked={draft.ckg}
                    onCheckedChange={(checked) => set('ckg', checked === true)}
                />
                <Label htmlFor="ckg">
                    Tandai sebagai pasien Cek Kesehatan Gratis (CKG)
                </Label>
            </div>
        </div>
    );
}

// Kelas warna ditulis di .tsx karena Tailwind tidak memindai berkas .ts.
const bandTone: Record<string, string> = {
    red: 'border-red-500 bg-red-50 dark:bg-red-950/40',
    orange: 'border-orange-500 bg-orange-50 dark:bg-orange-950/40',
    yellow: 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/40',
    green: 'border-green-600 bg-green-50 dark:bg-green-950/40',
};

export function triageLevel(
    selected: string[],
): (typeof triageBands)[number] | null {
    return (
        triageBands.find((band) =>
            band.items.some((item) => selected.includes(item)),
        ) ?? null
    );
}

export function TriageFields({
    state,
    columns = 2,
}: {
    state: RegistrationState;
    columns?: 1 | 2;
}): ReactNode {
    const { draft, set, errors } = state;
    const level = triageLevel(draft.triage);
    return (
        <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
                Centang tanda yang terlihat saat pasien datang. Kategori
                mengikuti tanda paling berat.
                {level && (
                    <span className="ml-2 inline-flex items-center gap-1.5 font-medium text-foreground">
                        <Dot color={level.name} /> Kategori {level.name}
                    </span>
                )}
            </p>
            <div
                className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2')}
            >
                {triageBands.map((band) => (
                    <fieldset
                        key={band.id}
                        className={cn(
                            'rounded-md border-l-4 px-3 py-2',
                            bandTone[band.id],
                        )}
                    >
                        <legend className="sr-only">{band.name}</legend>
                        <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                            <Dot color={band.name} /> {band.name}
                        </p>
                        <div className="space-y-1.5">
                            {band.items.map((item) => (
                                <div
                                    key={item}
                                    className="flex items-center gap-2"
                                >
                                    <Checkbox
                                        id={`triage-${item}`}
                                        checked={draft.triage.includes(item)}
                                        onCheckedChange={(checked) =>
                                            set(
                                                'triage',
                                                checked === true
                                                    ? [...draft.triage, item]
                                                    : draft.triage.filter(
                                                          (value) =>
                                                              value !== item,
                                                      ),
                                            )
                                        }
                                    />
                                    <Label
                                        htmlFor={`triage-${item}`}
                                        className="font-normal"
                                    >
                                        {item}
                                    </Label>
                                </div>
                            ))}
                        </div>
                    </fieldset>
                ))}
            </div>
            {errors.triage && (
                <p className="text-sm text-destructive">{errors.triage}</p>
            )}
        </div>
    );
}

function Pill({
    pressed,
    disabled,
    onClick,
    children,
}: {
    pressed: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
}): ReactNode {
    return (
        <Button
            type="button"
            size="sm"
            variant={pressed ? 'default' : 'outline'}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className="h-auto min-h-8 justify-start py-1.5 text-left whitespace-normal"
        >
            {children}
        </Button>
    );
}

export function DestinationFields({
    state,
}: {
    state: RegistrationState;
}): ReactNode {
    const { draft, set, errors, scheduleUsed } = state;
    const available = sections.filter(
        (section) => section.installation === draft.installation,
    );
    const section = sections.find((item) => item.id === draft.sectionId);
    const doctors = schedules.filter(
        (item) => item.section_id === draft.sectionId,
    );
    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <p className="text-sm font-medium">Instalasi *</p>
                <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label="Instalasi"
                >
                    {installations.map((item) => (
                        <Pill
                            key={item.id}
                            pressed={draft.installation === item.id}
                            onClick={() => {
                                set('installation', item.id);
                                set('sectionId', null);
                                set('scheduleId', null);
                            }}
                        >
                            {item.name}
                        </Pill>
                    ))}
                </div>
            </div>
            <div className="space-y-2">
                <p className="text-sm font-medium">Poli / ruangan *</p>
                <div
                    className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                    role="group"
                    aria-label="Poli atau ruangan"
                >
                    {available.map((item) => (
                        <Pill
                            key={item.id}
                            pressed={draft.sectionId === item.id}
                            onClick={() => {
                                set('sectionId', item.id);
                                const only = schedules.filter(
                                    (schedule) =>
                                        schedule.section_id === item.id,
                                );
                                set(
                                    'scheduleId',
                                    only.length === 1 && only[0]
                                        ? only[0].id
                                        : null,
                                );
                            }}
                        >
                            {item.name}
                        </Pill>
                    ))}
                </div>
                {errors.sectionId && (
                    <p className="text-sm text-destructive">
                        {errors.sectionId}
                    </p>
                )}
            </div>
            {section && (
                <div className="space-y-2">
                    <p className="text-sm font-medium">Dokter hari ini *</p>
                    {doctors.length === 0 ? (
                        <Alert>
                            <AlertDescription>
                                Tidak ada jadwal dokter di {section.name} hari
                                ini. Pasien tetap bisa didaftarkan tanpa dokter.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <div
                            className="grid gap-2 sm:grid-cols-2"
                            role="group"
                            aria-label="Dokter"
                        >
                            {doctors.map((doctor) => {
                                const taken = scheduleUsed(doctor.id);
                                const full = taken >= doctor.quota;
                                return (
                                    <Pill
                                        key={doctor.id}
                                        pressed={draft.scheduleId === doctor.id}
                                        disabled={full}
                                        onClick={() =>
                                            set('scheduleId', doctor.id)
                                        }
                                    >
                                        <span className="flex w-full flex-col">
                                            <span className="font-medium">
                                                {doctor.practitioner}
                                            </span>
                                            <span className="text-xs opacity-80">
                                                {doctor.hours} ·{' '}
                                                {full
                                                    ? 'Kuota penuh'
                                                    : `${String(taken)}/${String(doctor.quota)} pasien`}
                                            </span>
                                        </span>
                                    </Pill>
                                );
                            })}
                        </div>
                    )}
                    {errors.scheduleId && (
                        <p className="text-sm text-destructive">
                            {errors.scheduleId}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

export function SavedNotice({
    saved,
    patient,
    onNext,
    onList,
}: {
    saved: Saved;
    patient: MockPatient | null;
    onNext: () => void;
    onList: () => void;
}): ReactNode {
    return (
        <div className="rounded-md border border-green-600/40 bg-green-50 p-4 dark:bg-green-950/30">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <CheckCircle2
                    aria-hidden="true"
                    className="size-8 text-green-600"
                />
                <div>
                    <p className="text-xs text-muted-foreground">
                        Nomor antrian
                    </p>
                    <p className="text-3xl leading-none font-semibold tabular-nums">
                        {saved.queue}
                    </p>
                </div>
                <div className="min-w-0 text-sm">
                    <p className="font-medium">Registrasi tersimpan</p>
                    <p className="tabular-nums">{saved.number}</p>
                    <p className="text-muted-foreground">
                        {patient?.name} · {saved.section} · {saved.practitioner}
                    </p>
                </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline">
                    <Printer aria-hidden="true" /> Cetak nomor antrian
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onNext}
                >
                    Registrasi pasien berikutnya
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onList}
                >
                    Kembali ke daftar
                </Button>
            </div>
        </div>
    );
}

export function VariantSwitcher({
    current,
}: {
    current: 'list' | 'a' | 'b';
}): ReactNode {
    const links = [
        [
            'list',
            'Daftar registrasi',
            '/healthcare/registration/prototype-list',
        ],
        ['a', 'A · Kartu', '/healthcare/registration/prototype-a'],
        ['b', 'B · Halaman penuh', '/healthcare/registration/prototype-b'],
    ] as const;
    return (
        <nav
            aria-label="Pilihan prototype"
            className="flex flex-wrap items-center gap-2 border-b border-dashed border-amber-500 bg-amber-50 px-3 py-1.5 text-xs dark:bg-amber-950/30"
        >
            <span className="font-medium">Prototype, data contoh:</span>
            {links.map(([id, label, href]) => (
                <a
                    key={id}
                    href={href}
                    aria-current={id === current ? 'page' : undefined}
                    className={cn(
                        'rounded px-2 py-0.5 underline-offset-2 hover:underline',
                        id === current &&
                            'bg-amber-200 font-semibold dark:bg-amber-800',
                    )}
                >
                    {label}
                </a>
            ))}
        </nav>
    );
}
