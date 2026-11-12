import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { getRouteApi } from '@tanstack/react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage } from '../../../platform/shell/index.ts';
import type { Reference } from '../master-lookup.tsx';
import { ItemCategoryCard } from './item-category-card.tsx';
import type { ItemCategory } from './item-category-lookup.tsx';

// Kategori barang sebagai pohon (Item Categories di BC). Server mengirim urutan pohon beserta depth dan has_children;
// menutup kategori hanya menyembunyikan turunannya yang sudah dimuat. Hasil pencarian tampil rata, karena induk baris
// yang cocok belum tentu ikut cocok.

const route = getRouteApi('/_app/sysadmin/inventory/item-categories');
const searchSchema = z.object({ q: z.string().max(200).optional() });

type Open =
    | { kind: 'record'; category: ItemCategory }
    | { kind: 'new'; parent: Reference | null };

function visibleRows(
    rows: ItemCategory[],
    collapsed: ReadonlySet<string>,
): ItemCategory[] {
    const shown: ItemCategory[] = [];
    let hiddenBelow: number | null = null;
    for (const row of rows) {
        if (hiddenBelow !== null && row.depth > hiddenBelow) continue;
        hiddenBelow = collapsed.has(row.id) ? row.depth : null;
        shown.push(row);
    }
    return shown;
}

function ItemCategoriesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Open | null>(null);
    const [canManage, setCanManage] = useState(false);
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
        () => new Set(),
    );
    const tree = !search.q;
    const loader = useCallback<ListLoader<ItemCategory>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.inventoryItemCategoryList(
                { query: { q: query, ...(cursor ? { cursor } : {}) } },
                { signal },
            );
            setCanManage(body.can_manage);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (category) => category.id,
    });
    const toggle = (id: string) =>
        setCollapsed((current) => {
            const next = new Set(current);
            if (!next.delete(id)) next.add(id);
            return next;
        });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Kategori barang"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: { q: q || undefined },
                                    replace: true,
                                }),
                            label: 'Cari kategori barang',
                            placeholder: 'Cari kode atau nama...',
                        }}
                    >
                        {canManage && (
                            <ActionButton
                                action="create"
                                onClick={() =>
                                    setOpen({ kind: 'new', parent: null })
                                }
                            />
                        )}
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} kategori dimuat
                    </p>
                }
            >
                <DataTable
                    data={
                        tree ? visibleRows(list.items, collapsed) : list.items
                    }
                    getRowKey={(category) => category.id}
                    getRowLabel={(category) => category.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[
                        { id: 'open', label: 'Buka' },
                        ...(canManage
                            ? [
                                  {
                                      id: 'new-child',
                                      label: 'Baru di bawah kategori ini',
                                  },
                              ]
                            : []),
                    ]}
                    onRowAction={(action, category) =>
                        setOpen(
                            action === 'new-child'
                                ? { kind: 'new', parent: category }
                                : { kind: 'record', category },
                        )
                    }
                    onRowClick={(category) =>
                        setOpen({ kind: 'record', category })
                    }
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada kategori barang yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada kategori barang yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 220,
                            cell: (category) =>
                                tree ? (
                                    <span
                                        className="flex min-w-0 items-center gap-1"
                                        style={{
                                            paddingInlineStart: `${category.depth * 1.25}rem`,
                                        }}
                                    >
                                        {category.has_children ? (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                aria-expanded={
                                                    !collapsed.has(category.id)
                                                }
                                                aria-label={`${collapsed.has(category.id) ? 'Tampilkan' : 'Sembunyikan'} kategori di bawah ${category.name}`}
                                                onClick={() =>
                                                    toggle(category.id)
                                                }
                                                onDoubleClick={(event) =>
                                                    event.stopPropagation()
                                                }
                                            >
                                                {collapsed.has(category.id) ? (
                                                    <ChevronRight aria-hidden="true" />
                                                ) : (
                                                    <ChevronDown aria-hidden="true" />
                                                )}
                                            </Button>
                                        ) : (
                                            <span
                                                aria-hidden="true"
                                                className="size-6 shrink-0"
                                            />
                                        )}
                                        <DataTableText>
                                            {category.code}
                                        </DataTableText>
                                    </span>
                                ) : (
                                    <DataTableText>
                                        {category.code}
                                    </DataTableText>
                                ),
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 260,
                            cell: (category) => (
                                <DataTableText>{category.name}</DataTableText>
                            ),
                        },
                        {
                            id: 'parent',
                            header: 'Induk',
                            width: 220,
                            cell: (category) => (
                                <DataTableText>
                                    {category.parent?.name ?? ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'tracking_code',
                            header: 'Profil pelacakan',
                            width: 220,
                            cell: (category) => (
                                <DataTableText>
                                    {category.tracking_code?.name ?? ''}
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
                    <PageDialogContent title="Kategori barang">
                        <ItemCategoryCard
                            key={
                                open.kind === 'new'
                                    ? `new:${open.parent?.id ?? ''}`
                                    : `${open.category.id}:${open.category.version}`
                            }
                            record={
                                open.kind === 'record' ? open.category : null
                            }
                            parent={open.kind === 'new' ? open.parent : null}
                            canManage={canManage}
                            onSaved={(category) => {
                                setOpen({ kind: 'record', category });
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
    path: '/sysadmin/inventory/item-categories',
    layout: 'app',
    title: 'Kategori barang',
    validateSearch: searchSchema,
    component: ItemCategoriesPage,
});
