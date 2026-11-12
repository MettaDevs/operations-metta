import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { cn } from '@operations-metta/ui/utils';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    api,
    definePage,
    orpc,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import {
    StatusDot,
    TriageDot,
    VisitStatusText,
    visitConditionLabel,
    visitStatusLabels,
} from './visit-display.tsx';
import {
    isVisitStatus,
    visitStatuses,
    type VisitStatus,
} from './visit.statuses.ts';

// Daftar registrasi kunjungan seperti "Daftar registrasi" sistem lama: penghitung status di toolbar yang sekaligus
// menyaring, pencarian NRM, nama, atau NoReg, filter tanggal, tipe pasien, nakes, section, dan status di panel kiri.

const route = getRouteApi('/_app/healthcare/registration/visits');
const ALL = 'all';
type Row = ApiBody<'healthcareVisitList'>['data'][number];
type Counts = ApiBody<'healthcareVisitList'>['counts'];
type Search = z.infer<typeof searchSchema>;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    from: z.string().max(10).optional(),
    to: z.string().max(10).optional(),
    patient_type: z.string().max(100).optional(),
    practitioner: z.string().max(100).optional(),
    section: z.string().max(100).optional(),
    cluster: z.string().max(100).optional(),
    status: z.enum(visitStatuses).optional(),
});

// Penghitung dari API per status kunjungan.
const countOf: Record<VisitStatus, keyof Counts> = {
    terdaftar: 'waiting',
    diperiksa: 'in_examination',
    selesai: 'done',
    batal: 'cancelled',
};

function Counters({
    counts,
    active,
    onPick,
}: {
    counts: Counts | null;
    active: VisitStatus | undefined;
    onPick: (status: VisitStatus | undefined) => void;
}): ReactNode {
    const number = (value: number | undefined) =>
        value === undefined ? '…' : value.toLocaleString('id-ID');
    return (
        <div
            role="group"
            aria-label="Saring menurut status"
            className="flex flex-wrap items-center gap-1 text-xs"
        >
            {visitStatuses.map((status) => (
                <Button
                    key={status}
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-pressed={active === status}
                    onClick={() =>
                        onPick(active === status ? undefined : status)
                    }
                    className={cn(
                        'gap-1.5 rounded-full font-normal',
                        active === status && 'bg-accent font-semibold',
                    )}
                >
                    <StatusDot status={status} />
                    {visitStatusLabels[status]}
                    <span className="font-semibold tabular-nums">
                        {number(counts?.[countOf[status]])}
                    </span>
                </Button>
            ))}
            <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-pressed={active === undefined}
                onClick={() => onPick(undefined)}
                className={cn(
                    'rounded-full font-normal text-muted-foreground',
                    active === undefined && 'bg-accent',
                )}
            >
                Total
                <span className="font-semibold text-foreground tabular-nums">
                    {number(counts?.total)}
                </span>
            </Button>
        </div>
    );
}

