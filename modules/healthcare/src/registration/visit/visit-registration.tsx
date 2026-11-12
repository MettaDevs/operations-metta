import { ActionButton } from '@operations-metta/ui/action-button';
import { Alert, AlertDescription } from '@operations-metta/ui/alert';
import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import {
    Card,
    CardAction,
    CardContent,
    CardHeader,
    CardTitle,
} from '@operations-metta/ui/card';
import { Checkbox } from '@operations-metta/ui/checkbox';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@operations-metta/ui/dialog';
import { FieldLegend, FieldSet } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
} from '@operations-metta/ui/input-group';
import { Input } from '@operations-metta/ui/input';
import { Label } from '@operations-metta/ui/label';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RadioGroup, RadioGroupItem } from '@operations-metta/ui/radio-group';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { Textarea } from '@operations-metta/ui/textarea';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import { useRecordTransition } from '@operations-metta/ui/use-record-transition';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { cn } from '@operations-metta/ui/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Ban, CheckCircle2, Save, Search, UserPlus, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
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
import { ageOf, PatientCard } from '../../patient/patient/patient-card.tsx';
import {
    isSectionKind,
    sectionKinds,
} from '../../service/section/section.kinds.ts';
import {
    TriageDot,
    VisitStatusText,
    visitConditionLabel,
    visitConditionLabels,
} from './visit-display.tsx';
import {
    isVisitCondition,
    visitConditions,
    type VisitCondition,
} from './visit.statuses.ts';

// Halaman penuh pendaftaran kunjungan rawat jalan (varian B yang dipilih pemilik produk): kiri data pasien sebagai
// baris label : nilai beserta riwayatnya, kanan data kunjungan, skrining visual, dan tujuan. Kunjungan tersimpan dibuka
// di halaman yang sama dengan isian terkunci; satu-satunya perubahan yang tersedia adalah batal dengan alasan.

type Metadata = ApiBody<'healthcareVisitMetadata'>;
type Visit = ApiBody<'healthcareVisitShow'>['data'];
type VisitRow = ApiBody<'healthcareVisitList'>['data'][number];
type Patient = ApiBody<'healthcarePatientShow'>['data'];
type PatientMetadata = ApiBody<'healthcarePatientMetadata'>;
type PatientRow = ApiBody<'healthcarePatientList'>['data'][number];
type Section = Metadata['sections'][number];
type Schedule = Section['schedules'][number];
type Errors = Record<string, string[]>;

// Cara bayar kunjungan. `null` berarti mengikuti cara bayar utama pasien (atau tipe bawaan), sampai petugas
// mengubahnya.
type Payer = { patientTypeId: string; guarantorId: string; cardNumber: string };

type Draft = {
    payer: Payer | null;
    height: string;
    weight: string;
    condition: VisitCondition;
    conditionIds: string[];
    signIds: string[];
    kind: string | null;
    sectionId: string | null;
    scheduleId: string | null;
};

const emptyDraft: Draft = {
    payer: null,
    height: '',
    weight: '',
    condition: 'sakit',
    conditionIds: [],
    signIds: [],
    kind: null,
    sectionId: null,
    scheduleId: null,
};

function draftOf(visit: Visit): Draft {
    const destination = visit.destinations[0];
    return {
        payer: {
            patientTypeId: visit.patient_type_id,
            guarantorId: visit.guarantor_id ?? '',
            cardNumber: visit.card_number ?? '',
        },
        height: visit.height_cm === null ? '' : String(visit.height_cm),
        weight: visit.weight_kg === null ? '' : String(visit.weight_kg),
        condition: isVisitCondition(visit.visit_condition)
            ? visit.visit_condition
            : 'sakit',
        conditionIds: visit.patient_conditions.map((row) => row.id),
        signIds: visit.screening_signs.map((row) => row.id),
        kind: null,
        sectionId: destination?.section_id ?? null,
        scheduleId: destination?.practice_schedule_id ?? null,
    };
}

function defaultPayer(patient: Patient | null, metadata: Metadata): Payer {
    const primary =
        patient?.payment_methods.find((method) => method.is_primary) ??
        patient?.payment_methods[0];
    if (
        primary &&
        metadata.patient_types.some(
            (type) => type.id === primary.patient_type_id,
        )
    )
        return {
            patientTypeId: primary.patient_type_id,
            guarantorId: primary.guarantor_id ?? '',
            cardNumber: primary.card_number ?? '',
        };
    const type =
        metadata.patient_types.find((item) => item.is_default) ??
        metadata.patient_types[0];
    return {
        patientTypeId: type?.id ?? '',
        guarantorId:
            type?.guarantors.find((guarantor) => guarantor.is_default)?.id ??
            '',
        cardNumber: '',
    };
}

export function notFound(caught: unknown): boolean {
    return caught instanceof ApiError && caught.status === 404;
}

