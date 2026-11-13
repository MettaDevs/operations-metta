import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
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
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage } from '../../../platform/shell/index.ts';
import {
    DiscountCard,
    discountKindLabels,
    type Discount,
} from './discount-card.tsx';

// Diskon kasir (mDiscount sistem lama): potongan yang dipilih kasir di tab Diskon Form Pembayaran.

const route = getRouteApi('/_app/billing/discounts');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function DiscountsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Discount | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<Discount>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.billingDiscountList(
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
        getKey: (discount) => discount.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Diskon"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: { q: q || undefined },
                                    replace: true,
                                }),
                            label: 'Cari diskon',
                            placeholder: 'Cari kode atau nama...',
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
                        {list.items.length} diskon dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(discount) => discount.id}
                    getRowLabel={(discount) =>
                        `${discount.code} ${discount.name}`
                    }
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, discount) => setOpen(discount)}
                    onRowClick={(discount) => setOpen(discount)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada diskon yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada diskon yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 140,
                            cell: (discount) => (
                                <DataTableText>{discount.code}</DataTableText>
                            ),
                            sortValue: (discount) => discount.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 280,
                            cell: (discount) => (
                                <DataTableText>{discount.name}</DataTableText>
                            ),
                            sortValue: (discount) => discount.name,
                        },
                        {
                            id: 'kind',
                            header: 'Jenis',
                            width: 220,
                            cell: (discount) => (
                                <DataTableText>
                                    {discountKindLabels[discount.kind] ??
                                        discount.kind}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'basis',
                            header: 'Komponen / kelompok jasa',
                            width: 240,
                            cell: (discount) => (
                                <DataTableText>
                                    {discount.charge_component_name ??
                                        discount.service_group_name ??
                                        '—'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (discount) => (
                                <Badge
                                    variant={
                                        discount.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {discount.is_active ? 'Aktif' : 'Nonaktif'}
                                </Badge>
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
                    <PageDialogContent title="Diskon">
                        <DiscountCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(discount) => {
                                setOpen(discount);
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
    path: '/billing/discounts',
    layout: 'app',
    title: 'Diskon',
    validateSearch: searchSchema,
    component: DiscountsPage,
});
