import { Checkbox } from '@operations-metta/ui/checkbox';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import {
    Field,
    FieldLabel,
    FieldLegend,
    FieldSet,
} from '@operations-metta/ui/field';
import { FormControl } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { api, type ApiBody } from '@core/platform/shell/index.ts';
import { Icd10Card, type Icd10 } from '../../clinical/icd10/icd10-card.tsx';
import type {
    MedicalRecordDraft,
    MedicalRecordMetadata,
} from './medical-record-panels.tsx';

// Panel Riwayat Diagnosa, Diagnosa, dan Prognosa tab Rekam Medis poli sistem lama (rekammedis/Diagnosa.php), dalam
// urutan aslinya sesudah Lainnya. Baris diagnosa: Dokter / Tenaga Medis, Perawat / Bidan / Nutrisionist /
// Sanitarian, ICD-X, Jenis, Kasus, dan Posisi Gigi bila section memakai Pemeriksaan dasar gigi. Setiap panel tampil
// bila isi rekam medis memuatnya.

type Diagnosis = NonNullable<MedicalRecordDraft['diagnoses']>[number];
type Line = { index: number; row: Diagnosis };
type Reference = MedicalRecordMetadata['prognoses'][number];
type Practitioner = MedicalRecordMetadata['practitioners'][number];
type History = ApiBody<'healthcareDiagnosisHistory'>['data'][number];

const offered = (rows: Reference[], current: string | null) =>
    rows.filter((row) => row.active || row.id === current);

function ReferenceCell({
    field,
    label,
    rows,
    value,
    error,
    onChange,
}: {
    field: string;
    label: string;
    rows: Reference[];
    value: string | null;
    error: string | undefined;
    onChange: (id: string) => void;
}): ReactNode {
    const current = rows.find((row) => row.id === value) ?? null;
    return (
        <FormControl error={error} data-error-field={field}>
            <InlineLookup
                label={label}
                required
                items={offered(rows, value)}
                value={current}
                displayValue={current?.name ?? ''}
                onValueChange={(row) => onChange(row.id)}
                getItemValue={(row) => row.id}
                getItemLabel={(row) => row.name}
                emptyMessage={`${label} tidak ditemukan.`}
                showDetails={false}
                showFullList={false}
                columns={[
                    {
                        id: 'name',
                        header: 'Nama',
                        width: 160,
                        cell: (row) => row.name,
                    },
                ]}
            />
        </FormControl>
    );
}

