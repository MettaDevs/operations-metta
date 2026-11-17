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
    orpc,
    errorText,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import { Decimal } from '../../../platform/money/index.ts';
import {
    PurchaseOrderCard,
    purchaseOrderStatusLabels,
    type PurchaseOrder,
    type PurchaseOrderPermissions,
} from './purchase-order-card.tsx';

const route = getRouteApi('/_app/sysadmin/purchasing/orders');
type Row = ApiBody<'purchasingOrderList'>['data'][number];
const searchSchema = z.object({ q: z.string().max(200).optional() });
const noPermissions: PurchaseOrderPermissions = {
    update: false,
    release: false,
    receive: false,
    create_vendor: false,
};

function PurchaseOrdersPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<PurchaseOrder | 'new' | null>(null);
    const [opened, setOpened] = useState(0);
    const openCard = (target: PurchaseOrder | 'new') => {
        setOpened((count) => count + 1);
        setOpen(target);
    };
    const [permissions, setPermissions] =
        useState<PurchaseOrderPermissions>(noPermissions);
    const [amountDecimals, setAmountDecimals] = useState(0);
    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.purchasingOrderList(
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
            const { body } = await api.purchasingOrderShow({
                params: { id: row.id },
            });
            setPermissions(body.permissions);
            setAmountDecimals(body.amount_decimals);
            openCard(body.data);
        } catch (caught) {
            toast.error(errorText(caught, 'Order belum bisa dibuka.'));
        }
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Purchase order"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari purchase order',
                            placeholder: 'Cari nomor, vendor, atau lokasi...',
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
                        {list.items.length} order dimuat
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
                            ? 'Belum ada purchase order. Pilih Baru untuk memesan barang ke vendor.'
                            : 'Belum ada purchase order.'
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
                            id: 'order_date',
                            header: 'Tanggal order',
                            width: 120,
                            cell: (row) => (
                                <DataTableText>
                                    {displayDate(row.order_date)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.order_date,
                        },
                        {
                            id: 'vendor',
                            header: 'Vendor',
                            width: 240,
                            cell: (row) => (
                                <DataTableText>{row.vendor.name}</DataTableText>
                            ),
                            sortValue: (row) => row.vendor.name,
                        },
                        {
                            id: 'location',
                            header: 'Dikirim ke',
                            width: 180,
                            cell: (row) => (
                                <DataTableText>
                                    {row.location.name}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.location.code,
                        },
                        {
                            id: 'expected_receipt_date',
                            header: 'Diharapkan datang',
                            width: 140,
                            cell: (row) => (
                                <DataTableText>
                                    {row.expected_receipt_date
                                        ? displayDate(row.expected_receipt_date)
                                        : ''}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.expected_receipt_date ?? '',
                        },
                        {
                            id: 'amount',
                            header: 'Nilai',
                            width: 140,
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>
                                    {displayAmount(
                                        Decimal.of(row.amount)
                                            .plus(Decimal.of(row.vat_amount))
                                            .normalized(),
                                        amountDecimals,
                                    )}
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
                                        row.status === 'dirilis'
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {purchaseOrderStatusLabels[row.status]}
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
                        title="Purchase order"
                        defaultExpanded
                    >
                        <PurchaseOrderCard
                            key={opened}
                            order={open === 'new' ? null : open}
                            permissions={permissions}
                            amountDecimals={amountDecimals}
                            portalContainer={contentRef}
                            onSaved={(order) => {
                                setOpen(order);
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

function PurchaseOrderRecord({ id }: { id: string }): ReactNode {
    const { data } = useSuspenseQuery(
        orpc.purchasingOrderShow.queryOptions({
            input: { params: { id } },
            select: (response) => response.body,
        }),
    );
    const container = useRef<HTMLDivElement>(null);
    return (
        <div ref={container} className="contents">
            <PurchaseOrderCard
                order={data.data}
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
    path: '/sysadmin/purchasing/orders',
    layout: 'app',
    title: 'Purchase order',
    validateSearch: searchSchema,
    component: PurchaseOrdersPage,
});

export const record = defineRecordPage({
    key: 'core.purchase-order',
    title: 'Purchase order',
    component: PurchaseOrderRecord,
});
