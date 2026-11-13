import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import type { DataTableColumn } from '@operations-metta/ui/data-table';
import {
    DatePicker,
    dateValue,
    displayDate,
    parseDate,
} from '@operations-metta/ui/date-picker';
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from '@operations-metta/ui/empty';
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
import { getRouteApi, Link } from '@tanstack/react-router';
import { FilterX } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    api,
    definePage,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import {
    displayAmount,
    displayNumber,
} from '@operations-metta/ui/display-number';
import { ItemCard } from '../item/item-card.tsx';
import { ItemLookup, type Item } from '../item/item-lookup.tsx';
import { LocationCard } from '../location/location-card.tsx';
import { LocationLookup, type Location } from '../location/location-lookup.tsx';
import {
    MasterLookup,
    type LookupRequest,
    type Reference,
} from '@operations-metta/ui/master-lookup';

// Kartu stok (Item Ledger Entries di BC): gerak stok satu barang dalam satu periode, langsung dari kartu gudang.

type Entry = ApiBody<'inventoryItemLedgerEntries'>['data'][number];
type EntryKind = Entry['kind'];
type Batch = ApiBody<'inventoryItemBatches'>['data'][number];
type BatchOption = Reference & { expiry_date: string | null };

const kindLabels: Record<EntryKind, string> = {
    penerimaan: 'Penerimaan',
    penyerahan: 'Penyerahan',
    penyesuaian_tambah: 'Penyesuaian tambah',
    penyesuaian_kurang: 'Penyesuaian kurang',
    transfer: 'Transfer',
    pemakaian: 'Pemakaian',
};
const isKind = (value: unknown): value is EntryKind =>
    typeof value === 'string' && Object.hasOwn(kindLabels, value);

const route = getRouteApi('/_app/sysadmin/inventory/item-ledger-entries');
const ALL = 'all';
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const searchSchema = z.object({
    item: z.string().max(100).optional(),
    location: z.string().max(100).optional(),
    batch: z.string().max(100).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    kind: z.custom<EntryKind>(isKind).optional(),
});
type Search = z.infer<typeof searchSchema>;

