import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import { CollapsibleSection } from '@operations-metta/ui/collapsible-section';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { api, errorText } from '../../../platform/shell/index.ts';
import { displayNumber } from '@operations-metta/ui/display-number';
import type { Adjustment } from './adjustment-labels.tsx';

// Baris kartu gudang yang ditulis posting dokumen ini, termasuk batch yang diambil otomatis untuk stok keluar dan baris
// pembalik bila postingnya dibatalkan. Baris pembalik memakai tanggal posting dokumen, jadi kartu stok pada tanggal
// itu memuat keduanya.
export function AdjustmentEntries({
    document,
}: {
    document: Adjustment;
}): ReactNode {
    const entries = useQuery({
        queryKey: [
            'inventory-adjustment-entries',
            document.id,
            document.version,
        ],
        queryFn: async () =>
            (
                await api.inventoryAdjustmentEntries({
                    params: { id: document.id },
                })
            ).body.data,
    });
    const rows = entries.data;

    return (
        <CollapsibleSection
            value="entries"
            title="Kartu stok"
            summary={rows ? `${rows.length} baris` : ''}
        >
            {rows ? (
                <DataTable
                    data={rows}
                    getRowKey={(entry) => entry.id}
                    getRowLabel={(entry) => entry.item.name}
                    scrollMode="inline"
                    emptyMessage="Posting dokumen ini belum menulis baris kartu stok."
                    columns={[
                        {
                            id: 'item',
                            header: 'Barang',
                            width: 280,
                            cell: (entry) => (
                                <Link
                                    to="/sysadmin/inventory/item-ledger-entries"
                                    search={{
                                        item: entry.item.id,
                                        location: document.location.id,
                                        from: document.posting_date,
                                        to: document.posting_date,
                                    }}
                                    className="block truncate text-primary underline-offset-4 hover:underline"
                                    title="Buka kartu stok barang ini di lokasi dokumen"
                                >
                                    {`${entry.item.code} · ${entry.item.name}`}
                                </Link>
                            ),
                        },
                        {
                            id: 'batch',
                            header: 'Batch',
                            width: 140,
                            cell: (entry) => (
                                <DataTableText>
                                    {entry.batch?.batch_number ?? ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'expiry_date',
                            header: 'Kedaluwarsa',
                            width: 120,
                            cell: (entry) => (
                                <DataTableText>
                                    {entry.batch?.expiry_date
                                        ? displayDate(entry.batch.expiry_date)
                                        : ''}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'quantity',
                            header: 'Jumlah',
                            width: 120,
                            align: 'right',
                            cell: (entry) => (
                                <DataTableText>
                                    {`${displayNumber(entry.quantity)} ${entry.item.unit}`}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'cost_amount',
                            header: 'Nilai',
                            width: 140,
                            align: 'right',
                            cell: (entry) => (
                                <DataTableText>
                                    {displayNumber(entry.cost_amount)}
                                </DataTableText>
                            ),
                        },
                        {
                            id: 'reversal',
                            header: 'Keterangan',
                            width: 150,
                            cell: (entry) =>
                                entry.reversed_entry_id ? (
                                    <Badge variant="outline">Pembalik</Badge>
                                ) : null,
                        },
                    ]}
                />
            ) : (
                <div className="space-y-3">
                    <p
                        role={entries.isError ? 'alert' : 'status'}
                        className={
                            entries.isError
                                ? 'text-sm text-destructive'
                                : 'text-sm text-muted-foreground'
                        }
                    >
                        {entries.isError
                            ? errorText(
                                  entries.error,
                                  'Kartu stok dokumen ini belum dapat dimuat.',
                              )
                            : 'Memuat kartu stok…'}
                    </p>
                    {entries.isError && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => void entries.refetch()}
                        >
                            Coba lagi
                        </Button>
                    )}
                </div>
            )}
        </CollapsibleSection>
    );
}
