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
import { displayNumber } from '@operations-metta/ui/display-number';
import { MerchantCard, type Merchant } from './merchant-card.tsx';

// Merchan (Vendor → Merchan di sistem lama): bank atau mesin EDC yang dipilih kasir saat pasien membayar dengan kartu.

const route = getRouteApi('/_app/billing/merchants');
const searchSchema = z.object({ q: z.string().max(200).optional() });

function MerchantsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<Merchant | 'new' | null>(null);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<Merchant>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.billingMerchantList(
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
        getKey: (merchant) => merchant.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Merchan"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: { q: q || undefined },
                                    replace: true,
                                }),
                            label: 'Cari merchan',
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
                        {list.items.length} merchan dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(merchant) => merchant.id}
                    getRowLabel={(merchant) =>
                        `${merchant.code} ${merchant.name}`
                    }
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, merchant) => setOpen(merchant)}
                    onRowClick={(merchant) => setOpen(merchant)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada merchan yang cocok. Pilih Baru untuk menambahkan.'
                            : 'Belum ada merchan yang cocok.'
                    }
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 140,
                            cell: (merchant) => (
                                <DataTableText>{merchant.code}</DataTableText>
                            ),
                            sortValue: (merchant) => merchant.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 280,
                            cell: (merchant) => (
                                <DataTableText>{merchant.name}</DataTableText>
                            ),
                            sortValue: (merchant) => merchant.name,
                        },
                        ...(
                            [
                                [
                                    'debit_surcharge_percent',
                                    'Add Charge Debet (%)',
                                ],
                                [
                                    'credit_surcharge_percent',
                                    'Add Charge Kredit (%)',
                                ],
                                ['discount_percent', 'Diskon (%)'],
                            ] as const
                        ).map(([field, header]) => ({
                            id: field,
                            header,
                            width: 150,
                            align: 'right' as const,
                            cell: (merchant: Merchant) => (
                                <DataTableText>
                                    {displayNumber(merchant[field])}
                                </DataTableText>
                            ),
                        })),
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (merchant) => (
                                <Badge
                                    variant={
                                        merchant.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {merchant.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent title="Merchan">
                        <MerchantCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(merchant) => {
                                setOpen(merchant);
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
    path: '/billing/merchants',
    layout: 'app',
    title: 'Merchan',
    validateSearch: searchSchema,
    component: MerchantsPage,
});