const currentMonth = () => {
    const today = new Date();
    return {
        from: dateValue(new Date(today.getFullYear(), today.getMonth(), 1)),
        to: dateValue(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
};

const batchOption = (batch: Batch): BatchOption => ({
    id: batch.id,
    code: batch.batch_number,
    name: batch.expiry_date
        ? `${batch.batch_number} · ${displayDate(batch.expiry_date)}`
        : batch.batch_number,
    expiry_date: batch.expiry_date,
});

const optional = (value: string | null | undefined) => value ?? '—';

// Hanya dokumen yang sudah punya layar yang ditautkan; jenis lain tetap teks.
function DocumentNumber({ document }: { document: Entry['document'] }) {
    const className =
        'truncate text-primary underline-offset-4 hover:underline';
    if (document.number && document.type === 'penyesuaian')
        return (
            <Link
                to="/sysadmin/inventory/adjustments"
                search={{ document: document.id }}
                className={className}
            >
                {document.number}
            </Link>
        );
    if (document.number && document.type === 'opname')
        return (
            <Link
                to="/sysadmin/inventory/stock-counts"
                search={{ document: document.id }}
                className={className}
            >
                {document.number}
            </Link>
        );
    return <DataTableText>{optional(document.number)}</DataTableText>;
}

// Tanggal periode tinggal di URL. Ketikan yang belum menjadi tanggal sah ditahan di sini, supaya URL tidak pernah
// menerima teks setengah jadi.
function PeriodDate({
    label,
    value,
    min,
    max,
    onChange,
}: {
    label: string;
    value: string;
    min?: string;
    max?: string;
    onChange: (value: string) => void;
}): ReactNode {
    const [typing, setTyping] = useState({ source: value, text: value });
    return (
        <FormControl>
            <DatePicker
                label={label}
                required
                min={min}
                max={max}
                value={typing.source === value ? typing.text : value}
                onValueChange={(next) => {
                    const valid = parseDate(next) !== undefined;
                    setTyping({ source: valid ? next : value, text: next });
                    if (valid) onChange(next);
                }}
            />
        </FormControl>
    );
}

type Creating = 'item' | 'location';

function ItemLedgerEntriesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const { item: itemId, location: locationId, batch: batchId, kind } = search;
    const month = currentMonth();
    const from = search.from ?? month.from;
    const to = search.to ?? month.to;
    const [filtersOpen, setFiltersOpen] = useState(!itemId);
    const [creating, setCreating] = useState<Creating | null>(null);
    // Barang dan lokasi yang dipilih di filter; URL hanya menyimpan id-nya.
    const [pickedItem, setPickedItem] = useState<Item | null>(null);
    const [pickedLocation, setPickedLocation] = useState<Location | null>(null);
    const [pickedBatch, setPickedBatch] = useState<BatchOption | null>(null);
    const [amountDecimals, setAmountDecimals] = useState(0);
    const [opening, setOpening] = useState<{
        key: string;
        balance: string;
    } | null>(null);
    const filterPanelId = useId();
    const filterKey = JSON.stringify([
        itemId,
        locationId,
        batchId,
        kind,
        from,
        to,
    ]);

    // Tautan dari kartu barang hanya membawa id; nama barang dan lokasi dibaca lewat daftarnya.
    const itemQuery = useQuery({
        queryKey: ['inventory-item', itemId],
        queryFn: async () =>
            (
                await api.inventoryItemList({
                    query: { record_id: itemId ?? '' },
                })
            ).body.data[0] ?? null,
        enabled: Boolean(itemId) && pickedItem?.id !== itemId,
    });
    const item =
        pickedItem?.id === itemId ? pickedItem : (itemQuery.data ?? null);
    const locationQuery = useQuery({
        queryKey: ['inventory-location', locationId],
        queryFn: async () =>
            (
                await api.inventoryLocationList({
                    query: { record_id: locationId ?? '' },
                })
            ).body.data[0] ?? null,
        enabled: Boolean(locationId) && pickedLocation?.id !== locationId,
    });
    const location: Reference | null = locationId
        ? pickedLocation?.id === locationId
            ? pickedLocation
            : (locationQuery.data ?? null)
        : null;
    // Saringan batch hanya ditawarkan untuk barang yang memang punya batch; satu baris cukup untuk mengetahuinya.
    const hasBatches = useQuery({
        queryKey: ['inventory-item-batches', itemId, 'any'],
        queryFn: async () =>
            (
                await api.inventoryItemBatches({
                    params: { id: itemId ?? '' },
                    query: { per_page: 1 },
                })
            ).body.data.length > 0,
        enabled: Boolean(itemId),
    });
    const batchQuery = useQuery({
        queryKey: ['inventory-item-batches', itemId, batchId],
        queryFn: async () => {
            const [found] = (
                await api.inventoryItemBatches({
                    params: { id: itemId ?? '' },
                    query: { record_id: batchId ?? '' },
                })
            ).body.data;
            return found ? batchOption(found) : null;
        },
        enabled: Boolean(itemId && batchId) && pickedBatch?.id !== batchId,
    });
    const batch: BatchOption | null = batchId
        ? pickedBatch?.id === batchId
            ? pickedBatch
            : (batchQuery.data ?? null)
        : null;
    const loadBatches = useCallback(
        async ({ query, cursor, signal }: LookupRequest) => {
            const { body } = await api.inventoryItemBatches(
                {
                    params: { id: itemId ?? '' },
                    query: { q: query, ...(cursor ? { cursor } : {}) },
                },
                { signal },
            );
            return {
                items: body.data.map(batchOption),
                nextCursor: body.next_cursor,
            };
        },
        [itemId],
    );

    const loader = useCallback<ListLoader<Entry>>(
        async ({ cursor, sort, signal }) => {
            if (!itemId) return { items: [], nextCursor: null };
            const { body } = await api.inventoryItemLedgerEntries(
                {
                    query: {
                        item_id: itemId,
                        from,
                        to,
                        ...(locationId ? { location_id: locationId } : {}),
                        ...(batchId ? { batch_id: batchId } : {}),
                        ...(kind ? { kind } : {}),
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            setOpening({ key: filterKey, balance: body.opening_balance });
            setAmountDecimals(body.amount_decimals);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [itemId, locationId, batchId, kind, from, to, filterKey],
    );
    const list = useIncrementalList({
        loadItems: loader,
        active: Boolean(itemId),
        getKey: (entry) => entry.id,
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
    const filtered = Boolean(
        locationId || batchId || kind || search.from || search.to,
    );
    const unit = item?.base_unit.code ?? '';
    const openingText =
        opening?.key === filterKey
            ? kind
                ? 'Saldo tidak ditampilkan karena daftar hanya memuat satu jenis gerak.'
                : `Saldo awal per ${displayDate(from)}: ${displayNumber(opening.balance)} ${unit}`
            : null;

    const columns: DataTableColumn<Entry>[] = [
        {
            id: 'posting_date',
            header: 'Tanggal',
            width: 110,
            cell: (entry) => (
                <DataTableText>{displayDate(entry.posting_date)}</DataTableText>
            ),
            sortValue: (entry) => entry.posting_date,
        },
        {
            id: 'kind',
            header: 'Jenis',
            width: 260,
            cell: (entry) => (
                <span className="flex min-w-0 items-center gap-2">
                    <DataTableText>{kindLabels[entry.kind]}</DataTableText>
                    {entry.reversed_entry_id && (
                        <Badge variant="outline">Pembalik</Badge>
                    )}
                </span>
            ),
        },
        {
            id: 'document',
            header: 'No. dokumen',
            width: 160,
            cell: (entry) => <DocumentNumber document={entry.document} />,
        },
        {
            id: 'location',
            header: 'Lokasi',
            width: 200,
            cell: (entry) => (
                <DataTableText>
                    {`${entry.location.code} · ${entry.location.name}`}
                </DataTableText>
            ),
        },
        {
            id: 'batch',
            header: 'Batch',
            width: 130,
            cell: (entry) => (
                <DataTableText>
                    {optional(entry.batch?.batch_number)}
                </DataTableText>
            ),
        },
        {
            id: 'expiry_date',
            header: 'Kedaluwarsa',
            width: 120,
            cell: (entry) => (
                <DataTableText>
                    {entry.batch?.expiry_date
                        ? displayDate(entry.batch.expiry_date)
                        : '—'}
                </DataTableText>
            ),
        },
        {
            id: 'quantity',
            header: 'Jumlah',
            width: 110,
            align: 'right',
            cell: (entry) => (
                <DataTableText>{displayNumber(entry.quantity)}</DataTableText>
            ),
        },
        {
            id: 'remaining_quantity',
            header: 'Sisa',
            description:
                'Bagian baris yang belum terpakai: stok yang masih ada pada baris masuk, atau kekurangan pada baris keluar.',
            width: 110,
            align: 'right',
            cell: (entry) => (
                <DataTableText>
                    {displayNumber(entry.remaining_quantity)}
                </DataTableText>
            ),
        },
        {
            id: 'cost_amount',
            header: 'Nilai',
            width: 140,
            align: 'right',
            cell: (entry) => (
                <DataTableText>
                    {displayAmount(entry.cost_amount, amountDecimals)}
                </DataTableText>
            ),
        },
        // Saldo berjalan dihitung atas baris yang lolos saringan; dengan saringan jenis ia bukan saldo stok.
        ...(kind
            ? []
            : [
                  {
                      id: 'balance',
                      header: 'Saldo',
                      width: 120,
                      align: 'right' as const,
                      cell: (entry: Entry) => (
                          <DataTableText>
                              {displayNumber(entry.balance)}
                          </DataTableText>
                      ),
                  },
              ]),
    ];

    const created = (target: Creating): { title: string; card: ReactNode } => {
        const close = () => setCreating(null);
        switch (target) {
            case 'item':
                return {
                    title: 'Barang',
                    card: (
                        <ItemCard
                            record={null}
                            canManage
                            onSaved={(saved) => {
                                close();
                                setPickedItem(saved);
                                setSearch({ item: saved.id, batch: undefined });
                            }}
                            onClose={close}
                        />
                    ),
                };
            case 'location':
                return {
                    title: 'Lokasi',
                    card: (
                        <LocationCard
                            record={null}
                            canManage
                            onSaved={(saved) => {
                                close();
                                setPickedLocation(saved);
                                setSearch({ location: saved.id });
                            }}
                            onClose={close}
                        />
                    ),
                };
            default: {
                const unknown: never = target;
                throw new Error(`Unknown master: ${String(unknown)}`);
            }
        }
    };
    const nested = creating ? created(creating) : null;

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title={
                            item
                                ? `Kartu stok · ${item.code} ${item.name}`
                                : 'Kartu stok'
                        }
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
                                    <ItemLookup
                                        label="Barang"
                                        includeBlocked
                                        required
                                        field="item"
                                        value={item}
                                        onChange={(next) => {
                                            setPickedItem(next);
                                            setSearch({
                                                item: next.id,
                                                batch: undefined,
                                            });
                                        }}
                                        onCreate={() => setCreating('item')}
                                    />
                                    <LocationLookup
                                        label="Lokasi"
                                        field="location"
                                        value={location}
                                        onChange={(next) => {
                                            setPickedLocation(next);
                                            setSearch({ location: next.id });
                                        }}
                                        onCreate={() => setCreating('location')}
                                    />
                                    {Boolean(
                                        itemId && (batchId || hasBatches.data),
                                    ) && (
                                        <MasterLookup<BatchOption>
                                            label="Batch"
                                            field="batch"
                                            value={batch}
                                            onChange={(next) => {
                                                setPickedBatch(next);
                                                setSearch({ batch: next.id });
                                            }}
                                            noun="Batch"
                                            placeholder="Cari nomor batch…"
                                            load={loadBatches}
                                            columns={[
                                                {
                                                    id: 'code',
                                                    header: 'Batch',
                                                    width: 140,
                                                    cell: (row) => row.code,
                                                },
                                                {
                                                    id: 'expiry_date',
                                                    header: 'Kedaluwarsa',
                                                    width: 120,
                                                    cell: (row) =>
                                                        row.expiry_date
                                                            ? displayDate(
                                                                  row.expiry_date,
                                                              )
                                                            : '—',
                                                },
                                            ]}
                                        />
                                    )}
                                    <PeriodDate
                                        label="Dari tanggal"
                                        value={from}
                                        max={to}
                                        onChange={(next) =>
                                            setSearch({ from: next })
                                        }
                                    />
                                    <PeriodDate
                                        label="Sampai tanggal"
                                        value={to}
                                        min={from}
                                        onChange={(next) =>
                                            setSearch({ to: next })
                                        }
                                    />
                                    <FormControl>
                                        <Select
                                            label="Jenis"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua jenis',
                                                },
                                                ...Object.entries<string>(
                                                    kindLabels,
                                                ).map(([value, label]) => ({
                                                    value,
                                                    label,
                                                })),
                                            ]}
                                            value={kind ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    kind: isKind(value)
                                                        ? value
                                                        : undefined,
                                                })
                                            }
                                            searchPlaceholder="Cari jenis"
                                            emptyMessage="Jenis tidak ditemukan."
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
                                                    location: undefined,
                                                    batch: undefined,
                                                    kind: undefined,
                                                    from: undefined,
                                                    to: undefined,
                                                })
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
                    itemId ? (
                        <p className="p-3 text-sm text-muted-foreground">
                            {[openingText, `${list.items.length} baris dimuat`]
                                .filter(Boolean)
                                .join(' · ')}
                        </p>
                    ) : null
                }
            >
                {itemId ? (
                    <DataTable
                        data={list.items}
                        getRowKey={(entry) => entry.id}
                        getRowLabel={(entry) =>
                            `${displayDate(entry.posting_date)} ${kindLabels[entry.kind]}`
                        }
                        showRowNumbers
                        sort={list.sort}
                        onSortChange={list.onSortChange}
                        serverSort
                        incremental={list}
                        emptyMessage="Tidak ada gerak stok yang cocok pada periode ini."
                        columns={columns}
                    />
                ) : (
                    <Empty>
                        <EmptyHeader>
                            <EmptyTitle>Pilih barang</EmptyTitle>
                            <EmptyDescription>
                                Kartu stok menampilkan gerak stok satu barang.
                                Pilih barangnya di panel filter.
                            </EmptyDescription>
                        </EmptyHeader>
                        {!filtersOpen && (
                            <EmptyContent>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setFiltersOpen(true)}
                                >
                                    Buka filter
                                </Button>
                            </EmptyContent>
                        )}
                    </Empty>
                )}
            </ListPageLayout>
            {nested && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setCreating(null);
                    }}
                >
                    <PageDialogContent title={nested.title}>
                        {nested.card}
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/item-ledger-entries',
    layout: 'app',
    title: 'Kartu stok',
    validateSearch: searchSchema,
    component: ItemLedgerEntriesPage,
});
