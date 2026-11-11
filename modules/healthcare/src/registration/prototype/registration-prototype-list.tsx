import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker } from '@operations-metta/ui/date-picker';
import { displayDate } from '@operations-metta/ui/date-picker';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { cn } from '@operations-metta/ui/utils';
import { CalendarClock } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import {
    age,
    counters,
    patientTypes,
    registrations,
    schedules,
    sections,
    statusLabels,
    type MockRegistration,
    type VisitStatus,
} from './registration-prototype.mock.ts';

const statusTone: Record<VisitStatus, string> = {
    waiting: 'bg-slate-400',
    in_exam: 'bg-sky-500',
    done: 'bg-green-600',
    cancelled: 'bg-red-500',
};

const statusText: Record<VisitStatus, string> = {
    waiting: 'text-slate-700 dark:text-slate-300',
    in_exam: 'text-sky-700 dark:text-sky-300',
    done: 'text-green-700 dark:text-green-400',
    cancelled: 'text-red-700 dark:text-red-400',
};

function StatusDot({ status }: { status: VisitStatus }): ReactNode {
    return (
        <span
            aria-hidden="true"
            className={cn(
                'inline-block size-2 shrink-0 rounded-full',
                statusTone[status],
            )}
        />
    );
}

function Counters({
    active,
    onPick,
}: {
    active: VisitStatus | undefined;
    onPick: (status: VisitStatus | undefined) => void;
}): ReactNode {
    const order: VisitStatus[] = ['waiting', 'in_exam', 'done', 'cancelled'];
    return (
        <div className="flex flex-wrap items-center gap-1 text-xs">
            {order.map((status) => (
                <button
                    key={status}
                    type="button"
                    aria-pressed={active === status}
                    onClick={() =>
                        onPick(active === status ? undefined : status)
                    }
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 hover:bg-accent',
                        active === status && 'bg-accent font-semibold',
                    )}
                >
                    <StatusDot status={status} />
                    {statusLabels[status]}
                    <span className="font-semibold tabular-nums">
                        {counters[status].toLocaleString('id-ID')}
                    </span>
                </button>
            ))}
            <span className="px-2 text-muted-foreground">
                Total{' '}
                <span className="font-semibold text-foreground tabular-nums">
                    {counters.total.toLocaleString('id-ID')}
                </span>
            </span>
        </div>
    );
}

