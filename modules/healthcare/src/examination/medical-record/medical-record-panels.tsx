import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { Checkbox } from '@operations-metta/ui/checkbox';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { FieldLegend, FieldSet } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import { Label } from '@operations-metta/ui/label';
import { RadioGroup, RadioGroupItem } from '@operations-metta/ui/radio-group';
import { Select } from '@operations-metta/ui/select';
import { Slider } from '@operations-metta/ui/slider';
import { Textarea } from '@operations-metta/ui/textarea';
import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ApiBody } from '@core/platform/shell/index.ts';
import { DrugAllergyLines } from './order-panels.tsx';

// Panel tab Rekam Medis poli sistem lama (rekammedis/index.php), dalam urutan dan susunan kolom aslinya: Anamnesa,
// Riwayat penyakit dan alergi, Status fisik, Periksa fisik, Asesmen nyeri, Risiko jatuh, Pemeriksaan dasar gigi, Keadaan
// fisik, Anatomi tubuh, dan Lainnya. Panel tampil bila isi rekam medis memuatnya, yaitu bila section tujuan memakainya.

export type MedicalRecordMetadata = ApiBody<'healthcareMedicalRecordMetadata'>;
export type MedicalRecordShown = ApiBody<'healthcareMedicalRecordShow'>;
type RecordData = MedicalRecordShown['data'];
type Context = MedicalRecordShown['context'];
type Option = { code: string; name: string; color: string | null };
type Practitioner = MedicalRecordMetadata['practitioners'][number];

// Isian angka disimpan apa adanya selama diketik; server yang memeriksanya.
type Loose<T> = T extends number
    ? number | string
    : T extends (infer U)[]
      ? Loose<U>[]
      : T extends object
        ? { [K in keyof T]: Loose<T[K]> }
        : T;
export type MedicalRecordDraft = Loose<RecordData>;
type Panel = Exclude<
    keyof MedicalRecordDraft,
    | 'id'
    | 'version'
    | 'findings'
    | 'anatomy'
    | 'diagnoses'
    | 'prognosis_id'
    | 'chronic_disease_ids'
    | 'drug_allergies'
    | 'procedures'
    | 'prescriptions'
>;

function numberOf(value: number | string | null): number | null {
    if (value === null || value === '') return null;
    const number =
        typeof value === 'number' ? value : Number(value.replace(',', '.'));
    return Number.isFinite(number) ? number : null;
}

const textOf = (value: number | string | null) =>
    value === null ? '' : String(value);
const valueOf = (value: string) => (value === '' ? null : value);

// IMT dan hasilnya seperti sistem lama: BB / (TB/100)², dua desimal; ≤18,5 Kurus, ≤25 Normal, ≤30 Gemuk, selain itu
// Obesitas.
function bodyMassIndex(height: number | null, weight: number | null) {
    if (!height || !weight) return null;
    const value = Math.round((weight / (height / 100) ** 2) * 100) / 100;
    const result =
        value <= 18.5
            ? 'Kurus'
            : value <= 25
              ? 'Normal'
              : value <= 30
                ? 'Gemuk'
                : 'Obesitas';
    return { value, result };
}

// MAP sistem lama: 1/3 sistole + 2/3 diastole, dua desimal.
function meanArterialPressure(
    systolic: number | null,
    diastolic: number | null,
) {
    if (systolic === null || diastolic === null) return null;
    return (systolic / 3 + (diastolic * 2) / 3).toFixed(2);
}

// Skala nyeri sistem lama.
function painLabel(scale: number): string {
    if (scale === 0) return 'Tidak Ada Nyeri';
    if (scale <= 2) return 'Nyeri Ringan';
    if (scale <= 5) return 'Nyeri Sedang';
    if (scale <= 8) return 'Nyeri Tinggi';
    return 'Nyeri Sangat Hebat';
}

// Hasil Get Up and Go sistem lama: jumlah jawaban Ya.
export const fallRiskResults = [
    { label: 'Tidak Beresiko', className: 'bg-emerald-600 text-white' },
    { label: 'Resiko Rendah', className: 'bg-amber-500 text-white' },
    { label: 'Resiko Tinggi', className: 'bg-red-600 text-white' },
];

// Isian Pemeriksaan dasar gigi dalam urutan PemeriksaanGigiDasar.php: Extraoral lalu Intraoral, dengan kelompok
// pilihannya. Dipakai panel ini dan CPPT.
export const dentalSections = [
    [
        'Pemeriksaan extraoral',
        [
            ['swelling', 'Bengkak', 'gigi_bengkak'],
            ['consistency', 'Konsistensi', 'gigi_konsistensi'],
            ['skin_color', 'Warna kulit', 'gigi_warna_kulit'],
            ['skin_temperature', 'Suhu kulit', 'gigi_suhu_kulit'],
        ],
    ],
    [
        'Pemeriksaan intraoral',
        [
            ['mobility', 'Goyang', 'gigi_goyang'],
            ['gum_color', 'Warna gusi', 'gigi_warna_gusi'],
            ['caries', 'Karies gigi', 'gigi_karies'],
            ['intraoral_swelling', 'Pembengkakan', 'gigi_pembengkakan'],
            ['percussion', 'Perkusi', 'gigi_perkusi'],
            ['pressure', 'Druk', 'gigi_druk'],
            ['palpation', 'Palpasi', 'gigi_palpasi'],
            ['caries_status', 'Status karies', 'gigi_status_karies'],
        ],
    ],
] as const;

