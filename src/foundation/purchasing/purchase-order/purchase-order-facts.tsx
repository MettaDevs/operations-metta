import { displayDate } from '@operations-metta/ui/date-picker';
import {
    displayAmount,
    displayNumber,
} from '@operations-metta/ui/display-number';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { orpc } from '../../../platform/shell/index.ts';
import type { AmountDecimals } from '../../currency/index.ts';
import type { PurchaseOrder } from './purchase-order-card.tsx';

type HistoryLink = {
    label: string;
    count: number;
    to:
        | '/sysadmin/purchasing/orders'
        | '/sysadmin/purchasing/receipts'
        | '/sysadmin/purchasing/invoices'
        | '/sysadmin/purchasing/credit-memos';
};

function Figure({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="shrink-0 font-medium tabular-nums">{value}</dd>
        </div>
    );
}

// Isi FactBox kartu purchase order: statistik dan riwayat vendor, lalu stok barang baris aktif di lokasi order.
export function PurchaseOrderFacts({
    order,
    lineId,
    amountDecimals,
    canLeave,
}: {
    order: PurchaseOrder | null;
    lineId: string | null;
    amountDecimals: AmountDecimals;
    // Tautan riwayat meninggalkan kartu order, jadi hanya ditawarkan selama tidak ada isian yang belum disimpan.
    canLeave: boolean;
}): ReactNode {
    const options = orpc.purchasingOrderFacts.queryOptions({
        input: {
            params: { id: order?.id ?? '' },
            query: lineId ? { line_id: lineId } : {},
        },
        select: (response) => response.body.data,
    });
    // Versi order ikut kunci supaya ringkasan dimuat ulang sesudah order disimpan atau diposting.
    const { data: facts } = useQuery({
        ...options,
        queryKey: [...options.queryKey, order?.version],
        enabled: order !== null,
    });
    const line = order?.lines.find((candidate) => candidate.id === lineId);
    const amount = (value: string) => displayAmount(value, amountDecimals);
    const vendor = facts?.vendor;
    const history: HistoryLink[] = vendor
        ? [
              {
                  label: 'Purchase order',
                  count: vendor.orders,
                  to: '/sysadmin/purchasing/orders',
              },
              {
                  label: 'Penerimaan diposting',
                  count: vendor.receipts,
                  to: '/sysadmin/purchasing/receipts',
              },
              {
                  label: 'Faktur diposting',
                  count: vendor.invoices,
                  to: '/sysadmin/purchasing/invoices',
              },
              {
                  label: 'Nota kredit diposting',
                  count: vendor.credit_memos,
                  to: '/sysadmin/purchasing/credit-memos',
              },
          ]
        : [];

    if (!order)
        return (
            <p className="text-sm text-muted-foreground">
                Ringkasan vendor dan stok tampil di sini setelah order disimpan.
            </p>
        );
    return (
        <div className="space-y-5 text-sm">
            {vendor && (
                <section className="space-y-2">
                    <h3 className="font-medium">{order.vendor.name}</h3>
                    <dl className="space-y-1">
                        <Figure
                            label="Sisa utang"
                            value={amount(vendor.remaining)}
                        />
                        <Figure
                            label="Lewat jatuh tempo"
                            value={amount(vendor.overdue)}
                        />
                        <Figure
                            label="Order belum datang"
                            value={amount(vendor.outstanding_orders)}
                        />
                        <Figure
                            label="Diterima belum difakturkan"
                            value={amount(vendor.received_not_invoiced)}
                        />
                        <Figure
                            label="Pembayaran terakhir"
                            value={
                                vendor.last_payment_date
                                    ? displayDate(vendor.last_payment_date)
                                    : 'Belum ada'
                            }
                        />
                    </dl>
                </section>
            )}
            {vendor && (
                <section className="space-y-2 border-t pt-3">
                    <h3 className="font-medium">Riwayat vendor</h3>
                    <dl className="space-y-1">
                        {history.map((entry) => (
                            <Figure
                                key={entry.to}
                                label={entry.label}
                                value={
                                    canLeave && entry.count > 0 ? (
                                        <Link
                                            to={entry.to}
                                            search={{ q: order.vendor.name }}
                                            className="text-primary underline-offset-4 hover:underline"
                                        >
                                            {entry.count}
                                        </Link>
                                    ) : (
                                        entry.count
                                    )
                                }
                            />
                        ))}
                    </dl>
                </section>
            )}
            <section className="space-y-2 border-t pt-3">
                <h3 className="font-medium">
                    {line
                        ? `${line.item.code} · ${line.item.name}`
                        : 'Baris order'}
                </h3>
                {!line ? (
                    <p className="text-muted-foreground">
                        Klik baris barang untuk melihat stoknya di{' '}
                        {order.location.name}.
                    </p>
                ) : facts?.line ? (
                    <dl className="space-y-1">
                        <Figure
                            label={`Stok di ${order.location.code}`}
                            value={`${displayNumber(facts.line.inventory)} ${facts.line.base_unit}`}
                        />
                        <Figure
                            label="Sedang dipesan"
                            value={`${displayNumber(facts.line.on_order)} ${facts.line.base_unit}`}
                        />
                    </dl>
                ) : facts ? (
                    <p className="text-muted-foreground">
                        Anda tidak punya akses untuk melihat stok barang.
                    </p>
                ) : null}
            </section>
        </div>
    );
}
