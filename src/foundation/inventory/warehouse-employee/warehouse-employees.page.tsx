import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormGrid } from '@operations-metta/ui/form-control';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import type { Reference } from '@operations-metta/ui/master-lookup';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { getRouteApi } from '@tanstack/react-router';
import { FilterX } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import {
    api,
    defineRecordPage,
    definePage,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import { LocationLookup } from '../location/location-lookup.tsx';
import {
    WarehouseEmployeeCard,
    type WarehouseEmployee,
} from './warehouse-employee-card.tsx';

// Petugas lokasi (Warehouse Employees di BC): siapa bekerja di lokasi stok mana. Lokasi yang ditandai khusus petugas
// hanya terlihat dan bisa dikerjakan petugasnya.

const route = getRouteApi('/_app/sysadmin/inventory/warehouse-employees');
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    location: z.string().max(100).optional(),
});

type ListLocation = ApiBody<'inventoryWarehouseEmployeeList'>['location'];

function EmployeeList({
    locationId,
    query,
    frame,
}: {
    locationId: string | undefined;
    query: string;
    frame: (
        state: {
            canManage: boolean;
            location: ListLocation;
            loaded: number;
            create: () => void;
        },
        table: ReactNode,
    ) => ReactNode;
}): ReactNode {
    const [open, setOpen] = useState<WarehouseEmployee | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const [location, setLocation] = useState<ListLocation>(null);
    const loader = useCallback<ListLoader<WarehouseEmployee>>(
        async ({ query: q, cursor, sort, signal }) => {
            const { body } = await api.inventoryWarehouseEmployeeList(
                {
                    query: {
                        q,
                        ...(locationId ? { location_id: locationId } : {}),
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                    },
                },
                { signal },
            );
            setCanManage(body.can_manage);
            setLocation(body.location);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [locationId],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query,
        getKey: (employee) => employee.id,
    });
    const fixedLocation: Reference | null = location
        ? { id: location.id, code: location.code, name: location.name }
        : null;

    return (
        <>
            {frame(
                {
                    canManage,
                    location,
                    loaded: list.items.length,
                    create: () => setOpen('new'),
                },
                <DataTable
                    data={list.items}
                    getRowKey={(employee) => employee.id}
                    getRowLabel={(employee) =>
                        `${employee.user.name} · ${employee.location.code}`
                    }
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, employee) => setOpen(employee)}
                    onRowClick={(employee) => setOpen(employee)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada petugas lokasi. Pilih Baru untuk menambahkan.'
                            : 'Belum ada petugas lokasi.'
                    }
                    columns={[
                        {
                            id: 'location',
                            header: 'Lokasi',
                            width: 220,
                            cell: (employee) => (
                                <DataTableText>
                                    {`${employee.location.code} · ${employee.location.name}`}
                                </DataTableText>
                            ),
                            sortValue: (employee) => employee.location.code,
                        },
                        {
                            id: 'user',
                            header: 'Pengguna',
                            width: 220,
                            cell: (employee) => (
                                <DataTableText>
                                    {employee.user.name}
                                </DataTableText>
                            ),
                            sortValue: (employee) => employee.user.name,
                        },
                        {
                            id: 'email',
                            header: 'Email',
                            width: 240,
                            cell: (employee) => (
                                <DataTableText>
                                    {employee.user.email}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'is_default',
                            header: 'Lokasi bawaan',
                            width: 130,
                            cell: (employee) => (
                                <DataTableText>
                                    {employee.is_default ? 'Ya' : 'Tidak'}
                                </DataTableText>
                            ),
                            sortValue: (employee) =>
                                String(employee.is_default),
                        },
                        {
                            id: 'restricted',
                            header: 'Khusus petugas',
                            width: 140,
                            cell: (employee) => (
                                <DataTableText>
                                    {employee.location.restricted_to_employees
                                        ? 'Ya'
                                        : 'Tidak'}
                                </DataTableText>
                            ),
                        },
                    ]}
                />,
            )}
            {open && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpen(null);
                    }}
                >
                    <PageDialogContent title="Petugas lokasi">
                        <WarehouseEmployeeCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            location={fixedLocation}
                            canManage={canManage}
                            onSaved={(employee) => {
                                setOpen(employee);
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

function WarehouseEmployeesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [filtersOpen, setFiltersOpen] = useState(false);
    const filterPanelId = useId();
    const setSearch = (next: Partial<z.infer<typeof searchSchema>>) =>
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

    return (
        <EmployeeList
            locationId={search.location}
            query={search.q ?? ''}
            frame={({ canManage, location, loaded, create }, table) => (
                <ListPageLayout
                    header={
                        <RecordActionBar
                            title="Petugas lokasi"
                            search={{
                                value: search.q ?? '',
                                onValueChange: (q) => setSearch({ q }),
                                label: 'Cari petugas lokasi',
                                placeholder: 'Cari lokasi, nama, atau email...',
                            }}
                            filter={{
                                open: filtersOpen,
                                onOpenChange: setFiltersOpen,
                                active: Boolean(search.location),
                                controls: filterPanelId,
                            }}
                        >
                            {canManage && (
                                <ActionButton
                                    action="create"
                                    onClick={create}
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
                                        <LocationLookup
                                            label="Lokasi"
                                            field="location"
                                            transit={false}
                                            value={location}
                                            onChange={(picked) =>
                                                setSearch({
                                                    location: picked.id,
                                                })
                                            }
                                        />
                                        {search.location && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="command"
                                                className="justify-self-start"
                                                onClick={() =>
                                                    setSearch({
                                                        location: undefined,
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
                            {`${loaded} petugas dimuat`}
                        </p>
                    }
                >
                    {table}
                </ListPageLayout>
            )}
        />
    );
}

// Dibuka dari penolakan "hanya untuk petugasnya": daftar petugas satu lokasi, tempat pengelola lokasi menambahkan
// pengguna yang ditolak.
function LocationEmployees({ id }: { id: string }): ReactNode {
    return (
        <EmployeeList
            locationId={id}
            query=""
            frame={({ canManage, location, create }, table) => (
                <LocationEmployeesFrame
                    canManage={canManage}
                    location={location}
                    create={create}
                >
                    {table}
                </LocationEmployeesFrame>
            )}
        />
    );
}

function LocationEmployeesFrame({
    canManage,
    location,
    create,
    children,
}: {
    canManage: boolean;
    location: ListLocation;
    create: () => void;
    children: ReactNode;
}): ReactNode {
    usePageDialogRecord({
        recordTitle: location ? `${location.code} ${location.name}` : '',
        editing: false,
        dirty: false,
    });
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {canManage && (
                <PageDialogToolbar>
                    <ActionButton action="create" onClick={create} />
                </PageDialogToolbar>
            )}
            <PageDialogBody className="flex min-h-0 flex-1 flex-col gap-3 py-3">
                {location && (
                    <p className="text-sm text-muted-foreground">
                        {location.restricted_to_employees
                            ? 'Resep dan dokumen stok lokasi ini hanya terlihat oleh petugas di bawah ini.'
                            : 'Lokasi ini terbuka untuk semua pengguna yang punya izin dokumennya. Nyalakan Khusus petugas lokasi di kartu lokasi untuk membatasinya.'}
                        {!canManage &&
                            location.restricted_to_employees &&
                            ' Minta pengelola lokasi stok menambahkan Anda sebagai petugas di sini.'}
                    </p>
                )}
                {children}
            </PageDialogBody>
        </div>
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/warehouse-employees',
    layout: 'app',
    title: 'Petugas lokasi',
    validateSearch: searchSchema,
    component: WarehouseEmployeesPage,
});

export const record = defineRecordPage({
    key: 'core.inventory-location',
    title: 'Petugas lokasi',
    component: LocationEmployees,
});