function TextField({
    id,
    label,
    value,
    error,
    rows = 2,
    onChange,
}: {
    id: string;
    label: string;
    value: string | null;
    error: string | undefined;
    rows?: number;
    onChange: (value: string | null) => void;
}): ReactNode {
    return (
        <FormControl error={error}>
            <Textarea
                id={id}
                label={label}
                rows={rows}
                value={value ?? ''}
                aria-invalid={error ? true : undefined}
                onChange={(event) => onChange(valueOf(event.target.value))}
            />
        </FormControl>
    );
}

function LineField({
    id,
    label,
    value,
    error,
    required = false,
    readOnly = false,
    numeric = false,
    onChange,
}: {
    id: string;
    label: string;
    value: number | string | null;
    error?: string | undefined;
    required?: boolean;
    readOnly?: boolean;
    numeric?: boolean;
    onChange?: (value: string | null) => void;
}): ReactNode {
    return (
        <FormControl error={error}>
            <Input
                id={id}
                label={label}
                required={required}
                readOnly={readOnly}
                inputMode={numeric ? 'decimal' : undefined}
                value={textOf(value)}
                aria-invalid={error ? true : undefined}
                onChange={(event) => onChange?.(valueOf(event.target.value))}
            />
        </FormControl>
    );
}

function OptionField({
    field,
    label,
    options,
    value,
    error,
    required = false,
    scored = false,
    onChange,
}: {
    field: string;
    label: string;
    options: Option[];
    value: string | null;
    error: string | undefined;
    required?: boolean;
    scored?: boolean;
    onChange: (value: string | null) => void;
}): ReactNode {
    return (
        <FormControl error={error} data-error-field={field}>
            <Select
                label={label}
                required={required}
                items={options.map((option) => ({
                    value: option.code,
                    label: scored
                        ? `[${option.code}] ${option.name}`
                        : option.name,
                }))}
                value={value}
                onValueChange={onChange}
            />
        </FormControl>
    );
}

function ChoiceField({
    field,
    legend,
    options,
    value,
    error,
    onChange,
}: {
    field: string;
    legend: string;
    options: Option[];
    value: string | null;
    error: string | undefined;
    onChange: (value: string) => void;
}): ReactNode {
    return (
        <FormControl error={error} data-error-field={field}>
            <FieldSet className="gap-1.5">
                <FieldLegend variant="label">{legend}</FieldLegend>
                <RadioGroup
                    aria-label={legend}
                    className="flex flex-wrap gap-x-6 gap-y-1.5"
                    value={value ?? ''}
                    onValueChange={onChange}
                >
                    {options.map((option) => (
                        <div
                            key={option.code}
                            className="flex items-center gap-2"
                        >
                            <RadioGroupItem
                                id={`${field}-${option.code}`}
                                value={option.code}
                            />
                            <Label
                                htmlFor={`${field}-${option.code}`}
                                className="font-normal"
                            >
                                {option.color ? (
                                    <span
                                        className="rounded px-2 py-0.5 text-xs font-semibold text-white"
                                        style={{
                                            backgroundColor: option.color,
                                        }}
                                    >
                                        {option.name}
                                    </span>
                                ) : (
                                    option.name
                                )}
                            </Label>
                        </div>
                    ))}
                </RadioGroup>
            </FieldSet>
        </FormControl>
    );
}

const yesNo: Option[] = [
    { code: 'yes', name: 'Ya', color: null },
    { code: 'no', name: 'Tidak', color: null },
];

function YesNoField({
    field,
    legend,
    value,
    error,
    onChange,
}: {
    field: string;
    legend: string;
    value: boolean | null;
    error: string | undefined;
    onChange: (value: boolean) => void;
}): ReactNode {
    return (
        <ChoiceField
            field={field}
            legend={legend}
            options={yesNo}
            value={value === null ? null : value ? 'yes' : 'no'}
            error={error}
            onChange={(choice) => onChange(choice === 'yes')}
        />
    );
}

export function PractitionerField({
    field,
    label,
    practitioners,
    fills,
    value,
    error,
    disabled,
    onChange,
}: {
    field: string;
    label: string;
    practitioners: Practitioner[];
    fills: (practitioner: Practitioner) => boolean;
    value: string | null;
    error: string | undefined;
    disabled: boolean;
    onChange: (value: string) => void;
}): ReactNode {
    const current = practitioners.find((row) => row.id === value) ?? null;
    return (
        <FormControl error={error} data-error-field={field}>
            <InlineLookup
                label={label}
                disabled={disabled}
                items={practitioners.filter(
                    (row) => (row.active && fills(row)) || row.id === value,
                )}
                value={current}
                displayValue={current?.name ?? ''}
                onValueChange={(row) => onChange(row.id)}
                getItemValue={(row) => row.id}
                getItemLabel={(row) => row.name}
                placeholder="Cari nama…"
                emptyMessage="Tenaga kesehatan tidak ditemukan."
                showDetails={false}
                columns={[
                    {
                        id: 'name',
                        header: 'Nama',
                        width: 220,
                        cell: (row) => row.name,
                    },
                    {
                        id: 'profession',
                        header: 'Profesi',
                        width: 120,
                        cell: (row) => row.profession,
                    },
                ]}
            />
        </FormControl>
    );
}

function Subheading({ children }: { children: ReactNode }): ReactNode {
    return <h3 className="text-sm font-semibold">{children}</h3>;
}