function VisitsPage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareVisitMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    // Label jenis kelamin dari data acuan pasien; tanpa izin pasien kodenya yang tampil.
    const patientMetadata = useQuery(
        orpc.healthcarePatientMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [counts, setCounts] = useState<Counts | null>(null);
    const filterPanelId = useId();
    const from = search.from ?? metadata.date;
    const to = search.to ?? from;
    const {
        patient_type: patientType,
        practitioner,
        section,
        cluster,
        status,
    } = search;
    const practitioners = [
        ...new Map(
            metadata.sections
                .flatMap((item) => item.schedules)
                .map((schedule) => [
                    schedule.practitioner_id,
                    schedule.practitioner_name,
                ]),
        ),
    ].sort(([, a], [, b]) => a.localeCompare(b));
    const gender = (code: string | null) =>
        code === null
            ? null
            : (patientMetadata.data?.reference_values.gender?.find(
                  (value) => value.code === code,
              )?.name ?? code);

    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcareVisitList(
                {
                    query: {
                        from,
                        to,
                        ...(patientType
                            ? { patient_type_id: patientType }
                            : {}),
                        ...(practitioner
                            ? { practitioner_id: practitioner }
                            : {}),
                        ...(section ? { section_id: section } : {}),
                        ...(cluster ? { cluster_id: cluster } : {}),
                        ...(status ? { status } : {}),
                        q: query,
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            if (!cursor) setCounts(body.counts);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [from, to, patientType, practitioner, section, cluster, status],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (row) => row.id,
    });
    const setSearch = (next: Partial<Search>) =>
        void navigate({
            search: (current) =>
                Object.fromEntries(
                    Object.entries<string | undefined>({
                        ...current,
                        ...next,
                    }).filter(
                        ([, value]) => value !== undefined && value !== '',
                    ),
                ),
            replace: true,
        });
    const choice = (value: string | null) =>
        value === ALL || value === null ? undefined : value;
    const open = (row: Row) =>
        void navigate({
            to: '/healthcare/registration/visits/$visitId',
            params: { visitId: row.id },
        });

    return (
        <ListPageLayout
            header={
                <RecordActionBar
                    title="Kunjungan"
                    search={{
                        value: search.q ?? '',
                        onValueChange: (q) => setSearch({ q }),
                        label: 'Cari kunjungan',
                        placeholder: 'Cari NRM, nama pasien, atau NoReg...',
                    }}
                    filter={{
                        open: filtersOpen,
                        onOpenChange: setFiltersOpen,
                        active: Boolean(
                            search.from ||
                            search.to ||
                            patientType ||
                            practitioner ||
                            section ||
                            cluster ||
                            status,
                        ),
                        controls: filterPanelId,
                    }}
                    trailing={
                        <Counters
                            counts={counts}
                            active={status}
                            onPick={(next) => setSearch({ status: next })}
                        />
                    }
                >
                    {metadata.permissions.create && (
                        <ActionButton
                            action="create"
                            onClick={() =>
                                void navigate({
                                    to: '/healthcare/registration/visits/new',
                                })
                            }
                        />
                    )}
                </RecordActionBar>
            }
            filterPanel={
                filtersOpen ? (
                    <FilterPane
                        id={filterPanelId}
                        title="Filter"
                        description="Hasil diperbarui otomatis saat filter diubah."
                        onClose={() => setFiltersOpen(false)}
                    >
                        <div className="p-4">
                            <FormGrid columns={1}>
                                <FormControl>
                                    <DatePicker
                                        label="Tanggal dari"
                                        value={from}
                                        onValueChange={(value) =>
                                            setSearch({
                                                from:
                                                    value === metadata.date
                                                        ? undefined
                                                        : value || undefined,
                                            })
                                        }
                                    />
                                </FormControl>
                                <FormControl>
                                    <DatePicker
                                        label="Tanggal sampai"
                                        value={to}
                                        onValueChange={(value) =>
                                            setSearch({
                                                to:
                                                    value === from
                                                        ? undefined
                                                        : value || undefined,
                                            })
                                        }
                                    />
                                </FormControl>
                                <FormControl>
                                    <Select
                                        label="Tipe pasien"
                                        items={[
                                            {
                                                value: ALL,
                                                label: 'Semua tipe pasien',
                                            },
                                            ...metadata.patient_types.map(
                                                (type) => ({
                                                    value: type.id,
                                                    label: type.name,
                                                }),
                                            ),
                                        ]}
                                        value={patientType ?? ALL}
                                        onValueChange={(value) =>
                                            setSearch({
                                                patient_type: choice(value),
                                            })
                                        }
                                        searchPlaceholder="Cari tipe pasien"
                                        emptyMessage="Tipe pasien tidak ditemukan."
                                    />
                                </FormControl>
                                <FormControl>
                                    <Select
                                        label="Nakes"
                                        items={[
                                            {
                                                value: ALL,
                                                label: 'Semua nakes',
                                            },
                                            ...practitioners.map(
                                                ([id, name]) => ({
                                                    value: id,
                                                    label: name,
                                                }),
                                            ),
                                        ]}
                                        value={practitioner ?? ALL}
                                        onValueChange={(value) =>
                                            setSearch({
                                                practitioner: choice(value),
                                            })
                                        }
                                        searchPlaceholder="Cari nakes"
                                        emptyMessage="Tidak ada nakes berjadwal hari ini."
                                    />
                                </FormControl>
                                <FormControl>
                                    <Select
                                        label="Poli / ruangan"
                                        items={[
                                            {
                                                value: ALL,
                                                label: 'Semua poli / ruangan',
                                            },
                                            ...metadata.sections.map(
                                                (item) => ({
                                                    value: item.id,
                                                    label: item.name,
                                                }),
                                            ),
                                        ]}
                                        value={section ?? ALL}
                                        onValueChange={(value) =>
                                            setSearch({
                                                section: choice(value),
                                            })
                                        }
                                        searchPlaceholder="Cari poli atau ruangan"
                                        emptyMessage="Poli atau ruangan tidak ditemukan."
                                    />
                                </FormControl>
                                <FormControl>
                                    <Select
                                        label="Klaster"
                                        items={[
                                            {
                                                value: ALL,
                                                label: 'Semua klaster',
                                            },
                                            ...metadata.clusters.map(
                                                (item) => ({
                                                    value: item.id,
                                                    label: `${item.code} ${item.name}`,
                                                }),
                                            ),
                                        ]}
                                        value={cluster ?? ALL}
                                        onValueChange={(value) =>
                                            setSearch({
                                                cluster: choice(value),
                                            })
                                        }
                                        searchPlaceholder="Cari klaster"
                                        emptyMessage="Klaster tidak ditemukan."
                                    />
                                </FormControl>
                                <FormControl>
                                    <Select
                                        label="Status"
                                        items={[
                                            {
                                                value: ALL,
                                                label: 'Semua status',
                                            },
                                            ...visitStatuses.map((value) => ({
                                                value,
                                                label: visitStatusLabels[value],
                                            })),
                                        ]}
                                        value={status ?? ALL}
                                        onValueChange={(value) =>
                                            setSearch({
                                                status:
                                                    value &&
                                                    isVisitStatus(value)
                                                        ? value
                                                        : undefined,
                                            })
                                        }
                                        searchPlaceholder="Cari status"
                                        emptyMessage="Status tidak ditemukan."
                                    />
                                </FormControl>
                            </FormGrid>
                        </div>
                    </FilterPane>
                ) : null
            }
            footer={
                <p className="p-3 text-sm text-muted-foreground">
                    {list.items.length} kunjungan dimuat
                </p>
            }
        >
            <DataTable
                data={list.items}
                getRowKey={(row) => row.id}
                getRowLabel={(row) =>
                    `${row.queue_code} ${row.registration_number} ${row.patient_name}`
                }
                showRowNumbers
                actionsPlacement="inline"
                actions={[{ id: 'open', label: 'Buka' }]}
                onRowAction={(_, row) => open(row)}
                onRowClick={open}
                incremental={list}
                emptyMessage={
                    metadata.permissions.create
                        ? 'Belum ada kunjungan yang cocok. Pilih Baru atau ubah pencarian dan filter.'
                        : 'Belum ada kunjungan yang cocok.'
                }
                columns={[
                    {
                        id: 'queue',
                        header: 'Antrean',
                        width: 72,
                        cell: (row) => (
                            <DataTableText>
                                <span className="font-semibold tabular-nums">
                                    {row.queue_code}
                                </span>
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'registration',
                        header: 'Tanggal & NoReg',
                        width: 190,
                        cell: (row) => (
                            <DataTableText multiline>
                                <span className="block tabular-nums">
                                    {displayDate(row.date)}{' '}
                                    {new Date(
                                        row.registered_at,
                                    ).toLocaleTimeString('id-ID', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </span>
                                <span className="block text-muted-foreground tabular-nums">
                                    {row.registration_number}
                                </span>
                            </DataTableText>
                        ),
                    },
                    {
                        // Identitas pasien sebagai butir berlabel seperti kolom Identitas di daftar pasien, dua kolom
                        // supaya baris tetap pendek.
                        id: 'patient',
                        header: 'Data pasien',
                        width: 430,
                        cell: (row) => (
                            <DataTableText multiline>
                                <ul className="grid list-disc grid-cols-1 gap-x-6 gap-y-0.5 pl-4 sm:grid-cols-2">
                                    <li className="font-semibold sm:col-span-2">
                                        {row.patient_name}
                                    </li>
                                    {(
                                        [
                                            ['NRM', row.patient_nrm],
                                            ['NIK', row.nik],
                                            ['No. kartu', row.card_number],
                                            ['No. dok RM', row.document_number],
                                            ['NRM lama', row.old_number],
                                            [
                                                'Jenis kelamin',
                                                gender(row.gender),
                                            ],
                                            [
                                                'Tgl. lahir',
                                                row.birth_date &&
                                                    displayDate(row.birth_date),
                                            ],
                                            [
                                                'Umur',
                                                row.age_years === null
                                                    ? null
                                                    : `${String(row.age_years)} thn`,
                                            ],
                                        ] as const
                                    ).map(([label, value]) => (
                                        <li key={label}>
                                            {label}: {value || '—'}
                                        </li>
                                    ))}
                                    <li className="sm:col-span-2">
                                        Alamat:{' '}
                                        {row.address?.replaceAll('\n', ', ') ||
                                            '—'}
                                    </li>
                                </ul>
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'section',
                        header: 'Ruangan',
                        width: 190,
                        cell: (row) => (
                            <DataTableText multiline>
                                <span className="block font-medium">
                                    {row.section_name}
                                </span>
                                <span className="block">
                                    {row.practitioner_name ?? '—'}
                                </span>
                                <span className="block text-muted-foreground">
                                    {visitConditionLabel(row.visit_condition)}
                                </span>
                                {row.cluster_code && (
                                    <span className="block text-muted-foreground">
                                        {row.cluster_code} ·{' '}
                                        {row.life_cycle_name}
                                    </span>
                                )}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'payer',
                        header: 'Asuransi',
                        width: 100,
                        cell: (row) => (
                            <DataTableText multiline>
                                <span className="block">
                                    {row.patient_type_name}
                                </span>
                                {row.guarantor_name && (
                                    <span className="block text-muted-foreground">
                                        {row.guarantor_name}
                                    </span>
                                )}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'status',
                        header: 'Status',
                        width: 140,
                        cell: (row) => (
                            <DataTableText multiline>
                                <span className="block">
                                    <VisitStatusText status={row.status} />
                                </span>
                                {row.screening_category_name && (
                                    <span className="flex items-center gap-1.5 text-muted-foreground">
                                        <TriageDot
                                            color={row.screening_category_color}
                                        />
                                        {row.screening_category_name}
                                    </span>
                                )}
                            </DataTableText>
                        ),
                    },
                ]}
            />
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/healthcare/registration/visits',
    layout: 'app',
    title: 'Kunjungan',
    validateSearch: searchSchema,
    component: VisitsPage,
});
