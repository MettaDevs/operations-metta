import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTableText } from '@operations-metta/ui/data-table';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { Select } from '@operations-metta/ui/select';
import { FlaskConical, Send } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { api } from '@core/platform/shell/index.ts';
import { DrugCard, type Drug } from '../../clinical/drug/drug-card.tsx';
import {
    ProcedureCard,
    type Procedure,
} from '../../clinical/procedure/procedure-card.tsx';
import { PractitionerCell } from './diagnosis-panels.tsx';
import {
    drugAllergyMessage,
    drugDuplicateMessage,
    procedureDuplicateMessage,
} from './medical-record.messages.ts';
import type {
    MedicalRecordDraft,
    MedicalRecordMetadata,
} from './medical-record-panels.tsx';

// Panel Biaya Tindakan dan E-Resep tab Rekam Medis poli sistem lama (rekammedis/Services.php dan Eresep), dalam urutan
// aslinya sesudah Prognosa, serta daftar alergi obat pasien di panel Riwayat penyakit dan alergi. Tarif tindakan dan stok
// obat belum ada sampai kasir dan farmasi dibangun.

type Draft = MedicalRecordDraft;
type SetDraft = (update: (draft: Draft) => Draft) => void;
type ProcedureRow = NonNullable<Draft['procedures']>[number];
type Prescription = NonNullable<Draft['prescriptions']>[number];
type PrescriptionLine = Prescription['lines'][number];
type DrugAllergy = NonNullable<Draft['drug_allergies']>[number];
type Errors = Record<string, string[]>;

const NOT_COMPOUND = 'none';
const compoundLabel = (compound: number | string) => `Racikan ${compound}`;
const drugLabel = (drug: { code: string | null; name: string }) =>
    drug.code ? `${drug.code} - ${drug.name}` : drug.name;
// Waktu dari API adalah ISO UTC; layar menampilkannya dalam waktu peramban.
const timeOf = (stamp: string | null | undefined) => {
    if (!stamp) return '';
    const date = new Date(stamp);
    return `${date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`;
};

