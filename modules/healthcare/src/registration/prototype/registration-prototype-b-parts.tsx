import { Badge } from '@operations-metta/ui/badge';
import { Checkbox } from '@operations-metta/ui/checkbox';
import { displayDate } from '@operations-metta/ui/date-picker';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
} from '@operations-metta/ui/input-group';
import { Input } from '@operations-metta/ui/input';
import { Label } from '@operations-metta/ui/label';
import { RadioGroup, RadioGroupItem } from '@operations-metta/ui/radio-group';
import { Select } from '@operations-metta/ui/select';
import { cn } from '@operations-metta/ui/utils';
import { Search, X } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
    age,
    conditions,
    findPatients,
    guarantors,
    patientTypes,
    triageBands,
    type MockPatient,
} from './registration-prototype.mock.ts';
import {
    triageLevel,
    type RegistrationState,
} from './registration-prototype-parts.tsx';

// Kelas warna ditulis di .tsx karena Tailwind tidak memindai berkas .ts.
const dotTone: Record<string, string> = {
    Merah: 'bg-red-500',
    Oranye: 'bg-orange-500',
    Kuning: 'bg-yellow-400',
    Hijau: 'bg-green-600',
};

function Dot({ tone }: { tone: string }): ReactNode {
    return (
        <span
            aria-hidden="true"
            className={cn(
                'inline-block size-2 shrink-0 rounded-full',
                dotTone[tone],
            )}
        />
    );
}

// Satu baris gaya aplikasi lama: label, titik dua, nilai. Garis tipis di bawah setiap baris.
function Row({
    label,
    htmlFor,
    error,
    children,
    align = 'center',
}: {
    label: string;
    htmlFor?: string;
    error?: string | undefined;
    children: ReactNode;
    align?: 'center' | 'start';
}): ReactNode {
    return (
        <div
            className={cn(
                'grid min-h-9 grid-cols-[7.5rem_0.5rem_minmax(0,1fr)] gap-x-2 border-b border-border/70 py-1 text-sm sm:grid-cols-[9rem_0.5rem_minmax(0,1fr)]',
                align === 'center' ? 'items-center' : 'items-start',
            )}
        >
            {htmlFor ? (
                <Label
                    htmlFor={htmlFor}
                    className={cn(
                        'font-normal text-muted-foreground',
                        align === 'start' && 'pt-1.5',
                    )}
                >
                    {label}
                </Label>
            ) : (
                <span
                    className={cn(
                        'text-muted-foreground',
                        align === 'start' && 'pt-1.5',
                    )}
                >
                    {label}
                </span>
            )}
            <span
                aria-hidden="true"
                className={cn(
                    'text-muted-foreground',
                    align === 'start' && 'pt-1.5',
                )}
            >
                :
            </span>
            <div className="min-w-0">
                {children}
                {error && (
                    <p className="pt-1 text-xs text-destructive">{error}</p>
                )}
            </div>
        </div>
    );
}

function patientRows(patient: MockPatient | null): [string, string | null][] {
    const p = patient;
    return [
        ['NRM lama', p?.old_nrm ?? null],
        ['No. dokumen RM', p?.document_number ?? null],
        ['Golongan darah', p?.blood_type ?? null],
        ['Nama pasien', p?.name ?? null],
        ['E-mail', p?.email ?? null],
        ['No. identitas', p?.nik ?? null],
        ['No. KK', p?.family_card ?? null],
        [
            'Tempat / tanggal lahir',
            p ? `${p.birth_place}, ${displayDate(p.birth_date)}` : null,
        ],
        ['Umur', p ? age(p.birth_date) : null],
        ['Status perkawinan', p?.marital_status ?? null],
        ['Agama', p?.religion ?? null],
        ['Pendidikan', p?.education ?? null],
        ['Pekerjaan', p?.occupation ?? null],
        ['No. HP', p?.phone ?? null],
        ['Jenis kelamin', p?.gender ?? null],
        ['Status di kartu keluarga', p?.family_role ?? null],
        ['Warganegara', p?.citizenship ?? null],
        ['Alamat', p?.street ?? null],
        ['Provinsi', p?.province ?? null],
        ['Kabupaten/Kota', p?.regency ?? null],
        ['Kecamatan', p?.district ?? null],
        ['Kelurahan/Desa', p?.village ?? null],
    ];
}