export function MedicalRecordPanels({
    draft,
    setDraft,
    metadata,
    context,
    errors,
    disabled,
}: {
    draft: MedicalRecordDraft;
    setDraft: (
        update: (draft: MedicalRecordDraft) => MedicalRecordDraft,
    ) => void;
    metadata: MedicalRecordMetadata;
    context: Context;
    errors: Record<string, string[]>;
    disabled: boolean;
}): ReactNode {
    const error = (field: string) => errors[field]?.join(' ');
    const options = (group: string): Option[] => metadata.options[group] ?? [];
    const required = new Set<string>(metadata.required.map((row) => row.field));
    const patch = <P extends Panel>(
        panel: P,
        values: Partial<NonNullable<MedicalRecordDraft[P]>>,
    ) =>
        setDraft((current) => ({
            ...current,
            [panel]: { ...current[panel], ...values },
        }));
    const {
        anamnesis,
        history,
        allergy,
        status,
        physical,
        pain,
        dental,
        other,
    } = draft;
    const fallRisk = draft.fall_risk;
    const bmi = physical
        ? bodyMassIndex(numberOf(physical.height), numberOf(physical.weight))
        : null;
    const map = physical
        ? meanArterialPressure(
              numberOf(physical.systolic),
              numberOf(physical.diastolic),
          )
        : null;
    const score = (values: (string | null)[]) =>
        values.reduce((total, value) => total + (Number(value) || 0), 0);
    const fallScore =
        !fallRisk ||
        (fallRisk.unsteady_gait === null && fallRisk.uses_support === null)
            ? null
            : Number(fallRisk.unsteady_gait === true) +
              Number(fallRisk.uses_support === true);
    const findings = new Map(
        (draft.findings ?? []).map((row) => [row.aspect_id, row.result]),
    );
    const bodyParts = metadata.findings.filter(
        (part) => part.gender === null || part.gender === context.gender,
    );
    const physicalField = (
        field: keyof NonNullable<MedicalRecordDraft['physical']>,
        label: string,
    ) => (
        <LineField
            id={`physical.${field}`}
            label={label}
            numeric
            required={required.has(field)}
            value={physical?.[field] ?? null}
            error={error(`physical.${field}`)}
            onChange={(value) => patch('physical', { [field]: value })}
        />
    );
    const statusQuestion = (
        field:
            | 'uses_mobility_aid'
            | 'communication_barrier'
            | 'caregiver_at_home'
            | 'needs_assistance',
        note:
            | 'mobility_aid_note'
            | 'communication_barrier_note'
            | 'caregiver_at_home_note'
            | 'needs_assistance_note',
        legend: string,
    ) => {
        return (
            <div className="space-y-2">
                <YesNoField
                    field={`status.${field}`}
                    legend={legend}
                    value={status?.[field] ?? null}
                    error={error(`status.${field}`)}
                    onChange={(value) =>
                        patch('status', {
                            [field]: value,
                            ...(value ? {} : { [note]: null }),
                        })
                    }
                />
                {status?.[field] === true && (
                    <LineField
                        id={`status.${note}`}
                        label="Jelaskan"
                        value={status[note]}
                        error={error(`status.${note}`)}
                        onChange={(value) => patch('status', { [note]: value })}
                    />
                )}
            </div>
        );
    };
    const otherFlag = (
        field: 'smoking' | 'alcohol' | 'low_vegetable_fruit',
        legend: string,
    ) => (
        <YesNoField
            field={`other.${field}`}
            legend={legend}
            value={other?.[field] ?? null}
            error={error(`other.${field}`)}
            onChange={(value) => patch('other', { [field]: value })}
        />
    );
    const otherText = (
        field:
            | 'drug_therapy'
            | 'non_drug_therapy'
            | 'consumables'
            | 'plan'
            | 'education'
            | 'nursing_care_description'
            | 'observation'
            | 'notes'
            | 'biopsychosocial'
            | 'nursing_actions',
        label: string,
    ) => (
        <TextField
            id={`other.${field}`}
            label={label}
            value={other?.[field] ?? null}
            error={error(`other.${field}`)}
            onChange={(value) => patch('other', { [field]: value })}
        />
    );

    return (
        <CollapsibleSectionGroup
            defaultValue={[
                'anamnesis',
                'history',
                'status',
                'physical',
                'pain',
                'fall-risk',
                'dental',
                'findings',
                'anatomy',
                'other',
            ]}
        >
            {anamnesis && (
                <CollapsibleSection
                    value="anamnesis"
                    title="Anamnesa"
                    keepMounted
                >
                    <div className="grid items-start gap-x-6 gap-y-4 md:grid-cols-2">
                        <PractitionerField
                            field="anamnesis.doctor_id"
                            label="Dokter / Tenaga medis"
                            practitioners={metadata.practitioners}
                            fills={(row) => row.fills_medical_staff}
                            value={anamnesis.doctor_id}
                            error={error('anamnesis.doctor_id')}
                            disabled={disabled}
                            onChange={(value) =>
                                patch('anamnesis', { doctor_id: value })
                            }
                        />
                        <PractitionerField
                            field="anamnesis.nurse_id"
                            label="Perawat / Bidan / Nutrisionist / Sanitarian"
                            practitioners={metadata.practitioners}
                            fills={(row) => row.fills_nurse}
                            value={anamnesis.nurse_id}
                            error={error('anamnesis.nurse_id')}
                            disabled={disabled}
                            onChange={(value) =>
                                patch('anamnesis', { nurse_id: value })
                            }
                        />
                        <TextField
                            id="anamnesis.chief_complaint"
                            label="Keluhan utama"
                            value={anamnesis.chief_complaint}
                            error={error('anamnesis.chief_complaint')}
                            onChange={(value) =>
                                patch('anamnesis', { chief_complaint: value })
                            }
                        />
                        <TextField
                            id="anamnesis.additional_complaint"
                            label="Keluhan tambahan / Anamnesa"
                            value={anamnesis.additional_complaint}
                            error={error('anamnesis.additional_complaint')}
                            onChange={(value) =>
                                patch('anamnesis', {
                                    additional_complaint: value,
                                })
                            }
                        />
                        <FieldSet className="gap-1.5">
                            <FieldLegend variant="label">
                                Lama sakit
                            </FieldLegend>
                            <div className="grid grid-cols-3 gap-2">
                                {(
                                    [
                                        ['illness_years', 'Tahun'],
                                        ['illness_months', 'Bulan'],
                                        ['illness_days', 'Hari'],
                                    ] as const
                                ).map(([field, label]) => (
                                    <LineField
                                        key={field}
                                        id={`anamnesis.${field}`}
                                        label={label}
                                        numeric
                                        value={anamnesis[field]}
                                        error={error(`anamnesis.${field}`)}
                                        onChange={(value) =>
                                            patch('anamnesis', {
                                                [field]: value,
                                            })
                                        }
                                    />
                                ))}
                            </div>
                        </FieldSet>
                    </div>
                </CollapsibleSection>
            )}

            {history && allergy && (
                <CollapsibleSection
                    value="history"
                    title="Riwayat penyakit dan alergi"
                    keepMounted
                >
                    <div className="grid items-start gap-x-6 gap-y-4 md:grid-cols-2">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <Subheading>Riwayat penyakit</Subheading>
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="history.none"
                                        checked={history.none}
                                        onCheckedChange={(checked) =>
                                            patch('history', {
                                                none: checked === true,
                                            })
                                        }
                                    />
                                    <Label
                                        htmlFor="history.none"
                                        className="font-normal"
                                    >
                                        Tidak ada
                                    </Label>
                                </div>
                            </div>
                            {!history.none && (
                                <FormGrid columns={1}>
                                    <TextField
                                        id="history.present"
                                        label="Riwayat penyakit pasien"
                                        value={history.present}
                                        error={error('history.present')}
                                        onChange={(value) =>
                                            patch('history', { present: value })
                                        }
                                    />
                                    <TextField
                                        id="history.past"
                                        label="Riwayat penyakit dahulu"
                                        value={history.past}
                                        error={error('history.past')}
                                        onChange={(value) =>
                                            patch('history', { past: value })
                                        }
                                    />
                                    <TextField
                                        id="history.family"
                                        label="Riwayat penyakit keluarga"
                                        value={history.family}
                                        error={error('history.family')}
                                        onChange={(value) =>
                                            patch('history', { family: value })
                                        }
                                    />
                                </FormGrid>
                            )}
                        </div>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                                <Subheading>Alergi pasien</Subheading>
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="allergy.none"
                                        checked={allergy.none}
                                        onCheckedChange={(checked) =>
                                            patch('allergy', {
                                                none: checked === true,
                                            })
                                        }
                                    />
                                    <Label
                                        htmlFor="allergy.none"
                                        className="font-normal"
                                    >
                                        Tidak ada
                                    </Label>
                                </div>
                            </div>
                            {!allergy.none && (
                                <FormGrid columns={1}>
                                    <FormControl
                                        error={error('allergy.food_allergy_id')}
                                        data-error-field="allergy.food_allergy_id"
                                    >
                                        <Select
                                            label="Alergi makanan"
                                            items={metadata.allergies.food.map(
                                                (row) => ({
                                                    value: row.id,
                                                    label: row.name,
                                                }),
                                            )}
                                            value={allergy.food_allergy_id}
                                            onValueChange={(value) =>
                                                patch('allergy', {
                                                    food_allergy_id: value,
                                                })
                                            }
                                        />
                                    </FormControl>
                                    <FormControl
                                        error={error(
                                            'allergy.airborne_allergy_id',
                                        )}
                                        data-error-field="allergy.airborne_allergy_id"
                                    >
                                        <Select
                                            label="Alergi udara"
                                            items={metadata.allergies.airborne.map(
                                                (row) => ({
                                                    value: row.id,
                                                    label: row.name,
                                                }),
                                            )}
                                            value={allergy.airborne_allergy_id}
                                            onValueChange={(value) =>
                                                patch('allergy', {
                                                    airborne_allergy_id: value,
                                                })
                                            }
                                        />
                                    </FormControl>
                                    <LineField
                                        id="allergy.other"
                                        label="Alergi lainnya"
                                        value={allergy.other}
                                        error={error('allergy.other')}
                                        onChange={(value) =>
                                            patch('allergy', { other: value })
                                        }
                                    />
                                </FormGrid>
                            )}
                            <Subheading>Alergi obat pasien</Subheading>
                            <DrugAllergyLines
                                rows={draft.drug_allergies ?? []}
                                setDraft={setDraft}
                                canCreate={metadata.permissions.create_drug}
                                errors={errors}
                                disabled={disabled}
                            />
                        </div>
                    </div>
                </CollapsibleSection>
            )}

            {status && (
                <CollapsibleSection
                    value="status"
                    title="Status fisik / neurologis / mental, biologis, psikososiospiritual dan ekonomi"
                    keepMounted
                >
                    <div className="grid items-start gap-x-6 gap-y-4 md:grid-cols-2">
                        {statusQuestion(
                            'uses_mobility_aid',
                            'mobility_aid_note',
                            'Apakah menggunakan alat bantu saat beraktifitas',
                        )}
                        <LineField
                            id="status.religion"
                            label="Agama/Kepercayaan"
                            readOnly
                            value={context.religion}
                        />
                        {statusQuestion(
                            'communication_barrier',
                            'communication_barrier_note',
                            'Adakah kendala komunikasi',
                        )}
                        {statusQuestion(
                            'caregiver_at_home',
                            'caregiver_at_home_note',
                            'Adakah yang merawat dirumah',
                        )}
                        {statusQuestion(
                            'needs_assistance',
                            'needs_assistance_note',
                            'Apakah membutuhkan bantuan orang lain saat beraktifitas',
                        )}
                        <OptionField
                            field="status.emotional_expression"
                            label="Ekspresi dan emosi"
                            options={options('ekspresi_emosi')}
                            value={status.emotional_expression}
                            error={error('status.emotional_expression')}
                            onChange={(value) =>
                                patch('status', { emotional_expression: value })
                            }
                        />
                        <div className="space-y-2">
                            <ChoiceField
                                field="status.language"
                                legend="Bahasa yang digunakan"
                                options={options('bahasa')}
                                value={status.language}
                                error={error('status.language')}
                                onChange={(value) =>
                                    patch('status', {
                                        language: value,
                                        ...(value === 'Lainnya'
                                            ? {}
                                            : { language_note: null }),
                                    })
                                }
                            />
                            {status.language === 'Lainnya' && (
                                <LineField
                                    id="status.language_note"
                                    label="Jelaskan"
                                    value={status.language_note}
                                    error={error('status.language_note')}
                                    onChange={(value) =>
                                        patch('status', {
                                            language_note: value,
                                        })
                                    }
                                />
                            )}
                        </div>
                        <LineField
                            id="status.occupation"
                            label="Pekerjaan"
                            readOnly
                            value={context.occupation}
                        />
                        <div className="space-y-2">
                            <ChoiceField
                                field="status.lives_with"
                                legend="Tinggal dengan"
                                options={options('tinggal_dengan')}
                                value={status.lives_with}
                                error={error('status.lives_with')}
                                onChange={(value) =>
                                    patch('status', {
                                        lives_with: value,
                                        ...(value === 'Lainnya'
                                            ? {}
                                            : { lives_with_note: null }),
                                    })
                                }
                            />
                            {status.lives_with === 'Lainnya' && (
                                <LineField
                                    id="status.lives_with_note"
                                    label="Jelaskan"
                                    value={status.lives_with_note}
                                    error={error('status.lives_with_note')}
                                    onChange={(value) =>
                                        patch('status', {
                                            lives_with_note: value,
                                        })
                                    }
                                />
                            )}
                        </div>
                        <ChoiceField
                            field="status.social_economy"
                            legend="Sosial ekonomi"
                            options={options('ekonomi')}
                            value={status.social_economy}
                            error={error('status.social_economy')}
                            onChange={(value) =>
                                patch('status', { social_economy: value })
                            }
                        />
                        <LineField
                            id="status.guarantee"
                            label="Jaminan"
                            readOnly
                            value={context.guarantee}
                        />
                        <ChoiceField
                            field="status.past_mental_disorder"
                            legend="Gangguan jiwa dimasa lalu"
                            options={options('gangguan_jiwa')}
                            value={status.past_mental_disorder}
                            error={error('status.past_mental_disorder')}
                            onChange={(value) =>
                                patch('status', { past_mental_disorder: value })
                            }
                        />
                        <LineField
                            id="status.marital_status"
                            label="Status perkawinan"
                            readOnly
                            value={context.marital_status}
                        />
                        <ChoiceField
                            field="status.economic_status"
                            legend="Status ekonomi"
                            options={options('ekonomi')}
                            value={status.economic_status}
                            error={error('status.economic_status')}
                            onChange={(value) =>
                                patch('status', { economic_status: value })
                            }
                        />
                        <OptionField
                            field="status.family_relationship"
                            label="Hubungan dengan keluarga"
                            options={options('hubungan_keluarga')}
                            value={status.family_relationship}
                            error={error('status.family_relationship')}
                            onChange={(value) =>
                                patch('status', { family_relationship: value })
                            }
                        />
                    </div>
                </CollapsibleSection>
            )}

            {physical && (
                <CollapsibleSection
                    value="physical"
                    title="Periksa fisik"
                    keepMounted
                >
                    <div className="grid items-start gap-x-6 gap-y-4 md:grid-cols-2">
                        <FormGrid columns={1}>
                            <OptionField
                                field="physical.consciousness"
                                label="Kesadaran"
                                required={required.has('consciousness')}
                                options={options('kesadaran')}
                                value={physical.consciousness}
                                error={error('physical.consciousness')}
                                onChange={(value) =>
                                    patch('physical', { consciousness: value })
                                }
                            />
                            {physicalField('systolic', 'Sistole (mm/Hg)')}
                            {physicalField('diastolic', 'Diastole (mm/Hg)')}
                            <LineField
                                id="physical-map"
                                label="MAP (mm/Hg)"
                                numeric
                                readOnly
                                value={map}
                            />
                            {physicalField('height', 'Tinggi badan (cm)')}
                            <OptionField
                                field="physical.height_method"
                                label="Cara ukur tinggi badan"
                                options={options('cara_ukur_tinggi')}
                                value={physical.height_method}
                                error={error('physical.height_method')}
                                onChange={(value) =>
                                    patch('physical', { height_method: value })
                                }
                            />
                            {physicalField('weight', 'Berat badan (kg)')}
                            {physicalField(
                                'waist_circumference',
                                'Lingkar perut (cm)',
                            )}
                            <div className="grid grid-cols-2 gap-2">
                                <LineField
                                    id="physical-bmi"
                                    label="IMT"
                                    numeric
                                    readOnly
                                    value={bmi?.value ?? null}
                                />
                                <LineField
                                    id="physical-bmi-result"
                                    label="IMT hasil"
                                    readOnly
                                    value={bmi?.result ?? null}
                                />
                            </div>
                            <Subheading>Glasgow Coma Scale (GCS)</Subheading>
                            {(
                                [
                                    ['eye_opening', 'Membuka mata', 'gcs_mata'],
                                    [
                                        'verbal_response',
                                        'Respon verbal',
                                        'gcs_verbal',
                                    ],
                                    [
                                        'motor_response',
                                        'Respon motorik',
                                        'gcs_motorik',
                                    ],
                                ] as const
                            ).map(([field, label, group]) => (
                                <OptionField
                                    key={field}
                                    field={`physical.${field}`}
                                    label={label}
                                    scored
                                    options={options(group)}
                                    value={physical[field]}
                                    error={error(`physical.${field}`)}
                                    onChange={(value) =>
                                        patch('physical', { [field]: value })
                                    }
                                />
                            ))}
                            <p className="text-sm">
                                Total GCS:{' '}
                                <span className="font-semibold tabular-nums">
                                    {score([
                                        physical.eye_opening,
                                        physical.verbal_response,
                                        physical.motor_response,
                                    ])}
                                </span>
                            </p>
                        </FormGrid>
                        <FormGrid columns={1}>
                            {physicalField(
                                'pulse_rate',
                                'Detak nadi (x / menit)',
                            )}
                            {physicalField(
                                'respiratory_rate',
                                'Nafas (x / menit)',
                            )}
                            {physicalField(
                                'oxygen_saturation',
                                'Saturasi (SpO2) (%)',
                            )}
                            {physicalField('temperature', 'Suhu (°C)')}
                            <Subheading>
                                Aktifitas fisik dan assessment fungsional
                            </Subheading>
                            {(
                                [
                                    ['mobility', 'Mobilisasi'],
                                    ['toileting', 'Toileting'],
                                    ['eating', 'Makan / Minum'],
                                    ['bathing', 'Mandi'],
                                    ['dressing', 'Berpakaian'],
                                ] as const
                            ).map(([field, label]) => (
                                <OptionField
                                    key={field}
                                    field={`physical.${field}`}
                                    label={label}
                                    scored
                                    options={options('aktivitas')}
                                    value={physical[field]}
                                    error={error(`physical.${field}`)}
                                    onChange={(value) =>
                                        patch('physical', { [field]: value })
                                    }
                                />
                            ))}
                            <p className="text-sm">
                                Total:{' '}
                                <span className="font-semibold tabular-nums">
                                    {score([
                                        physical.mobility,
                                        physical.toileting,
                                        physical.eating,
                                        physical.bathing,
                                        physical.dressing,
                                    ])}
                                </span>
                            </p>
                            <ChoiceField
                                field="physical.heart_rhythm"
                                legend="Detak jantung"
                                options={options('detak_jantung')}
                                value={physical.heart_rhythm}
                                error={error('physical.heart_rhythm')}
                                onChange={(value) =>
                                    patch('physical', { heart_rhythm: value })
                                }
                            />
                            <ChoiceField
                                field="physical.triage"
                                legend="Triage"
                                options={options('triage')}
                                value={physical.triage}
                                error={error('physical.triage')}
                                onChange={(value) =>
                                    patch('physical', { triage: value })
                                }
                            />
                        </FormGrid>
                    </div>
                </CollapsibleSection>
            )}

            {pain && (
                <CollapsibleSection
                    value="pain"
                    title="Asesmen nyeri"
                    keepMounted
                >
                    <div className="grid items-start gap-x-6 gap-y-4 md:grid-cols-2">
                        <YesNoField
                            field="pain.has_pain"
                            legend="Apakah pasien merasakan nyeri?"
                            value={pain.has_pain}
                            error={error('pain.has_pain')}
                            onChange={(value) =>
                                patch('pain', {
                                    has_pain: value,
                                    ...(value ? {} : { timing: null }),
                                })
                            }
                        />
                        <LineField
                            id="pain.trigger"
                            label="Pencetus"
                            value={pain.trigger}
                            error={error('pain.trigger')}
                            onChange={(value) =>
                                patch('pain', { trigger: value })
                            }
                        />
                        <OptionField
                            field="pain.quality"
                            label="Kualitas"
                            options={options('kualitas_nyeri')}
                            value={pain.quality}
                            error={error('pain.quality')}
                            onChange={(value) =>
                                patch('pain', { quality: value })
                            }
                        />
                        <LineField
                            id="pain.location"
                            label="Lokasi"
                            value={pain.location}
                            error={error('pain.location')}
                            onChange={(value) =>
                                patch('pain', { location: value })
                            }
                        />
                        <FormControl
                            error={error('pain.scale')}
                            data-error-field="pain.scale"
                        >
                            <FieldSet className="gap-2">
                                <FieldLegend variant="label">
                                    Skala nyeri
                                </FieldLegend>
                                <Slider
                                    aria-label="Skala nyeri"
                                    min={0}
                                    max={10}
                                    step={1}
                                    disabled={disabled}
                                    value={[numberOf(pain.scale) ?? 0]}
                                    onValueChange={([value]) =>
                                        patch('pain', { scale: value ?? 0 })
                                    }
                                />
                                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                                    {Array.from({ length: 11 }, (_, index) => (
                                        <span key={index}>{index}</span>
                                    ))}
                                </div>
                                <p className="text-sm">
                                    {numberOf(pain.scale) === null
                                        ? 'Geser untuk memilih skala.'
                                        : `${numberOf(pain.scale)} · ${painLabel(numberOf(pain.scale) ?? 0)}`}
                                </p>
                            </FieldSet>
                        </FormControl>
                        {pain.has_pain !== false && (
                            <ChoiceField
                                field="pain.timing"
                                legend="Waktu"
                                options={options('waktu_nyeri')}
                                value={pain.timing}
                                error={error('pain.timing')}
                                onChange={(value) =>
                                    patch('pain', { timing: value })
                                }
                            />
                        )}
                    </div>
                </CollapsibleSection>
            )}

            {fallRisk && (
                <CollapsibleSection
                    value="fall-risk"
                    title="Asesmen resiko jatuh (Get Up and Go)"
                    keepMounted
                >
                    <div className="space-y-4">
                        <YesNoField
                            field="fall_risk.unsteady_gait"
                            legend="a. Perhatikan cara berjalan pasien saat akan duduk di kursi. Apakah pasien tampak tidak seimbang (sempoyongan/tumbang)?"
                            value={fallRisk.unsteady_gait}
                            error={error('fall_risk.unsteady_gait')}
                            onChange={(value) =>
                                patch('fall_risk', { unsteady_gait: value })
                            }
                        />
                        <YesNoField
                            field="fall_risk.uses_support"
                            legend="b. Apakah pasien memegang pinggiran kursi atau meja atau benda lain sebagai penopang saat duduk?"
                            value={fallRisk.uses_support}
                            error={error('fall_risk.uses_support')}
                            onChange={(value) =>
                                patch('fall_risk', { uses_support: value })
                            }
                        />
                        {fallScore !== null && (
                            <p className="text-sm">
                                Hasil kegiatan:{' '}
                                <span
                                    className={`rounded px-2 py-0.5 text-xs font-semibold ${fallRiskResults[fallScore]?.className ?? ''}`}
                                >
                                    {fallRiskResults[fallScore]?.label}
                                </span>
                            </p>
                        )}
                    </div>
                </CollapsibleSection>
            )}

            {dental && (
                <CollapsibleSection
                    value="dental"
                    title="Pemeriksaan dasar gigi"
                    keepMounted
                >
                    <div className="grid items-start gap-x-6 gap-y-4 md:grid-cols-2">
                        {dentalSections.map(([heading, fields]) => (
                            <FormGrid key={heading} columns={1}>
                                <Subheading>{heading}</Subheading>
                                {fields.map(([field, label, group]) => (
                                    <OptionField
                                        key={field}
                                        field={`dental.${field}`}
                                        label={label}
                                        options={options(group)}
                                        value={dental[field]}
                                        error={error(`dental.${field}`)}
                                        onChange={(value) =>
                                            patch('dental', { [field]: value })
                                        }
                                    />
                                ))}
                            </FormGrid>
                        ))}
                    </div>
                </CollapsibleSection>
            )}

            {draft.findings && (
                <CollapsibleSection
                    value="findings"
                    title="Keadaan fisik"
                    keepMounted
                >
                    <div className="gap-x-6 md:columns-2">
                        {bodyParts.map((part) => {
                            const checked = part.aspects.some((aspect) =>
                                findings.has(aspect.id),
                            );
                            const toggle = (on: boolean) =>
                                setDraft((current) => ({
                                    ...current,
                                    findings: on
                                        ? [
                                              ...(current.findings ?? []),
                                              ...part.aspects
                                                  .filter(
                                                      (aspect) =>
                                                          !findings.has(
                                                              aspect.id,
                                                          ),
                                                  )
                                                  .map((aspect) => ({
                                                      aspect_id: aspect.id,
                                                      result: aspect.normal_text,
                                                  })),
                                          ]
                                        : (current.findings ?? []).filter(
                                              (row) =>
                                                  !part.aspects.some(
                                                      (aspect) =>
                                                          aspect.id ===
                                                          row.aspect_id,
                                                  ),
                                          ),
                                }));
                            return (
                                <div
                                    key={part.id}
                                    className="mb-4 break-inside-avoid space-y-3"
                                >
                                    <div className="flex items-center gap-2">
                                        <Checkbox
                                            id={`finding-${part.id}`}
                                            checked={checked}
                                            onCheckedChange={(value) =>
                                                toggle(value === true)
                                            }
                                        />
                                        <Label
                                            htmlFor={`finding-${part.id}`}
                                            className="font-normal"
                                        >
                                            {part.name}
                                        </Label>
                                    </div>
                                    {checked && (
                                        <FormGrid columns={1}>
                                            {part.aspects.map((aspect) => (
                                                <TextField
                                                    key={aspect.id}
                                                    id={`finding-${aspect.id}`}
                                                    label={aspect.name}
                                                    rows={1}
                                                    value={
                                                        findings.get(
                                                            aspect.id,
                                                        ) ?? null
                                                    }
                                                    error={undefined}
                                                    onChange={(value) =>
                                                        setDraft((current) => ({
                                                            ...current,
                                                            findings: (
                                                                current.findings ??
                                                                []
                                                            ).map((row) =>
                                                                row.aspect_id ===
                                                                aspect.id
                                                                    ? {
                                                                          ...row,
                                                                          result: value,
                                                                      }
                                                                    : row,
                                                            ),
                                                        }))
                                                    }
                                                />
                                            ))}
                                        </FormGrid>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </CollapsibleSection>
            )}

            {draft.anatomy && (
                <CollapsibleSection
                    value="anatomy"
                    title="Anatomi tubuh"
                    keepMounted
                >
                    <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                            Catat bagian tubuh dan keterangannya. Peta tubuh
                            yang bisa diklik belum tersedia.
                        </p>
                        {draft.anatomy.length === 0 && (
                            <p className="text-sm text-muted-foreground">
                                Belum ada bagian tubuh. Pilih Tambah untuk
                                menambahkan baris.
                            </p>
                        )}
                        {draft.anatomy.map((row, index) => (
                            <div
                                key={row.id ?? `new-${index}`}
                                className="grid items-start gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
                            >
                                <LineField
                                    id={`anatomy.${index}.body_part`}
                                    label="Bagian tubuh"
                                    required
                                    value={row.body_part}
                                    error={error(`anatomy.${index}.body_part`)}
                                    onChange={(value) =>
                                        setDraft((current) => ({
                                            ...current,
                                            anatomy: (
                                                current.anatomy ?? []
                                            ).map((item, position) =>
                                                position === index
                                                    ? {
                                                          ...item,
                                                          body_part: value,
                                                      }
                                                    : item,
                                            ),
                                        }))
                                    }
                                />
                                <TextField
                                    id={`anatomy.${index}.description`}
                                    label="Keterangan"
                                    rows={1}
                                    value={row.description}
                                    error={error(
                                        `anatomy.${index}.description`,
                                    )}
                                    onChange={(value) =>
                                        setDraft((current) => ({
                                            ...current,
                                            anatomy: (
                                                current.anatomy ?? []
                                            ).map((item, position) =>
                                                position === index
                                                    ? {
                                                          ...item,
                                                          description: value,
                                                      }
                                                    : item,
                                            ),
                                        }))
                                    }
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Hapus baris ${index + 1}`}
                                    onClick={() =>
                                        setDraft((current) => ({
                                            ...current,
                                            anatomy: (
                                                current.anatomy ?? []
                                            ).filter(
                                                (_, position) =>
                                                    position !== index,
                                            ),
                                        }))
                                    }
                                >
                                    <Trash2 aria-hidden="true" />
                                </Button>
                            </div>
                        ))}
                        <ActionButton
                            action="add"
                            type="button"
                            onClick={() =>
                                setDraft((current) => ({
                                    ...current,
                                    anatomy: [
                                        ...(current.anatomy ?? []),
                                        {
                                            id: null,
                                            body_part: null,
                                            description: null,
                                        },
                                    ],
                                }))
                            }
                        />
                    </div>
                </CollapsibleSection>
            )}

            {other && (
                <CollapsibleSection value="other" title="Lainnya" keepMounted>
                    <div className="grid items-start gap-x-6 gap-y-4 md:grid-cols-2">
                        <FormGrid columns={1}>
                            {otherText(
                                'drug_therapy',
                                'Terapi obat yang dianjurkan',
                            )}
                            {otherText(
                                'non_drug_therapy',
                                'Terapi non obat yang dianjurkan',
                            )}
                            {otherText('consumables', 'BMHP yang digunakan')}
                            {otherText('plan', 'Rencana')}
                            {otherFlag('smoking', 'Merokok')}
                            {otherFlag('alcohol', 'Konsumsi alkohol')}
                            {otherFlag(
                                'low_vegetable_fruit',
                                'Kurang sayur/buah',
                            )}
                        </FormGrid>
                        <FormGrid columns={1}>
                            <ChoiceField
                                field="other.nursing_care_type"
                                legend="Tipe askep"
                                options={options('tipe_askep')}
                                value={other.nursing_care_type}
                                error={error('other.nursing_care_type')}
                                onChange={(value) =>
                                    patch('other', { nursing_care_type: value })
                                }
                            />
                            {otherText('education', 'Edukasi')}
                            {other.nursing_care_type !== 'Text' &&
                                otherText(
                                    'nursing_care_description',
                                    'Deskripsi askep',
                                )}
                            {otherText('observation', 'Observasi')}
                            {otherText('notes', 'Keterangan lainnya')}
                            {otherText('biopsychosocial', 'Biopsikososial')}
                            {otherText(
                                'nursing_actions',
                                'Tindakan keperawatan',
                            )}
                        </FormGrid>
                    </div>
                </CollapsibleSection>
            )}
        </CollapsibleSectionGroup>
    );
}
