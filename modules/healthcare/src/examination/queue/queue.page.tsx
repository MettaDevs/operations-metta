import { Alert, AlertDescription } from '@operations-metta/ui/alert';
import { Button } from '@operations-metta/ui/button';
import {
    Card,
    CardAction,
    CardContent,
    CardHeader,
    CardTitle,
} from '@operations-metta/ui/card';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import type { DataTableRowAction } from '@operations-metta/ui/data-table';
import { DatePicker } from '@operations-metta/ui/date-picker';
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
import {
    Megaphone,
    SkipForward,
    Stethoscope,
    UserX,
    Volume2,
} from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    definePage,
    errorText,
    orpc,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import {
    ageText,
    DestinationStatusDot,
    DestinationStatusText,
    destinationStatusLabels,
    timeText,
} from './queue-display.tsx';
import {
    destinationStatuses,
    isDestinationStatus,
    type DestinationStatus,
} from './queue.statuses.ts';

// Antrean poli: pilih poli dan ruangan tempat memanggil, lalu Panggil berikutnya. Ruangan yang lebih dulu memanggil
// mendapat pasien berikutnya ke ruangannya. Ruangan diingat per perangkat, karena komputer poli berada di satu ruangan.

const route = getRouteApi('/_app/healthcare/examination/queue');
const ALL = 'all';
type Row = ApiBody<'healthcareExaminationQueue'>['data'][number];
type Counts = ApiBody<'healthcareExaminationQueue'>['counts'];
type Search = z.infer<typeof searchSchema>;
const queueStatuses = destinationStatuses.filter(
    (status) => status !== 'batal',
);
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    section: z.string().max(100).optional(),
    date: z.string().max(10).optional(),
    cluster: z.string().max(100).optional(),
    practitioner: z.string().max(100).optional(),
    status: z.enum(destinationStatuses).optional(),
});

const countOf: Record<Exclude<DestinationStatus, 'batal'>, keyof Counts> = {
    menunggu: 'waiting',
    dipanggil: 'called',
    diperiksa: 'in_examination',
    selesai: 'done',
    tidak_datang: 'no_show',
};

// Poli dan ruangan terakhir di perangkat ini. Hanya kenyamanan: bila penyimpanan peramban diblokir, petugas memilih
// ulang setiap kali membuka layar.
const placeKey = 'healthcare.examination.place';
const placeSchema = z.object({
    section: z.string().optional(),
    rooms: z.record(z.string(), z.string()).default({}),
});
type Place = z.infer<typeof placeSchema>;

function readPlace(): Place {
    try {
        const parsed = placeSchema.safeParse(
            JSON.parse(localStorage.getItem(placeKey) ?? '{}'),
        );
        return parsed.success ? parsed.data : { rooms: {} };
    } catch {
        return { rooms: {} };
    }
}

function rememberPlace(place: Place): void {
    try {
        localStorage.setItem(placeKey, JSON.stringify(place));
    } catch {
        // Penyimpanan peramban diblokir: poli dan ruangan tidak diingat.
    }
}