export function RegistrationList({
    onNew,
    onOpen,
}: {
    onNew: () => void;
    onOpen: (row: MockRegistration) => void;
}): ReactNode {
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<VisitStatus | undefined>();
    const [section, setSection] = useState('all');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterId = useId();
    const loader = useCallback<ListLoader<MockRegistration>>(
        ({ query: needle }) => {
            const text = needle.trim().toLowerCase();
            const items = registrations.filter(
                (row) =>
                    (!status || row.status === status) &&
                    (section === 'all' || row.section === section) &&
                    (!text ||
                        row.patient.name.toLowerCase().includes(text) ||
                        row.patient.nrm.includes(text) ||
                        row.number.toLowerCase().includes(text)),
            );
            return Promise.resolve({ items, nextCursor: null });
        },
        [status, section],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query,
        getKey: (row) => row.id,
    });

    return (
        <ListPageLayout
            header={
                <RecordActionBar
                    title="Registrasi kunjungan"
                    search={{
                        value: query,
                        onValueChange: setQuery,
                        label: 'Cari registrasi',
                        placeholder:
                            'Cari nama pasien, NRM, atau nomor registrasi...',
                    }}
                    filter={{
                        open: filtersOpen,
                        onOpenChange: setFiltersOpen,
                        active: Boolean(status) || section !== 'all',
                        controls: filterId,
                    }}
                    groups={[
                        {
                            id: 'visit',
                            label: 'Kunjungan',
                            actions: [
                                {
                                    id: 'control',
                                    label: 'Rencana kontrol',
                                    icon: <CalendarClock aria-hidden="true" />,
                                    onSelect: () => undefined,
                                },
                            ],
                        },
                    ]}
                    trailing={<Counters active={status} onPick={setStatus} />}
                >
                    <ActionButton action="create" onClick={onNew} />
                </RecordActionBar>
            }
            filterPanel={
                filtersOpen ? (
                    <FilterPane
                        id={filterId}
                        title="Filter"
                        description="Hasil diperbarui otomatis saat filter diubah."
                        onClose={() => setFiltersOpen(false)}
                    >
                        <div className="p-4">
                            <FormGrid columns={1}>
                                <FormControl>
                                    <DatePicker
                                        label="Tanggal dari"
                                        defaultValue="2026-11-11"
                                    />
                                </FormControl>
                                <FormControl>
                                    <DatePicker
                                        label="Tanggal sampai"
                                        defaultValue="2026-11-11"
                                    />
                                </FormControl>
                                <FormControl>
                                    <Select
                                        label="Tipe pasien"
                                        items={[
                                            {
                                                value: 'all',
                                                label: 'Semua tipe',
                                            },
                                            ...patientTypes.map((type) => ({
                                                value: type.id,
                                                label: type.name,
                                            })),
                                        ]}
                                        defaultValue="all"
                                    />
                                </FormControl>
                                <FormControl>
                                    <Select
                                        label="Poli / ruangan"
                                        items={[
                                            {
                                                value: 'all',
                                                label: 'Semua poli',
                                            },
                                            ...sections.map((item) => ({
                                                value: item.name,
                                                label: item.name,
                                            })),
                                        ]}
                                        value={section}
                                        onValueChange={(value) =>
                                            setSection(value ?? 'all')
                                        }
                                    />
                                </FormControl>
                                <FormControl>
                                    <Select
                                        label="Dokter"
                                        items={[
                                            {
                                                value: 'all',
                                                label: 'Semua dokter',
                                            },
                                            ...schedules.map((item) => ({
                                                value: item.id,
                                                label: item.practitioner,
                                            })),
                                        ]}
                                        defaultValue="all"
                                    />
                                </FormControl>
                                <FormControl>
                                    <Select
                                        label="Status kunjungan"
                                        items={[
                                            { value: 'all', label: 'Semua' },
                                            {
                                                value: 'sick',
                                                label: 'Kunjungan sakit',
                                            },
                                            {
                                                value: 'healthy',
                                                label: 'Kunjungan sehat',
                                            },
                                        ]}
                                        defaultValue="all"
                                    />
                                </FormControl>
                                <FormControl>
                                    <Select
                                        label="Status periksa"
                                        items={[
                                            {
                                                value: 'all',
                                                label: 'Semua status',
                                            },
                                            ...(
                                                [
                                                    'waiting',
                                                    'in_exam',
                                                    'done',
                                                    'cancelled',
                                                ] as const
                                            ).map((value) => ({
                                                value,
                                                label: statusLabels[value],
                                            })),
                                        ]}
                                        value={status ?? 'all'}
                                        onValueChange={(value) =>
                                            setStatus(
                                                value === 'waiting' ||
                                                    value === 'in_exam' ||
                                                    value === 'done' ||
                                                    value === 'cancelled'
                                                    ? value
                                                    : undefined,
                                            )
                                        }
                                    />
                                </FormControl>
                                <FormControl>
                                    <Input label="Alamat" />
                                </FormControl>
                            </FormGrid>
                        </div>
                    </FilterPane>
                ) : null
            }
            footer={
                <p className="p-3 text-sm text-muted-foreground">
                    {list.items.length} registrasi dimuat
                </p>
            }
        >
            <DataTable
                data={list.items}
                getRowKey={(row) => row.id}
                getRowLabel={(row) => `${row.number} ${row.patient.name}`}
                actionsPlacement="inline"
                actions={[{ id: 'open', label: 'Lihat' }]}
                onRowAction={(_, row) => onOpen(row)}
                onRowClick={onOpen}
                incremental={list}
                emptyMessage="Belum ada registrasi yang cocok. Pilih Baru atau ubah pencarian."
                columns={[
                    {
                        id: 'queue',
                        header: 'Antrian',
                        width: 80,
                        cell: (row) => (
                            <DataTableText>
                                <span className="font-semibold tabular-nums">
                                    {row.queue}
                                </span>
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'number',
                        header: 'Tanggal & no. registrasi',
                        width: 170,
                        cell: (row) => (
                            <DataTableText multiline>
                                <span className="block tabular-nums">
                                    {row.registered_at}
                                </span>
                                <span className="block text-muted-foreground tabular-nums">
                                    {row.number}
                                </span>
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'patient',
                        header: 'Data pasien',
                        width: 440,
                        cell: (row) => (
                            <DataTableText multiline>
                                <ul className="grid list-disc grid-cols-2 gap-x-6 gap-y-0.5 pl-4">
                                    <li className="col-span-2 font-semibold">
                                        {row.patient.name}
                                    </li>
                                    {(
                                        [
                                            ['NRM', row.patient.nrm],
                                            ['NIK', row.patient.nik],
                                            [
                                                'No. asuransi',
                                                row.patient.insurance_number,
                                            ],
                                            [
                                                'No. dok RM',
                                                row.patient.document_number,
                                            ],
                                            ['NRM lama', row.patient.old_nrm],
                                            [
                                                'Jenis kelamin',
                                                row.patient.gender,
                                            ],
                                            [
                                                'Tgl. lahir',
                                                displayDate(
                                                    row.patient.birth_date,
                                                ),
                                            ],
                                            ['Klaster', row.patient.cluster],
                                            [
                                                'Umur',
                                                age(row.patient.birth_date),
                                            ],
                                            [
                                                'Alamat',
                                                `${row.patient.street}, ${row.patient.village}`,
                                            ],
                                        ] as const
                                    ).map(([label, value]) => (
                                        <li
                                            key={label}
                                            className={
                                                label === 'Alamat'
                                                    ? 'col-span-2'
                                                    : undefined
                                            }
                                        >
                                            {label}: {value ?? '—'}
                                        </li>
                                    ))}
                                </ul>
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'section',
                        header: 'Ruangan',
                        width: 180,
                        cell: (row) => (
                            <DataTableText multiline>
                                <span className="block font-medium">
                                    {row.section}
                                </span>
                                <span className="block">
                                    {row.practitioner}
                                </span>
                                <span className="block text-muted-foreground">
                                    {row.visit_kind === 'sick'
                                        ? 'Kunjungan sakit'
                                        : 'Kunjungan sehat'}
                                </span>
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'type',
                        header: 'Tipe pasien',
                        width: 120,
                        cell: (row) => row.patient_type,
                    },
                    {
                        id: 'status',
                        header: 'Status',
                        width: 140,
                        cell: (row) => (
                            <DataTableText>
                                <span
                                    className={cn(
                                        'inline-flex items-center gap-1.5 font-medium',
                                        statusText[row.status],
                                    )}
                                >
                                    <StatusDot status={row.status} />
                                    {statusLabels[row.status]}
                                </span>
                            </DataTableText>
                        ),
                    },
                ]}
            />
        </ListPageLayout>
    );
}
