import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import { displayNumber } from '@operations-metta/ui/display-number';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage } from '@core/platform/shell/index.ts';
import { DrugPriceCard, type DrugPrice } from './drug-price-card.tsx';

// Grading harga obat legal entity tempat kerja (SIMmGradingHargaObat sistem lama). Harga obat di penyerahan = harga
// dasar barang x (1 + % naik / 100), dengan % naik dari baris kelompok grading obat untuk kelompok harga pembeli, lalu
// baris semua barang, lalu 0 %.

const route = getRouteApi('/_app/pharmacy/drug/drug-prices');
const searchSchema = z.object({ q: z.string().max(200).optional() });
const rangeText = (row: DrugPrice) =>
    `${displayNumber(row.price_from)} sampai ${displayNumber(row.price_to)}`;

function DrugPricesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<DrugPrice | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<DrugPrice>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.pharmacyDrugPriceList(
                {
                    query: {
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
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (row) => row.id,
    });
    const text = (value: string) => <DataTableText>{value}</DataTableText>;

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Grading harga obat"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari grading harga obat',
                            placeholder:
                                'Cari kelompok harga atau kelompok grading...',
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
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} grading dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) =>
                        `${row.price_group.name} ${row.grading_group?.name ?? 'Semua barang'}`
                    }
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, row) => setOpen(row)}
                    onRowClick={(row) => setOpen(row)}
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada grading harga obat. Pilih Baru untuk menambahkan.'
                            : 'Belum ada grading harga obat.'
                    }
                    columns={[
                        {
                            id: 'price_group',
                            header: 'Kelompok harga',
                            width: 180,
                            cell: (row) => text(row.price_group.name),
                        },
                        {
                            id: 'grading_group',
                            header: 'Kelompok grading',
                            width: 200,
                            cell: (row) =>
                                text(row.grading_group?.name ?? 'Semua barang'),
                        },
                        {
                            id: 'price_from',
                            header: 'Harga dasar',
                            width: 240,
                            cell: (row) => text(rangeText(row)),
                        },
                        {
                            id: 'markup_percent',
                            header: '% naik',
                            width: 90,
                            align: 'right',
                            cell: (row) =>
                                text(displayNumber(row.markup_percent)),
                        },
                        {
                            id: 'discount_percent',
                            header: '% diskon',
                            width: 90,
                            align: 'right',
                            cell: (row) =>
                                text(displayNumber(row.discount_percent)),
                        },
                        {
                            id: 'effective_from',
                            header: 'Berlaku mulai',
                            width: 130,
                            cell: (row) =>
                                text(displayDate(row.effective_from)),
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
                    <PageDialogContent title="Grading harga obat">
                        <DrugPriceCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(row) => {
                                setOpen(row);
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
    path: '/pharmacy/drug/drug-prices',
    layout: 'app',
    title: 'Grading harga obat',
    validateSearch: searchSchema,
    component: DrugPricesPage,
});
