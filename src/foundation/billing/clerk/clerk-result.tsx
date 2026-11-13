import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayNumber } from '@operations-metta/ui/display-number';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import type { ReactNode } from 'react';
import type { ApiBody } from '../../../platform/shell/index.ts';

export type Clerk = ApiBody<'billingClerkShow'>['data'];

export const dateTime = (value: string) =>
    new Date(value).toLocaleString('id-ID', {
        dateStyle: 'short',
        timeStyle: 'short',
    });

// Hasil Clerk End, blok Jumlah Sistem dan Jumlah Clerk layar Lihat Clerk sistem lama: ringkasan sesi lalu jumlah sistem,
// jumlah fisik, dan selisih per jenis bayar yang dihitung, dalam mata uang jenis bayar itu, dengan kurs hari Clerk End
// dan selisihnya dalam mata uang lokal untuk jenis bayar bermata uang asing.
export function ClerkResult({ clerk }: { clerk: Clerk }): ReactNode {
    const amount = (value: string | null) =>
        value === null ? '' : displayNumber(value);
    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    return (
        <div className="space-y-4">
            <FormGrid>
                <FormControl>
                    <Input label="Kode" value={clerk.code} readOnly />
                </FormControl>
                <FormControl>
                    <Input label="Kasir" value={clerk.user_name} readOnly />
                </FormControl>
                <FormControl>
                    <Input
                        label="Tanggal"
                        value={`${dateTime(clerk.started_at)}${clerk.ended_at ? ` s/d ${dateTime(clerk.ended_at)}` : ''}`}
                        readOnly
                    />
                </FormControl>
                <FormControl>
                    <Input
                        label="Jumlah Penjualan"
                        value={String(clerk.transactions)}
                        readOnly
                    />
                </FormControl>
                <FormControl hint="Nilai semua pembayaran kasir ini selama clerk, semua jenis bayar.">
                    <Input
                        label="Jumlah Total"
                        value={amount(clerk.system_total)}
                        readOnly
                    />
                </FormControl>
                <FormControl>
                    <Input
                        label="Jumlah Clerk"
                        value={amount(clerk.clerk_total)}
                        readOnly
                    />
                </FormControl>
                <FormControl hint="Jumlah Clerk dikurangi Jumlah Sistem, hanya untuk jenis bayar yang dihitung saat Clerk End. Minus berarti uang kurang.">
                    <Input
                        label="Jumlah Selisih"
                        value={amount(clerk.difference_total)}
                        readOnly
                    />
                </FormControl>
            </FormGrid>
            <DataTable
                data={clerk.lines}
                getRowKey={(line) => line.payment_method_id}
                getRowLabel={(line) => line.name}
                scrollMode="inline"
                showRowNumbers
                emptyMessage="Tidak ada jenis bayar yang dihitung saat Clerk End."
                columns={[
                    {
                        id: 'name',
                        header: 'Jenis Pembayaran',
                        width: 260,
                        cell: (line) => text(line.name),
                    },
                    {
                        id: 'currency',
                        header: 'Mata Uang',
                        width: 110,
                        cell: (line) => text(line.currency_code),
                    },
                    {
                        id: 'system_amount',
                        header: 'Jumlah Sistem',
                        width: 160,
                        align: 'right',
                        cell: (line) => text(amount(line.system_amount)),
                    },
                    {
                        id: 'counted_amount',
                        header: 'Jumlah Clerk',
                        width: 160,
                        align: 'right',
                        cell: (line) => text(amount(line.counted_amount)),
                    },
                    {
                        id: 'difference',
                        header: 'Jumlah Selisih',
                        width: 160,
                        align: 'right',
                        cell: (line) => text(amount(line.difference)),
                    },
                    {
                        id: 'rate',
                        header: 'Kurs',
                        width: 130,
                        align: 'right',
                        cell: (line) =>
                            text(
                                line.currency_code === clerk.local_currency
                                    ? ''
                                    : amount(line.rate),
                            ),
                    },
                    {
                        id: 'difference_local',
                        header: `Selisih ${clerk.local_currency}`,
                        width: 160,
                        align: 'right',
                        cell: (line) => text(amount(line.difference_local)),
                    },
                ]}
            />
        </div>
    );
}
