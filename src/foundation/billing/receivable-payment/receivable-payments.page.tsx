import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
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
import { api, definePage } from '../../../platform/shell/index.ts';
import {
    ReceivablePaymentCard,
    type ReceivablePayment,
} from './receivable-payment-card.tsx';

// Daftar Pembayaran Hutang sistem lama: pelunasan bon dan piutang penjamin, terbaru lebih dulu. Baru membuka form
// Transaksi Pembayaran Hutang.

const route = getRouteApi('/_app/billing/receivable-payments');
const searchSchema = z.object({ q: z.string().max(200).optional() });
const statusLabels = {
    diposting: 'Dibayar',
    batal: 'Batal',
} as const satisfies Record<ReceivablePayment['status'], string>;

function ReceivablePaymentsPage(): ReactNode {
    const search = route.useSearch();
    const navigate = route.useNavigate();
    const [open, setOpen] = useState<ReceivablePayment | 'new' | null>(null);
    const [canPay, setCanPay] = useState(false);
    const loader = useCallback<ListLoader<ReceivablePayment>>(
        async ({ query, cursor, sort, signal }) => {
            const { body } = await api.billingReceivablePaymentList(
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
            setCanPay(body.can_pay);
            return { items: body.data, nextCursor: body.next_cursor };
        },
        [],
    );
    const list = useIncrementalList({
        loadItems: loader,
        query: search.q ?? '',
        getKey: (payment) => payment.id,
    });
    const text = (value: string) => <DataTableText>{value}</DataTableText>;

    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar
                        title="Daftar Pembayaran Hutang"
                        search={{
                            value: search.q ?? '',
                            onValueChange: (q) =>
                                void navigate({
                                    search: { q: q || undefined },
                                    replace: true,
                                }),
                            label: 'Cari pembayaran hutang',
                            placeholder:
                                'Cari nomor bukti, nomor invoice, NRM, atau pasien...',
                        }}
                    >
                        {canPay && (
                            <ActionButton
                                action="create"
                                onClick={() => setOpen('new')}
                            />
                        )}
                    </RecordActionBar>
                }
                footer={
                    <p className="p-3 text-sm text-muted-foreground">
                        {list.items.length} pembayaran hutang dimuat
                    </p>
                }
            >
                <DataTable
                    data={list.items}
                    getRowKey={(payment) => payment.id}
                    getRowLabel={(payment) =>
                        `${payment.number} ${payment.patient_name}`
                    }
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, payment) => setOpen(payment)}
                    onRowClick={(payment) => setOpen(payment)}
                    sort={list.sort}
                    onSortChange={list.onSortChange}
                    serverSort
                    incremental={list}
                    emptyMessage={
                        canPay
                            ? 'Belum ada pembayaran hutang yang cocok. Pilih Baru untuk melunasi invoice.'
                            : 'Belum ada pembayaran hutang yang cocok.'
                    }
                    columns={[
                        {
                            id: 'number',
                            header: 'Nomor Bukti',
                            width: 150,
                            cell: (payment) => text(payment.number),
                            sortValue: (payment) => payment.number,
                        },
                        {
                            id: 'date',
                            header: 'Tanggal',
                            width: 110,
                            cell: (payment) => text(displayDate(payment.date)),
                            sortValue: (payment) => payment.date,
                        },
                        {
                            id: 'invoice_number',
                            header: 'Nomor Invoice',
                            width: 150,
                            cell: (payment) => text(payment.invoice_number),
                            sortValue: (payment) => payment.invoice_number,
                        },
                        {
                            id: 'registration_number',
                            header: 'Nomor Registrasi',
                            width: 150,
                            cell: (payment) =>
                                text(payment.registration_number),
                        },
                        {
                            id: 'patient_name',
                            header: 'Nama Pasien',
                            width: 220,
                            cell: (payment) => text(payment.patient_name),
                            sortValue: (payment) => payment.patient_name,
                        },
                        {
                            id: 'patient_type_name',
                            header: 'Tipe Pasien',
                            width: 130,
                            cell: (payment) => text(payment.patient_type_name),
                        },
                        {
                            id: 'amount',
                            header: 'Nilai Pembayaran',
                            width: 150,
                            align: 'right',
                            cell: (payment) =>
                                text(displayNumber(payment.amount)),
                        },
                        {
                            id: 'user_name',
                            header: 'User',
                            width: 160,
                            cell: (payment) => text(payment.user_name),
                        },
                        {
                            id: 'status',
                            header: 'Status',
                            width: 100,
                            cell: (payment) => (
                                <Badge
                                    variant={
                                        payment.status === 'diposting'
                                            ? 'secondary'
                                            : 'outline'
                                    }
                                >
                                    {statusLabels[payment.status]}
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
                    <PageDialogContent title="Pembayaran Hutang">
                        <ReceivablePaymentCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            canPay={canPay}
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

export const page = definePage({
    path: '/billing/receivable-payments',
    layout: 'app',
    title: 'Pembayaran Hutang',
    validateSearch: searchSchema,
    component: ReceivablePaymentsPage,
});
