import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import { displayAmount } from '@operations-metta/ui/display-number';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    definePage,
    defineRecordPage,
    errorText,
    orpc,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import {
    VendorPaymentCard,
    vendorPaymentStatusLabels,
    type VendorPayment,
    type VendorPaymentPermissions,
} from './vendor-payment-card.tsx';

// Pembayaran ke vendor (Payment Journal BC).

const route = getRouteApi('/_app/sysadmin/purchasing/vendor-payments');
type Row = ApiBody<'purchasingVendorPaymentList'>['data'][number];
const noPermissions: VendorPaymentPermissions = {
    update: false,
    post: false,
    reverse: false,
};

function VendorPaymentsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<VendorPayment | 'new' | null>(null);
    const [opened, setOpened] = useState(0);
    const openCard = (target: VendorPayment | 'new') => {
        setOpened((count) => count + 1);
        setOpen(target);
    };
    const [permissions, setPermissions] =
        useState<VendorPaymentPermissions>(noPermissions);
    const [amountDecimals, setAmountDecimals] = useState(0);
    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.purchasingVendorPaymentList(
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
            setPermissions(body.permissions);
            setAmountDecimals(body.amount_decimals);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (row) => row.id,
    });
    const show = async (row: Row) => {
        try {
            const { body } = await api.purchasingVendorPaymentShow({
                params: { id: row.id },
            });
            setPermissions(body.permissions);
            setAmountDecimals(body.amount_decimals);
            openCard(body.data);
        } catch (caught) {
            toast.error(errorText(caught, 'Pembayaran belum bisa dibuka.'));
        }
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Pembayaran ke vendor"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari pembayaran',
                            placeholder:
                                'Cari nomor, vendor, atau nomor referensi...',
                        }}
                    >
                        {permissions.update && (
                            <ActionButton
                                action="create"
                                onClick={() => openCard('new')}
                            />
                        )}
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} pembayaran dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) => row.number}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, row) => void show(row)}
                    onRowClick={(row) => void show(row)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        permissions.update
                            ? 'Belum ada pembayaran ke vendor. Pilih Baru untuk membayar utang vendor.'
                            : 'Belum ada pembayaran ke vendor.'
                    }
                    columns={[
                        {
                            id: 'number',
                            header: 'Nomor',
                            width: 140,
                            cell: (row) => (
                                <DataTableText>{row.number}</DataTableText>
                            ),
                            sortValue: (row) => row.number,
                        },
                        {
                            id: 'vendor',
                            header: 'Vendor',
                            width: 220,
                            cell: (row) => (
                                <DataTableText>{row.vendor.name}</DataTableText>
                            ),
                            sortValue: (row) => row.vendor.name,
                        },
                        {
                            id: 'posting_date',
                            header: 'Tanggal bayar',
                            width: 120,
                            cell: (row) => (
                                <DataTableText>
                                    {displayDate(row.posting_date)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.posting_date,
                        },
                        {
                            id: 'payment_method',
                            header: 'Cara bayar',
                            width: 140,
                            cell: (row) => (
                                <DataTableText>
                                    {row.payment_method.name}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'reference',
                            header: 'No. referensi',
                            width: 150,
                            cell: (row) => (
                                <DataTableText>
                                    {row.reference ?? ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'amount',
                            header: 'Jumlah',
                            width: 140,
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>
                                    {displayAmount(row.amount, amountDecimals)}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 120,
                            cell: (row) => (
                                <Badge
                                    variant={
                                        row.status === 'diposting'
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {vendorPaymentStatusLabels[row.status]}
                                </Badge>
                            ),
                            sortValue: (row) => row.status,
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
                    <PageDialogContent
                        ref={contentRef}
                        title="Pembayaran ke vendor"
                        defaultExpanded
                    >
                        <VendorPaymentCard
                            key={opened}
                            payment={open === 'new' ? null : open}
                            permissions={permissions}
                            amountDecimals={amountDecimals}
                            portalContainer={contentRef}
                            onSaved={(payment) => {
                                setOpen(payment);
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

function VendorPaymentRecord({ id }: { id: string }): ReactNode {
    const { data } = useSuspenseQuery(
        orpc.purchasingVendorPaymentShow.queryOptions({
            input: { params: { id } },
            select: (response) => response.body,
        }),
    );
    const container = useRef<HTMLDivElement>(null);
    return (
        <div ref={container} className="contents">
            <VendorPaymentCard
                payment={data.data}
                permissions={data.permissions}
                amountDecimals={data.amount_decimals}
                portalContainer={container}
                onSaved={() => undefined}
                onClose={() => undefined}
            />
        </div>
    );
}

export const page = definePage({
    path: '/sysadmin/purchasing/vendor-payments',
    layout: 'app',
    title: 'Pembayaran ke vendor',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: VendorPaymentsPage,
});

export const record = defineRecordPage({
    key: 'core.vendor-payment',
    title: 'Pembayaran ke vendor',
    component: VendorPaymentRecord,
});
