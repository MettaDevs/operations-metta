import { Button } from '@operations-metta/ui/button';
import { Card, CardContent } from '@operations-metta/ui/card';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
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
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { FilterX } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    api,
    definePage,
    orpc,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import { PrescriptionCard } from './prescription-card.tsx';
import { ageText, clockText, durationText } from './prescription-display.tsx';

// Antrean resep farmasi. Lokasi dipilih sekali per perangkat, karena komputer farmasi berada di satu lokasi: farmasi
// biasa dan farmasi pusling hanya beda lokasi, diatur di Lokasi layanan resep.

const route = getRouteApi('/_app/pharmacy/dispensing/prescriptions');
type Row = ApiBody<'pharmacyPrescriptionList'>['data'][number];
const ALL = 'all';
const NONE = 'none';
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    location: z.string().max(100).optional(),
    date: z.string().max(10).optional(),
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

function PrescriptionsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const metadata = useQuery(
        orpc.pharmacyPrescriptionMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const { location, date } = search;
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
            }),
        [navigate],
    );
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
        [location, date],
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
                                    Setup › Lokasi layanan resep.
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
                        actions={[{ id: 'open', label: 'Buka' }]}
                        onRowAction={(_, row) =>
                            setSearch({ prescription: row.id }, false)
                        }
                        onRowClick={(row) =>
                            setSearch({ prescription: row.id }, false)
                        }
                        activeRowKey={search.prescription}
                        sort={list.sort}
                        onSortChange={list.onSortChange}
                        serverSort
                        incremental={list}
                        emptyMessage="Belum ada resep di antrean ini."
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
                                width: 170,
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
                                width: 180,
                                cell: (row) => (
                                    <DataTableText>
                                        {row.doctor_name ?? '—'}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'section',
                                header: 'Section asal',
                                width: 160,
                                cell: (row) => (
                                    <DataTableText>
                                        {row.section_name}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'location',
                                header: 'Lokasi farmasi',
                                width: 180,
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
                                            {durationText(row.issued_at, null)}
                                        </span>
                                    </DataTableText>
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
                        if (!next)
                            setSearch({ prescription: undefined }, false);
                    }}
                >
                    <PageDialogContent title="Resep">
                        <PrescriptionCard
                            key={search.prescription}
                            prescriptionId={search.prescription}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
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