// Satu tahun ke belakang, batas rentang daftar kunjungan.
function yearBefore(date: string): string {
    const day = new Date(`${date}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - 365);
    return day.toISOString().slice(0, 10);
}

function scheduleLabel(schedule: Schedule): string {
    if (schedule.full) return 'Kuota penuh';
    return schedule.capacity === null
        ? `${String(schedule.registered)} pasien`
        : `${String(schedule.registered)}/${String(schedule.capacity)} pasien`;
}

// Satu baris gaya aplikasi lama: label, titik dua, nilai, dengan garis tipis di bawahnya.
function Row({
    label,
    htmlFor,
    required = false,
    error,
    align = 'center',
    children,
}: {
    label: string;
    htmlFor?: string;
    required?: boolean;
    error?: string | undefined;
    align?: 'center' | 'start';
    children: ReactNode;
}): ReactNode {
    const labelClass = cn(
        'font-normal text-muted-foreground',
        align === 'start' && 'pt-1.5',
    );
    const text = (
        <>
            {label}
            {required && (
                <span aria-hidden="true" className="text-destructive">
                    {' '}
                    *
                </span>
            )}
        </>
    );
    return (
        <div
            className={cn(
                'grid min-h-9 grid-cols-[7.5rem_0.5rem_minmax(0,1fr)] gap-x-2 border-b border-border/70 py-1 text-sm sm:grid-cols-[9rem_0.5rem_minmax(0,1fr)]',
                align === 'center' ? 'items-center' : 'items-start',
            )}
        >
            {htmlFor ? (
                <Label htmlFor={htmlFor} className={labelClass}>
                    {text}
                </Label>
            ) : (
                <span className={labelClass}>{text}</span>
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

function patientRows(
    patient: Patient | null,
    patientMetadata: PatientMetadata | undefined,
): [string, string | null][] {
    const reference = (category: string, code: string | null) =>
        code === null
            ? null
            : (patientMetadata?.reference_values[category]?.find(
                  (value) => value.code === code,
              )?.name ?? code);
    const country = (code: string | null) =>
        code === null
            ? null
            : (patientMetadata?.countries.find((item) => item.code === code)
                  ?.name ?? code);
    const address = patient?.domicile_address ?? patient?.identity_address;
    const street = address
        ? [
              address.street,
              address.rt || address.rw
                  ? `RT ${address.rt ?? '-'}/RW ${address.rw ?? '-'}`
                  : null,
          ]
              .filter(Boolean)
              .join(', ') || null
        : null;
    const birth = [
        patient?.birth_place,
        patient?.birth_date ? displayDate(patient.birth_date) : null,
    ]
        .filter(Boolean)
        .join(', ');
    return [
        ['NRM lama', patient?.old_number ?? null],
        ['No. dokumen RM', patient?.document_number ?? null],
        [
            'Golongan darah',
            reference('blood_type', patient?.blood_type ?? null),
        ],
        ['Nama pasien', patient?.name ?? null],
        ['E-mail', patient?.email ?? null],
        ['No. identitas', patient?.nik.number ?? null],
        ['No. KK', patient?.family_card_number.number ?? null],
        ['Tempat / tanggal lahir', birth || null],
        [
            'Umur',
            patient?.birth_date ? ageOf(patient.birth_date) || null : null,
        ],
        [
            'Status perkawinan',
            reference('marital_status', patient?.marital_status ?? null),
        ],
        ['Agama', reference('religion', patient?.religion ?? null)],
        ['Pendidikan', reference('education', patient?.education ?? null)],
        ['Pekerjaan', patient?.occupation_name ?? null],
        ['No. HP', patient?.phone ?? null],
        ['Jenis kelamin', reference('gender', patient?.gender ?? null)],
        [
            'Status di kartu keluarga',
            reference('family_status', patient?.family_status ?? null),
        ],
        ['Warganegara', country(patient?.nationality_country_code ?? null)],
        ['Alamat', street],
        ['Provinsi', address?.province ?? null],
        ['Kabupaten/Kota', address?.city ?? null],
        ['Kecamatan', address?.district ?? null],
        ['Kelurahan/Desa', address?.village ?? null],
    ];
}

// Cari pasien lewat API pasien (NRM, nama, NIK, no. penjamin, tanggal lahir). Satu hasil langsung dipilih; lebih dari
// satu ditampilkan sebagai daftar yang dimuat bertahap.
function PatientSearch({
    patientNrm,
    error,
    onPick,
    onClear,
}: {
    patientNrm: string | null;
    error: string | undefined;
    onPick: (patient: PatientRow) => void;
    onClear: () => void;
}): ReactNode {
    const [text, setText] = useState('');
    const [query, setQuery] = useState<string | null>(null);
    const [searching, setSearching] = useState(false);
    const shown = patientNrm !== null && query === null ? patientNrm : text;
    const loader = useCallback<ListLoader<PatientRow>>(
        async ({ query: needle, cursor, signal }) => {
            const { body } = await api.healthcarePatientList(
                {
                    query: {
                        q: needle,
                        status: 'active',
                        per_page: 20,
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const results = useIncrementalList({
        loadItems: loader,
        query: query ?? '',
        active: query !== null,
        getKey: (row) => row.id,
    });
    const pick = (row: PatientRow) => {
        setQuery(null);
        setText(row.nrm);
        onPick(row);
    };
    // Satu pasien yang cocok langsung dipilih; selain itu hasilnya ditampilkan sebagai daftar.
    const search = async () => {
        const needle = shown.trim();
        if (!needle) return;
        setSearching(true);
        try {
            const { body } = await api.healthcarePatientList({
                query: { q: needle, status: 'active', per_page: 2 },
            });
            const only = body.data.length === 1 ? body.data[0] : undefined;
            if (only) pick(only);
            else setQuery(needle);
        } catch {
            setQuery(needle);
        } finally {
            setSearching(false);
        }
    };
    return (
        <>
            <Row label="NRM" htmlFor="visit-patient-search" error={error}>
                <InputGroup className="h-8">
                    <InputGroupInput
                        id="visit-patient-search"
                        value={shown}
                        placeholder="Cari NRM, nama, atau NIK"
                        aria-invalid={error ? true : undefined}
                        onChange={(event) => {
                            setText(event.target.value);
                            setQuery(null);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void search();
                            }
                        }}
                    />
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton
                            size="icon-xs"
                            aria-label="Cari pasien"
                            disabled={searching}
                            onClick={() => void search()}
                        >
                            <Search />
                        </InputGroupButton>
                        <InputGroupButton
                            size="icon-xs"
                            aria-label="Kosongkan pasien"
                            disabled={!shown && patientNrm === null}
                            onClick={() => {
                                setText('');
                                setQuery(null);
                                onClear();
                            }}
                        >
                            <X />
                        </InputGroupButton>
                    </InputGroupAddon>
                </InputGroup>
            </Row>
            {query !== null && (
                <div className="max-h-72 border-b border-border/70 py-1.5">
                    <DataTable
                        data={results.items}
                        getRowKey={(row) => row.id}
                        getRowLabel={(row) => `${row.nrm} ${row.name}`}
                        scrollMode="inline"
                        showRowNumbers={false}
                        rowActivation="single-click"
                        onRowClick={pick}
                        incremental={results}
                        emptyMessage="Pasien tidak ditemukan. Pilih Buat pasien baru bila pasien belum pernah datang."
                        columns={[
                            {
                                id: 'nrm',
                                header: 'NRM',
                                width: 100,
                                cell: (row) => row.nrm,
                            },
                            {
                                id: 'name',
                                header: 'Nama',
                                width: 180,
                                cell: (row) => (
                                    <DataTableText>
                                        <span className="font-medium">
                                            {row.name}
                                        </span>
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'birth',
                                header: 'Tgl. lahir',
                                width: 100,
                                cell: (row) =>
                                    row.birth_date
                                        ? displayDate(row.birth_date)
                                        : '—',
                            },
                        ]}
                    />
                </div>
            )}
        </>
    );
}

function PatientPanel({
    patient,
    patientNrm,
    loading,
    loadError,
    patientMetadata,
    searchable,
    error,
    onPick,
    onClear,
}: {
    patient: Patient | null;
    patientNrm: string | null;
    loading: boolean;
    loadError: string | null;
    patientMetadata: PatientMetadata | undefined;
    searchable: boolean;
    error: string | undefined;
    onPick: (patient: PatientRow) => void;
    onClear: () => void;
}): ReactNode {
    return (
        <div>
            {searchable ? (
                <PatientSearch
                    patientNrm={patientNrm}
                    error={error}
                    onPick={onPick}
                    onClear={onClear}
                />
            ) : (
                <Row label="NRM">
                    <span className="font-medium tabular-nums">
                        {patientNrm ?? '—'}
                    </span>
                </Row>
            )}
            {(loading || loadError) && (
                <p
                    role={loadError ? 'alert' : 'status'}
                    className={cn(
                        'border-b border-border/70 py-1.5 text-sm',
                        loadError
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                    )}
                >
                    {loadError ?? 'Memuat data pasien…'}
                </p>
            )}
            {patientRows(patient, patientMetadata).map(([label, value]) => (
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
    );
}

// Riwayat di kolom kiri. Pemeriksaan terakhir dan skrining datang dari kunjungan pasien ini setahun terakhir.
// Penyakit khusus dan risiko kehamilan baru terisi setelah pemeriksaan ada.
function PatientHistory({
    patientId,
    currentVisitId,
    today,
}: {
    patientId: string | null;
    currentVisitId: string | null;
    today: string;
}): ReactNode {
    const history = useQuery({
        ...orpc.healthcareVisitList.queryOptions({
            input: {
                query: {
                    patient_id: patientId ?? '',
                    from: yearBefore(today),
                    to: today,
                    per_page: 20,
                },
            },
            select: (response) =>
                response.body.data.filter(
                    (row) =>
                        row.id !== currentVisitId && row.status !== 'batal',
                ),
        }),
        enabled: patientId !== null,
    });
    const rows: VisitRow[] = history.data ?? [];
    const screened = rows.filter((row) => row.screening_category_name);
    const last = rows[0];
    const empty =
        patientId === null ? 'Pilih pasien lebih dulu' : 'Belum ada data';
    const status = history.isError
        ? 'Riwayat belum dapat dimuat'
        : history.isLoading
          ? 'Memuat…'
          : null;
    return (
        <CollapsibleSectionGroup defaultValue={['history']}>
            <CollapsibleSection
                value="history"
                title="Riwayat pemeriksaan terakhir"
                summary={
                    status ??
                    (last
                        ? `${displayDate(last.date)} · ${last.section_name}`
                        : empty)
                }
            >
                {history.isError ? (
                    <div className="space-y-2 px-3 py-2 text-sm">
                        <p role="alert" className="text-destructive">
                            {errorText(
                                history.error,
                                'Riwayat kunjungan belum dapat dimuat.',
                            )}
                        </p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void history.refetch()}
                        >
                            Coba lagi
                        </Button>
                    </div>
                ) : (
                    <DataTable
                        data={rows}
                        getRowKey={(row) => row.id}
                        scrollMode="inline"
                        showRowNumbers={false}
                        emptyMessage={
                            patientId === null
                                ? 'Pilih pasien untuk melihat riwayatnya.'
                                : history.isLoading
                                  ? 'Memuat riwayat…'
                                  : 'Belum ada kunjungan sebelumnya.'
                        }
                        columns={[
                            {
                                id: 'date',
                                header: 'Tanggal',
                                width: 88,
                                cell: (row) => displayDate(row.date),
                            },
                            {
                                id: 'section',
                                header: 'Poli/ruangan',
                                width: 120,
                                cell: (row) => row.section_name,
                            },
                            {
                                id: 'practitioner',
                                header: 'Nakes',
                                width: 120,
                                cell: (row) => row.practitioner_name ?? '—',
                            },
                        ]}
                    />
                )}
            </CollapsibleSection>
            <CollapsibleSection
                value="screening"
                title="Riwayat skrining"
                summary={
                    status ??
                    (screened.length
                        ? [
                              ...new Set(
                                  screened.map(
                                      (row) => row.screening_category_name,
                                  ),
                              ),
                          ].join(', ')
                        : empty)
                }
            >
                <ul className="space-y-1 px-3 py-2 text-sm">
                    {screened.length === 0 && (
                        <li className="text-muted-foreground">
                            {patientId === null
                                ? 'Pilih pasien untuk melihat riwayatnya.'
                                : 'Belum ada skrining sebelumnya.'}
                        </li>
                    )}
                    {screened.map((row) => (
                        <li key={row.id} className="flex items-center gap-2">
                            <TriageDot color={row.screening_category_color} />
                            {displayDate(row.date)} ·{' '}
                            {row.screening_category_name} · {row.section_name}
                        </li>
                    ))}
                </ul>
            </CollapsibleSection>
            <CollapsibleSection
                value="diseases"
                title="Riwayat penyakit khusus"
                summary="Belum ada data"
            >
                <p className="px-3 py-2 text-sm text-muted-foreground">
                    Belum ada data. Riwayat ini terisi dari hasil pemeriksaan
                    dokter.
                </p>
            </CollapsibleSection>
            <CollapsibleSection
                value="pregnancy"
                title="Riwayat risiko kehamilan"
                summary="Belum ada data"
            >
                <p className="px-3 py-2 text-sm text-muted-foreground">
                    Belum ada data. Riwayat ini terisi dari hasil pemeriksaan
                    kehamilan.
                </p>
            </CollapsibleSection>
        </CollapsibleSectionGroup>
    );
}

// Isian kunjungan memakai komponen isian produk (label melayang, seperti kartu pasien). Dari layar lama hanya
// letaknya yang dipertahankan: tipe pasien dan penjaminnya di kiri, ukuran tubuh, status, dan keadaan bertumpuk di kanan.
function VisitPanel({
    metadata,
    draft,
    payer,
    error,
    set,
    setPayer,
}: {
    metadata: Metadata;
    draft: Draft;
    payer: Payer;
    error: (field: string) => string | undefined;
    set: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
    setPayer: (payer: Payer) => void;
}): ReactNode {
    const type = metadata.patient_types.find(
        (item) => item.id === payer.patientTypeId,
    );
    const needsGuarantor = type?.behaviors.includes('requires_guarantor');
    const needsCard = type?.behaviors.includes('requires_card_number');
    return (
        <div className="grid items-start gap-x-6 gap-y-4 md:grid-cols-2">
            <FormGrid columns={1}>
                <FormControl error={error('patient_type_id')}>
                    <Select
                        label="Tipe pasien"
                        required
                        items={metadata.patient_types.map((item) => ({
                            value: item.id,
                            label: item.name,
                        }))}
                        value={payer.patientTypeId || null}
                        onValueChange={(value) => {
                            const next = metadata.patient_types.find(
                                (item) => item.id === value,
                            );
                            setPayer({
                                patientTypeId: next?.id ?? '',
                                guarantorId:
                                    next?.guarantors.find(
                                        (guarantor) => guarantor.is_default,
                                    )?.id ?? '',
                                cardNumber: payer.cardNumber,
                            });
                        }}
                        searchPlaceholder="Cari tipe pasien"
                        emptyMessage="Tipe pasien tidak ditemukan."
                    />
                </FormControl>
                {needsGuarantor && (
                    <FormControl error={error('guarantor_id')}>
                        <Select
                            label="Penjamin"
                            required
                            items={(type?.guarantors ?? []).map((item) => ({
                                value: item.id,
                                label: item.name,
                            }))}
                            value={payer.guarantorId || null}
                            onValueChange={(value) =>
                                setPayer({ ...payer, guarantorId: value ?? '' })
                            }
                            searchPlaceholder="Cari penjamin"
                            emptyMessage="Belum ada penjamin untuk tipe pasien ini."
                        />
                    </FormControl>
                )}
                {needsCard && (
                    <FormControl error={error('card_number')}>
                        <Input
                            id="visit-card-number"
                            label="No. kartu"
                            required
                            value={payer.cardNumber}
                            maxLength={50}
                            aria-invalid={
                                error('card_number') ? true : undefined
                            }
                            onChange={(event) =>
                                setPayer({
                                    ...payer,
                                    cardNumber: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                )}
            </FormGrid>
            <FormGrid columns={1}>
                <FormControl error={error('height_cm')}>
                    <Input
                        id="visit-height"
                        label="Tinggi badan (cm)"
                        inputMode="decimal"
                        value={draft.height}
                        aria-invalid={error('height_cm') ? true : undefined}
                        onChange={(event) => set('height', event.target.value)}
                    />
                </FormControl>
                <FormControl error={error('weight_kg')}>
                    <Input
                        id="visit-weight"
                        label="Berat badan (kg)"
                        inputMode="decimal"
                        value={draft.weight}
                        aria-invalid={error('weight_kg') ? true : undefined}
                        onChange={(event) => set('weight', event.target.value)}
                    />
                </FormControl>
                <FormControl error={error('visit_condition')}>
                    <FieldSet className="gap-1.5">
                        <FieldLegend variant="label">
                            Status kunjungan
                            <span className="text-destructive"> *</span>
                        </FieldLegend>
                        <RadioGroup
                            aria-label="Status kunjungan"
                            className="flex flex-wrap gap-x-6 gap-y-1.5"
                            value={draft.condition}
                            onValueChange={(value) => {
                                if (isVisitCondition(value))
                                    set('condition', value);
                            }}
                        >
                            {visitConditions.map((value) => (
                                <div
                                    key={value}
                                    className="flex items-center gap-2"
                                >
                                    <RadioGroupItem
                                        id={`visit-condition-${value}`}
                                        value={value}
                                    />
                                    <Label
                                        htmlFor={`visit-condition-${value}`}
                                        className="font-normal"
                                    >
                                        {visitConditionLabels[value]}
                                    </Label>
                                </div>
                            ))}
                        </RadioGroup>
                    </FieldSet>
                </FormControl>
                <FormControl error={error('patient_condition_ids')}>
                    <FieldSet className="gap-1.5">
                        <FieldLegend variant="label">
                            Keadaan pasien
                        </FieldLegend>
                        <div
                            role="group"
                            aria-label="Keadaan pasien"
                            className="flex flex-wrap gap-x-6 gap-y-1.5"
                        >
                            {metadata.patient_conditions.map((condition) => (
                                <div
                                    key={condition.id}
                                    className="flex items-center gap-2"
                                >
                                    <Checkbox
                                        id={`visit-patient-condition-${condition.id}`}
                                        checked={draft.conditionIds.includes(
                                            condition.id,
                                        )}
                                        onCheckedChange={(checked) =>
                                            set(
                                                'conditionIds',
                                                checked === true
                                                    ? [
                                                          ...draft.conditionIds,
                                                          condition.id,
                                                      ]
                                                    : draft.conditionIds.filter(
                                                          (id) =>
                                                              id !==
                                                              condition.id,
                                                      ),
                                            )
                                        }
                                    />
                                    <Label
                                        htmlFor={`visit-patient-condition-${condition.id}`}
                                        className="font-normal"
                                    >
                                        {condition.name}
                                    </Label>
                                </div>
                            ))}
                        </div>
                    </FieldSet>
                </FormControl>
            </FormGrid>
        </div>
    );
}

// Kategori skrining paling gawat (tingkat terkecil) di antara tanda yang dicentang, aturan yang sama dengan server.
function screeningCategory(metadata: Metadata, signIds: string[]) {
    return metadata.screening_categories.find((category) =>
        category.signs.some((sign) => signIds.includes(sign.id)),
    );
}

function ScreeningBadge({
    name,
    color,
}: {
    name: string | null;
    color: string | null;
}): ReactNode {
    if (!name)
        return (
            <span className="text-xs text-muted-foreground">
                Belum ada tanda dipilih
            </span>
        );
    return (
        <Badge variant="outline" className="gap-1.5 text-sm" aria-live="polite">
            <TriageDot color={color} />
            Kategori: {name}
        </Badge>
    );
}

function ScreeningPanel({
    metadata,
    draft,
    error,
    set,
}: {
    metadata: Metadata;
    draft: Draft;
    error: string | undefined;
    set: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
}): ReactNode {
    const toggle = (id: string, checked: boolean) =>
        set(
            'signIds',
            checked
                ? [...draft.signIds, id]
                : draft.signIds.filter((value) => value !== id),
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
                    error && 'border-destructive',
                )}
            >
                {metadata.screening_categories.map((category) => {
                    const picked = category.signs.filter((sign) =>
                        draft.signIds.includes(sign.id),
                    ).length;
                    return (
                        <fieldset key={category.id}>
                            <legend className="flex w-full items-center gap-2 bg-muted/50 px-3 py-1.5 text-xs font-medium">
                                <TriageDot color={category.color} />
                                {category.name}
                                {picked > 0 && (
                                    <span className="ml-auto font-normal text-muted-foreground">
                                        {picked} dipilih
                                    </span>
                                )}
                            </legend>
                            <div className="grid sm:grid-cols-2">
                                {category.signs.map((sign) => (
                                    <Label
                                        key={sign.id}
                                        htmlFor={`visit-sign-${sign.id}`}
                                        className="flex min-h-9 cursor-pointer items-center gap-2 border-t border-border/50 px-3 py-1.5 font-normal hover:bg-muted/40"
                                    >
                                        <Checkbox
                                            id={`visit-sign-${sign.id}`}
                                            checked={draft.signIds.includes(
                                                sign.id,
                                            )}
                                            onCheckedChange={(checked) =>
                                                toggle(
                                                    sign.id,
                                                    checked === true,
                                                )
                                            }
                                        />
                                        {sign.name}
                                    </Label>
                                ))}
                            </div>
                        </fieldset>
                    );
                })}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
    );
}

function Pill({
    pressed,
    disabled = false,
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

// Instalasi adalah jenis section; poli/ruangan adalah section di unit pengguna; dokter hari ini dari jadwal praktik
// section itu beserta kuotanya. Kunjungan tersimpan menambahkan tujuannya sendiri bila tidak lagi ada di data hari ini.
function DestinationPanel({
    metadata,
    draft,
    visit,
    error,
    choose,
}: {
    metadata: Metadata;
    draft: Draft;
    visit: Visit | null;
    error: (field: string) => string | undefined;
    choose: (next: Pick<Draft, 'kind' | 'sectionId' | 'scheduleId'>) => void;
}): ReactNode {
    const stored = visit?.destinations[0] ?? null;
    const sections: Section[] = [...metadata.sections];
    if (
        visit &&
        stored &&
        !sections.some((section) => section.id === stored.section_id)
    )
        sections.push({
            id: stored.section_id,
            name: stored.section_name,
            kind: '',
            queue_mode: '',
            operating_unit_id: visit.operating_unit_id,
            operating_unit_name: visit.operating_unit_name,
            schedules: [],
        });
    const kinds = [
        ...new Set(sections.map((section) => section.kind).filter(Boolean)),
    ].sort(
        (a, b) =>
            Object.keys(sectionKinds).indexOf(a) -
            Object.keys(sectionKinds).indexOf(b),
    );
    const selectedSection = sections.find(
        (section) => section.id === draft.sectionId,
    );
    const kind =
        draft.kind ??
        selectedSection?.kind ??
        (kinds.includes('rawat_jalan') ? 'rawat_jalan' : (kinds[0] ?? ''));
    const shown = sections.filter(
        (section) =>
            section.kind === kind ||
            (section.id === draft.sectionId && !section.kind),
    );
    const units = new Set(shown.map((section) => section.operating_unit_id));
    const schedules: Schedule[] = [...(selectedSection?.schedules ?? [])];
    if (
        stored?.practice_schedule_id &&
        !schedules.some(
            (schedule) => schedule.id === stored.practice_schedule_id,
        )
    )
        schedules.push({
            id: stored.practice_schedule_id,
            date: visit?.date ?? '',
            ends_on: visit?.date ?? '',
            practitioner_id: stored.practitioner_id ?? '',
            practitioner_name: stored.practitioner_name ?? '—',
            scheduled_practitioner_id: stored.practitioner_id ?? '',
            is_substitute: false,
            session_id: '',
            session_name: '',
            start_time: '',
            end_time: '',
            capacity: null,
            registered: 0,
            full: false,
        });
    if (!sections.length)
        return (
            <Alert>
                <AlertDescription>
                    Belum ada poli atau ruangan aktif di unit kerja Anda.
                    Section diatur di Setup → Section.
                </AlertDescription>
            </Alert>
        );
    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <p className="text-sm font-medium">
                    Instalasi <span className="text-destructive">*</span>
                </p>
                <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label="Instalasi"
                >
                    {kinds.map((item) => (
                        <Pill
                            key={item}
                            pressed={kind === item}
                            onClick={() =>
                                choose({
                                    kind: item,
                                    sectionId: null,
                                    scheduleId: null,
                                })
                            }
                        >
                            {isSectionKind(item) ? sectionKinds[item] : item}
                        </Pill>
                    ))}
                </div>
            </div>
            <div className="space-y-2">
                <p className="text-sm font-medium">
                    Poli / ruangan <span className="text-destructive">*</span>
                </p>
                <div
                    className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                    role="group"
                    aria-label="Poli atau ruangan"
                >
                    {shown.map((section) => (
                        <Pill
                            key={section.id}
                            pressed={draft.sectionId === section.id}
                            onClick={() => {
                                const open = section.schedules.filter(
                                    (schedule) => !schedule.full,
                                );
                                choose({
                                    kind,
                                    sectionId: section.id,
                                    scheduleId:
                                        open.length === 1 && open[0]
                                            ? open[0].id
                                            : null,
                                });
                            }}
                        >
                            <span className="flex w-full flex-col">
                                <span>{section.name}</span>
                                {units.size > 1 && (
                                    <span className="text-xs opacity-80">
                                        {section.operating_unit_name}
                                    </span>
                                )}
                            </span>
                        </Pill>
                    ))}
                </div>
                {error('section_id') && (
                    <p className="text-sm text-destructive">
                        {error('section_id')}
                    </p>
                )}
            </div>
            {selectedSection && (
                <div className="space-y-2">
                    <p className="text-sm font-medium">
                        Dokter hari ini{' '}
                        {schedules.length > 0 && (
                            <span className="text-destructive">*</span>
                        )}
                    </p>
                    {schedules.length === 0 ? (
                        <Alert>
                            <AlertDescription>
                                Tidak ada jadwal dokter di{' '}
                                {selectedSection.name} hari ini. Pasien tetap
                                bisa didaftarkan tanpa dokter.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <div
                            className="grid gap-2 sm:grid-cols-2"
                            role="group"
                            aria-label="Dokter hari ini"
                        >
                            {schedules.map((schedule) => (
                                <Pill
                                    key={schedule.id}
                                    pressed={draft.scheduleId === schedule.id}
                                    disabled={
                                        schedule.full &&
                                        draft.scheduleId !== schedule.id
                                    }
                                    onClick={() =>
                                        choose({
                                            kind,
                                            sectionId: selectedSection.id,
                                            scheduleId: schedule.id,
                                        })
                                    }
                                >
                                    <span className="flex w-full flex-col">
                                        <span className="font-medium">
                                            {schedule.practitioner_name}
                                        </span>
                                        {schedule.start_time && (
                                            <span className="text-xs opacity-80">
                                                {schedule.start_time}–
                                                {schedule.end_time} ·{' '}
                                                {scheduleLabel(schedule)}
                                            </span>
                                        )}
                                    </span>
                                </Pill>
                            ))}
                        </div>
                    )}
                    {error('practice_schedule_id') && (
                        <p className="text-sm text-destructive">
                            {error('practice_schedule_id')}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

// Ringkasan kunjungan tersimpan di atas halaman: nomor antrean besar, NoReg, NoBukti, dan statusnya.
function VisitSummary({
    visit,
    justSaved,
    canCreate,
    onNew,
    onList,
}: {
    visit: Visit;
    justSaved: boolean;
    canCreate: boolean;
    onNew: () => void;
    onList: () => void;
}): ReactNode {
    const destination = visit.destinations[0];
    const saved = justSaved && visit.status !== 'batal';
    const registeredAt = new Date(visit.registered_at);
    return (
        <Card>
            <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    {saved && (
                        <CheckCircle2
                            aria-hidden="true"
                            className="size-8 text-success"
                        />
                    )}
                    <div>
                        <p className="text-xs text-muted-foreground">
                            Nomor antrean
                        </p>
                        <p className="text-3xl leading-none font-semibold tabular-nums">
                            {destination?.queue_code ?? '—'}
                        </p>
                    </div>
                    <div className="min-w-0 space-y-0.5 text-sm">
                        <p className="font-medium">
                            {saved
                                ? 'Registrasi tersimpan'
                                : 'Registrasi kunjungan'}
                        </p>
                        <p>
                            <span className="text-muted-foreground">
                                NoReg{' '}
                            </span>
                            <span className="tabular-nums">
                                {visit.registration_number}
                            </span>
                            <span className="text-muted-foreground">
                                {' '}
                                · NoBukti{' '}
                            </span>
                            <span className="tabular-nums">
                                {destination?.examination_number ?? '—'}
                            </span>
                        </p>
                        <p className="text-muted-foreground">
                            {visit.patient_name} ·{' '}
                            {destination?.section_name ?? '—'}
                            {destination?.practitioner_name
                                ? ` · ${destination.practitioner_name}`
                                : ''}
                        </p>
                        <p className="text-muted-foreground">
                            {displayDate(visit.date)}{' '}
                            {registeredAt.toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                            })}{' '}
                            · {visitConditionLabel(visit.visit_condition)} ·
                            Pasien {visit.visit_kind}
                        </p>
                    </div>
                    <div className="text-sm sm:ml-auto">
                        <VisitStatusText status={visit.status} />
                    </div>
                </div>
                {visit.status === 'batal' && (
                    <Alert variant="destructive">
                        <AlertDescription>
                            Dibatalkan
                            {visit.cancelled_at
                                ? ` ${new Date(visit.cancelled_at).toLocaleString('id-ID')}`
                                : ''}
                            . Alasan: {visit.cancel_reason ?? '—'}
                        </AlertDescription>
                    </Alert>
                )}
                <div className="flex flex-wrap gap-2">
                    {canCreate && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={onNew}
                        >
                            Registrasi baru
                        </Button>
                    )}
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={onList}
                    >
                        Kembali ke daftar
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function CancelVisitDialog({
    visit,
    onClose,
    onCancelled,
}: {
    visit: Visit;
    onClose: () => void;
    onCancelled: (visit: Visit) => void;
}): ReactNode {
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.healthcareVisitCancel({
                params: { id: visit.id },
                body: { version: visit.version, reason },
            });
            toast.success(
                `Registrasi ${visit.registration_number} dibatalkan.`,
            );
            onCancelled(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422) {
                setErrors(caught.errors);
                const other = Object.entries(caught.errors)
                    .filter(([field]) => field !== 'reason')
                    .flatMap(([, messages]) => messages);
                setMessage(
                    other.length
                        ? other.join(' ')
                        : caught.errors.reason
                          ? null
                          : caught.message,
                );
            } else
                setMessage(errorText(caught, 'Registrasi belum dibatalkan.'));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open && !busy) onClose();
            }}
        >
            <DialogContent size="compact">
                <form
                    noValidate
                    className="contents"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>
                            Batalkan registrasi {visit.registration_number}?
                        </DialogTitle>
                        <DialogDescription>
                            Antrean {visit.destinations[0]?.queue_code ?? ''}{' '}
                            untuk {visit.patient_name} tidak dipakai lagi, dan
                            kuota dokternya dikembalikan.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogBody className="space-y-3">
                        {message && (
                            <p
                                role="alert"
                                className="text-sm text-destructive"
                            >
                                {message}
                            </p>
                        )}
                        <FormControl error={errors.reason?.[0]}>
                            <Textarea
                                label="Alasan batal"
                                required
                                value={reason}
                                maxLength={200}
                                onChange={(event) =>
                                    setReason(event.target.value)
                                }
                            />
                        </FormControl>
                    </DialogBody>
                    <DialogFooter>
                        <Button
                            type="submit"
                            variant="destructive"
                            disabled={busy}
                        >
                            <Ban aria-hidden="true" />
                            {busy ? 'Membatalkan…' : 'Batalkan registrasi'}
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={onClose}
                        >
                            Tutup
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

const fieldsShownInPlace = new Set([
    'patient_id',
    'patient_type_id',
    'guarantor_id',
    'card_number',
    'height_cm',
    'weight_kg',
    'visit_condition',
    'patient_condition_ids',
    'screening_sign_ids',
    'section_id',
    'practice_schedule_id',
]);

/**
 * Halaman pendaftaran kunjungan. Tanpa `visit` halaman mendaftarkan kunjungan baru untuk pasien dari URL
 * (`patientId`); dengan `visit` halaman menampilkan kunjungan tersimpan dengan isian terkunci dan aksi batal.
 */
export function VisitRegistration({
    metadata,
    visit,
    patientId,
    justSaved,
    onPatientChange,
}: {
    metadata: Metadata;
    visit: Visit | null;
    patientId: string | null;
    justSaved: boolean;
    onPatientChange: (patientId: string | null) => void;
}): ReactNode {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const topRef = useRef<HTMLDivElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState<Draft>(() =>
        visit ? draftOf(visit) : emptyDraft,
    );
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [creatingPatient, setCreatingPatient] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [patientBusy, setPatientBusy] = useState(false);
    const [patientDirty, setPatientDirty] = useState(false);
    // Menutup kartu pasien baru yang sudah diisi meminta konfirmasi lebih dulu.
    const patientTransition = useRecordTransition(patientDirty, patientBusy);
    // Satu kunci per isian: simpan ulang setelah jaringan putus mengembalikan kunjungan yang sama.
    const [idempotencyKey] = useState(() => crypto.randomUUID());
    const shownPatientId = visit?.patient_id ?? patientId;
    const patientMetadata = useQuery(
        orpc.healthcarePatientMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const patientQuery = useQuery({
        queryKey: ['healthcare-patient', shownPatientId],
        queryFn: async () => {
            if (shownPatientId === null) throw new Error('Belum ada pasien.');
            return (
                await api.healthcarePatientShow({
                    params: { id: shownPatientId },
                })
            ).body.data;
        },
        enabled: shownPatientId !== null,
    });
    const patient = patientQuery.data ?? null;
    const locked = visit !== null;
    const payer = draft.payer ?? defaultPayer(patient, metadata);
    const selectedType = metadata.patient_types.find(
        (type) => type.id === payer.patientTypeId,
    );
    const set = <K extends keyof Draft>(field: K, value: Draft[K]) =>
        setDraft((current) => ({ ...current, [field]: value }));
    const error = (field: string) => errors[field]?.[0];
    const category = visit
        ? {
              name: visit.screening_category_name,
              color: visit.screening_category_color,
          }
        : (() => {
              const found = screeningCategory(metadata, draft.signIds);
              return {
                  name: found?.name ?? null,
                  color: found?.color ?? null,
              };
          })();
    const toList = () =>
        void navigate({ to: '/healthcare/registration/visits' });
    const toNew = () =>
        void navigate({ to: '/healthcare/registration/visits/new' });

    const choosePatient = (id: string | null) => {
        setDraft((current) => ({ ...current, payer: null }));
        setErrors(({ patient_id: _, ...rest }) => rest);
        onPatientChange(id);
    };

    const save = async () => {
        const section = metadata.sections.find(
            (item) => item.id === draft.sectionId,
        );
        const missing: Errors = {};
        if (shownPatientId === null)
            missing.patient_id = ['Pilih pasien atau buat pasien baru.'];
        if (!section) missing.section_id = ['Pilih poli atau ruangan tujuan.'];
        else if (section.schedules.length && !draft.scheduleId)
            missing.practice_schedule_id = [
                'Pilih dokter dari jadwal hari ini.',
            ];
        if (Object.keys(missing).length || shownPatientId === null) {
            setErrors(missing);
            setMessage(null);
            return;
        }
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.healthcareVisitCreate({
                body: {
                    patient_id: shownPatientId,
                    patient_type_id: payer.patientTypeId,
                    guarantor_id: selectedType?.behaviors.includes(
                        'requires_guarantor',
                    )
                        ? payer.guarantorId || null
                        : null,
                    card_number: selectedType?.behaviors.includes(
                        'requires_card_number',
                    )
                        ? payer.cardNumber.trim() || null
                        : null,
                    height_cm: draft.height.trim() || null,
                    weight_kg: draft.weight.trim() || null,
                    visit_condition: draft.condition,
                    patient_condition_ids: draft.conditionIds,
                    screening_sign_ids: draft.signIds,
                    section_id: draft.sectionId ?? '',
                    practice_schedule_id: draft.scheduleId,
                },
                headers: { 'idempotency-key': idempotencyKey },
            });
            const saved = body.data;
            queryClient.setQueryData(
                orpc.healthcareVisitShow.queryKey({
                    input: { params: { id: saved.id } },
                }),
                { status: 200, headers: {}, body },
            );
            void queryClient.invalidateQueries({
                queryKey: orpc.healthcareVisitMetadata.key(),
            });
            void queryClient.invalidateQueries({
                queryKey: orpc.healthcareVisitList.key(),
            });
            toast.success(
                `Registrasi tersimpan. Nomor antrean ${saved.destinations[0]?.queue_code ?? ''}.`,
            );
            void navigate({
                to: '/healthcare/registration/visits/$visitId',
                params: { visitId: saved.id },
                search: { saved: true },
                replace: true,
            });
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422) {
                setErrors(caught.errors);
                if (
                    !Object.keys(caught.errors).some((field) =>
                        fieldsShownInPlace.has(field),
                    )
                )
                    setMessage(caught.message);
            } else setMessage(errorText(caught, 'Registrasi belum disimpan.'));
            topRef.current?.scrollIntoView({ block: 'start' });
        } finally {
            setBusy(false);
        }
    };

    const canCancel =
        visit !== null &&
        visit.status === 'terdaftar' &&
        metadata.permissions.cancel;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <RecordActionBar
                title={
                    visit
                        ? `Registrasi ${visit.registration_number}`
                        : 'Registrasi kunjungan baru'
                }
            >
                {visit ? (
                    <>
                        {metadata.permissions.create && (
                            <ActionButton action="create" onClick={toNew} />
                        )}
                        {canCancel && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="command"
                                onClick={() => setCancelling(true)}
                            >
                                <Ban aria-hidden="true" />
                                Batalkan registrasi
                            </Button>
                        )}
                    </>
                ) : (
                    <>
                        <ActionButton
                            action="save"
                            type="button"
                            pending={busy}
                            disabled={busy || !metadata.permissions.create}
                            onClick={() => void save()}
                        />
                        <ActionButton
                            action="cancel"
                            disabled={busy}
                            onClick={toList}
                        />
                    </>
                )}
            </RecordActionBar>
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div ref={topRef} className="space-y-4 p-3 lg:p-4">
                    {!visit && (
                        <FormErrorHeader
                            errors={errors}
                            message={message}
                            operation="Registrasi belum disimpan"
                        />
                    )}
                    {!visit && !metadata.permissions.create && (
                        <Alert>
                            <AlertDescription>
                                Anda dapat melihat kunjungan, tetapi belum
                                diberi izin mendaftarkannya.
                            </AlertDescription>
                        </Alert>
                    )}
                    {visit && (
                        <VisitSummary
                            visit={visit}
                            justSaved={justSaved}
                            canCreate={metadata.permissions.create}
                            onNew={toNew}
                            onList={toList}
                        />
                    )}
                    <div className="grid items-start gap-4 lg:grid-cols-[minmax(340px,1fr)_2fr]">
                        <div className="min-w-0 space-y-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Data pasien</CardTitle>
                                    {!locked &&
                                        patientMetadata.data?.permissions
                                            .create && (
                                            <CardAction align="end">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-primary"
                                                    onClick={() =>
                                                        setCreatingPatient(true)
                                                    }
                                                >
                                                    <UserPlus aria-hidden="true" />
                                                    Buat pasien baru
                                                </Button>
                                            </CardAction>
                                        )}
                                </CardHeader>
                                <CardContent>
                                    <PatientPanel
                                        patient={patient}
                                        patientNrm={
                                            visit?.patient_nrm ??
                                            patient?.nrm ??
                                            null
                                        }
                                        loading={patientQuery.isLoading}
                                        loadError={
                                            patientQuery.isError
                                                ? notFound(patientQuery.error)
                                                    ? 'Pasien tidak ditemukan di legal entity dan unit kerja aktif. Periksa tempat kerja Anda.'
                                                    : errorText(
                                                          patientQuery.error,
                                                          'Data pasien belum dapat dimuat.',
                                                      )
                                                : null
                                        }
                                        patientMetadata={patientMetadata.data}
                                        searchable={!locked}
                                        error={error('patient_id')}
                                        onPick={(row) => choosePatient(row.id)}
                                        onClear={() => choosePatient(null)}
                                    />
                                </CardContent>
                            </Card>
                            <Card className="py-0">
                                <PatientHistory
                                    patientId={shownPatientId}
                                    currentVisitId={visit?.id ?? null}
                                    today={metadata.date}
                                />
                            </Card>
                        </div>
                        <fieldset
                            disabled={locked || busy}
                            className="min-w-0 space-y-4"
                        >
                            <legend className="sr-only">Isian kunjungan</legend>
                            <Card>
                                <CardHeader>
                                    <CardTitle>Data kunjungan</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <VisitPanel
                                        metadata={metadata}
                                        draft={draft}
                                        payer={payer}
                                        error={error}
                                        set={set}
                                        setPayer={(next) => set('payer', next)}
                                    />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>Skrining visual</CardTitle>
                                    <CardAction align="end">
                                        <ScreeningBadge
                                            name={category.name}
                                            color={category.color}
                                        />
                                    </CardAction>
                                </CardHeader>
                                <CardContent>
                                    <ScreeningPanel
                                        metadata={metadata}
                                        draft={draft}
                                        error={error('screening_sign_ids')}
                                        set={set}
                                    />
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>Data tujuan</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <DestinationPanel
                                        metadata={metadata}
                                        draft={draft}
                                        visit={visit}
                                        error={error}
                                        choose={(next) => {
                                            setDraft((current) => ({
                                                ...current,
                                                ...next,
                                            }));
                                            setErrors(
                                                ({
                                                    section_id: _section,
                                                    practice_schedule_id:
                                                        _schedule,
                                                    ...rest
                                                }) => rest,
                                            );
                                        }}
                                    />
                                </CardContent>
                            </Card>
                            {!locked && metadata.permissions.create && (
                                <Button
                                    type="button"
                                    size="lg"
                                    className="w-full"
                                    disabled={busy}
                                    onClick={() => void save()}
                                >
                                    <Save aria-hidden="true" />
                                    {busy
                                        ? 'Menyimpan registrasi…'
                                        : 'Simpan registrasi'}
                                </Button>
                            )}
                        </fieldset>
                    </div>
                </div>
            </div>
            {creatingPatient && patientMetadata.data && (
                <PageDialog
                    open
                    onOpenChange={(open) => {
                        if (!open && !patientBusy)
                            patientTransition.request(() =>
                                setCreatingPatient(false),
                            );
                    }}
                >
                    <PageDialogContent
                        ref={dialogRef}
                        title="Pasien"
                        busy={patientBusy}
                        onEscapeKeyDown={(event) => {
                            if (
                                patientBusy ||
                                dialogRef.current?.querySelector(
                                    '[role="combobox"][aria-expanded="true"]',
                                )
                            )
                                event.preventDefault();
                        }}
                    >
                        <PatientCard
                            patientId={null}
                            metadata={patientMetadata.data}
                            portalContainer={dialogRef}
                            onBusyChange={setPatientBusy}
                            onDirtyChange={setPatientDirty}
                            onCancelNew={() =>
                                patientTransition.request(() =>
                                    setCreatingPatient(false),
                                )
                            }
                            onCreated={(created) => {
                                setCreatingPatient(false);
                                setPatientDirty(false);
                                choosePatient(created.id);
                            }}
                            onUpdated={() => undefined}
                            onDeleted={() => setCreatingPatient(false)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
            {patientTransition.confirmation}
            {cancelling && visit && (
                <CancelVisitDialog
                    visit={visit}
                    onClose={() => setCancelling(false)}
                    onCancelled={(cancelled) => {
                        setCancelling(false);
                        queryClient.setQueryData(
                            orpc.healthcareVisitShow.queryKey({
                                input: { params: { id: cancelled.id } },
                            }),
                            {
                                status: 200,
                                headers: {},
                                body: { data: cancelled },
                            },
                        );
                        void queryClient.invalidateQueries({
                            queryKey: orpc.healthcareVisitMetadata.key(),
                        });
                        void queryClient.invalidateQueries({
                            queryKey: orpc.healthcareVisitList.key(),
                        });
                    }}
                />
            )}
        </div>
    );
}
