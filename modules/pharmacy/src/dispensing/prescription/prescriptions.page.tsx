import { Alert, AlertDescription } from '@operations-metta/ui/alert';
import { Button } from '@operations-metta/ui/button';
import { Card, CardContent } from '@operations-metta/ui/card';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import type { DataTableRowAction } from '@operations-metta/ui/data-table';
import { DatePicker } from '@operations-metta/ui/date-picker';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useRecordTransition } from '@operations-metta/ui/use-record-transition';
import { cn } from '@operations-metta/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { FilterX } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    ApiError,
    definePage,
    errorText,
    orpc,
    useUnsavedChangesGuard,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import { DispensingCard, StatusBadge } from '../dispensing/dispensing-card.tsx';
import { ageText, clockText, durationText } from './prescription-display.tsx';

// Antrean resep farmasi. Lokasi dipilih sekali per perangkat, karena komputer farmasi berada di satu lokasi: farmasi
// biasa dan farmasi pusling hanya beda lokasi, diatur di Lokasi layanan resep. Bawaannya resep yang menunggu disiapkan;
// penghitung status memindahkan daftar ke resep yang sudah disiapkan, dipanggil, atau diserahkan.

const route = getRouteApi('/_app/pharmacy/dispensing/prescriptions');
type Row = ApiBody<'pharmacyPrescriptionList'>['data'][number];
type Count = ApiBody<'pharmacyPrescriptionList'>['counts'][number];
type QueueStatus = Row['queue_status'];
const ALL = 'all';
const NONE = 'none';
const EVERY = 'semua';
const queueStatuses = [
    'menunggu',
    'disiapkan',
    'dipanggil',
    'diserahkan',
] as const satisfies readonly QueueStatus[];
const counterStatuses: (QueueStatus | typeof EVERY)[] = [
    ...queueStatuses,
    EVERY,
];
const statusLabels = {
    menunggu: 'Menunggu',
    disiapkan: 'Disiapkan',
    dipanggil: 'Dipanggil',
    diserahkan: 'Diserahkan',
} as const satisfies Record<QueueStatus, string>;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    location: z.string().max(100).optional(),
    date: z.string().max(10).optional(),
    status: z.enum([...queueStatuses, EVERY]).optional(),
    prescription: z.string().max(100).optional(),
});
type Search = z.infer<typeof searchSchema>;

// Lokasi terakhir di perangkat ini. Hanya kenyamanan: bila penyimpanan peramban diblokir, petugas memilih ulang.
const placeKey = 'pharmacy.queue.location';
function readPlace(): string | null {
    try {
        return localStorage.getItem(placeKey);
    } catch {
        return null;
    }
}
function rememberPlace(location: string | undefined): void {
    try {
        if (location) localStorage.setItem(placeKey, location);
        else localStorage.removeItem(placeKey);
    } catch {
        // Penyimpanan peramban diblokir: lokasi tidak diingat.
    }
}

function Counters({
    counts,
    active,
    onPick,
}: {
    counts: Count[] | null;
    active: QueueStatus | typeof EVERY;
    onPick: (status: QueueStatus | typeof EVERY) => void;
}): ReactNode {
    const total = (status: QueueStatus | typeof EVERY) => {
        if (!counts) return '…';
        const value =
            status === EVERY
                ? counts.reduce((sum, row) => sum + row.total, 0)
                : (counts.find((row) => row.status === status)?.total ?? 0);
        return value.toLocaleString('id-ID');
    };
    return (
        <div
            role="group"
            aria-label="Saring menurut status"
            className="flex flex-wrap items-center gap-1 text-xs"
        >
            {counterStatuses.map((status) => (
                <Button
                    key={status}
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-pressed={active === status}
                    onClick={() => onPick(status)}
                    className={cn(
                        'gap-1.5 rounded-full font-normal',
                        active === status && 'bg-accent font-semibold',
                    )}
                >
                    {status === EVERY ? 'Semua' : statusLabels[status]}
                    <span className="font-semibold tabular-nums">
                        {total(status)}
                    </span>
                </Button>
            ))}
        </div>
    );
}

function PrescriptionsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const metadata = useQuery(
        orpc.pharmacyPrescriptionMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const permissions = metadata.data?.permissions ?? {
        prepare: false,
        hand_over: false,
    };
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [counts, setCounts] = useState<Count[] | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [pending, setPending] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const transition = useRecordTransition(dirty, busy);
    const filterPanelId = useId();
    const { location, date } = search;
    const status = search.status ?? 'menunggu';
    const setSearch = useCallback(
        (next: Partial<Search>, replace = true) =>
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
                replace,
                ignoreBlocker: true,
            }),
        [navigate],
    );
    const closeCard = () => setSearch({ prescription: undefined }, false);
    const leaveGuard = useUnsavedChangesGuard(dirty, closeCard);
    useEffect(() => {
        if (location !== undefined) return;
        const remembered = readPlace();
        if (remembered) setSearch({ location: remembered });
    }, [location, setSearch]);
    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.pharmacyPrescriptionList(
                {
                    query: {
                        q: query,
                        ...(location ? { location } : {}),
                        ...(date ? { date } : {}),
                        ...(status === EVERY ? {} : { status }),
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            setCounts(body.counts);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [location, date, status],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (row) => row.id,
    });
    const pickLocation = (value: string | null) => {
        const next = value === null || value === ALL ? undefined : value;
        rememberPlace(next);
        setSearch({ location: next });
    };
    const openPrescription = (id: string) =>
        transition.request(() => setSearch({ prescription: id }, false));

    // Aksi cepat dari antrean memakai isian tersimpan atau usulan resep; perubahan jumlah dan batch dilakukan di kartu.
    const quick = async (
        row: Row,
        request: () => Promise<unknown>,
        done: string,
        failed: string,
    ) => {
        if (pending !== null) return;
        setPending(row.id);
        setMessage(null);
        try {
            await request();
            toast.success(done);
            list.reload();
        } catch (caught) {
            setMessage(
                caught instanceof ApiError && caught.status === 422
                    ? `${failed}: ${Object.values(caught.errors).flat()[0] ?? caught.message} Buka resepnya untuk mengubah jumlah, batch, atau lokasi.`
                    : errorText(caught, `${failed}.`),
            );
        } finally {
            setPending(null);
        }
    };
    const rowHandlers: Record<string, (row: Row) => void> = {
        open: (row) => openPrescription(row.id),
        prepare: (row) =>
            void quick(
                row,
                () =>
                    api.pharmacyDispensingPrepare({
                        params: { id: row.id },
                        body:
                            row.dispensing_version === null
                                ? {}
                                : { version: row.dispensing_version },
                    }),
                `Resep ${row.prescription_number} disiapkan.`,
                `Resep ${row.prescription_number} belum disiapkan`,
            ),
        call: (row) =>
            void quick(
                row,
                () =>
                    api.pharmacyDispensingCall({
                        params: { id: row.id },
                        body: {},
                    }),
                `${row.patient_name} dipanggil.`,
                `${row.patient_name} belum dipanggil`,
            ),
        'hand-over': (row) =>
            void quick(
                row,
                () =>
                    api.pharmacyDispensingHandOver({
                        params: { id: row.id },
                        body: { version: row.dispensing_version ?? 0 },
                    }),
                `Obat ${row.patient_name} sudah diserahkan.`,
                `Obat ${row.patient_name} belum diserahkan`,
            ),
    };
    const rowActions = (row: Row): DataTableRowAction[] => {
        const actions: DataTableRowAction[] = [];
        if (row.queue_status === 'menunggu' && permissions.prepare)
            actions.push({
                id: 'prepare',
                label: 'Siapkan',
            });
        if (
            (row.queue_status === 'disiapkan' ||
                row.queue_status === 'dipanggil') &&
            permissions.prepare
        )
            actions.push({
                id: 'call',
                label:
                    row.queue_status === 'dipanggil'
                        ? 'Panggil ulang'
                        : 'Panggil',
            });
        if (
            (row.queue_status === 'disiapkan' ||
                row.queue_status === 'dipanggil') &&
            permissions.hand_over
        )
            actions.push({
                id: 'hand-over',
                label: 'Serahkan',
            });
        actions.push({ id: 'open', label: 'Buka' });
        return actions;
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Antrean resep"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari resep di antrean',
                            placeholder:
                                'Cari nama pasien, NRM, nomor resep, atau dokter...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(date),
                            controls: filterPanelId,
                        }}
                        trailing={
                            <Counters
                                counts={counts}
                                active={status}
                                onPick={(next) =>
                                    setSearch({
                                        status:
                                            next === 'menunggu'
                                                ? undefined
                                                : next,
                                    })
                                }
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
                                            label="Tanggal resep"
                                            value={date ?? ''}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    date: value || undefined,
                                                })
                                            }
                                        />
                                    </FormControl>
                                    {date && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="command"
                                            className="justify-self-start"
                                            onClick={() =>
                                                setSearch({ date: undefined })
                                            }
                                        >
                                            <FilterX aria-hidden="true" />
                                            Hapus filter
                                        </Button>
                                    )}
                                </FormGrid>
                            </div>
                        </FilterPane>
                    ) : null
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} resep dimuat
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
                            <div className="w-72">
                                <Select
                                    label="Lokasi farmasi"
                                    className="w-full"
                                    items={[
                                        { value: ALL, label: 'Semua lokasi' },
                                        {
                                            value: NONE,
                                            label: 'Belum ada lokasi',
                                        },
                                        ...(metadata.data?.locations ?? []).map(
                                            (item) => ({
                                                value: item.id,
                                                label: `${item.code} · ${item.name}`,
                                            }),
                                        ),
                                    ]}
                                    value={location ?? ALL}
                                    onValueChange={pickLocation}
                                    searchPlaceholder="Cari lokasi"
                                    emptyMessage="Lokasi tidak ditemukan."
                                />
                            </div>
                            {location === NONE && (
                                <p className="text-sm text-muted-foreground">
                                    Resep ini belum punya lokasi farmasi. Atur
                                    lokasi untuk unit atau section asalnya di
                                    Setup › Lokasi layanan resep, atau pilih
                                    lokasinya di resep.
                                </p>
                            )}
                        </CardContent>
                    </Card>
                    <DataTable
                        data={list.items}
                        getRowKey={(row) => row.id}
                        getRowLabel={(row) =>
                            `${row.prescription_number} ${row.patient_name}`
                        }
                        showRowNumbers
                        actionsPlacement="inline"
                        getRowActions={rowActions}
                        onRowAction={(action, row) =>
                            rowHandlers[action]?.(row)
                        }
                        onRowClick={(row) => openPrescription(row.id)}
                        activeRowKey={search.prescription}
                        sort={list.sort}
                        onSortChange={list.onSortChange}
                        serverSort
                        incremental={list}
                        emptyMessage={
                            status === 'menunggu'
                                ? 'Belum ada resep yang menunggu disiapkan di lokasi ini.'
                                : 'Belum ada resep di antrean ini.'
                        }
                        columns={[
                            {
                                id: 'issued_at',
                                header: 'Diterbitkan',
                                width: 100,
                                cell: (row) => (
                                    <DataTableText>
                                        <span className="tabular-nums">
                                            {clockText(row.issued_at)}
                                        </span>
                                    </DataTableText>
                                ),
                                sortValue: (row) => row.issued_at,
                            },
                            {
                                id: 'prescription_number',
                                header: 'No resep',
                                width: 200,
                                cell: (row) => (
                                    <DataTableText>
                                        {row.prescription_number}
                                    </DataTableText>
                                ),
                                sortValue: (row) => row.prescription_number,
                            },
                            {
                                id: 'patient_name',
                                header: 'Pasien',
                                width: 240,
                                cell: (row) => (
                                    <DataTableText multiline>
                                        <span className="block font-medium">
                                            {row.patient_name}
                                        </span>
                                        <span className="block text-muted-foreground tabular-nums">
                                            {[
                                                row.medical_record_number,
                                                ageText(row.birth_date),
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </span>
                                    </DataTableText>
                                ),
                                sortValue: (row) => row.patient_name,
                            },
                            {
                                id: 'doctor',
                                header: 'Dokter',
                                width: 170,
                                cell: (row) => (
                                    <DataTableText>
                                        {row.doctor_name ?? '—'}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'section',
                                header: 'Section asal',
                                width: 150,
                                cell: (row) => (
                                    <DataTableText>
                                        {row.section_name}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'location',
                                header: 'Lokasi farmasi',
                                width: 170,
                                cell: (row) => (
                                    <DataTableText>
                                        {row.location ? (
                                            row.location.name
                                        ) : (
                                            <span className="text-warning">
                                                Belum ada lokasi
                                            </span>
                                        )}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'waiting',
                                header: 'Menunggu',
                                width: 110,
                                cell: (row) => (
                                    <DataTableText>
                                        <span className="tabular-nums">
                                            {durationText(
                                                row.issued_at,
                                                row.handed_over_at,
                                            )}
                                        </span>
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'status',
                                header: 'Status',
                                width: 120,
                                cell: (row) => (
                                    <StatusBadge
                                        status={row.dispensing_status}
                                    />
                                ),
                            },
                        ]}
                    />
                </div>
            </ListPageLayout>
            {search.prescription && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) transition.request(closeCard);
                    }}
                >
                    <PageDialogContent
                        ref={contentRef}
                        title="Penyerahan obat"
                        busy={busy}
                    >
                        <DispensingCard
                            key={search.prescription}
                            prescriptionId={search.prescription}
                            portalContainer={contentRef}
                            onChanged={() => list.reload()}
                            onBusyChange={setBusy}
                            onDirtyChange={setDirty}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
            {transition.confirmation}
            {leaveGuard}
        </>
    );
}

export const page = definePage({
    path: '/pharmacy/dispensing/prescriptions',
    layout: 'app',
    title: 'Antrean resep',
    validateSearch: searchSchema,
    component: PrescriptionsPage,
});
