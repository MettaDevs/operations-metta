import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import { displayAmount } from '@operations-metta/ui/display-number';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { ListPageLayout } from '@operations-metta/ui/list-page-layout';
import {
    PageDialog,
    PageDialogContent,
} from '@operations-metta/ui/page-dialog';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { Switch } from '@operations-metta/ui/switch';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    api,
    definePage,
    errorText,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import {
    PurchaseInvoiceCard,
    type PurchaseInvoice,
    type PurchaseInvoicePermissions,
} from '../purchase-invoice/purchase-invoice-card.tsx';
import {
    VendorPaymentCard,
    type VendorPayment,
    type VendorPaymentPermissions,
} from '../vendor-payment/vendor-payment-card.tsx';

// Utang vendor (Vendor Ledger Entries di BC).

const route = getRouteApi('/_app/sysadmin/purchasing/vendor-ledger');
type Row = ApiBody<'purchasingVendorLedgerList'>['data'][number];

const closedText: Record<Row['kind'], string> = {
    faktur: 'Ditutup',
    pembatalan: 'Pembatalan',
    pembayaran: 'Pembayaran',
    pembatalan_pembayaran: 'Pembayaran dibatalkan',
};

type Opened =
    | {
          kind: 'invoice';
          invoice: PurchaseInvoice;
          permissions: PurchaseInvoicePermissions;
          amountDecimals: number;
      }
    | {
          kind: 'payment';
          payment: VendorPayment;
          permissions: VendorPaymentPermissions;
          amountDecimals: number;
      };

const dueText = (days: number) =>
    days > 0
        ? `Lewat ${days} hari`
        : days === 0
          ? 'Hari ini'
          : `${-days} hari lagi`;

function VendorLedgerPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const includeClosed = search.all === '1';
    const switchId = useId();
    const contentRef = useRef<HTMLDivElement>(null);
    const [totals, setTotals] = useState({ remaining: '0', overdue: '0' });
    const [amountDecimals, setAmountDecimals] = useState(0);
    const [opened, setOpened] = useState<Opened | null>(null);
    const loader = useCallback<ListLoader<Row>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.purchasingVendorLedgerList(
                {
                    query: {
                        q: query,
                        ...(cursor ? { cursor } : {}),
                        ...(sort
                            ? { sort: sort.columnId, direction: sort.direction }
                            : {}),
                        ...(includeClosed ? { all: '1' as const } : {}),
                    },
                },
                { signal },
            );
            setTotals({ remaining: body.remaining, overdue: body.overdue });
            setAmountDecimals(body.amount_decimals);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [includeClosed],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (row) => row.id,
    });
    const showInvoice = async (id: string) => {
        try {
            const { body } = await api.purchasingInvoiceShow({
                params: { id },
            });
            setOpened({
                kind: 'invoice',
                invoice: body.data,
                permissions: body.permissions,
                amountDecimals: body.amount_decimals,
            });
        } catch (caught) {
            toast.error(errorText(caught, 'Faktur belum bisa dibuka.'));
        }
    };
    const showPayment = async (id: string) => {
        try {
            const { body } = await api.purchasingVendorPaymentShow({
                params: { id },
            });
            setOpened({
                kind: 'payment',
                payment: body.data,
                permissions: body.permissions,
                amountDecimals: body.amount_decimals,
            });
        } catch (caught) {
            toast.error(errorText(caught, 'Pembayaran belum bisa dibuka.'));
        }
    };
    const show = (row: Row) => {
        if (row.payment_id) void showPayment(row.payment_id);
        else if (row.invoice_id) void showInvoice(row.invoice_id);
    };
    const paymentAction = 'payment:';
    const rowActions = (row: Row) =>
        row.payment_id
            ? [{ id: 'open', label: 'Buka pembayaran' }]
            : [
                  { id: 'open', label: 'Buka faktur' },
                  ...row.payments.map((payment) => ({
                      id: `${paymentAction}${payment.id}`,
                      label: `Buka pembayaran ${payment.number}`,
                  })),
              ];
    const closeOpened = () => {
        setOpened(null);
        list.reload();
    };
    const amount = (value: string) => displayAmount(value, amountDecimals);

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Utang vendor"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: {
                                        ...(q ? { q } : {}),
                                        ...(includeClosed ? { all: '1' } : {}),
                                    },
                                    replace: true,
                                }),
                            label: 'Cari utang',
                            placeholder:
                                'Cari vendor, nomor faktur, atau nomor faktur vendor...',
                        }}
                    >
                        <Field orientation="horizontal" className="w-auto">
                            <Switch
                                id={switchId}
                                checked={includeClosed}
                                onCheckedChange={(checked) =>
                                    void navigate({
                                        search: {
                                            ...(search.q
                                                ? { q: search.q }
                                                : {}),
                                            ...(checked ? { all: '1' } : {}),
                                        },
                                        replace: true,
                                    })
                                }
                            />
                            <FieldLabel
                                htmlFor={switchId}
                                className="font-normal"
                            >
                                Tampilkan yang sudah ditutup
                            </FieldLabel>
                        </Field>
                    </RecordActionBar>
                }
                footer={
                    <p className="flex flex-wrap gap-x-6 p-3 text-sm text-muted-foreground">
                        <span>{list.items.length} entri dimuat</span>
                        <span>
                            Sisa utang{' '}
                            <span className="font-semibold text-foreground">
                                {amount(totals.remaining)}
                            </span>
                        </span>
                        <span>
                            Lewat jatuh tempo{' '}
                            <span className="font-semibold text-foreground">
                                {amount(totals.overdue)}
                            </span>
                        </span>
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) => row.document_number}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    getRowActions={rowActions}
                    onRowAction={(action, row) => {
                        if (action.startsWith(paymentAction))
                            void showPayment(
                                action.slice(paymentAction.length),
                            );
                        else show(row);
                    }}
                    onRowClick={show}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        includeClosed
                            ? 'Belum ada faktur pembelian atau pembayaran yang diposting.'
                            : 'Tidak ada utang ke vendor yang belum dibayar.'
                    }
                    columns={[
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
                            id: 'age',
                            header: 'Keterangan',
                            width: 130,
                            cell: (row) =>
                                row.open ? (
                                    <Badge
                                        variant={
                                            row.days_overdue > 0
                                                ? 'destructive'
                                                : 'outline'
                                        }
                                    >
                                        {dueText(row.days_overdue)}
                                    </Badge>
                                ) : (
                                    <Badge variant="outline">
                                        {row.kind === 'faktur' &&
                                        row.payments.length
                                            ? 'Lunas'
                                            : closedText[row.kind]}
                                    </Badge>
                                ),
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
                                    {row.vendor_invoice_number ?? ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'document_number',
                            header: 'Dokumen',
                            width: 140,
                            cell: (row) => (
                                <DataTableText>
                                    {row.document_number}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.document_number,
                        },
                        {
                            id: 'posting_date',
                            header: 'Tanggal posting',
                            width: 120,
                            cell: (row) => (
                                <DataTableText>
                                    {displayDate(row.posting_date)}
                                </DataTableText>
                            ),
                            sortValue: (row) => row.posting_date,
                        },
                        {
                            id: 'amount',
                            header: 'Jumlah',
                            width: 140,
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>
                                    {amount(row.amount)}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'paid',
                            header: 'Dibayar',
                            width: 140,
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>
                                    {row.payments.length
                                        ? amount(row.paid)
                                        : ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'payments',
                            header: 'Pembayaran',
                            width: 180,
                            cell: (row) => (
                                <DataTableText>
                                    {row.payments
                                        .map((payment) => payment.number)
                                        .join(', ')}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'remaining',
                            header: 'Sisa',
                            width: 140,
                            align: 'right',
                            cell: (row) => (
                                <DataTableText>
                                    {amount(row.remaining)}
                                </DataTableText>
                            ),
                        },
                    ]}
                />
            </ListPageLayout>
            {opened && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) closeOpened();
                    }}
                >
                    <PageDialogContent
                        ref={contentRef}
                        title={
                            opened.kind === 'invoice'
                                ? 'Faktur pembelian'
                                : 'Pembayaran ke vendor'
                        }
                        defaultExpanded
                    >
                        {opened.kind === 'invoice' ? (
                            <PurchaseInvoiceCard
                                invoice={opened.invoice}
                                permissions={opened.permissions}
                                amountDecimals={opened.amountDecimals}
                                portalContainer={contentRef}
                                onSaved={() => undefined}
                                onClose={closeOpened}
                            />
                        ) : (
                            <VendorPaymentCard
                                payment={opened.payment}
                                permissions={opened.permissions}
                                amountDecimals={opened.amountDecimals}
                                portalContainer={contentRef}
                                onSaved={() => undefined}
                                onClose={closeOpened}
                            />
                        )}
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/purchasing/vendor-ledger',
    layout: 'app',
    title: 'Utang vendor',
    validateSearch: z.object({
        q: z.string().max(200).optional(),
        all: z.literal('1').optional(),
    }),
    component: VendorLedgerPage,
});
