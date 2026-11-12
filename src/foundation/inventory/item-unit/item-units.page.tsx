import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { FilterPane } from '@operations-metta/ui/filter-pane';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    ApiError,
    definePage,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../../platform/shell/index.ts';

// Satuan barang (Item Units of Measure di BC): satuan dasar berisi 1, lalu satuan kemasan seperti kotak atau strip
// beserta isinya dalam satuan dasar. Dokumen boleh memakai satuan mana pun dari daftar ini.

const route = getRouteApi('/_app/sysadmin/inventory/item-units');
type Item = ApiBody<'inventoryItemList'>['data'][number];
type ItemUnit = ApiBody<'inventoryItemUnitList'>['data'][number];
type Unit = ApiBody<'inventoryUnitOfMeasureList'>['data'][number];
type Errors = Record<string, string[]>;
const searchSchema = z.object({
    item_id: z.string().optional(),
    q: z.string().max(200).optional(),
});
const itemLabel = (item: { code: string; name: string }) =>
    `${item.code} - ${item.name}`;

function useItemLoader(): LookupLoader<Item> {
    return useCallback<LookupLoader<Item>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.inventoryItemList(
                { query: { q: query, ...(cursor ? { cursor } : {}) } },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
}

function ItemUnitCard({
    item,
    entry,
    canManage,
    portalContainer,
    onSaved,
    onClose,
}: {
    item: Item;
    entry: ItemUnit | null;
    canManage: boolean;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (entry: ItemUnit) => void;
    onClose: () => void;
}): ReactNode {
    const base = entry?.is_base ?? false;
    const editing = !base && (entry === null || canManage);
    const blank = {
        unit: entry
            ? { id: entry.id, code: entry.code, name: entry.name }
            : null,
        quantity: entry?.quantity_per_unit ?? '',
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    usePageDialogRecord({
        recordTitle: entry
            ? `${entry.code} ${itemLabel(item)}`
            : `Satuan baru ${itemLabel(item)}`,
        editing,
    });
    const loadUnits = useCallback<LookupLoader<Unit>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.inventoryUnitOfMeasureList(
                { query: { q: query, ...(cursor ? { cursor } : {}) } },
                { signal },
            );
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            item_id: item.id,
            unit_id: form.unit?.id ?? '',
            quantity_per_unit: form.quantity,
        };
        try {
            const { body: saved } = entry?.entry_id
                ? await api.inventoryItemUnitUpdate({
                      params: { id: entry.entry_id },
                      body: { ...body, version: entry.version },
                  })
                : await api.inventoryItemUnitCreate({ body });
            toast.success(entry ? 'Satuan diperbarui.' : 'Satuan dibuat.');
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Satuan belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!entry?.entry_id) return;
        if (
            !(await confirm({
                title: `Delete satuan ${entry.code} dari ${item.name}?`,
                description:
                    'Satuan ini tidak bisa dipilih lagi untuk barang ini. Dokumen yang sudah memakainya tetap menyimpan isinya.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.inventoryItemUnitDelete({
                params: { id: entry.entry_id },
                body: { version: entry.version },
            });
            toast.success('Satuan dihapus.');
            onClose();
        } catch (caught) {
            setMessage(errorText(caught, 'Satuan belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
                event.preventDefault();
                void save();
            }}
        >
            <PageDialogToolbar>
                {editing && (
                    <>
                        <ActionButton
                            action="save"
                            type="submit"
                            disabled={busy}
                            pending={busy}
                        />
                        <ActionButton
                            action="cancel"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                                if (!entry) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {entry?.entry_id && canManage && (
                    <ActionButton
                        action="archive"
                        disabled={busy}
                        onClick={() => void remove()}
                    />
                )}
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Satuan belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl>
                        <Input
                            label="Barang"
                            readOnly
                            value={itemLabel(item)}
                        />
                    </FormControl>
                    <FormControl
                        error={errors.unit_id?.[0]}
                        data-error-field="unit_id"
                    >
                        {editing ? (
                            <InlineLookup<Unit>
                                label="Satuan"
                                required
                                loadItems={loadUnits}
                                value={
                                    form.unit
                                        ? { ...form.unit, version: 0 }
                                        : null
                                }
                                onValueChange={(unit) =>
                                    setForm({
                                        ...form,
                                        unit: {
                                            id: unit.id,
                                            code: unit.code,
                                            name: unit.name,
                                        },
                                    })
                                }
                                getItemValue={(unit) => unit.id}
                                getItemLabel={(unit) =>
                                    `${unit.code} - ${unit.name}`
                                }
                                placeholder="Cari satuan…"
                                emptyMessage="Satuan tidak ditemukan."
                                columns={[
                                    {
                                        id: 'code',
                                        header: 'Kode',
                                        width: 100,
                                        cell: (unit) => unit.code,
                                    },
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        width: 200,
                                        cell: (unit) => unit.name,
                                    },
                                ]}
                                portalContainer={portalContainer}
                                showDetails={false}
                            />
                        ) : (
                            <Input
                                label="Satuan"
                                readOnly
                                value={
                                    form.unit
                                        ? `${form.unit.code} - ${form.unit.name}`
                                        : ''
                                }
                            />
                        )}
                    </FormControl>
                    <FormControl
                        error={errors.quantity_per_unit?.[0]}
                        hint={
                            base
                                ? 'Satuan dasar selalu berisi 1. Satuan dasar diganti di kartu barang.'
                                : `Berapa ${item.base_unit.code} dalam satu satuan ini, misalnya 100 untuk satu kotak berisi 100 ${item.base_unit.code}.`
                        }
                    >
                        <Input
                            label={`Isi dalam ${item.base_unit.code}`}
                            required
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            data-error-field="quantity_per_unit"
                            value={form.quantity}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    quantity: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}

function ItemUnitsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const loadItems = useItemLoader();
    const [item, setItem] = useState<Item | null>(null);
    const [open, setOpen] = useState<ItemUnit | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const itemId = search.item_id ?? null;
    const filterPanelId = useId();
    const [filtersOpen, setFiltersOpen] = useState(!itemId);

    // Barang dari alamat layar dibaca sekali, supaya label pilihannya tetap terbaca setelah muat ulang.
    useEffect(() => {
        if (!itemId || item?.id === itemId) return;
        const controller = new AbortController();
        void api
            .inventoryItemList(
                { query: { record_id: itemId } },
                { signal: controller.signal },
            )
            .then(({ body }) => setItem(body.data[0] ?? null))
            .catch(() => setItem(null));
        return () => controller.abort();
    }, [itemId, item?.id]);

    const loader = useCallback<ListLoader<ItemUnit>>(
        async ({ query, cursor, sort, signal }) => {
            if (!itemId) return { items: [], nextCursor: null };
            const { body } = await api.inventoryItemUnitList(
                {
                    query: {
                        item_id: itemId,
                        q: query,
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
        [itemId],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (entry) => entry.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Satuan barang"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: {
                                        ...(itemId ? { item_id: itemId } : {}),
                                        ...(q ? { q } : {}),
                                    },
                                    replace: true,
                                }),
                            label: 'Cari satuan',
                            placeholder: 'Cari kode atau nama satuan...',
                        }}
                        filter={{
                            open: filtersOpen,
                            onOpenChange: setFiltersOpen,
                            active: Boolean(itemId),
                            controls: filterPanelId,
                        }}
                    >
                        {canManage && item && (
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
                            description="Satuan yang tampil milik barang yang dipilih."
                            onClose={() => setFiltersOpen(false)}
                        >
                            <div className="p-4">
                                <FormGrid columns={1}>
                                    <FormControl>
                                        <InlineLookup<Item>
                                            label="Barang"
                                            required
                                            loadItems={loadItems}
                                            value={item}
                                            displayValue={
                                                item ? itemLabel(item) : ''
                                            }
                                            onValueChange={(picked) => {
                                                setItem(picked);
                                                void navigate({
                                                    search: {
                                                        item_id: picked.id,
                                                    },
                                                    replace: true,
                                                });
                                            }}
                                            getItemValue={(entry) => entry.id}
                                            getItemLabel={itemLabel}
                                            placeholder="Cari kode atau nama barang…"
                                            emptyMessage="Barang tidak ditemukan."
                                            popupClassName="w-[36rem]"
                                            showDetails={false}
                                            columns={[
                                                {
                                                    id: 'code',
                                                    header: 'Kode',
                                                    width: 120,
                                                    cell: (entry) => entry.code,
                                                },
                                                {
                                                    id: 'name',
                                                    header: 'Nama',
                                                    width: 280,
                                                    cell: (entry) => entry.name,
                                                },
                                                {
                                                    id: 'base_unit',
                                                    header: 'Satuan dasar',
                                                    width: 110,
                                                    cell: (entry) =>
                                                        entry.base_unit.code,
                                                },
                                            ]}
                                        />
                                    </FormControl>
                                </FormGrid>
                            </div>
                        </FilterPane>
                    ) : null
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} satuan dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(entry) => entry.id}
                    getRowLabel={(entry) => entry.name}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, entry) => setOpen(entry)}
                    onRowClick={(entry) => setOpen(entry)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        item
                            ? 'Barang ini belum punya satuan kemasan.'
                            : 'Pilih barang untuk melihat satuannya.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Satuan',
                            width: 120,
                            cell: (entry) => (
                                <DataTableText>{entry.code}</DataTableText>
                            ),
                            sortValue: (entry) => entry.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 220,
                            cell: (entry) => (
                                <DataTableText>{entry.name}</DataTableText>
                            ),
                            sortValue: (entry) => entry.name,
                        },
                        {
                            id: 'quantity_per_unit',
                            header: 'Isi',
                            width: 140,
                            align: 'right',
                            cell: (entry) => (
                                <DataTableText>
                                    {`${entry.quantity_per_unit} ${item?.base_unit.code ?? ''}`}
                                </DataTableText>
                            ),
                            sortValue: (entry) =>
                                Number(entry.quantity_per_unit),
                        },
                        {
                            id: 'is_base',
                            header: 'Keterangan',
                            width: 140,
                            cell: (entry) =>
                                entry.is_base ? (
                                    <Badge variant="secondary">
                                        Satuan dasar
                                    </Badge>
                                ) : null,
                        },
                    ]}
                />
            </ListPageLayout>
            {open && item && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setOpen(null);
                    }}
                >
                    <PageDialogContent ref={contentRef} title="Satuan barang">
                        <ItemUnitCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            item={item}
                            entry={open === 'new' ? null : open}
                            canManage={canManage}
                            portalContainer={contentRef}
                            onSaved={(entry) => {
                                setOpen(entry);
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
    path: '/sysadmin/inventory/item-units',
    layout: 'app',
    title: 'Satuan barang',
    validateSearch: searchSchema,
    component: ItemUnitsPage,
});