function Counters({
    counts,
    active,
    onPick,
}: {
    counts: Counts | null;
    active: DestinationStatus | undefined;
    onPick: (status: DestinationStatus | undefined) => void;
}): ReactNode {
    const number = (value: number | undefined) =>
        value === undefined ? '…' : value.toLocaleString('id-ID');
    return (
        <div
            role="group"
            aria-label="Saring menurut status"
            className="flex flex-wrap items-center gap-1 text-xs"
        >
            {queueStatuses.map((status) => (
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
                    <DestinationStatusDot status={status} />
                    {destinationStatusLabels[status]}
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

function Fact({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}): ReactNode {
    return (
        <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate">{children || '—'}</dd>
        </div>
    );
}

function QueuePage(): ReactNode {
    const { data: metadata } = useSuspenseQuery(
        orpc.healthcareExaminationMetadata.queryOptions({
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
    const [place, setPlace] = useState(readPlace);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [counts, setCounts] = useState<Counts | null>(null);
    const [current, setCurrent] = useState<Row | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const filterPanelId = useId();

    const section =
        metadata.sections.find(
            (item) => item.id === (search.section ?? place.section),
        ) ?? metadata.sections[0];
    const sectionRooms = section?.rooms ?? [];
    const roomId =
        sectionRooms.find((room) => room.id === place.rooms[section?.id ?? ''])
            ?.id ??
        (sectionRooms.length === 1 ? sectionRooms[0]?.id : undefined);
    const date = search.date ?? metadata.date;
    const today = date === metadata.date;
    const canManage = metadata.permissions.manage && today;
    const { cluster, practitioner, status } = search;
    const gender = (code: string | null) =>
        code === null
            ? null
            : (patientMetadata.data?.reference_values.gender?.find(
                  (value) => value.code === code,
              )?.name ?? code);

    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.healthcareExaminationQueue(
                {
                    query: {
                        date,
                        ...(section ? { section_id: section.id } : {}),
                        ...(roomId ? { room_id: roomId } : {}),
                        ...(cluster ? { cluster_id: cluster } : {}),
                        ...(practitioner
                            ? { practitioner_id: practitioner }
                            : {}),
                        ...(status ? { status } : {}),
                        q: query,
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            if (!cursor) {
                setCounts(body.counts);
                setCurrent(body.current);
            }
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [date, section, roomId, cluster, practitioner, status],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (row) => row.id,
    });
    const setSearch = (next: Partial<Search>) =>
        void navigate({
            search: (previous) =>
                Object.fromEntries(
                    Object.entries<string | undefined>({
                        ...previous,
                        ...next,
                    }).filter(
                        ([, value]) => value !== undefined && value !== '',
                    ),
                ),
            replace: true,
        });
    const choice = (value: string | null) =>
        value === ALL || value === null ? undefined : value;
    const pickPlace = (next: Place) => {
        setPlace(next);
        rememberPlace(next);
    };
    const openExamination = (id: string) =>
        void navigate({
            to: '/healthcare/examination/queue/$destinationId',
            params: { destinationId: id },
        });

    // Satu tindakan antrean: pesan berhasil sebagai toast, penolakan tetap terlihat sampai tindakan berikutnya.
    const run = async (
        perform: () => Promise<{ body: { data: Row } }>,
        success: (row: Row) => string,
        fallback: string,
    ): Promise<Row | null> => {
        setBusy(true);
        try {
            const { body } = await perform();
            setMessage(null);
            toast.success(success(body.data));
            list.reload();
            return body.data;
        } catch (caught) {
            setMessage(errorText(caught, fallback));
            list.reload();
            return null;
        } finally {
            setBusy(false);
        }
    };
    const callNext = () =>
        section && roomId
            ? void run(
                  () =>
                      api.healthcareExaminationCallNext({
                          body: { section_id: section.id, room_id: roomId },
                      }),
                  (row) =>
                      `${row.queue_code} ${row.patient_name} dipanggil ke ${row.room_name ?? 'ruangan'}.`,
                  'Pasien berikutnya belum dipanggil.',
              )
            : setMessage('Pilih ruangan tempat memanggil lebih dulu.');
    const recall = (row: Row) =>
        void run(
            () =>
                api.healthcareExaminationRecall({
                    params: { id: row.id },
                    body: {},
                }),
            (saved) => `${saved.queue_code} dipanggil ulang.`,
            'Pasien belum dipanggil ulang.',
        );
    const skip = (row: Row) =>
        void run(
            () =>
                api.healthcareExaminationSkip({
                    params: { id: row.id },
                    body: {},
                }),
            (saved) =>
                `${saved.queue_code} dilewati dan kembali antre di belakang.`,
            'Pasien belum dilewati.',
        );
    const noShow = (row: Row) =>
        void run(
            () =>
                api.healthcareExaminationNoShow({
                    params: { id: row.id },
                    body: {},
                }),
            (saved) => `${saved.queue_code} ditandai tidak datang.`,
            'Pasien belum ditandai tidak datang.',
        );
    const start = async (row: Row) => {
        if (row.status !== 'dipanggil' && !roomId && !row.room_id) {
            setMessage('Pilih ruangan pemeriksaan lebih dulu.');
            return;
        }
        const started = await run(
            () =>
                api.healthcareExaminationStart({
                    params: { id: row.id },
                    body:
                        row.status === 'dipanggil'
                            ? {}
                            : { room_id: roomId ?? row.room_id },
                }),
            (saved) => `Pemeriksaan ${saved.queue_code} dimulai.`,
            'Pemeriksaan belum dimulai.',
        );
        if (started) openExamination(started.id);
    };
    const finish = (row: Row) =>
        void run(
            () =>
                api.healthcareExaminationFinish({
                    params: { id: row.id },
                    body: {},
                }),
            (saved) => `Pemeriksaan ${saved.queue_code} selesai.`,
            'Pemeriksaan belum diselesaikan.',
        );

    const rowActions = (row: Row): DataTableRowAction[] => {
        const actions: DataTableRowAction[] = [];
        if (row.status === 'diperiksa' || row.status === 'selesai')
            actions.push({ id: 'open', label: 'Buka pemeriksaan' });
        if (!canManage) return actions;
        if (row.status === 'dipanggil')
            actions.push(
                { id: 'recall', label: 'Panggil ulang' },
                { id: 'skip', label: 'Lewati' },
                { id: 'no-show', label: 'Tidak datang' },
            );
        if (['menunggu', 'dipanggil', 'tidak_datang'].includes(row.status))
            actions.push({ id: 'start', label: 'Mulai periksa' });
        if (row.status === 'diperiksa')
            actions.push({ id: 'finish', label: 'Selesai periksa' });
        return actions;
    };
    const rowHandlers: Record<string, (row: Row) => void> = {
        open: (row) => openExamination(row.id),
        recall,
        skip,
        'no-show': noShow,
        start: (row) => void start(row),
        finish,
    };

    return (
        <ListPageLayout
            header={
                <RecordActionBar
                    title="Antrean poli"
                    search={{
                        value: search.q ?? '',
                        onValueChange: (q) => setSearch({ q }),
                        label: 'Cari pasien di antrean',
                        placeholder:
                            'Cari nomor antrean, NRM, nama, atau NoReg...',
                    }}
                    filter={{
                        open: filtersOpen,
                        onOpenChange: setFiltersOpen,
                        active: Boolean(
                            search.date || cluster || practitioner || status,
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
                />
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
                                        label="Tanggal"
                                        value={date}
                                        onValueChange={(value) =>
                                            setSearch({
                                                date:
                                                    value === metadata.date
                                                        ? undefined
                                                        : value || undefined,
                                            })
                                        }
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
                                        label="Nakes"
                                        items={[
                                            {
                                                value: ALL,
                                                label: 'Semua nakes',
                                            },
                                            ...(
                                                section?.practitioners ?? []
                                            ).map((item) => ({
                                                value: item.id,
                                                label: item.name,
                                            })),
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
                                        label="Status"
                                        items={[
                                            {
                                                value: ALL,
                                                label: 'Semua status',
                                            },
                                            ...queueStatuses.map((value) => ({
                                                value,
                                                label: destinationStatusLabels[
                                                    value
                                                ],
                                            })),
                                        ]}
                                        value={status ?? ALL}
                                        onValueChange={(value) =>
                                            setSearch({
                                                status:
                                                    value &&
                                                    isDestinationStatus(value)
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
                    {list.items.length} pasien dimuat
                </p>
            }
        >
            <div className="flex min-h-0 flex-1 flex-col gap-3">
                {message && (
                    <Alert variant="destructive" className="shrink-0">
                        <AlertDescription>{message}</AlertDescription>
                    </Alert>
                )}
                <Card className="shrink-0 gap-3 py-3">
                    <CardContent className="flex flex-wrap items-center gap-3 px-4">
                        <div className="w-56">
                            <Select
                                label="Poli"
                                className="w-full"
                                items={metadata.sections.map((item) => ({
                                    value: item.id,
                                    label: item.name,
                                }))}
                                value={section?.id ?? null}
                                onValueChange={(value) => {
                                    if (!value) return;
                                    pickPlace({ ...place, section: value });
                                    setSearch({
                                        section: value,
                                        practitioner: undefined,
                                    });
                                }}
                                searchPlaceholder="Cari poli"
                                emptyMessage="Belum ada poli di unit kerja Anda."
                            />
                        </div>
                        <div className="w-48">
                            <Select
                                label="Ruangan saya"
                                className="w-full"
                                items={sectionRooms.map((room) => ({
                                    value: room.id,
                                    label: room.name,
                                }))}
                                value={roomId ?? null}
                                onValueChange={(value) => {
                                    if (!value || !section) return;
                                    pickPlace({
                                        ...place,
                                        rooms: {
                                            ...place.rooms,
                                            [section.id]: value,
                                        },
                                    });
                                }}
                                searchPlaceholder="Cari ruangan"
                                emptyMessage="Poli ini belum punya ruangan."
                            />
                        </div>
                        {metadata.permissions.manage && (
                            <Button
                                type="button"
                                size="lg"
                                disabled={
                                    busy ||
                                    !canManage ||
                                    !roomId ||
                                    current !== null
                                }
                                onClick={callNext}
                            >
                                <Megaphone aria-hidden="true" />
                                Panggil berikutnya
                            </Button>
                        )}
                    </CardContent>
                    {current ? (
                        <>
                            <CardHeader className="border-t px-4 pt-3">
                                <CardTitle className="flex flex-wrap items-baseline gap-3">
                                    <span className="text-3xl font-bold tabular-nums">
                                        {current.queue_code}
                                    </span>
                                    <span className="text-base">
                                        {current.patient_name}
                                    </span>
                                    <span className="text-sm font-normal text-muted-foreground">
                                        Dipanggil {timeText(current.called_at)}
                                        {current.call_count > 1
                                            ? ` · ${String(current.call_count)} kali`
                                            : ''}
                                    </span>
                                </CardTitle>
                                {canManage && (
                                    <CardAction className="flex flex-wrap gap-1">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="command"
                                            disabled={busy}
                                            onClick={() => recall(current)}
                                        >
                                            <Volume2 aria-hidden="true" />
                                            Panggil ulang
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="command"
                                            disabled={busy}
                                            onClick={() => skip(current)}
                                        >
                                            <SkipForward aria-hidden="true" />
                                            Lewati
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="command"
                                            disabled={busy}
                                            onClick={() => noShow(current)}
                                        >
                                            <UserX aria-hidden="true" />
                                            Tidak datang
                                        </Button>
                                        <Button
                                            type="button"
                                            size="command"
                                            disabled={busy}
                                            onClick={() => void start(current)}
                                        >
                                            <Stethoscope aria-hidden="true" />
                                            Mulai periksa
                                        </Button>
                                    </CardAction>
                                )}
                            </CardHeader>
                            <CardContent className="px-4">
                                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-6">
                                    <Fact label="NRM">
                                        {current.patient_nrm}
                                    </Fact>
                                    <Fact label="Umur">{ageText(current)}</Fact>
                                    <Fact label="Jenis kelamin">
                                        {gender(current.gender)}
                                    </Fact>
                                    <Fact label="Klaster / siklus hidup">
                                        {current.cluster_code &&
                                            `${current.cluster_code} · ${current.life_cycle_name ?? ''}`}
                                    </Fact>
                                    <Fact label="Tipe pasien">
                                        {current.guarantor_name
                                            ? `${current.patient_type_name} · ${current.guarantor_name}`
                                            : current.patient_type_name}
                                    </Fact>
                                    <Fact label="Nakes">
                                        {current.practitioner_name}
                                    </Fact>
                                </dl>
                            </CardContent>
                        </>
                    ) : (
                        <CardContent className="px-4 text-sm text-muted-foreground">
                            {roomId
                                ? 'Belum ada pasien yang dipanggil ke ruangan ini.'
                                : 'Pilih ruangan Anda untuk memanggil pasien.'}
                        </CardContent>
                    )}
                </Card>
                <DataTable
                    data={list.items}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) =>
                        `${row.queue_code} ${row.patient_name}`
                    }
                    showRowNumbers
                    actionsPlacement="inline"
                    getRowActions={rowActions}
                    onRowAction={(action, row) => rowHandlers[action]?.(row)}
                    onRowClick={(row) =>
                        row.status === 'diperiksa' || row.status === 'selesai'
                            ? openExamination(row.id)
                            : undefined
                    }
                    incremental={list}
                    emptyMessage={
                        section
                            ? 'Belum ada pasien di antrean poli ini.'
                            : 'Belum ada poli di unit kerja Anda.'
                    }
                    columns={[
                        {
                            id: 'queue',
                            header: 'Antrean',
                            width: 80,
                            cell: (row) => (
                                <DataTableText>
                                    <span className="font-semibold tabular-nums">
                                        {row.queue_code}
                                    </span>
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'patient',
                            header: 'Pasien',
                            width: 260,
                            cell: (row) => (
                                <DataTableText multiline>
                                    <span className="block font-medium">
                                        {row.patient_name}
                                    </span>
                                    <span className="block text-muted-foreground tabular-nums">
                                        {row.patient_nrm}
                                        {ageText(row)
                                            ? ` · ${ageText(row) ?? ''}`
                                            : ''}
                                        {row.gender
                                            ? ` · ${gender(row.gender) ?? ''}`
                                            : ''}
                                    </span>
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'cluster',
                            header: 'Klaster',
                            width: 170,
                            cell: (row) => (
                                <DataTableText multiline>
                                    <span className="block">
                                        {row.cluster_code ?? '—'}
                                    </span>
                                    <span className="block text-muted-foreground">
                                        {row.life_cycle_name}
                                    </span>
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'payer',
                            header: 'Tipe pasien',
                            width: 140,
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
                            id: 'practitioner',
                            header: 'Nakes',
                            width: 170,
                            cell: (row) => (
                                <DataTableText>
                                    {row.practitioner_name ?? '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'room',
                            header: 'Ruangan',
                            width: 140,
                            cell: (row) => (
                                <DataTableText multiline>
                                    <span className="block">
                                        {row.room_name ?? '—'}
                                    </span>
                                    {row.called_at && (
                                        <span className="block text-muted-foreground tabular-nums">
                                            Dipanggil {timeText(row.called_at)}
                                        </span>
                                    )}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 130,
                            cell: (row) => (
                                <DataTableText>
                                    <DestinationStatusText
                                        status={row.status}
                                    />
                                </DataTableText>
                            ),
                        },
                    ]}
                />
            </div>
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/healthcare/examination/queue',
    layout: 'app',
    title: 'Antrean poli',
    validateSearch: searchSchema,
    component: QueuePage,
});