export function PractitionerCell({
    field,
    label,
    practitioners,
    fills,
    value,
    error,
    onChange,
}: {
    field: string;
    label: string;
    practitioners: Practitioner[];
    fills: (practitioner: Practitioner) => boolean;
    value: string | null;
    error: string | undefined;
    onChange: (id: string) => void;
}): ReactNode {
    const current = practitioners.find((row) => row.id === value) ?? null;
    return (
        <FormControl error={error} data-error-field={field}>
            <InlineLookup
                label={label}
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

function DiagnosisHistory({
    destinationId,
}: {
    destinationId: string;
}): ReactNode {
    const loader = useCallback<ListLoader<History>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.healthcareDiagnosisHistory(
                {
                    params: { id: destinationId },
                    query: {
                        q: query,
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [destinationId],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: '',
        getKey: (row) => row.id,
    });
    return (
        <DataTable
            data={list.items}
            getRowKey={(row) => row.id}
            getRowLabel={(row) => `${row.date} ${row.icd10_code}`}
            showRowNumbers
            scrollMode="inline"
            sort={list.sort}
            onSortChange={list.onSortChange}
            serverSort
            incremental={list}
            emptyMessage="Belum ada diagnosa dari kunjungan lain pasien ini."
            columns={[
                {
                    id: 'date',
                    header: 'Tanggal',
                    width: 110,
                    cell: (row) => (
                        <DataTableText>{displayDate(row.date)}</DataTableText>
                    ),
                    sortValue: (row) => row.date,
                },
                {
                    id: 'doctor',
                    header: 'Dokter / Tenaga Medis',
                    width: 200,
                    cell: (row) => (
                        <DataTableText>{row.doctor_name ?? '—'}</DataTableText>
                    ),
                },
                {
                    id: 'nurse',
                    header: 'Perawat / Bidan / Nutrisionist / Sanitarian',
                    width: 200,
                    cell: (row) => (
                        <DataTableText>{row.nurse_name ?? '—'}</DataTableText>
                    ),
                },
                {
                    id: 'icd10_code',
                    header: 'ICD-X',
                    width: 280,
                    cell: (row) => (
                        <DataTableText>
                            {`${row.icd10_code} - ${row.icd10_name}`}
                        </DataTableText>
                    ),
                    sortValue: (row) => row.icd10_code,
                },
                {
                    id: 'type',
                    header: 'Jenis',
                    width: 110,
                    cell: (row) => (
                        <DataTableText>{row.type_name}</DataTableText>
                    ),
                },
                {
                    id: 'case',
                    header: 'Kasus',
                    width: 90,
                    cell: (row) => (
                        <DataTableText>{row.case_name}</DataTableText>
                    ),
                },
            ]}
        />
    );
}

export function DiagnosisPanels({
    destinationId,
    draft,
    setDraft,
    metadata,
    errors,
    disabled,
}: {
    destinationId: string;
    draft: MedicalRecordDraft;
    setDraft: (
        update: (draft: MedicalRecordDraft) => MedicalRecordDraft,
    ) => void;
    metadata: MedicalRecordMetadata;
    errors: Record<string, string[]>;
    disabled: boolean;
}): ReactNode {
    const [selected, setSelected] = useState<number[]>([]);
    const [creatingFor, setCreatingFor] = useState<number | null>(null);
    const error = (field: string) => errors[field]?.join(' ');
    const diagnoses = draft.diagnoses;
    const usesDental = draft.dental !== undefined;
    const lines: Line[] = (diagnoses ?? []).map((row, index) => ({
        index,
        row,
    }));
    const change = (index: number, values: Partial<Diagnosis>) =>
        setDraft((current) => ({
            ...current,
            diagnoses: (current.diagnoses ?? []).map((row, position) =>
                position === index ? { ...row, ...values } : row,
            ),
        }));
    const pickIcd10 = (index: number, icd10: Icd10) =>
        change(index, {
            icd10_id: icd10.id,
            icd10_code: icd10.code,
            icd10_name: icd10.name,
        });
    const loadIcd10 = useCallback<LookupLoader<Icd10>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcareIcd10List(
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
    const field = (index: number, name: keyof Diagnosis) =>
        `diagnoses.${index}.${name}`;
    const chronicDiseaseIds = draft.chronic_disease_ids;
    const chronic = new Set(chronicDiseaseIds);
    const prognosisId = draft.prognosis_id ?? null;
    const prognosis =
        metadata.prognoses.find((row) => row.id === prognosisId) ?? null;

    return (
        <CollapsibleSectionGroup defaultValue={['diagnoses', 'prognosis']}>
            {diagnoses && (
                <CollapsibleSection value="history" title="Riwayat Diagnosa">
                    <DiagnosisHistory destinationId={destinationId} />
                </CollapsibleSection>
            )}

            {diagnoses && (
                <CollapsibleSection
                    value="diagnoses"
                    title="Diagnosa"
                    keepMounted
                >
                    <DocumentLines
                        title="Diagnosa"
                        data={lines}
                        getRowKey={(line) => line.index}
                        getRowLabel={(line) =>
                            line.row.icd10_code
                                ? `${line.row.icd10_code} ${line.row.icd10_name ?? ''}`
                                : `Diagnosa ${line.index + 1}`
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
                                diagnoses: [
                                    ...(current.diagnoses ?? []),
                                    {
                                        icd10_id: null,
                                        icd10_code: null,
                                        icd10_name: null,
                                        type_id: null,
                                        case_id: null,
                                        doctor_id:
                                            current.anamnesis?.doctor_id ??
                                            null,
                                        nurse_id:
                                            current.anamnesis?.nurse_id ?? null,
                                        ...(usesDental
                                            ? { tooth_position: null }
                                            : {}),
                                    },
                                ],
                            }))
                        }
                        onDeleteRows={(removed) =>
                            setDraft((current) => ({
                                ...current,
                                diagnoses: (current.diagnoses ?? []).filter(
                                    (_, position) =>
                                        !removed.some(
                                            (line) => line.index === position,
                                        ),
                                ),
                            }))
                        }
                        emptyMessage={
                            disabled
                                ? 'Belum ada diagnosa.'
                                : 'Belum ada diagnosa. Pilih Tambah untuk menambahkan baris.'
                        }
                        columns={[
                            {
                                id: 'doctor_id',
                                header: 'Dokter / Tenaga Medis',
                                content: 'control',
                                minWidth: 200,
                                cell: ({ index, row }) => (
                                    <PractitionerCell
                                        field={field(index, 'doctor_id')}
                                        label="Dokter / Tenaga Medis"
                                        practitioners={metadata.practitioners}
                                        fills={(item) =>
                                            item.fills_medical_staff
                                        }
                                        value={row.doctor_id}
                                        error={error(field(index, 'doctor_id'))}
                                        onChange={(id) =>
                                            change(index, { doctor_id: id })
                                        }
                                    />
                                ),
                            },
                            {
                                id: 'nurse_id',
                                header: 'Perawat / Bidan / Nutrisionist / Sanitarian',
                                content: 'control',
                                minWidth: 200,
                                cell: ({ index, row }) => (
                                    <PractitionerCell
                                        field={field(index, 'nurse_id')}
                                        label="Perawat / Bidan / Nutrisionist / Sanitarian"
                                        practitioners={metadata.practitioners}
                                        fills={(item) => item.fills_nurse}
                                        value={row.nurse_id}
                                        error={error(field(index, 'nurse_id'))}
                                        onChange={(id) =>
                                            change(index, { nurse_id: id })
                                        }
                                    />
                                ),
                            },
                            {
                                id: 'icd10_id',
                                header: 'ICD-X',
                                content: 'control',
                                minWidth: 260,
                                cell: ({ index, row }) => {
                                    const current: Icd10 | null = row.icd10_id
                                        ? {
                                              id: row.icd10_id,
                                              code: row.icd10_code ?? '',
                                              name: row.icd10_name ?? '',
                                              is_active: true,
                                              version: 0,
                                          }
                                        : null;
                                    return (
                                        <FormControl
                                            error={error(
                                                field(index, 'icd10_id'),
                                            )}
                                            data-error-field={field(
                                                index,
                                                'icd10_id',
                                            )}
                                        >
                                            <InlineLookup
                                                label="ICD-X"
                                                required
                                                loadItems={loadIcd10}
                                                value={current}
                                                displayValue={
                                                    current
                                                        ? `${current.code} - ${current.name}`
                                                        : ''
                                                }
                                                onValueChange={(icd10) =>
                                                    pickIcd10(index, icd10)
                                                }
                                                getItemValue={(icd10) =>
                                                    icd10.id
                                                }
                                                getItemLabel={(icd10) =>
                                                    `${icd10.code} - ${icd10.name}`
                                                }
                                                placeholder="Cari kode atau nama…"
                                                emptyMessage={
                                                    metadata.permissions
                                                        .create_icd10
                                                        ? 'Kode ICD-10 tidak ditemukan. Pilih Baru untuk menambahkan.'
                                                        : 'Kode ICD-10 tidak ditemukan.'
                                                }
                                                popupClassName="w-[36rem]"
                                                showDetails={false}
                                                columns={[
                                                    {
                                                        id: 'code',
                                                        header: 'Kode',
                                                        width: 90,
                                                        cell: (icd10) =>
                                                            icd10.code,
                                                    },
                                                    {
                                                        id: 'name',
                                                        header: 'Nama',
                                                        width: 360,
                                                        cell: (icd10) =>
                                                            icd10.name,
                                                    },
                                                ]}
                                                onCreate={
                                                    metadata.permissions
                                                        .create_icd10
                                                        ? () =>
                                                              setCreatingFor(
                                                                  index,
                                                              )
                                                        : undefined
                                                }
                                            />
                                        </FormControl>
                                    );
                                },
                            },
                            {
                                id: 'type_id',
                                header: 'Jenis',
                                content: 'control',
                                minWidth: 140,
                                cell: ({ index, row }) => (
                                    <ReferenceCell
                                        field={field(index, 'type_id')}
                                        label="Jenis"
                                        rows={metadata.diagnosis_types}
                                        value={row.type_id}
                                        error={error(field(index, 'type_id'))}
                                        onChange={(id) =>
                                            change(index, { type_id: id })
                                        }
                                    />
                                ),
                            },
                            {
                                id: 'case_id',
                                header: 'Kasus',
                                content: 'control',
                                minWidth: 120,
                                cell: ({ index, row }) => (
                                    <ReferenceCell
                                        field={field(index, 'case_id')}
                                        label="Kasus"
                                        rows={metadata.diagnosis_cases}
                                        value={row.case_id}
                                        error={error(field(index, 'case_id'))}
                                        onChange={(id) =>
                                            change(index, { case_id: id })
                                        }
                                    />
                                ),
                            },
                            ...(usesDental
                                ? [
                                      {
                                          id: 'tooth_position',
                                          header: 'Posisi Gigi',
                                          content: 'control' as const,
                                          minWidth: 120,
                                          cell: ({ index, row }: Line) => (
                                              <FormControl
                                                  error={error(
                                                      field(
                                                          index,
                                                          'tooth_position',
                                                      ),
                                                  )}
                                              >
                                                  <Input
                                                      id={field(
                                                          index,
                                                          'tooth_position',
                                                      )}
                                                      label="Posisi Gigi"
                                                      maxLength={50}
                                                      value={
                                                          row.tooth_position ??
                                                          ''
                                                      }
                                                      onChange={(event) =>
                                                          change(index, {
                                                              tooth_position:
                                                                  event.target
                                                                      .value ||
                                                                  null,
                                                          })
                                                      }
                                                  />
                                              </FormControl>
                                          ),
                                      },
                                  ]
                                : []),
                        ]}
                    />
                    {creatingFor !== null && (
                        <PageDialog
                            open
                            onOpenChange={(next) => {
                                if (!next) setCreatingFor(null);
                            }}
                        >
                            <PageDialogContent title="ICD-10">
                                <Icd10Card
                                    icd10={null}
                                    permissions={{
                                        create: true,
                                        update: false,
                                        delete: false,
                                    }}
                                    onSaved={(icd10) => {
                                        pickIcd10(creatingFor, icd10);
                                        setCreatingFor(null);
                                    }}
                                    onClose={() => setCreatingFor(null)}
                                />
                            </PageDialogContent>
                        </PageDialog>
                    )}
                </CollapsibleSection>
            )}

            {chronicDiseaseIds && (
                <CollapsibleSection
                    value="prognosis"
                    title="Prognosa"
                    keepMounted
                >
                    <div className="grid items-start gap-x-6 gap-y-4 md:grid-cols-2">
                        <FormControl
                            error={error('prognosis_id')}
                            data-error-field="prognosis_id"
                        >
                            <InlineLookup
                                label="Prognosa"
                                items={offered(metadata.prognoses, prognosisId)}
                                value={prognosis}
                                displayValue={prognosis?.name ?? ''}
                                onValueChange={(row) =>
                                    setDraft((current) => ({
                                        ...current,
                                        prognosis_id: row.id,
                                    }))
                                }
                                getItemValue={(row) => row.id}
                                getItemLabel={(row) => row.name}
                                emptyMessage="Prognosa tidak ditemukan."
                                popupClassName="w-[32rem]"
                                showDetails={false}
                                showFullList={false}
                                columns={[
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        width: 440,
                                        cell: (row) => row.name,
                                    },
                                ]}
                            />
                        </FormControl>
                        <FieldSet>
                            <FieldLegend variant="label">
                                Tandai Penyakit Kronis
                            </FieldLegend>
                            <div className="gap-x-6 sm:columns-2">
                                {metadata.chronic_diseases
                                    .filter(
                                        (row) =>
                                            row.active || chronic.has(row.id),
                                    )
                                    .map((row) => (
                                        <Field
                                            key={row.id}
                                            orientation="horizontal"
                                            className="mb-2 w-auto break-inside-avoid"
                                        >
                                            <Checkbox
                                                id={`chronic-${row.id}`}
                                                checked={chronic.has(row.id)}
                                                onCheckedChange={(checked) =>
                                                    setDraft((current) => ({
                                                        ...current,
                                                        chronic_disease_ids:
                                                            checked === true
                                                                ? [
                                                                      ...(current.chronic_disease_ids ??
                                                                          []),
                                                                      row.id,
                                                                  ]
                                                                : (
                                                                      current.chronic_disease_ids ??
                                                                      []
                                                                  ).filter(
                                                                      (id) =>
                                                                          id !==
                                                                          row.id,
                                                                  ),
                                                    }))
                                                }
                                            />
                                            <FieldLabel
                                                htmlFor={`chronic-${row.id}`}
                                            >
                                                {row.name}
                                            </FieldLabel>
                                        </Field>
                                    ))}
                            </div>
                        </FieldSet>
                    </div>
                </CollapsibleSection>
            )}
        </CollapsibleSectionGroup>
    );
}
