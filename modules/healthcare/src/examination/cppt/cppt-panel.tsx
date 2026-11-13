import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@operations-metta/ui/card';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { displayDate } from '@operations-metta/ui/date-picker';
import { IncrementalListStatus } from '@operations-metta/ui/incremental-list-status';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import {
    api,
    errorText,
    orpc,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import {
    dentalSections,
    fallRiskResults,
} from '../medical-record/medical-record-panels.tsx';
import { prescriptionStatusLabels } from '../medical-record/order-panels.tsx';

// Panel CPPT di kolom kiri halaman pemeriksaan, seperti panel Catatan Perkembangan Pasien Terintegrasi sistem lama
// (form/cppt/index.php dan reports/history/cppt_history.php): S/O/A/P pemeriksaan ini, lalu Riwayat kunjungan pasien
// yang masing-masing dibuka ke CPPT-nya.

type Cppt = ApiBody<'healthcareCppt'>['data'];
type Visit = ApiBody<'healthcareVisitHistory'>['data'][number];

const value = (number: number | null, unit: string): string | null =>
    number === null ? null : `${number} ${unit}`;

type PlanPrescription = Cppt['plan']['prescriptions'][number];

// Baris resep seperti CPPT sistem lama: komponen racikan menjorok di bawah racikannya, jumlah beserta satuannya.
const prescriptionLines = (prescription: PlanPrescription): string[] =>
    prescription.lines.map((line) =>
        line.drug_name === null
            ? `Racikan ${line.compound ?? ''} (${line.requested_quantity ?? ''})${line.signa ? ` · ${line.signa}` : ''}`
            : `${line.compound === null ? '' : '  '}${line.drug_name} (Qty: ${line.quantity ?? ''})${line.signa ? ` · ${line.signa}` : ''}${line.usage_instruction ? ` · ${line.usage_instruction}` : ''}`,
    );

const planText = (lines: string[]) => (lines.length ? lines.join('\n') : null);

function Lines({ rows }: { rows: [string, ReactNode][] }): ReactNode {
    const shown = rows.filter(
        ([, content]) => content !== null && content !== '',
    );
    if (!shown.length) return <p className="text-muted-foreground">—</p>;
    return (
        <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-3 gap-y-0.5">
            {shown.map(([label, content]) => (
                <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-words whitespace-pre-line">
                        {content}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

function Part({
    letter,
    title,
    children,
}: {
    letter: string;
    title: string;
    children: ReactNode;
}): ReactNode {
    return (
        <section className="space-y-1">
            <h4 className="text-xs font-semibold tracking-wide text-muted-foreground">
                <span className="text-foreground">{letter}</span> · {title}
            </h4>
            {children}
        </section>
    );
}

// S/O/A/P satu pemeriksaan, dengan label dan satuan kolom CPPT sistem lama.
export function CpptView({ cppt }: { cppt: Cppt }): ReactNode {
    const { subjective, objective, assessment, plan } = cppt;
    const fallScore =
        objective.unsteady_gait === null && objective.uses_support === null
            ? null
            : Number(objective.unsteady_gait === true) +
              Number(objective.uses_support === true);
    const dental = objective.dental;
    return (
        <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
                {displayDate(cppt.date)} · {cppt.section_name} ·{' '}
                {cppt.examination_number}
                {cppt.doctor_name && ` · ${cppt.doctor_name}`}
                {cppt.nurse_name && ` · ${cppt.nurse_name}`}
            </p>
            <Part letter="S" title="Subjektif">
                <Lines
                    rows={[
                        ['Keluhan utama', subjective.chief_complaint],
                        ['Keluhan tambahan', subjective.additional_complaint],
                        ...(subjective.history_none
                            ? []
                            : ([
                                  [
                                      'Riwayat penyakit pasien',
                                      subjective.present_history,
                                  ],
                                  [
                                      'Riwayat penyakit dahulu',
                                      subjective.past_history,
                                  ],
                                  [
                                      'Riwayat penyakit keluarga',
                                      subjective.family_history,
                                  ],
                              ] satisfies [string, ReactNode][])),
                    ]}
                />
            </Part>
            <Part letter="O" title="Objektif">
                <Lines
                    rows={[
                        ['Kesadaran', objective.consciousness],
                        ['Sistole', value(objective.systolic, 'mmHg')],
                        ['Diastole', value(objective.diastolic, 'mmHg')],
                        ['Tinggi badan', value(objective.height, 'cm')],
                        ['Berat badan', value(objective.weight, 'kg')],
                        [
                            'Lingkar perut',
                            value(objective.waist_circumference, 'cm'),
                        ],
                        ['Detak nadi', value(objective.pulse_rate, 'x/menit')],
                        ['Nafas', value(objective.respiratory_rate, 'x/menit')],
                        ['Oksigenasi', value(objective.oxygen_saturation, '%')],
                        ['Suhu', value(objective.temperature, '°C')],
                        [
                            'Skala nyeri',
                            objective.pain_scale === null
                                ? null
                                : `${objective.pain_scale} /10`,
                        ],
                        [
                            'Hasil kegiatan',
                            fallScore === null
                                ? null
                                : (fallRiskResults[fallScore]?.label ?? null),
                        ],
                        ...(dental
                            ? dentalSections.flatMap(([, fields]) =>
                                  fields.map(
                                      ([field, label]): [string, ReactNode] => [
                                          label,
                                          dental[field] ?? null,
                                      ],
                                  ),
                              )
                            : []),
                    ]}
                />
            </Part>
            <Part letter="A" title="Asesmen">
                {assessment.length ? (
                    <ul className="space-y-0.5">
                        {assessment.map((row) => (
                            <li key={row.icd10_code}>
                                ({row.icd10_code}) {row.icd10_name}{' '}
                                <span className="text-muted-foreground">
                                    · {row.type_name} · {row.case_name}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-muted-foreground">—</p>
                )}
            </Part>
            <Part letter="P" title="Perencanaan">
                <Lines
                    rows={[
                        ['Terapi obat', plan.drug_therapy],
                        ['Terapi non obat', plan.non_drug_therapy],
                        [
                            'Tindakan',
                            plan.procedures.length
                                ? plan.procedures
                                      .map(
                                          (row) =>
                                              `${row.name} (${row.quantity})`,
                                      )
                                      .join('\n')
                                : null,
                        ],
                        [
                            'Obat direalisasi',
                            planText(
                                plan.prescriptions
                                    .filter((row) => row.handed_over)
                                    .flatMap(prescriptionLines),
                            ),
                        ],
                        [
                            'Resep',
                            planText(
                                plan.prescriptions
                                    .filter((row) => !row.handed_over)
                                    .flatMap((prescription) => [
                                        [
                                            prescription.number,
                                            prescriptionStatusLabels[
                                                prescription.status
                                            ],
                                        ]
                                            .filter(Boolean)
                                            .join(' · '),
                                        ...prescriptionLines(prescription),
                                    ]),
                            ),
                        ],
                    ]}
                />
            </Part>
        </div>
    );
}

function CpptOf({ destinationId }: { destinationId: string }): ReactNode {
    const cppt = useQuery(
        orpc.healthcareCppt.queryOptions({
            input: { params: { id: destinationId } },
            select: (response) => response.body.data,
        }),
    );
    if (cppt.data) return <CpptView cppt={cppt.data} />;
    return (
        <p
            role={cppt.isError ? 'alert' : 'status'}
            className="text-sm text-muted-foreground"
        >
            {cppt.isError
                ? errorText(cppt.error, 'CPPT belum dapat dimuat.')
                : 'Memuat CPPT…'}
        </p>
    );
}

function VisitHistory({ destinationId }: { destinationId: string }): ReactNode {
    const loader = useCallback<ListLoader<Visit>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcareVisitHistory(
                {
                    params: { id: destinationId },
                    query: { q: query, ...(cursor ? { cursor } : {}) },
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
    if (!list.loading && !list.error && !list.items.length)
        return (
            <p className="text-sm text-muted-foreground">
                Belum ada kunjungan lain pasien ini.
            </p>
        );
    return (
        <div className="max-h-[32rem] overflow-y-auto">
            <CollapsibleSectionGroup>
                {list.items.map((row) => (
                    <CollapsibleSection
                        key={row.id}
                        value={row.id}
                        title={`${displayDate(row.date)} · ${row.section_name}`}
                        summary={[row.doctor_name, row.diagnoses]
                            .filter(Boolean)
                            .join(' · ')}
                    >
                        <CpptOf destinationId={row.id} />
                    </CollapsibleSection>
                ))}
            </CollapsibleSectionGroup>
            <IncrementalListStatus state={list} />
        </div>
    );
}

export function CpptPanel({
    destinationId,
}: {
    destinationId: string;
}): ReactNode {
    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    Catatan Perkembangan Pasien Terintegrasi (CPPT)
                </CardTitle>
                <CardDescription>
                    Klik Simpan terlebih dahulu agar CPPT terbarui.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <CpptOf destinationId={destinationId} />
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold">Riwayat kunjungan</h3>
                    <VisitHistory destinationId={destinationId} />
                </div>
            </CardContent>
        </Card>
    );
}
