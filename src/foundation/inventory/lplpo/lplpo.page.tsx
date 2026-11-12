import { Button } from '@operations-metta/ui/button';
import { dateValue, displayDate } from '@operations-metta/ui/date-picker';
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
import {
    LocationLookup,
    OperatingUnitLookup,
    type Location,
    type OperatingUnit,
} from '../location/location-lookup.tsx';
import type { Reference } from '@operations-metta/ui/master-lookup';
import { ReportDataTable, ReportDate } from '../report-controls.tsx';
import { downloadCsv } from '../report-table.ts';
import { lplpoTable } from './lplpo-table.ts';

// LPLPO (Laporan Pemakaian dan Lembar Permintaan Obat) satu lokasi atau satu operating unit untuk satu periode, langsung
// dari kartu gudang. Belum ada mesin cetak; unduhan CSV berisi persis baris yang tampil.

const route = getRouteApi('/_app/sysadmin/inventory/lplpo');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const searchSchema = z.object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    location: z.string().max(100).optional(),
    unit: z.string().max(100).optional(),
    category: z.string().max(100).optional(),
});
type Search = z.infer<typeof searchSchema>;
type Scope = 'location' | 'unit';

const scopeLabels: Record<Scope, string> = {
    location: 'Satu lokasi',
    unit: 'Semua lokasi satu operating unit',
};
const isScope = (value: string): value is Scope =>
    Object.hasOwn(scopeLabels, value);

const previousMonth = () => {
    const today = new Date();
    return {
        from: dateValue(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: dateValue(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
};

function LplpoPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const month = previousMonth();
    const from = search.from ?? month.from;
    const to = search.to ?? month.to;
    const [scope, setScope] = useState<Scope>(
        search.unit ? 'unit' : 'location',
    );
    const [filtersOpen, setFiltersOpen] = useState(
        !search.location && !search.unit,
    );
    const filterPanelId = useId();
    // Lokasi, operating unit, dan kategori yang dipilih di filter; URL hanya menyimpan id-nya.
    const [pickedLocation, setPickedLocation] = useState<Location | null>(null);
    const [pickedUnit, setPickedUnit] = useState<OperatingUnit | null>(null);
    const [pickedCategory, setPickedCategory] = useState<ItemCategory | null>(
        null,
    );
    const shownScope: Scope = search.unit
        ? 'unit'
        : search.location
          ? 'location'
          : scope;

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
    const unitQuery = useQuery({
        queryKey: ['inventory-operating-unit', search.unit],
        queryFn: async () => {
            const found = (
                await api.inventoryLocationOperatingUnits({
                    query: { record_id: search.unit ?? '' },
                })
            ).body.data[0];
            return found ? { ...found, code: found.number ?? '' } : null;
        },
        enabled: Boolean(search.unit) && pickedUnit?.id !== search.unit,
    });
    const unit: Reference | null = search.unit
        ? pickedUnit?.id === search.unit
            ? pickedUnit
            : (unitQuery.data ?? null)
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

    const chosen = Boolean(search.location || search.unit);
    const report = useQuery({
        queryKey: [
            'inventory-lplpo',
            from,
            to,
            search.location,
            search.unit,
            search.category,
        ],
        queryFn: async () =>
            lplpoTable(
                (
                    await api.inventoryLplpo({
                        query: {
                            from,
                            to,
                            ...(search.location
                                ? { location_id: search.location }
                                : {}),
                            ...(search.unit
                                ? { operating_unit_id: search.unit }
                                : {}),
                            ...(search.category
                                ? { category_id: search.category }
                                : {}),
                        },
                    })
                ).body,
            ),
        enabled: chosen,
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
    const filtered = Boolean(search.category || search.from || search.to);
    const scopeName =
        shownScope === 'unit'
            ? unit
                ? `Operating unit ${unit.name}`
                : null
            : location
              ? `${location.code} · ${location.name}`
              : null;
    const period = `${displayDate(from)}–${displayDate(to)}`;

    const table = report.data;

    return (
        <ListPageLayout
            header={
                <RecordActionBar
                    title={scopeName ? `LPLPO · ${scopeName}` : 'LPLPO'}
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
                                downloadCsv(`LPLPO ${from} ${to}.csv`, table)
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
                                    label="Dari tanggal"
                                    value={from}
                                    max={to}
                                    onChange={(next) =>
                                        setSearch({ from: next })
                                    }
                                />
                                <ReportDate
                                    label="Sampai tanggal"
                                    value={to}
                                    min={from}
                                    onChange={(next) => setSearch({ to: next })}
                                />
                                <FormControl hint="Satu operating unit menggabungkan semua lokasinya, misalnya gudang dan apotek satu puskesmas. Kiriman antarlokasinya tidak dihitung sebagai penerimaan atau pemakaian.">
                                    <Select
                                        label="Cakupan"
                                        required
                                        items={Object.entries(scopeLabels).map(
                                            ([value, label]) => ({
                                                value,
                                                label,
                                            }),
                                        )}
                                        value={shownScope}
                                        onValueChange={(value) => {
                                            if (!value || !isScope(value))
                                                return;
                                            setScope(value);
                                            setSearch({
                                                location: undefined,
                                                unit: undefined,
                                            });
                                        }}
                                        searchPlaceholder="Cari cakupan"
                                        emptyMessage="Cakupan tidak ditemukan."
                                    />
                                </FormControl>
                                {shownScope === 'location' ? (
                                    <LocationLookup
                                        label="Lokasi"
                                        required
                                        transit={false}
                                        field="location"
                                        value={location}
                                        onChange={(next) => {
                                            setPickedLocation(next);
                                            setSearch({ location: next.id });
                                        }}
                                    />
                                ) : (
                                    <OperatingUnitLookup
                                        label="Operating unit"
                                        required
                                        field="unit"
                                        value={unit}
                                        onChange={(next) => {
                                            setPickedUnit(next);
                                            setSearch({ unit: next.id });
                                        }}
                                    />
                                )}
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
                                {filtered && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="command"
                                        className="justify-self-start"
                                        onClick={() =>
                                            setSearch({
                                                category: undefined,
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
                chosen ? (
                    <p className="p-3 text-sm text-muted-foreground">
                        {report.isError
                            ? errorText(
                                  report.error,
                                  'LPLPO belum bisa dimuat.',
                              )
                            : report.data
                              ? `Periode ${period} · ${report.data.rows.length} barang`
                              : `Periode ${period} · memuat…`}
                    </p>
                ) : null
            }
        >
            {chosen ? (
                <ReportDataTable
                    table={report.data ?? { columns: [], rows: [] }}
                    emptyMessage={
                        report.isPending
                            ? 'Memuat LPLPO…'
                            : 'Tidak ada stok, gerak, permintaan, atau stok optimum barang pada periode ini.'
                    }
                />
            ) : (
                <Empty>
                    <EmptyHeader>
                        <EmptyTitle>Pilih lokasi</EmptyTitle>
                        <EmptyDescription>
                            LPLPO disusun untuk satu lokasi atau semua lokasi
                            satu operating unit. Pilih cakupannya di panel
                            filter.
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
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/lplpo',
    layout: 'app',
    title: 'LPLPO',
    validateSearch: searchSchema,
    component: LplpoPage,
});
