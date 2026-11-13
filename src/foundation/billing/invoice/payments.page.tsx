import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    api,
    definePage,
    type ApiBody,
} from '../../../platform/shell/index.ts';

// Daftar Pembayaran (List Data Pembayaran Kuta 1): kunjungan yang selesai diperiksa dalam rentang tanggal, dengan
// lencana Belum Bayar, Sudah Bayar, dan Total. Bayar membuka Form Pembayaran kunjungan itu.

type Visit = ApiBody<'billingVisitList'>['data'][number];
type Counts = ApiBody<'billingVisitList'>['counts'];

const route = getRouteApi('/_app/billing/payments');
const ALL = 'all';
const statusLabels = { unpaid: 'Belum Bayar', paid: 'Sudah Bayar' } as const;
const isStatus = (value: unknown): value is keyof typeof statusLabels =>
    value === 'unpaid' || value === 'paid';
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    from: z.string().regex(datePattern).optional(),
    to: z.string().regex(datePattern).optional(),
    status: z.custom<keyof typeof statusLabels>(isStatus).optional(),
});
type Search = z.infer<typeof searchSchema>;

function PaymentsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [counts, setCounts] = useState<Counts | null>(null);
    const [range, setRange] = useState({ from: '', to: '' });
    const filterPanelId = useId();
    const { from, to, status } = search;
    const loader = useCallback<ListLoader<Visit>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.billingVisitList(
                {
                    query: {
                        q: query,
                        ...(from ? { from } : {}),
                        ...(to ? { to } : {}),
                        ...(status ? { status } : {}),
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            setCounts(body.counts);
            setRange({ from: body.from, to: body.to });
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [from, to, status],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (visit) => visit.id,
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
    const open = (visit: Visit) =>
        void navigate({
            to: '/billing/payments/$visitId',
            params: { visitId: visit.id },
        });

    return (
        <ListPageLayout
            header={
                <RecordActionBar
                    title="List Data Pembayaran"
                    search={{
                        value: search.q ?? '',
                        onValueChange: (q) => setSearch({ q }),
                        label: 'Cari pasien',
                        placeholder:
                            'Cari NRM, nama pasien, atau no. registrasi...',
                    }}
                    filter={{
                        open: filtersOpen,
                        onOpenChange: setFiltersOpen,
                        active: Boolean(from || to || status),
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
                                        label="Dari Tanggal"
                                        value={from ?? range.from}
                                        onValueChange={(next) => {
                                            if (datePattern.test(next))
                                                setSearch({ from: next });
                                        }}
                                    />
                                </FormControl>
                                <FormControl>
                                    <DatePicker
                                        label="Sampai Tanggal"
                                        value={to ?? range.to}
                                        onValueChange={(next) => {
                                            if (datePattern.test(next))
                                                setSearch({ to: next });
                                        }}
                                    />
                                </FormControl>
                                <FormControl>
                                    <Select
                                        label="Status Bayar"
                                        items={[
                                            {
                                                value: ALL,
                                                label: '-- Semua --',
                                            },
                                            ...Object.entries(statusLabels).map(
                                                ([value, label]) => ({
                                                    value,
                                                    label,
                                                }),
                                            ),
                                        ]}
                                        value={status ?? ALL}
                                        onValueChange={(value) =>
                                            setSearch({
                                                status: isStatus(value)
                                                    ? value
                                                    : undefined,
                                            })
                                        }
                                        searchPlaceholder="Cari status"
                                        emptyMessage="Pilihan tidak ditemukan."
                                    />
                                </FormControl>
                            </FormGrid>
                        </div>
                    </FilterPane>
                ) : undefined
            }
            footer={
                <div className="flex flex-wrap items-center gap-2 p-3 text-sm text-muted-foreground">
                    {counts && (
                        <>
                            <Badge variant="outline">
                                Belum Bayar: {counts.unpaid}
                            </Badge>
                            <Badge variant="secondary">
                                Sudah Bayar: {counts.paid}
                            </Badge>
                            <Badge variant="outline">
                                Total: {counts.total}
                            </Badge>
                        </>
                    )}
                    {range.from && (
                        <span>
                            {range.from === range.to
                                ? displayDate(range.from)
                                : `${displayDate(range.from)} s/d ${displayDate(range.to)}`}
                        </span>
                    )}
                </div>
            }
        >
            <DataTable
                data={list.items}
                getRowKey={(visit) => visit.id}
                getRowLabel={(visit) =>
                    `${visit.registration_number} ${visit.patient_name}`
                }
                showRowNumbers
                actionsPlacement="inline"
                actions={[{ id: 'open', label: 'Bayar' }]}
                onRowAction={(_, visit) => open(visit)}
                onRowClick={open}
                sort={list.sort}
                onSortChange={list.onSortChange}
                serverSort
                incremental={list}
                emptyMessage="Belum ada kunjungan selesai yang cocok di rentang tanggal ini."
                columns={[
                    {
                        id: 'registered_at',
                        header: 'Tgl Masuk',
                        width: 150,
                        cell: (visit) => (
                            <DataTableText>
                                {new Date(visit.registered_at).toLocaleString(
                                    'id-ID',
                                    { dateStyle: 'short', timeStyle: 'short' },
                                )}
                            </DataTableText>
                        ),
                        sortValue: (visit) => visit.registered_at,
                    },
                    {
                        id: 'registration_number',
                        header: 'NoReg',
                        width: 170,
                        cell: (visit) => (
                            <DataTableText>
                                {visit.registration_number}
                            </DataTableText>
                        ),
                        sortValue: (visit) => visit.registration_number,
                    },
                    {
                        id: 'patient_name',
                        header: 'Data Pasien',
                        width: 260,
                        cell: (visit) => (
                            <DataTableText>
                                {`${visit.patient_medical_record_number} · ${visit.patient_name} · ${visit.patient_type_name}`}
                            </DataTableText>
                        ),
                        sortValue: (visit) => visit.patient_name,
                    },
                    {
                        id: 'sections',
                        header: 'Status',
                        width: 200,
                        cell: (visit) => (
                            <DataTableText>{visit.sections}</DataTableText>
                        ),
                    },
                    {
                        id: 'paid',
                        header: 'Status periksa',
                        width: 130,
                        cell: (visit) => (
                            <Badge
                                variant={visit.paid ? 'secondary' : 'outline'}
                            >
                                {visit.paid ? 'Sudah Bayar' : 'Belum Bayar'}
                            </Badge>
                        ),
                    },
                ]}
            />
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/billing/payments',
    layout: 'app',
    title: 'Pembayaran',
    validateSearch: searchSchema,
    component: PaymentsPage,
});