export function PatientPanel({
    state,
}: {
    state: RegistrationState;
}): ReactNode {
    const { draft, set, errors } = state;
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<MockPatient[] | null>(null);
    const shownQuery =
        draft.patient && results === null ? draft.patient.nrm : query;
    const pick = (patient: MockPatient) => {
        set('patient', patient);
        setQuery(patient.nrm);
        setResults(null);
    };
    const search = () => {
        const found = findPatients(shownQuery);
        if (found.length === 1 && found[0]) pick(found[0]);
        else setResults(found);
    };
    const clear = () => {
        set('patient', null);
        setQuery('');
        setResults(null);
    };
    return (
        <div>
            <Row label="NRM" htmlFor="patient-search" error={errors.patient}>
                <InputGroup className="h-8">
                    <InputGroupInput
                        id="patient-search"
                        value={shownQuery}
                        placeholder="Cari pasien"
                        aria-invalid={errors.patient ? true : undefined}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            if (draft.patient) set('patient', null);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                search();
                            }
                        }}
                    />
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton
                            size="icon-xs"
                            aria-label="Cari pasien"
                            onClick={search}
                        >
                            <Search />
                        </InputGroupButton>
                        <InputGroupButton
                            size="icon-xs"
                            aria-label="Kosongkan pasien"
                            disabled={!shownQuery && !draft.patient}
                            onClick={clear}
                        >
                            <X />
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
            </Row>
            {results !== null && (
                <div className="border-b border-border/70 py-1.5">
                    {results.length === 0 ? (
                        <p className="px-1 text-sm text-muted-foreground">
                            Pasien tidak ditemukan. Pilih Buat pasien baru bila
                            pasien belum pernah datang.
                        </p>
                    ) : (
                        <ul
                            aria-label="Hasil pencarian pasien"
                            className="divide-y divide-border/70 rounded-md border"
                        >
                            {results.map((item) => (
                                <li key={item.id}>
                                    <button
                                        type="button"
                                        onClick={() => pick(item)}
                                        className="grid w-full grid-cols-[6rem_minmax(0,1fr)] gap-x-2 px-2 py-1.5 text-left text-sm hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none sm:grid-cols-[6rem_minmax(0,1fr)_6.5rem]"
                                    >
                                        <span className="tabular-nums">
                                            {item.nrm}
                                        </span>
                                        <span className="truncate font-medium">
                                            {item.name}
                                        </span>
                                        <span className="hidden text-muted-foreground tabular-nums sm:block">
                                            {displayDate(item.birth_date)}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            <div>
                {patientRows(draft.patient).map(([label, value]) => (
                    <Row key={label} label={label}>
                        <span
                            className={cn(
                                'block break-words',
                                label === 'Nama pasien' &&
                                    value !== null &&
                                    'font-semibold',
                                value === null && 'text-muted-foreground',
                            )}
                        >
                            {value ?? '—'}
                        </span>
                    </Row>
                ))}
            </div>
        </div>
    );
}

function MeasureInput({
    id,
    unit,
    value,
    error,
    onChange,
}: {
    id: string;
    unit: string;
    value: string;
    error?: string | undefined;
    onChange: (value: string) => void;
}): ReactNode {
    return (
        <InputGroup className="h-8 max-w-40">
            <InputGroupInput
                id={id}
                inputMode="decimal"
                value={value}
                aria-invalid={error ? true : undefined}
                onChange={(event) => onChange(event.target.value)}
            />
            <InputGroupAddon
                align="inline-end"
                className="w-11 justify-center border-l border-border pr-0 pl-0"
            >
                {unit}
            </InputGroupAddon>
        </InputGroup>
    );
}

export function VisitPanel({ state }: { state: RegistrationState }): ReactNode {
    const { draft, set, errors, needsGuarantor } = state;
    return (
        <div className="grid gap-x-6 md:grid-cols-2">
            <div>
                <Row label="Tipe pasien *">
                    <Select
                        ariaLabel="Tipe pasien"
                        className="h-8"
                        items={patientTypes.map((type) => ({
                            value: type.id,
                            label: type.name,
                        }))}
                        value={draft.patientType}
                        onValueChange={(value) =>
                            set('patientType', value ?? 'UMUM')
                        }
                    />
                </Row>
                {needsGuarantor && (
                    <>
                        <Row label="Penjamin *" error={errors.guarantor}>
                            <Select
                                ariaLabel="Penjamin"
                                className="h-8"
                                items={guarantors}
                                value={draft.guarantor}
                                onValueChange={(value) =>
                                    set('guarantor', value ?? '')
                                }
                            />
                        </Row>
                        <Row
                            label="No. kartu *"
                            htmlFor="guarantor-card"
                            error={errors.card}
                        >
                            <Input
                                id="guarantor-card"
                                className="h-8"
                                value={draft.card}
                                aria-invalid={errors.card ? true : undefined}
                                onChange={(event) =>
                                    set('card', event.target.value)
                                }
                            />
                        </Row>
                    </>
                )}
            </div>
            <div>
                <Row
                    label="Tinggi badan *"
                    htmlFor="height"
                    error={errors.height}
                >
                    <MeasureInput
                        id="height"
                        unit="cm"
                        value={draft.height}
                        error={errors.height}
                        onChange={(value) => set('height', value)}
                    />
                </Row>
                <Row
                    label="Berat badan *"
                    htmlFor="weight"
                    error={errors.weight}
                >
                    <MeasureInput
                        id="weight"
                        unit="kg"
                        value={draft.weight}
                        error={errors.weight}
                        onChange={(value) => set('weight', value)}
                    />
                </Row>
                <Row label="Status *" align="start">
                    <RadioGroup
                        aria-label="Status kunjungan"
                        className="gap-1.5 py-1"
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
                            <div
                                key={value}
                                className="flex items-center gap-2"
                            >
                                <RadioGroupItem
                                    id={`visit-${value}`}
                                    value={value}
                                />
                                <Label
                                    htmlFor={`visit-${value}`}
                                    className="font-normal"
                                >
                                    {label}
                                </Label>
                            </div>
                        ))}
                    </RadioGroup>
                </Row>
                <Row label="Keadaan pasien" align="start">
                    <div
                        role="group"
                        aria-label="Keadaan atau kelainan pasien"
                        className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-x-3 gap-y-1.5 py-1"
                    >
                        {conditions.map((condition) => (
                            <div
                                key={condition}
                                className="flex items-center gap-2"
                            >
                                <Checkbox
                                    id={`condition-${condition}`}
                                    checked={draft.conditions.includes(
                                        condition,
                                    )}
                                    onCheckedChange={(checked) =>
                                        set(
                                            'conditions',
                                            checked === true
                                                ? [
                                                      ...draft.conditions,
                                                      condition,
                                                  ]
                                                : draft.conditions.filter(
                                                      (item) =>
                                                          item !== condition,
                                                  ),
                                        )
                                    }
                                />
                                <Label
                                    htmlFor={`condition-${condition}`}
                                    className="font-normal"
                                >
                                    {condition}
                                </Label>
                            </div>
                        ))}
                    </div>
                </Row>
            </div>
        </div>
    );
}

export function TriageResult({
    state,
}: {
    state: RegistrationState;
}): ReactNode {
    const level = triageLevel(state.draft.triage);
    if (!level)
        return (
            <span className="text-xs text-muted-foreground">
                Belum ada tanda dipilih
            </span>
        );
    return (
        <Badge variant="outline" className="gap-1.5 text-sm" aria-live="polite">
            <Dot tone={level.name} />
            Kategori: {level.name}
        </Badge>
    );
}

export function TriagePanel({
    state,
}: {
    state: RegistrationState;
}): ReactNode {
    const { draft, set, errors } = state;
    const toggle = (item: string, checked: boolean) =>
        set(
            'triage',
            checked
                ? [...draft.triage, item]
                : draft.triage.filter((value) => value !== item),
        );
    return (
        <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
                Centang tanda yang terlihat saat pasien datang. Kategori
                mengikuti tanda paling berat.
            </p>
            <div
                className={cn(
                    'divide-y divide-border/70 overflow-hidden rounded-md border',
                    errors.triage && 'border-destructive',
                )}
            >
                {triageBands.map((band) => {
                    const picked = band.items.filter((item) =>
                        draft.triage.includes(item),
                    ).length;
                    return (
                        <fieldset key={band.id}>
                            <legend className="flex w-full items-center gap-2 bg-muted/50 px-3 py-1.5 text-xs font-medium">
                                <Dot tone={band.name} />
                                {band.name}
                                {picked > 0 && (
                                    <span className="ml-auto font-normal text-muted-foreground">
                                        {picked} dipilih
                                    </span>
                                )}
                            </legend>
                            <div className="grid sm:grid-cols-2">
                                {band.items.map((item) => (
                                    <Label
                                        key={item}
                                        htmlFor={`triage-${item}`}
                                        className="flex min-h-9 cursor-pointer items-center gap-2 border-t border-border/50 px-3 py-1.5 font-normal hover:bg-muted/40"
                                    >
                                        <Checkbox
                                            id={`triage-${item}`}
                                            checked={draft.triage.includes(
                                                item,
                                            )}
                                            onCheckedChange={(checked) =>
                                                toggle(item, checked === true)
                                            }
                                        />
                                        {item}
                                    </Label>
                                ))}
                            </div>
                        </fieldset>
                    );
                })}
            </div>
            {errors.triage && (
                <p className="text-sm text-destructive">{errors.triage}</p>
            )}
        </div>
    );
}
