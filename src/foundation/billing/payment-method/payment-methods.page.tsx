import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
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
import { FileInput } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { api, definePage } from '../../../platform/shell/index.ts';
import {
    isPaymentMethodBehavior,
    paymentMethodBehaviors,
} from './payment-method.behaviors.ts';
import {
    PaymentMethodCard,
    type PaymentMethod,
} from './payment-method-card.tsx';
import { LegacyImportDialog } from './legacy-import-dialog.tsx';

// Jenis bayar (mJenisBayar sistem lama). Form kasir menggambar isian pembayarannya dari daftar ini, berurut Urutan,
// jadi menambah jenis bayar cukup dari layar ini.

const route = getRouteApi('/_app/billing/payment-methods');
const searchSchema = z.object({ q: z.string().max(200).optional() });

const behaviorText = (behavior: string) =>
    isPaymentMethodBehavior(behavior)
        ? paymentMethodBehaviors[behavior].label
        : behavior;

function PaymentMethodsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<PaymentMethod | 'new' | null>(null);
    const [importing, setImporting] = useState(false);
    const [canManage, setCanManage] = useState(false);
    const loader = useCallback<ListLoader<PaymentMethod>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.billingPaymentMethodList(
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
        getKey: (method) => method.id,
    });

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Jenis bayar"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: { q: q || undefined },
                                    replace: true,
                                }),
                            label: 'Cari jenis bayar',
                            placeholder: 'Cari kode, nama, atau label...',
                        }}
                    >
                        {canManage && (
                            <>
                                <ActionButton
                                    action="create"
                                    onClick={() => setOpen('new')}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="command"
                                    onClick={() => setImporting(true)}
                                >
                                    <FileInput aria-hidden="true" />
                                    Impor dari sistem lama
                                </Button>
                            </>
                        )}
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} jenis bayar dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(method) => method.id}
                    getRowLabel={(method) => `${method.code} ${method.name}`}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, method) => setOpen(method)}
                    onRowClick={(method) => setOpen(method)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canManage
                            ? 'Belum ada jenis bayar yang cocok. Pilih Baru untuk menambahkan, atau impor dari sistem lama.'
                            : 'Belum ada jenis bayar yang cocok.'
                    }
                    columns={[
                        {
                            id: 'sort_order',
                            header: 'Urutan',
                            width: 90,
                            cell: (method) => (
                                <DataTableText>
                                    {method.sort_order}
                                </DataTableText>
                            ),
                            sortValue: (method) => method.sort_order,
                        },
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 120,
                            cell: (method) => (
                                <DataTableText>{method.code}</DataTableText>
                            ),
                            sortValue: (method) => method.code,
                        },
                        {
                            id: 'name',
                            header: 'Nama',
                            width: 240,
                            cell: (method) => (
                                <DataTableText>{method.name}</DataTableText>
                            ),
                            sortValue: (method) => method.name,
                        },
                        {
                            id: 'cashier_label',
                            header: 'Label di kasir',
                            width: 200,
                            cell: (method) => (
                                <DataTableText>
                                    {method.cashier_label ?? ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'behavior',
                            header: 'Perilaku',
                            width: 130,
                            cell: (method) => (
                                <DataTableText>
                                    {behaviorText(method.behavior)}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'shown_at_cashier',
                            header: 'Di kasir',
                            width: 100,
                            cell: (method) => (
                                <DataTableText>
                                    {method.shown_at_cashier ? 'Tampil' : '-'}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 110,
                            cell: (method) => (
                                <Badge
                                    variant={
                                        method.is_active
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {method.is_active ? 'Aktif' : 'Nonaktif'}
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
                    <PageDialogContent title="Jenis bayar">
                        <PaymentMethodCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(method) => {
                                setOpen(method);
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
            {importing && (
                <LegacyImportDialog
                    onClose={() => {
                        setImporting(false);
                        list.reload();
                    }}
                />
            )}
        </>
    );
}

export const page = definePage({
    path: '/billing/payment-methods',
    layout: 'app',
    title: 'Jenis bayar',
    validateSearch: searchSchema,
    component: PaymentMethodsPage,
});
