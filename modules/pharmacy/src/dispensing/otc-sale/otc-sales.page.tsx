import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker } from '@operations-metta/ui/date-picker';
import { displayNumber } from '@operations-metta/ui/display-number';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { getRouteApi } from '@tanstack/react-router';
import { FilterX } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage, type ApiBody } from '@core/platform/shell/index.ts';
import { clockText } from '../prescription/prescription-display.tsx';
import { OtcSaleCard, PaidBadge } from './otc-sale-card.tsx';

// Daftar penjualan obat bebas yang sudah terjadi, bawaannya hari ini. Membuka satu penjualan menampilkan kartunya, tempat
// obatnya diretur.

const route = getRouteApi('/_app/pharmacy/dispensing/otc-sales');
type Row = ApiBody<'pharmacyOtcSaleList'>['data'][number];
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    from: z.string().max(10).optional(),
    to: z.string().max(10).optional(),
    sale: z.string().max(100).optional(),
});
type Search = z.infer<typeof searchSchema>;

// Tanggal hari ini di peramban, sebagai bawaan filter.
function today(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function OtcSalesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const [initial] = useState(today);
    const from = search.from ?? initial;
    const to = search.to ?? initial;
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
    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.pharmacyOtcSaleList(
                {
                    query: {
                        q: query,
                        from,
                        to,
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
        [from, to],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (row) => row.id,
    });
    const filtered = search.from !== undefined || search.to !== undefined;
    const openSale = (id: string) => setSearch({ sale: id }, false);

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Daftar penjualan obat bebas"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari penjualan',
                            placeholder: 'Cari nomor penjualan atau pembeli...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: filtered,
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
                                            label="Dari tanggal"
                                            value={from}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    from: value || undefined,
                                                })
                                            }
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <DatePicker
                                            label="Sampai tanggal"
                                            value={to}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    to: value || undefined,
                                                })
                                            }
                                        />
                                    </FormControl>
                                    {filtered && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="command"
                                            className="justify-self-start"
                                            onClick={() =>
                                                setSearch({
                                                    from: undefined,
                                                    to: undefined,
                                                })
                                            }
                                        >
                                            <FilterX aria-hidden="true" />
                                            Kembali ke hari ini
                                        </Button>
                                    )}
                                </FormGrid>
                            </div>
                        </FilterPane>
                    ) : null
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} penjualan dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) => row.number}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, row) => openSale(row.id)}
                    onRowClick={(row) => openSale(row.id)}
                    activeRowKey={search.sale}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage="Belum ada penjualan obat bebas pada tanggal ini."
                    columns={[
                        {
                            id: 'number',
                            header: 'No penjualan',
                            width: 200,
                            cell: (row) => (
                                <DataTableText>{row.number}</DataTableText>
                            ),
                            sortValue: (row) => row.number,
                        },
                        {
                            id: 'handed_over_at',
                            header: 'Waktu',
                            width: 100,
                            cell: (row) => (
                                <DataTableText>
                                    <span className="tabular-nums">
                                        {clockText(row.handed_over_at)}
                                    </span>
                                </DataTableText>
                            ),
                            sortValue: (row) => row.handed_over_at,
                        },
                        {
                            id: 'location',
                            header: 'Lokasi',
                            width: 180,
                            cell: (row) => (
                                <DataTableText>
                                    {row.location.name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.location.name,
                        },
                        {
                            id: 'buyer_name',
                            header: 'Pembeli',
                            width: 220,
                            cell: (row) => (
                                <DataTableText>
                                    {row.buyer_name ?? 'Pembeli umum'}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.buyer_name ?? '',
                        },
                        {
                            id: 'total',
                            header: 'Total',
                            width: 130,
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>
                                    <span className="tabular-nums">
                                        {displayNumber(row.total)}
                                    </span>
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'paid',
                            header: 'Pembayaran',
                            width: 130,
                            cell: (row) => <PaidBadge paid={row.paid} />,
                        },
                    ]}
                />
            </ListPageLayout>
            {search.sale && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setSearch({ sale: undefined }, false);
                    }}
                >
                    <PageDialogContent title="Penjualan obat bebas">
                        <OtcSaleCard
                            key={search.sale}
                            saleId={search.sale}
                            onChanged={() => list.reload()}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/pharmacy/dispensing/otc-sales',
    layout: 'app',
    title: 'Daftar penjualan obat bebas',
    validateSearch: searchSchema,
    component: OtcSalesPage,
});
