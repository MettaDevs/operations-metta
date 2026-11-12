import { Button } from '@operations-metta/ui/button';
import { dateValue, displayDate } from '@operations-metta/ui/date-picker';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Select } from '@operations-metta/ui/select';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { Download, FilterX } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage, errorText } from '../../../platform/shell/index.ts';
import {
    ItemCategoryLookup,
    type ItemCategory,
} from '../item-category/item-category-lookup.tsx';
import { ItemLookup, type Item } from '../item/item-lookup.tsx';
import { LocationLookup, type Location } from '../location/location-lookup.tsx';
import type { Reference } from '../master-lookup.tsx';
import { ReportDataTable, ReportDate } from '../report-controls.tsx';
import { downloadCsv } from '../report-table.ts';
import { stockByLocationTable } from './stock-by-location-table.ts';

// Stok per lokasi per tanggal (Inventory - Availability di BC), dengan batch, kedaluwarsa, nilai, dan total per barang.
// Lokasi transit hanya tampil bila dipilih sebagai saringan lokasi.

const route = getRouteApi('/_app/sysadmin/inventory/stock-by-location');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const expiryLabels = {
    all: 'Semua',
    expiring: 'Hampir kedaluwarsa',
    expired: 'Sudah kedaluwarsa',
} as const;
type ExpiryChoice = keyof typeof expiryLabels;
const isExpiryChoice = (value: unknown): value is ExpiryChoice =>
    typeof value === 'string' && Object.hasOwn(expiryLabels, value);
const searchSchema = z.object({
    as_of: isoDate.optional(),
    location: z.string().max(100).optional(),
    category: z.string().max(100).optional(),
    item: z.string().max(100).optional(),
    expiry: z.custom<Exclude<ExpiryChoice, 'all'>>(isExpiryChoice).optional(),
    days: z.string().max(4).optional(),
});
type Search = z.infer<typeof searchSchema>;
const defaultDays = '90';

function StockByLocationPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const asOf = search.as_of ?? dateValue(new Date());
    const days = search.days ?? defaultDays;
    const [filtersOpen, setFiltersOpen] = useState(true);
    const filterPanelId = useId();
    // Master yang dipilih di filter; URL hanya menyimpan id-nya.
    const [pickedLocation, setPickedLocation] = useState<Location | null>(null);
    const [pickedCategory, setPickedCategory] = useState<ItemCategory | null>(
        null,
    );
    const [pickedItem, setPickedItem] = useState<Item | null>(null);

    const locationQuery = useQuery({
        queryKey: ['inventory-location', search.location],
        queryFn: async () =>
            (
                await api.inventoryLocationList({
                    query: { record_id: search.location ?? '' },
                })
            ).body.data[0] ?? null,
        enabled:
            Boolean(search.location) && pickedLocation?.id !== search.location,
    });
    const location: Reference | null = search.location
        ? pickedLocation?.id === search.location
            ? pickedLocation
            : (locationQuery.data ?? null)
        : null;
    const categoryQuery = useQuery({
        queryKey: ['inventory-item-category', search.category],
        queryFn: async () =>
            (
                await api.inventoryItemCategoryList({
                    query: { record_id: search.category ?? '' },
                })
            ).body.data[0] ?? null,
        enabled:
            Boolean(search.category) && pickedCategory?.id !== search.category,
    });
    const category: Reference | null = search.category
        ? pickedCategory?.id === search.category
            ? pickedCategory
            : (categoryQuery.data ?? null)
        : null;
    const itemQuery = useQuery({
        queryKey: ['inventory-item', search.item],
        queryFn: async () =>
            (
                await api.inventoryItemList({
                    query: { record_id: search.item ?? '' },
                })
            ).body.data[0] ?? null,
        enabled: Boolean(search.item) && pickedItem?.id !== search.item,
    });
    const item: Reference | null = search.item
        ? pickedItem?.id === search.item
            ? pickedItem
            : (itemQuery.data ?? null)
        : null;

    const report = useQuery({
        queryKey: [
            'inventory-stock-by-location',
            asOf,
            search.location,
            search.category,
            search.item,
            search.expiry,
            days,
        ],
        queryFn: async () =>
            stockByLocationTable(
                (
                    await api.inventoryStockByLocation({
                        query: {
                            as_of: asOf,
                            ...(search.location
                                ? { location_id: search.location }
                                : {}),
                            ...(search.category
                                ? { category_id: search.category }
                                : {}),
                            ...(search.item ? { item_id: search.item } : {}),
                            ...(search.expiry
                                ? {
                                      expiry: search.expiry,
                                      ...(search.expiry === 'expiring'
                                          ? { days }
                                          : {}),
                                  }
                                : {}),
                        },
                    })
                ).body,
            ),
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
        search.as_of ||
        search.location ||
        search.category ||
        search.item ||
        search.expiry,
    );
    const items = report.data
        ? report.data.rows.filter((row) => row.total).length
        : 0;

    const table = report.data;

    return (
        <ListPageLayout
            header={
                <RecordActionBar
                    title="Stok per lokasi"
                    filter={{
                        open: filtersOpen,
                        onOpenChange: setFiltersOpen,
                        active: filtered,
                        controls: filterPanelId,
                    }}
                >
                    {table && table.rows.length > 0 && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            onClick={() =>
                                downloadCsv(
                                    `Stok per lokasi ${asOf}.csv`,
                                    table,
                                )
                            }
                        >
                            <Download aria-hidden="true" />
                            Unduh CSV
                        </Button>
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
                                <ReportDate
                                    label="Stok per tanggal"
                                    value={asOf}
                                    onChange={(next) =>
                                        setSearch({ as_of: next })
                                    }
                                />
                                <LocationLookup
                                    label="Lokasi"
                                    field="location"
                                    hint="Tanpa pilihan lokasi, semua lokasi tampil kecuali lokasi transit. Pilih lokasi transit untuk melihat barang yang sedang dalam perjalanan."
                                    value={location}
                                    onChange={(next) => {
                                        setPickedLocation(next);
                                        setSearch({ location: next.id });
                                    }}
                                />
                                <ItemCategoryLookup
                                    label="Kategori"
                                    field="category"
                                    hint="Termasuk semua subkategorinya."
                                    value={category}
                                    onChange={(next) => {
                                        setPickedCategory(next);
                                        setSearch({ category: next.id });
                                    }}
                                />
                                <ItemLookup
                                    label="Barang"
                                    includeBlocked
                                    field="item"
                                    value={item}
                                    onChange={(next) => {
                                        setPickedItem(next);
                                        setSearch({ item: next.id });
                                    }}
                                />
                                <FormControl hint="Dihitung dari tanggal stok. Batch tanpa tanggal kedaluwarsa tidak ikut saringan ini.">
                                    <Select
                                        label="Kedaluwarsa"
                                        items={Object.entries(expiryLabels).map(
                                            ([value, label]) => ({
                                                value,
                                                label,
                                            }),
                                        )}
                                        value={search.expiry ?? 'all'}
                                        onValueChange={(value) =>
                                            setSearch({
                                                expiry:
                                                    isExpiryChoice(value) &&
                                                    value !== 'all'
                                                        ? value
                                                        : undefined,
                                            })
                                        }
                                        searchPlaceholder="Cari pilihan"
                                        emptyMessage="Pilihan tidak ditemukan."
                                    />
                                </FormControl>
                                {search.expiry === 'expiring' && (
                                    <FormControl
                                        error={
                                            report.isError &&
                                            !/^\d+$/.test(days)
                                                ? 'Isi jumlah hari.'
                                                : undefined
                                        }
                                    >
                                        <Input
                                            label="Dalam berapa hari"
                                            required
                                            inputMode="numeric"
                                            maxLength={4}
                                            value={days}
                                            onChange={(event) =>
                                                setSearch({
                                                    days: event.target.value,
                                                })
                                            }
                                        />
                                    </FormControl>
                                )}
                                {filtered && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="command"
                                        className="justify-self-start"
                                        onClick={() =>
                                            setSearch({
                                                as_of: undefined,
                                                location: undefined,
                                                category: undefined,
                                                item: undefined,
                                                expiry: undefined,
                                                days: undefined,
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
                <p className="p-3 text-sm text-muted-foreground">
                    {report.isError
                        ? errorText(report.error, 'Stok belum bisa dimuat.')
                        : report.data
                          ? `Stok per ${displayDate(asOf)} · ${items} barang`
                          : 'Memuat stok…'}
                </p>
            }
        >
            <ReportDataTable
                table={report.data ?? { columns: [], rows: [] }}
                emptyMessage={
                    report.isPending
                        ? 'Memuat stok…'
                        : 'Tidak ada stok yang cocok dengan filter pada tanggal ini.'
                }
            />
        </ListPageLayout>
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/stock-by-location',
    layout: 'app',
    title: 'Stok per lokasi',
    validateSearch: searchSchema,
    component: StockByLocationPage,
});
