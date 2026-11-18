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
import { Decimal } from '../../../platform/money/index.ts';
import {
    api,
    definePage,
    defineRecordPage,
    errorText,
    orpc,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import {
    PurchaseInvoiceCard,
    purchaseInvoiceStatusLabels,
    type PurchaseInvoice,
    type PurchaseInvoicePermissions,
} from './purchase-invoice-card.tsx';
import type { AmountDecimals } from '../../currency/index.ts';

// Faktur pembelian (Purchase Invoices di BC): tagihan vendor atas barang yang sudah diterima. Draf, diposting, atau
// dibatalkan postingnya.

const route = getRouteApi('/_app/sysadmin/purchasing/invoices');
type Row = ApiBody<'purchasingInvoiceList'>['data'][number];
const noPermissions: PurchaseInvoicePermissions = {
    update: false,
    post: false,
    reverse: false,
};

function PurchaseInvoicesPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState<PurchaseInvoice | 'new' | null>(null);
    // Kartu dipasang ulang hanya saat dokumen lain dibuka; menyimpan atau memposting tetap di kartu yang sama.
    const [opened, setOpened] = useState(0);
    const openCard = (target: PurchaseInvoice | 'new') => {
        setOpened((count) => count + 1);
        setOpen(target);
    };
    const [permissions, setPermissions] =
        useState<PurchaseInvoicePermissions>(noPermissions);
    const [amountDecimals, setAmountDecimals] = useState<AmountDecimals>(0);
    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.purchasingInvoiceList(
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
            const { body } = await api.purchasingInvoiceShow({
                params: { id: row.id },
            });
            setPermissions(body.permissions);
            setAmountDecimals(body.amount_decimals);
            openCard(body.data);
        } catch (caught) {
            toast.error(errorText(caught, 'Faktur belum bisa dibuka.'));
        }
    };

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Faktur pembelian"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: q ? { q } : {},
                                    replace: true,
                                }),
                            label: 'Cari faktur',
                            placeholder:
                                'Cari nomor, vendor, atau nomor faktur vendor...',
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
                        {list.items.length} faktur dimuat
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
                            ? 'Belum ada faktur pembelian. Pilih Baru untuk mencatat tagihan vendor.'
                            : 'Belum ada faktur pembelian.'
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
                            id: 'vendor_invoice_number',
                            header: 'No. faktur vendor',
                            width: 160,
                            cell: (row) => (
                                <DataTableText>
                                    {row.vendor_invoice_number}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'document_date',
                            header: 'Tanggal faktur',
                            width: 120,
                            cell: (row) => (
                                <DataTableText>
                                    {displayDate(row.document_date)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.document_date,
                        },
                        {
                            id: 'due_date',
                            header: 'Jatuh tempo',
                            width: 120,
                            cell: (row) => (
                                <DataTableText>
                                    {displayDate(row.due_date)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.due_date,
                        },
                        {
                            id: 'amount',
                            header: 'Total',
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
                                        row.status === 'diposting'
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {purchaseInvoiceStatusLabels[row.status]}
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
                        title="Faktur pembelian"
                        defaultExpanded
                    >
                        <PurchaseInvoiceCard
                            key={opened}
                            invoice={open === 'new' ? null : open}
                            permissions={permissions}
                            amountDecimals={amountDecimals}
                            portalContainer={contentRef}
                            onSaved={(invoice) => {
                                setOpen(invoice);
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

// Faktur yang dibuka dari kotak error atau dari Utang vendor.
function PurchaseInvoiceRecord({ id }: { id: string }): ReactNode {
    const { data } = useSuspenseQuery(
        orpc.purchasingInvoiceShow.queryOptions({
            input: { params: { id } },
            select: (response) => response.body,
        }),
    );
    const container = useRef<HTMLDivElement>(null);
    return (
        <div ref={container} className="contents">
            <PurchaseInvoiceCard
                invoice={data.data}
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
    path: '/sysadmin/purchasing/invoices',
    layout: 'app',
    title: 'Faktur pembelian',
    validateSearch: z.object({ q: z.string().max(200).optional() }),
    component: PurchaseInvoicesPage,
});

export const record = defineRecordPage({
    key: 'core.purchase-invoice',
    title: 'Faktur pembelian',
    component: PurchaseInvoiceRecord,
});
