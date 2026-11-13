import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
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
import {
    CurrencyCard,
    roundingTypeLabels,
    type CurrencyPrecision,
} from './currency-card.tsx';

// Presisi mata uang tenant: angka di belakang koma jumlah dan harga satuan, dan pembulatan tagihan. Baris rupiah ditulis
// saat tenant disiapkan dengan rupiah utuh; mata uang lain ditambahkan dari sini.

function CurrenciesPage(): ReactNode {
    const listed = useQuery(
        orpc.currencyList.queryOptions({ select: (response) => response.body }),
    );
    const [open, setOpen] = useState<CurrencyPrecision | 'new' | null>(null);
    const rows = listed.data?.data ?? [];
    const canManage = listed.data?.can_manage ?? false;
    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    return (
        <>
            <ListPageLayout
                header={
                    <RecordActionBar title="Mata uang">
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
                        {rows.length} mata uang disetel
                    </p>
                }
            >
                <DataTable
                    data={rows}
                    getRowKey={(row) => row.id}
                    getRowLabel={(row) => row.currency_code}
                    showRowNumbers
                    actionsPlacement="inline"
                    actions={[{ id: 'open', label: 'Buka' }]}
                    onRowAction={(_, row) => setOpen(row)}
                    onRowClick={(row) => setOpen(row)}
                    emptyMessage="Belum ada mata uang yang disetel. Rupiah dibulatkan ke rupiah utuh sampai disetel di sini."
                    columns={[
                        {
                            id: 'code',
                            header: 'Kode',
                            width: 90,
                            cell: (row) => text(row.currency_code),
                        },
                        {
                            id: 'amount',
                            header: 'Presisi jumlah',
                            width: 140,
                            cell: (row) => text(String(row.amount_decimals)),
                        },
                        {
                            id: 'unit',
                            header: 'Presisi harga satuan',
                            width: 170,
                            cell: (row) =>
                                text(String(row.unit_amount_decimals)),
                        },
                        {
                            id: 'rounding',
                            header: 'Pembulatan tagihan',
                            width: 220,
                            cell: (row) =>
                                text(
                                    row.invoice_rounding_precision === '0'
                                        ? 'Tidak dibulatkan'
                                        : `Ke ${row.invoice_rounding_precision}, ${roundingTypeLabels[row.invoice_rounding_type] ?? ''}`,
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
                    <PageDialogContent title="Mata uang">
                        <CurrencyCard
                            key={
                                open === 'new'
                                    ? 'new'
                                    : `${open.id}:${open.version}`
                            }
                            record={open === 'new' ? null : open}
                            canManage={canManage}
                            onSaved={(record) => {
                                setOpen(record);
                                void listed.refetch();
                            }}
                            onClose={() => setOpen(null)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}

export const page = definePage({
    path: '/sysadmin/currency/currencies',
    layout: 'app',
    title: 'Mata uang',
    component: CurrenciesPage,
});
