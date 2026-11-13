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
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { definePage, orpc } from '../../platform/shell/index.ts';
import { ExchangeRateCard, type ExchangeRate } from './exchange-rate-card.tsx';

// Kurs mata uang asing tenant (Currency Exchange Rates BC): satu baris per mata uang per tanggal berlaku, terbaru di atas.
// Pembayaran memakai kurs dengan tanggal berlaku terakhir yang tidak lewat dari tanggal pembayarannya.

function ExchangeRatesPage(): ReactNode {
    const listed = useQuery(
        orpc.exchangeRateList.queryOptions({
            select: (response) => response.body,
        }),
    );
    const [open, setOpen] = useState<ExchangeRate | 'new' | null>(null);
    const rows = listed.data?.data ?? [];
    const currencies = listed.data?.currencies ?? [];
    const canManage = listed.data?.can_manage ?? false;
    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar title="Kurs">
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
                        {rows.length} kurs
                    </p>
                }
            >
                <DataTable
                    data={rows}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) =>
                        `${row.currency_code} ${displayDate(row.starting_date)}`
                    }
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, row) => setOpen(row)}
                    onRowClick={(row) => setOpen(row)}
                    emptyMessage={
                        currencies.length
                            ? 'Belum ada kurs. Pembayaran dengan mata uang asing ditolak sampai kursnya diisi.'
                            : 'Belum ada mata uang asing. Tambahkan dulu di Mata uang, lalu isi kursnya di sini.'
                    }
                    columns={[
                        {
                            id: 'currency',
                            header: 'Mata uang',
                            width: 110,
                            cell: (row) => text(row.currency_code),
                        },
                        {
                            id: 'starting-date',
                            header: 'Tanggal berlaku',
                            width: 150,
                            cell: (row) => text(displayDate(row.starting_date)),
                        },
                        {
                            id: 'rate',
                            header: 'Kurs',
                            width: 180,
                            align: 'right',
                            cell: (row) => text(displayNumber(row.rate)),
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
                    <PageDialogContent title="Kurs">
                        <ExchangeRateCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            currencies={currencies}
                            canManage={canManage}
                            onSaved={(record) => {
                                setOpen(record);
                                void listed.refetch();
                            }}
                            onClose={() => {
                                setOpen(null);
                                void listed.refetch();
                            }}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/currency/exchange-rates',
    layout: 'app',
    title: 'Kurs',
    component: ExchangeRatesPage,
});
