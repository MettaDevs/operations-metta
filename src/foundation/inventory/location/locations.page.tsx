import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
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
import { getRouteApi } from '@tanstack/react-router';
import { FilterX } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage } from '../../../platform/shell/index.ts';
import type { Reference } from '@operations-metta/ui/master-lookup';
import {
    pickingLabels,
    transferLabels,
} from '../setup/stock-policy-options.tsx';
import { LocationCard } from './location-card.tsx';
import {
    OperatingUnitLookup,
    type Location,
    type OperatingUnit,
} from './location-lookup.tsx';

// Daftar lokasi (Locations di BC): gudang, apotek, dan lokasi transit milik legal entity yang aktif.

const route = getRouteApi('/_app/sysadmin/inventory/locations');
const ALL = 'all';
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    operating_unit: z.string().max(100).optional(),
    transit: z.enum(['true', 'false']).optional(),
});
type Search = z.infer<typeof searchSchema>;

const inherited = 'Ikuti setelan';

function LocationsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Location | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    // Nama operating unit yang dipilih di filter; URL hanya menyimpan id-nya.
    const [pickedUnit, setPickedUnit] = useState<OperatingUnit | null>(null);
    const filterPanelId = useId();
    const { operating_unit: unitId, transit } = search;
    const loader = useCallback<ListLoader<Location>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.inventoryLocationList(
                {
                    query: {
                        q: query,
                        ...(unitId ? { operating_unit_id: unitId } : {}),
                        ...(transit ? { transit } : {}),
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            setCanManage(body.can_manage);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [unitId, transit],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (location) => location.id,
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
    const shownUnit = (): Reference | null => {
        if (!unitId) return null;
        if (pickedUnit?.id === unitId) return pickedUnit;
        const fromRow = list.items.find(
            (location) => location.operating_unit.id === unitId,
        )?.operating_unit;
        return fromRow ? { ...fromRow, code: '' } : null;
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Lokasi"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari lokasi',
                            placeholder: 'Cari kode atau nama...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(unitId || transit),
                            controls: filterPanelId,
                        }}
                    >
                        {canManage && (
                            <ActionButton
                                action="create"
                                onClick={() => setOpen('new')}
                            />
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
                                    <OperatingUnitLookup
                                        label="Operating unit"
                                        field="operating_unit"
                                        value={shownUnit()}
                                        onChange={(unit) => {
                                            setPickedUnit(unit);
                                            setSearch({
                                                operating_unit: unit.id,
                                            });
                                        }}
                                    />
                                    <FormControl>
                                        <Select
                                            label="Lokasi transit"
                                            items={[
                                                {
                                                    value: ALL,
                                                    label: 'Semua lokasi',
                                                },
                                                {
                                                    value: 'true',
                                                    label: 'Hanya lokasi transit',
                                                },
                                                {
                                                    value: 'false',
                                                    label: 'Tanpa lokasi transit',
                                                },
                                            ]}
                                            value={transit ?? ALL}
                                            onValueChange={(value) =>
                                                setSearch({
                                                    transit:
                                                        value === 'true' ||
                                                        value === 'false'
                                                            ? value
                                                            : undefined,
                                                })
                                            }
                                            searchPlaceholder="Cari pilihan"
                                            emptyMessage="Pilihan tidak ditemukan."
                                        />
                                    </FormControl>
                                    {(unitId || transit) && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="command"
                                            className="justify-self-start"
                                            onClick={() =>
                                                setSearch({
                                                    operating_unit: undefined,
                                                    transit: undefined,
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
                        {list.items.length} lokasi dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(location) => location.id}
                    getRowLabel={(location) => location.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, location) => setOpen(location)}
                    onRowClick={(location) => setOpen(location)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada lokasi yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada lokasi yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 140,
                            cell: (location) => (
                                <DataTableText>{location.code}</DataTableText>
                            ),
                            sortValue: (location) => location.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 240,
                            cell: (location) => (
                                <DataTableText>{location.name}</DataTableText>
                            ),
                            sortValue: (location) => location.name,
                        },
                        {
                            id: 'operating_unit',
                            header: 'Operating unit',
                            width: 220,
                            cell: (location) => (
                                <DataTableText>
                                    {location.operating_unit.name}
                                </DataTableText>
                            ),
                            sortValue: (location) =>
                                location.operating_unit.name,
                        },
                        {
                            id: 'is_transit',
                            header: 'Transit',
                            width: 90,
                            cell: (location) => (
                                <DataTableText>
                                    {location.is_transit ? 'Ya' : 'Tidak'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'picking_method',
                            header: 'Cara pengambilan',
                            width: 180,
                            cell: (location) => (
                                <DataTableText>
                                    {location.picking_method
                                        ? pickingLabels[location.picking_method]
                                        : inherited}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'transfer_mode',
                            header: 'Cara mutasi',
                            width: 170,
                            cell: (location) => (
                                <DataTableText>
                                    {location.transfer_mode
                                        ? transferLabels[location.transfer_mode]
                                        : inherited}
                                </DataTableText>
                            ),
                        },
                    ]}
                />
            </ListPageLayout>
            {open && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpen(null);
                    }}
                >
                    <PageDialogContent title="Lokasi">
                        <LocationCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(location) => {
                                setOpen(location);
                                list.reload();
                            }}
                            onClose={() => {
                                setOpen(null);
                                list.reload();
                            }}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/locations',
    layout: 'app',
    title: 'Lokasi',
    validateSearch: searchSchema,
    component: LocationsPage,
});