function useDrugLoader(): LookupLoader<Drug> {
    return useCallback<LookupLoader<Drug>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcareDrugList(
                {
                    query: {
                        q: query,
                        prescribable: 'true',
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
}

// Pilihan obat dengan Baru, yang membuka kartu obat dan langsung memilih obat yang baru disimpan.
function DrugLookup({
    field,
    value,
    canCreate,
    error,
    onPick,
}: {
    field: string;
    value: { id: string; code: string | null; name: string } | null;
    canCreate: boolean;
    error: string | undefined;
    onPick: (drug: Drug) => void;
}): ReactNode {
    const loadDrugs = useDrugLoader();
    const [creating, setCreating] = useState(false);
    return (
        <FormControl error={error} data-error-field={field}>
            <InlineLookup<Drug>
                label="Nama Obat"
                required
                loadItems={loadDrugs}
                value={
                    value
                        ? {
                              id: value.id,
                              code: value.code ?? '',
                              name: value.name,
                              base_unit_id: '',
                              base_unit_name: '',
                              dosage_form_id: null,
                              dosage_form_name: null,
                              is_prescribable: true,
                              is_blocked: false,
                              version: 0,
                          }
                        : null
                }
                displayValue={value ? drugLabel(value) : ''}
                onValueChange={onPick}
                getItemValue={(drug) => drug.id}
                getItemLabel={drugLabel}
                placeholder="Cari kode atau nama…"
                emptyMessage={
                    canCreate
                        ? 'Obat tidak ditemukan. Pilih Baru untuk menambahkan.'
                        : 'Obat tidak ditemukan.'
                }
                popupClassName="w-[40rem]"
                showDetails={false}
                columns={[
                    {
                        id: 'code',
                        header: 'Kode',
                        width: 100,
                        cell: (drug) => drug.code,
                    },
                    {
                        id: 'name',
                        header: 'Nama',
                        width: 300,
                        cell: (drug) => drug.name,
                    },
                    {
                        id: 'unit',
                        header: 'Satuan',
                        width: 100,
                        cell: (drug) => drug.base_unit_name,
                    },
                ]}
                onCreate={canCreate ? () => setCreating(true) : undefined}
            />
            {creating && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setCreating(false);
                    }}
                >
                    <PageDialogContent title="Obat">
                        <DrugCard
                            drug={null}
                            permissions={{
                                create: true,
                                update: false,
                                delete: false,
                            }}
                            onSaved={(drug) => {
                                setCreating(false);
                                onPick(drug);
                            }}
                            onClose={() => setCreating(false)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </FormControl>
    );
}

// Alergi Obat Pasien sistem lama (RiwayatPenyakit.php): daftar obat yang ditolak di resep pasien ini.
export function DrugAllergyLines({
    rows,
    setDraft,
    canCreate,
    errors,
    disabled,
}: {
    rows: DrugAllergy[];
    setDraft: SetDraft;
    canCreate: boolean;
    errors: Errors;
    disabled: boolean;
}): ReactNode {
    const [selected, setSelected] = useState<number[]>([]);
    const lines = rows.map((row, index) => ({ index, row }));
    const field = (index: number) => `drug_allergies.${index}.drug_id`;
    const pick = (index: number, drug: Drug) => {
        if (
            rows.some(
                (row, position) =>
                    position !== index && row.drug_id === drug.id,
            )
        ) {
            toast.error(`${drug.name} sudah ada di daftar alergi obat.`);
            return;
        }
        setDraft((current) => ({
            ...current,
            drug_allergies: (current.drug_allergies ?? []).map(
                (row, position) =>
                    position === index
                        ? {
                              drug_id: drug.id,
                              drug_code: drug.code,
                              drug_name: drug.name,
                          }
                        : row,
            ),
        }));
    };
    return (
        <DocumentLines
            title="Alergi obat pasien"
            data={lines}
            getRowKey={(line) => line.index}
            getRowLabel={(line) =>
                line.row.drug_name || `Obat ${line.index + 1}`
            }
            showRowNumbers
            readOnly={disabled}
            disabled={disabled}
            selection={
                disabled
                    ? undefined
                    : {
                          selectedKeys: selected,
                          onSelectedKeysChange: (keys) =>
                              setSelected(keys.map(Number)),
                      }
            }
            onAddRow={() =>
                setDraft((current) => ({
                    ...current,
                    drug_allergies: [
                        ...(current.drug_allergies ?? []),
                        { drug_id: '', drug_code: null, drug_name: '' },
                    ],
                }))
            }
            onDeleteRows={(removed) =>
                setDraft((current) => ({
                    ...current,
                    drug_allergies: (current.drug_allergies ?? []).filter(
                        (_, position) =>
                            !removed.some((line) => line.index === position),
                    ),
                }))
            }
            emptyMessage={
                disabled
                    ? 'Belum ada alergi obat.'
                    : 'Belum ada alergi obat. Pilih Tambah untuk menambahkan obat.'
            }
            columns={[
                {
                    id: 'drug_id',
                    header: 'Nama Obat',
                    content: 'control',
                    minWidth: 320,
                    cell: ({ index, row }) => (
                        <DrugLookup
                            field={field(index)}
                            value={
                                row.drug_id
                                    ? {
                                          id: row.drug_id,
                                          code: row.drug_code,
                                          name: row.drug_name,
                                      }
                                    : null
                            }
                            canCreate={canCreate}
                            error={errors[field(index)]?.join(' ')}
                            onPick={(drug) => pick(index, drug)}
                        />
                    ),
                },
            ]}
        />
    );
}

function ProcedureLines({
    rows,
    setDraft,
    metadata,
    errors,
    disabled,
}: {
    rows: ProcedureRow[];
    setDraft: SetDraft;
    metadata: MedicalRecordMetadata;
    errors: Errors;
    disabled: boolean;
}): ReactNode {
    const [selected, setSelected] = useState<number[]>([]);
    const [creatingFor, setCreatingFor] = useState<number | null>(null);
    const error = (field: string) => errors[field]?.join(' ');
    const field = (index: number, name: keyof ProcedureRow) =>
        `procedures.${index}.${name}`;
    const lines = rows.map((row, index) => ({ index, row }));
    const change = (index: number, values: Partial<ProcedureRow>) =>
        setDraft((current) => ({
            ...current,
            procedures: (current.procedures ?? []).map((row, position) =>
                position === index ? { ...row, ...values } : row,
            ),
        }));
    const pick = (index: number, procedure: Procedure) => {
        if (
            rows.some(
                (row, position) =>
                    position !== index && row.procedure_id === procedure.id,
            )
        ) {
            toast.error(procedureDuplicateMessage(procedure.name));
            return;
        }
        change(index, {
            procedure_id: procedure.id,
            procedure_code: procedure.code,
            procedure_name: procedure.name,
        });
    };
    const loadProcedures = useCallback<LookupLoader<Procedure>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcareProcedureList(
                {
                    query: {
                        q: query,
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
    const canCreate = metadata.permissions.create_procedure;
    return (
        <>
            <DocumentLines
                title="Biaya Tindakan"
                data={lines}
                getRowKey={(line) => line.index}
                getRowLabel={(line) =>
                    line.row.procedure_name ?? `Tindakan ${line.index + 1}`
                }
                showRowNumbers
                readOnly={disabled}
                disabled={disabled}
                selection={
                    disabled
                        ? undefined
                        : {
                              selectedKeys: selected,
                              onSelectedKeysChange: (keys) =>
                                  setSelected(keys.map(Number)),
                          }
                }
                onAddRow={() =>
                    setDraft((current) => ({
                        ...current,
                        procedures: [
                            ...(current.procedures ?? []),
                            {
                                procedure_id: null,
                                procedure_code: null,
                                procedure_name: null,
                                quantity: 1,
                                doctor_id: current.anamnesis?.doctor_id ?? null,
                                added_by: null,
                                added_at: null,
                            },
                        ],
                    }))
                }
                onDeleteRows={(removed) =>
                    setDraft((current) => ({
                        ...current,
                        procedures: (current.procedures ?? []).filter(
                            (_, position) =>
                                !removed.some(
                                    (line) => line.index === position,
                                ),
                        ),
                    }))
                }
                emptyMessage={
                    disabled
                        ? 'Belum ada tindakan.'
                        : 'Belum ada tindakan. Pilih Tambah untuk menambahkan baris.'
                }
                columns={[
                    {
                        id: 'procedure_id',
                        header: 'Nama Tindakan',
                        content: 'control',
                        minWidth: 300,
                        cell: ({ index, row }) => {
                            const current: Procedure | null = row.procedure_id
                                ? {
                                      id: row.procedure_id,
                                      code: row.procedure_code ?? '',
                                      name: row.procedure_name ?? '',
                                      group_id: null,
                                      group_name: null,
                                      is_active: true,
                                      version: 0,
                                  }
                                : null;
                            return (
                                <FormControl
                                    error={error(field(index, 'procedure_id'))}
                                    data-error-field={field(
                                        index,
                                        'procedure_id',
                                    )}
                                >
                                    <InlineLookup
                                        label="Nama Tindakan"
                                        required
                                        loadItems={loadProcedures}
                                        value={current}
                                        displayValue={
                                            current
                                                ? `${current.code} - ${current.name}`
                                                : ''
                                        }
                                        onValueChange={(procedure) =>
                                            pick(index, procedure)
                                        }
                                        getItemValue={(procedure) =>
                                            procedure.id
                                        }
                                        getItemLabel={(procedure) =>
                                            `${procedure.code} - ${procedure.name}`
                                        }
                                        placeholder="Cari kode atau nama…"
                                        emptyMessage={
                                            canCreate
                                                ? 'Tindakan tidak ditemukan. Pilih Baru untuk menambahkan.'
                                                : 'Tindakan tidak ditemukan.'
                                        }
                                        popupClassName="w-[40rem]"
                                        showDetails={false}
                                        columns={[
                                            {
                                                id: 'code',
                                                header: 'Kode',
                                                width: 100,
                                                cell: (procedure) =>
                                                    procedure.code,
                                            },
                                            {
                                                id: 'name',
                                                header: 'Nama',
                                                width: 300,
                                                cell: (procedure) =>
                                                    procedure.name,
                                            },
                                            {
                                                id: 'group',
                                                header: 'Kelompok',
                                                width: 160,
                                                cell: (procedure) =>
                                                    procedure.group_name ?? '',
                                            },
                                        ]}
                                        onCreate={
                                            canCreate
                                                ? () => setCreatingFor(index)
                                                : undefined
                                        }
                                    />
                                </FormControl>
                            );
                        },
                    },
                    {
                        id: 'quantity',
                        header: 'Qty',
                        content: 'control',
                        minWidth: 90,
                        cell: ({ index, row }) => (
                            <FormControl
                                error={error(field(index, 'quantity'))}
                            >
                                <Input
                                    id={field(index, 'quantity')}
                                    data-error-field={field(index, 'quantity')}
                                    label="Qty"
                                    required
                                    type="number"
                                    min={1}
                                    step={1}
                                    inputMode="numeric"
                                    value={row.quantity ?? ''}
                                    onChange={(event) =>
                                        change(index, {
                                            quantity: event.target.value,
                                        })
                                    }
                                />
                            </FormControl>
                        ),
                    },
                    {
                        id: 'doctor_id',
                        header: 'Nama Dokter',
                        content: 'control',
                        minWidth: 220,
                        cell: ({ index, row }) => (
                            <PractitionerCell
                                field={field(index, 'doctor_id')}
                                label="Nama Dokter"
                                practitioners={metadata.practitioners}
                                fills={(item) => item.fills_medical_staff}
                                value={row.doctor_id}
                                error={error(field(index, 'doctor_id'))}
                                onChange={(id) =>
                                    change(index, { doctor_id: id })
                                }
                            />
                        ),
                    },
                    {
                        id: 'added',
                        header: 'User & Jam',
                        minWidth: 170,
                        cell: ({ row }) => (
                            <DataTableText>
                                {row.added_at
                                    ? `${row.added_by ?? ''} ${timeOf(row.added_at)}`
                                    : 'Belum disimpan'}
                            </DataTableText>
                        ),
                    },
                ]}
            />
            {creatingFor !== null && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setCreatingFor(null);
                    }}
                >
                    <PageDialogContent title="Tindakan">
                        <ProcedureCard
                            procedure={null}
                            permissions={{
                                create: true,
                                update: false,
                                delete: false,
                            }}
                            onSaved={(procedure) => {
                                pick(creatingFor, procedure);
                                setCreatingFor(null);
                            }}
                            onClose={() => setCreatingFor(null)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

const emptyPrescription: Prescription = {
    id: null,
    number: null,
    status: 'draf',
    sent_at: null,
    doctor_name: null,
    nurse_name: null,
    notes: null,
    lines: [],
};

const statusLabel = {
    draf: 'Draf',
    dikirim: 'Dikirim ke farmasi',
    dibatalkan: 'Dibatalkan',
} as const satisfies Record<Prescription['status'], string>;

function PrescriptionFacts({
    prescription,
}: {
    prescription: Prescription;
}): ReactNode {
    return (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
            <div>
                <dt className="text-xs text-muted-foreground">No Resep</dt>
                <dd>
                    {prescription.number ?? 'Diberi saat dikirim ke farmasi'}
                </dd>
            </div>
            <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd>
                    <Badge
                        variant={
                            prescription.status === 'draf'
                                ? 'outline'
                                : 'secondary'
                        }
                    >
                        {prescription.dispensed_at
                            ? 'Diserahkan farmasi'
                            : statusLabel[prescription.status]}
                    </Badge>
                </dd>
            </div>
            {prescription.sent_at && (
                <div>
                    <dt className="text-xs text-muted-foreground">Dikirim</dt>
                    <dd>{timeOf(prescription.sent_at)}</dd>
                </div>
            )}
            {prescription.dispensed_at && (
                <div>
                    <dt className="text-xs text-muted-foreground">
                        Diserahkan
                    </dt>
                    <dd>
                        {timeOf(prescription.dispensed_at)}
                        {prescription.dispensing_number
                            ? ` · ${prescription.dispensing_number}`
                            : ''}
                    </dd>
                </div>
            )}
            {prescription.status !== 'draf' && (
                <div>
                    <dt className="text-xs text-muted-foreground">
                        Dokter / Tenaga Medis
                    </dt>
                    <dd>{prescription.doctor_name ?? '—'}</dd>
                </div>
            )}
        </dl>
    );
}

// Satu resep. Draf diubah di tempat dan ikut Simpan halaman; resep yang sudah dikirim hanya dibaca.
function PrescriptionLines({
    prescription,
    position,
    setDraft,
    metadata,
    allergies,
    errors,
    disabled,
    onSend,
}: {
    prescription: Prescription;
    position: number | null;
    setDraft: SetDraft;
    metadata: MedicalRecordMetadata;
    allergies: ReadonlySet<string>;
    errors: Errors;
    disabled: boolean;
    onSend: (position: number) => void;
}): ReactNode {
    const [selected, setSelected] = useState<number[]>([]);
    const readOnly = disabled || prescription.status !== 'draf';
    const index = position ?? 0;
    const prefix = `prescriptions.${index}`;
    const error = (field: string) => errors[field]?.join(' ');
    const field = (line: number, name: keyof PrescriptionLine) =>
        `${prefix}.lines.${line}.${name}`;
    const rows = prescription.lines;
    const lines = rows.map((row, line) => ({ index: line, row }));
    const compounds = rows
        .filter((row) => !row.drug_id && row.compound !== null)
        .map((row) => Number(row.compound));
    // Draf yang belum ada di isi rekam medis lahir saat baris pertamanya ditambahkan, seperti form resep sistem lama
    // yang langsung terbuka bila kunjungan belum punya resep.
    const update = (next: (current: Prescription) => Prescription) =>
        setDraft((current) => {
            const list = current.prescriptions ?? [];
            return {
                ...current,
                prescriptions:
                    position === null
                        ? [...list, next(emptyPrescription)]
                        : list.map((row, at) =>
                              at === position ? next(row) : row,
                          ),
            };
        });
    const setLines = (
        next: (lines: PrescriptionLine[]) => PrescriptionLine[],
    ) => update((current) => ({ ...current, lines: next(current.lines) }));
    const change = (line: number, values: Partial<PrescriptionLine>) =>
        setLines((current) =>
            current.map((row, at) =>
                at === line ? { ...row, ...values } : row,
            ),
        );
    const blankLine: PrescriptionLine = {
        drug_id: null,
        drug_code: null,
        drug_name: null,
        unit_name: null,
        compound: null,
        quantity: 1,
        requested_quantity: null,
        signa: null,
        usage_instruction_id: null,
        notes: null,
    };
    const pick = (line: number, drug: Drug) => {
        if (allergies.has(drug.id)) {
            toast.error(drugAllergyMessage(drug.name));
            return;
        }
        if (rows.some((row, at) => at !== line && row.drug_id === drug.id)) {
            toast.error(drugDuplicateMessage(drug.name));
            return;
        }
        change(line, {
            drug_id: drug.id,
            drug_code: drug.code,
            drug_name: drug.name,
            unit_name: drug.base_unit_name,
        });
    };
    // Komponen dipindah ke bawah racikannya, seperti baris komponen yang menjorok di bawah "Racikan N" sistem lama.
    const assign = (line: number, compound: number | null) =>
        setLines((current) => {
            const row = current[line];
            if (!row) return current;
            const moved: PrescriptionLine =
                compound === null
                    ? { ...row, compound }
                    : {
                          ...row,
                          compound,
                          signa: null,
                          usage_instruction_id: null,
                      };
            const rest = current.filter((_, at) => at !== line);
            if (compound === null) return [...rest, moved];
            const last = rest.reduce(
                (found, row, at) =>
                    Number(row.compound) === compound ? at : found,
                -1,
            );
            return [...rest.slice(0, last + 1), moved, ...rest.slice(last + 1)];
        });
    const usage = metadata.usage_instructions;
    const isHeader = (row: PrescriptionLine) =>
        !row.drug_id && row.compound !== null;
    const isComponent = (row: PrescriptionLine) =>
        Boolean(row.drug_id) && row.compound !== null;

    return (
        <div className="space-y-3" data-error-field={`${prefix}.id`}>
            <PrescriptionFacts prescription={prescription} />
            <DocumentLines
                title={
                    prescription.number
                        ? `Resep ${prescription.number}`
                        : 'Resep'
                }
                data={lines}
                getRowKey={(line) => line.index}
                getRowLabel={(line) =>
                    isHeader(line.row)
                        ? compoundLabel(line.row.compound ?? '')
                        : (line.row.drug_name ?? `Obat ${line.index + 1}`)
                }
                showRowNumbers
                readOnly={readOnly}
                disabled={readOnly}
                selection={
                    readOnly
                        ? undefined
                        : {
                              selectedKeys: selected,
                              onSelectedKeysChange: (keys) =>
                                  setSelected(keys.map(Number)),
                          }
                }
                toolbar={
                    readOnly ? undefined : (
                        <>
                            <Button
                                type="button"
                                variant="ghost"
                                size="command"
                                onClick={() =>
                                    setLines((current) => [
                                        ...current,
                                        {
                                            ...blankLine,
                                            quantity: null,
                                            compound:
                                                Math.max(0, ...compounds) + 1,
                                        },
                                    ])
                                }
                            >
                                <FlaskConical aria-hidden="true" />
                                Tambah racikan
                            </Button>
                            {position !== null && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="command"
                                    onClick={() => onSend(position)}
                                >
                                    <Send aria-hidden="true" />
                                    Kirim ke farmasi
                                </Button>
                            )}
                        </>
                    )
                }
                onAddRow={() => setLines((current) => [...current, blankLine])}
                onDeleteRows={(removed) => {
                    // Racikan dihapus beserta komponennya, seperti "Hapus racikan ... beserta komponennya?".
                    const gone = new Set(
                        removed
                            .filter((line) => isHeader(line.row))
                            .map((line) => Number(line.row.compound)),
                    );
                    setLines((current) =>
                        current.filter(
                            (row, at) =>
                                !removed.some((line) => line.index === at) &&
                                !(
                                    row.compound !== null &&
                                    gone.has(Number(row.compound))
                                ),
                        ),
                    );
                }}
                emptyMessage={
                    readOnly
                        ? 'Resep ini tidak berisi obat.'
                        : 'Belum ada obat. Pilih Tambah untuk menambahkan obat, atau Tambah racikan.'
                }
                columns={[
                    {
                        id: 'compound',
                        header: 'Racikan',
                        content: readOnly ? 'text' : 'control',
                        minWidth: 140,
                        cell: ({ index: line, row }) =>
                            readOnly || isHeader(row) ? (
                                <DataTableText>
                                    {row.compound !== null
                                        ? compoundLabel(row.compound)
                                        : '—'}
                                </DataTableText>
                            ) : (
                                <FormControl
                                    error={error(field(line, 'compound'))}
                                >
                                    <Select
                                        label="Racikan"
                                        data-error-field={field(
                                            line,
                                            'compound',
                                        )}
                                        items={[
                                            {
                                                value: NOT_COMPOUND,
                                                label: 'Bukan racikan',
                                            },
                                            ...compounds.map((compound) => ({
                                                value: String(compound),
                                                label: compoundLabel(compound),
                                            })),
                                        ]}
                                        value={
                                            row.compound === null
                                                ? NOT_COMPOUND
                                                : String(row.compound)
                                        }
                                        onValueChange={(value) =>
                                            assign(
                                                line,
                                                value === NOT_COMPOUND
                                                    ? null
                                                    : Number(value),
                                            )
                                        }
                                    />
                                </FormControl>
                            ),
                    },
                    {
                        id: 'drug_id',
                        header: 'Nama',
                        content: readOnly ? 'text' : 'control',
                        minWidth: 300,
                        cell: ({ index: line, row }) =>
                            isHeader(row) ? (
                                <DataTableText>
                                    {compoundLabel(row.compound ?? '')}
                                </DataTableText>
                            ) : readOnly ? (
                                <DataTableText>
                                    {`${isComponent(row) ? '↳ ' : ''}${row.drug_name ?? ''}`}
                                </DataTableText>
                            ) : (
                                <DrugLookup
                                    field={field(line, 'drug_id')}
                                    value={
                                        row.drug_id
                                            ? {
                                                  id: row.drug_id,
                                                  code: row.drug_code,
                                                  name: row.drug_name ?? '',
                                              }
                                            : null
                                    }
                                    canCreate={metadata.permissions.create_drug}
                                    error={error(field(line, 'drug_id'))}
                                    onPick={(drug) => pick(line, drug)}
                                />
                            ),
                    },
                    {
                        id: 'unit',
                        header: 'Satuan',
                        minWidth: 90,
                        cell: ({ row }) => (
                            <DataTableText>
                                {isHeader(row)
                                    ? 'Racikan'
                                    : (row.unit_name ?? '')}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'signa',
                        header: 'Signa',
                        content: readOnly ? 'text' : 'control',
                        minWidth: 120,
                        cell: ({ index: line, row }) =>
                            readOnly || isComponent(row) ? (
                                <DataTableText>{row.signa ?? ''}</DataTableText>
                            ) : (
                                <FormControl
                                    error={error(field(line, 'signa'))}
                                >
                                    <Input
                                        id={field(line, 'signa')}
                                        data-error-field={field(line, 'signa')}
                                        label="Signa"
                                        maxLength={100}
                                        value={row.signa ?? ''}
                                        onChange={(event) =>
                                            change(line, {
                                                signa:
                                                    event.target.value || null,
                                            })
                                        }
                                    />
                                </FormControl>
                            ),
                    },
                    {
                        id: 'usage_instruction_id',
                        header: 'Aturan Pakai',
                        content: readOnly ? 'text' : 'control',
                        minWidth: 170,
                        cell: ({ index: line, row }) => {
                            const current =
                                usage.find(
                                    (item) =>
                                        item.id === row.usage_instruction_id,
                                ) ?? null;
                            return readOnly || isComponent(row) ? (
                                <DataTableText>
                                    {current?.name ?? ''}
                                </DataTableText>
                            ) : (
                                <FormControl
                                    error={error(
                                        field(line, 'usage_instruction_id'),
                                    )}
                                    data-error-field={field(
                                        line,
                                        'usage_instruction_id',
                                    )}
                                >
                                    <InlineLookup
                                        label="Aturan Pakai"
                                        items={usage.filter(
                                            (item) =>
                                                item.active ||
                                                item.id ===
                                                    row.usage_instruction_id,
                                        )}
                                        value={current}
                                        displayValue={current?.name ?? ''}
                                        onValueChange={(item) =>
                                            change(line, {
                                                usage_instruction_id: item.id,
                                            })
                                        }
                                        getItemValue={(item) => item.id}
                                        getItemLabel={(item) => item.name}
                                        emptyMessage="Aturan pakai tidak ditemukan."
                                        showDetails={false}
                                        showFullList={false}
                                        columns={[
                                            {
                                                id: 'name',
                                                header: 'Nama',
                                                width: 180,
                                                cell: (item) => item.name,
                                            },
                                        ]}
                                    />
                                </FormControl>
                            );
                        },
                    },
                    {
                        id: 'requested_quantity',
                        header: 'Jumlah Permintaan',
                        content: readOnly ? 'text' : 'control',
                        minWidth: 110,
                        cell: ({ index: line, row }) =>
                            readOnly || !isHeader(row) ? (
                                <DataTableText>
                                    {row.requested_quantity ?? ''}
                                </DataTableText>
                            ) : (
                                <FormControl
                                    error={error(
                                        field(line, 'requested_quantity'),
                                    )}
                                >
                                    <Input
                                        id={field(line, 'requested_quantity')}
                                        data-error-field={field(
                                            line,
                                            'requested_quantity',
                                        )}
                                        label="Jumlah Permintaan"
                                        type="number"
                                        min={0}
                                        step={0.01}
                                        inputMode="decimal"
                                        value={row.requested_quantity ?? ''}
                                        onChange={(event) =>
                                            change(line, {
                                                requested_quantity:
                                                    event.target.value || null,
                                            })
                                        }
                                    />
                                </FormControl>
                            ),
                    },
                    {
                        id: 'quantity',
                        header: 'Qty',
                        content: readOnly ? 'text' : 'control',
                        minWidth: 90,
                        cell: ({ index: line, row }) =>
                            readOnly || isHeader(row) ? (
                                <DataTableText>
                                    {row.quantity ?? ''}
                                </DataTableText>
                            ) : (
                                <FormControl
                                    error={error(field(line, 'quantity'))}
                                >
                                    <Input
                                        id={field(line, 'quantity')}
                                        data-error-field={field(
                                            line,
                                            'quantity',
                                        )}
                                        label="Qty"
                                        required
                                        type="number"
                                        min={0}
                                        step={0.01}
                                        inputMode="decimal"
                                        value={row.quantity ?? ''}
                                        onChange={(event) =>
                                            change(line, {
                                                quantity:
                                                    event.target.value || null,
                                            })
                                        }
                                    />
                                </FormControl>
                            ),
                    },
                    ...(prescription.dispensed_at
                        ? [
                              {
                                  id: 'dispensed_quantity',
                                  header: 'Diserahkan',
                                  minWidth: 150,
                                  cell: ({
                                      row,
                                  }: {
                                      row: PrescriptionLine;
                                  }) => (
                                      <DataTableText>
                                          {isHeader(row)
                                              ? ''
                                              : `${String(row.dispensed_quantity ?? 0)}${
                                                    row.returned_quantity
                                                        ? ` (${String(row.returned_quantity)} dikembalikan)`
                                                        : ''
                                                }`}
                                      </DataTableText>
                                  ),
                              },
                          ]
                        : []),
                    {
                        id: 'notes',
                        header: 'Keterangan',
                        content: readOnly ? 'text' : 'control',
                        minWidth: 160,
                        cell: ({ index: line, row }) =>
                            readOnly ? (
                                <DataTableText>{row.notes ?? ''}</DataTableText>
                            ) : (
                                <FormControl
                                    error={error(field(line, 'notes'))}
                                >
                                    <Input
                                        id={field(line, 'notes')}
                                        data-error-field={field(line, 'notes')}
                                        label="Keterangan"
                                        maxLength={500}
                                        value={row.notes ?? ''}
                                        onChange={(event) =>
                                            change(line, {
                                                notes:
                                                    event.target.value || null,
                                            })
                                        }
                                    />
                                </FormControl>
                            ),
                    },
                ]}
            />
            {!readOnly && (
                <FormControl error={error(`${prefix}.notes`)}>
                    <Input
                        id={`${prefix}.notes`}
                        data-error-field={`${prefix}.notes`}
                        label="Catatan resep"
                        maxLength={500}
                        value={prescription.notes ?? ''}
                        onChange={(event) =>
                            update((current) => ({
                                ...current,
                                notes: event.target.value || null,
                            }))
                        }
                    />
                </FormControl>
            )}
            {readOnly && prescription.notes && (
                <p className="text-sm">
                    <span className="text-muted-foreground">
                        Catatan resep:{' '}
                    </span>
                    {prescription.notes}
                </p>
            )}
        </div>
    );
}

export function OrderPanels({
    draft,
    setDraft,
    metadata,
    errors,
    disabled,
    onSend,
}: {
    draft: Draft;
    setDraft: SetDraft;
    metadata: MedicalRecordMetadata;
    errors: Errors;
    disabled: boolean;
    onSend: (position: number) => void;
}): ReactNode {
    const { procedures, prescriptions } = draft;
    const allergies = new Set(
        (draft.drug_allergies ?? []).map((row) => row.drug_id),
    );
    const open = prescriptions?.findIndex((row) => row.status === 'draf') ?? -1;
    return (
        <CollapsibleSectionGroup defaultValue={['procedures', 'prescriptions']}>
            {procedures && (
                <CollapsibleSection
                    value="procedures"
                    title="Biaya Tindakan"
                    keepMounted
                >
                    <ProcedureLines
                        rows={procedures}
                        setDraft={setDraft}
                        metadata={metadata}
                        errors={errors}
                        disabled={disabled}
                    />
                </CollapsibleSection>
            )}
            {prescriptions && (
                <CollapsibleSection
                    value="prescriptions"
                    title="E-Resep"
                    keepMounted
                >
                    <div className="space-y-6" data-error-field="prescription">
                        {errors.prescription && (
                            <p
                                role="alert"
                                className="text-sm text-destructive"
                            >
                                {errors.prescription.join(' ')}
                            </p>
                        )}
                        {prescriptions.map((prescription, position) => (
                            <PrescriptionLines
                                key={prescription.id ?? `draf-${position}`}
                                prescription={prescription}
                                position={position}
                                setDraft={setDraft}
                                metadata={metadata}
                                allergies={allergies}
                                errors={errors}
                                disabled={disabled}
                                onSend={onSend}
                            />
                        ))}
                        {open === -1 && !disabled && (
                            <PrescriptionLines
                                prescription={emptyPrescription}
                                position={null}
                                setDraft={setDraft}
                                metadata={metadata}
                                allergies={allergies}
                                errors={errors}
                                disabled={disabled}
                                onSend={onSend}
                            />
                        )}
                        {prescriptions.length === 0 && disabled && (
                            <p className="text-sm text-muted-foreground">
                                Belum ada resep.
                            </p>
                        )}
                    </div>
                </CollapsibleSection>
            )}
        </CollapsibleSectionGroup>
    );
}
