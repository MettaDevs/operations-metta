import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
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
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { FilterX } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage, errorText } from '../../../platform/shell/index.ts';
import { displayNumber } from '../display-number.ts';
import { ItemCategoryCard } from '../item-category/item-category-card.tsx';
import {
    ItemCategoryLookup,
    type ItemCategory,
} from '../item-category/item-category-lookup.tsx';
import type { Reference } from '../master-lookup.tsx';
import { ItemCard } from './item-card.tsx';
import type { Item } from './item-lookup.tsx';

// Daftar barang (Items di BC). Barang yang dibuka tersimpan di URL (?item=), supaya tautan dari layar lain dan tombol
// Bagikan di kartu membuka barang yang sama.

const route = getRouteApi('/_app/sysadmin/inventory/items');
const ALL = 'all';
const searchSchema = z.object({
    q: z.string().max(200).optional(),
    category: z.string().max(100).optional(),
    status: z.enum(['active', 'blocked']).optional(),
    item: z.string().max(100).optional(),
});
type Search = z.infer<typeof searchSchema>;
type Status = NonNullable<Search['status']>;
const statusLabels: Record<Status, string> = {
    active: 'Aktif',
    blocked: 'Diblokir',
};
const isStatus = (value: string | null): value is Status =>
    value !== null && Object.hasOwn(statusLabels, value);

function ItemsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [creating, setCreating] = useState(false);
    const [createKey, setCreateKey] = useState(0);
    // Baris terakhir yang dibuka atau disimpan, supaya kartu tidak menunggu daftar dimuat ulang.
    const [opened, setOpened] = useState<Item | null>(null);
    const [canManage, setCanManage] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    // Nama kategori yang dipilih di filter; URL hanya menyimpan id-nya.
    const [pickedCategory, setPickedCategory] = useState<ItemCategory | null>(
        null,
    );
    const [creatingCategory, setCreatingCategory] = useState(false);
    const filterPanelId = useId();
    const { category: categoryId, status, item: itemId } = search;
    const loader = useCallback<ListLoader<Item>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.inventoryItemList(
                {
                    query: {
                        q: query,
                        ...(categoryId ? { category_id: categoryId } : {}),
                        ...(status
                            ? {
                                  blocked:
                                      status === 'blocked' ? 'true' : 'false',
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
            setCanManage(body.can_manage);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [categoryId, status],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (item) => item.id,
    });
    const listed = list.items.find((item) => item.id === itemId);
    const kept = opened?.id === itemId ? opened : undefined;
    // Tautan dari layar lain bisa menunjuk barang yang belum ada di batch daftar yang dimuat.
    const fetched = useQuery({
        queryKey: ['inventory-item', itemId],
        queryFn: async () => {
            const { body } = await api.inventoryItemList({
                query: { record_id: itemId ?? '' },
            });
            return body.data[0] ?? null;
        },
        enabled: Boolean(itemId) && !listed && !kept,
    });
    const record = itemId ? (kept ?? listed ?? fetched.data ?? null) : null;

    const setSearch = (next: Partial<Search>, replace = true) =>
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
        });
    const openItem = (item: Item) => {
        setOpened(item);
        setCreating(false);
        setSearch({ item: item.id }, false);
    };
    const closeCard = () => {
        setCreating(false);
        if (itemId) setSearch({ item: undefined }, false);
        list.reload();
    };
    const shownCategory = (): Reference | null => {
        if (!categoryId) return null;
        if (pickedCategory?.id === categoryId) return pickedCategory;
        return (
            list.items.find((item) => item.category?.id === categoryId)
                ?.category ?? null
        );
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Barang"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) => setSearch({ q }),
                            label: 'Cari barang',
                            placeholder: 'Cari kode atau nama...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(categoryId || status),
                            controls: filterPanelId,
                        }}
                    >
                        {canManage && (
                            <ActionButton
                                action="create"
                                onClick={() => {
                                    setSearch({ item: undefined });
                                    setCreateKey((key) => key + 1);
                                    setCreating(true);
                                }}
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
                                    <ItemCategoryLookup
                                        label="Kategori"
                                        field="category"
                                        value={shownCategory()}
                                        onChange={(category) => {
                                            setPickedCategory(category);
                                            setSearch({
                                                category: category.id,
                                            });
                                        }}
                                        onCreate={() =>
                                            setCreatingCategory(true)
                                        }
                                    />
                                    <FormControl>
                                        <Select
                                            label="Status"
                                            items={[
                                                { value: ALL, label: 'Semua' },
                                                ...Object.entries<string>(
                                                    statusLabels,
                                                ).map(([value, label]) => ({
                                                    value,
                                                    label,
                                                })),
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
                                            emptyMessage="Status tidak ditemukan."
                                        />
                                    </FormControl>
                                    {(categoryId || status) && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="command"
                                            className="justify-self-start"
                                            onClick={() =>
                                                setSearch({
                                                    category: undefined,
                                                    status: undefined,
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
                        {list.items.length} barang dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(item) => item.id}
                    getRowLabel={(item) => item.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, item) => openItem(item)}
                    onRowClick={openItem}
                    activeRowKey={itemId}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada barang yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada barang yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 140,
                            cell: (item) => (
                                <DataTableText>{item.code}</DataTableText>
                            ),
                            sortValue: (item) => item.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 280,
                            cell: (item) => (
                                <DataTableText>{item.name}</DataTableText>
                            ),
                            sortValue: (item) => item.name,
                        },
                        {
                            id: 'unit',
                            header: 'Satuan',
                            width: 90,
                            cell: (item) => (
                                <DataTableText>
                                    {item.base_unit.code}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'category',
                            header: 'Kategori',
                            width: 180,
                            cell: (item) => (
                                <DataTableText>
                                    {item.category?.name ?? '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'tracking_code',
                            header: 'Profil pelacakan',
                            width: 180,
                            cell: (item) => (
                                <DataTableText>
                                    {item.tracking_code?.name ?? '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'inventory',
                            header: 'Stok',
                            width: 110,
                            align: 'right',
                            cell: (item) => (
                                <DataTableText>
                                    {displayNumber(item.inventory)}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (item) =>
                                item.is_blocked ? (
                                    <Badge variant="outline">Diblokir</Badge>
                                ) : null,
                        },
                    ]}
                />
            </ListPageLayout>
            {(creating || itemId) && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) closeCard();
                    }}
                >
                    <PageDialogContent title="Barang">
                        {!itemId || record ? (
                            <ItemCard
                                key={
                                    record
                                        ? `${record.id}:${record.version}`
                                        : `new-${createKey}`
                                }
                                record={itemId ? record : null}
                                canManage={canManage}
                                onSaved={(item) => {
                                    setOpened(item);
                                    if (!itemId) setSearch({ item: item.id });
                                    list.reload();
                                }}
                                onClose={closeCard}
                            />
                        ) : (
                            <p
                                role={fetched.isError ? 'alert' : 'status'}
                                className={
                                    fetched.isError
                                        ? 'p-6 text-sm text-destructive'
                                        : 'p-6 text-sm text-muted-foreground'
                                }
                            >
                                {fetched.isError
                                    ? errorText(
                                          fetched.error,
                                          'Barang belum dapat dimuat.',
                                      )
                                    : fetched.isFetching
                                      ? 'Memuat barang…'
                                      : 'Barang ini tidak ditemukan. Mungkin sudah dihapus.'}
                            </p>
                        )}
                    </PageDialogContent>
                </PageDialog>
            )}
            {creatingCategory && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setCreatingCategory(false);
                    }}
                >
                    <PageDialogContent title="Kategori barang">
                        <ItemCategoryCard
                            record={null}
                            canManage
                            onSaved={(category) => {
                                setCreatingCategory(false);
                                setPickedCategory(category);
                                setSearch({ category: category.id });
                            }}
                            onClose={() => setCreatingCategory(false)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/inventory/items',
    layout: 'app',
    title: 'Barang',
    validateSearch: searchSchema,
    component: ItemsPage,
});
