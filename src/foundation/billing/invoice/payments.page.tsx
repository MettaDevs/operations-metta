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
import { Hourglass } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    api,
    definePage,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import { useVisitHolds } from './visit-holds.ts';

// Daftar Pembayaran (List Data Pembayaran Kuta 1): kunjungan yang selesai diperiksa dan penjualan tanpa kunjungan
// (misalnya obat bebas di loket farmasi) dalam rentang tanggal, dengan lencana Belum Bayar, Sudah Bayar, dan Total. Bayar
// membuka Form Pembayaran tagihan itu, termasuk untuk membayar ulang penjualan yang pembayarannya dibatalkan atau
// dikoreksi nota kredit. Kunjungan belum bayar yang
// masih menunggu, misalnya resep yang belum disiapkan farmasi, membawa lencana tunggunya, dan Siap Dibayar menyaring
// kunjungan belum bayar yang tidak menunggu apa pun. Lencana tunggu dibaca ulang berkala (visit-holds.ts), jadi
// kunjungan yang resepnya baru disiapkan langsung masuk Siap Dibayar tanpa memuat ulang daftar.

type Bill = ApiBody<'billingVisitList'>['data'][number];
type Counts = ApiBody<'billingVisitList'>['counts'];

// Isi kolom daftar untuk kedua jenis tagihan.
function cells(bill: Bill) {
    switch (bill.kind) {
        case 'visit':
            return {
                time: bill.registered_at,
                number: bill.registration_number,
                party: `${bill.patient_medical_record_number} · ${bill.patient_name} · ${bill.patient_type_name}`,
                status: bill.sections,
            };
        case 'sale':
            return {
                time: bill.sold_at,
                number: bill.number,
                party: bill.buyer_name ?? 'Pembeli umum',
                status: 'Penjualan',
            };
        default: {
            const unhandled: never = bill;
            return unhandled;
        }
    }
}

const route = getRouteApi('/_app/billing/payments');
const ALL = 'all';
const statusLabels = {
    unpaid: 'Belum Bayar',
    ready: 'Siap Dibayar',
    paid: 'Sudah Bayar',
} as const;
const isStatus = (value: unknown): value is keyof typeof statusLabels =>
    value === 'unpaid' || value === 'ready' || value === 'paid';
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
    const loader = useCallback<ListLoader<Bill>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.billingVisitList(
                {
                    query: {
                        q: query,
                        ...(from ? { from } : {}),
                        ...(to ? { to } : {}),
                        ...(status
                            ? {
                                  status:
                                      status === 'ready' ? 'unpaid' : status,
                              }
                            : {}),
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
        getKey: (bill) => bill.id,
    });
    const holds = useVisitHolds(range);
    const bills =
        status === 'ready'
            ? holds
                ? list.items.filter((bill) => !holds.has(bill.id))
                : []
            : list.items;
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
    const open = (bill: Bill) =>
        void navigate({
            to: '/billing/payments/$visitId',
            params: { visitId: bill.id },
        });

    return (
        <ListPageLayout
            header={
                <RecordActionBar
                    title="List Data Pembayaran"
                    search={{
                        value: search.q ?? '',
                        onValueChange: (q) => setSearch({ q }),
                        label: 'Cari tagihan',
                        placeholder:
                            'Cari NRM, nama pasien atau pembeli, atau nomor...',
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
                data={bills}
                getRowKey={(bill) => bill.id}
                getRowLabel={(bill) =>
                    `${cells(bill).number} ${cells(bill).party}`
                }
                showRowNumbers
                actionsPlacement="inline"
                actions={[{ id: 'open', label: 'Bayar' }]}
                onRowAction={(_, bill) => open(bill)}
                onRowClick={open}
                sort={list.sort}
                onSortChange={list.onSortChange}
                serverSort
                incremental={list}
                emptyMessage="Belum ada tagihan yang cocok di rentang tanggal ini."
                columns={[
                    {
                        id: 'time',
                        header: 'Tgl Masuk',
                        width: 150,
                        cell: (bill) => (
                            <DataTableText>
                                {new Date(cells(bill).time).toLocaleString(
                                    'id-ID',
                                    { dateStyle: 'short', timeStyle: 'short' },
                                )}
                            </DataTableText>
                        ),
                        sortValue: (bill) => cells(bill).time,
                    },
                    {
                        id: 'number',
                        header: 'Nomor',
                        width: 170,
                        cell: (bill) => (
                            <DataTableText>{cells(bill).number}</DataTableText>
                        ),
                        sortValue: (bill) => cells(bill).number,
                    },
                    {
                        id: 'name',
                        header: 'Pasien / Pembeli',
                        width: 260,
                        cell: (bill) => (
                            <DataTableText>{cells(bill).party}</DataTableText>
                        ),
                        sortValue: (bill) => cells(bill).party,
                    },
                    {
                        id: 'sections',
                        header: 'Status',
                        width: 200,
                        cell: (bill) => (
                            <DataTableText>{cells(bill).status}</DataTableText>
                        ),
                    },
                    {
                        id: 'paid',
                        header: 'Status periksa',
                        width: 300,
                        cell: (bill) => (
                            <div className="flex flex-wrap gap-1">
                                <Badge
                                    variant={
                                        bill.paid ? 'secondary' : 'outline'
                                    }
                                >
                                    {bill.paid ? 'Sudah Bayar' : 'Belum Bayar'}
                                </Badge>
                                {holds?.get(bill.id)?.map((hold) => (
                                    <Badge key={hold} variant="outline">
                                        <Hourglass aria-hidden="true" />
                                        {hold}
                                    </Badge>
                                ))}
                            </div>
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
