import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import {
    displayAmount,
    displayNumber,
} from '@operations-metta/ui/display-number';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { RecordActionBar } from '@operations-metta/ui/record-action-bar';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { Hourglass, ReceiptText, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
    definePage,
    defineRecordPage,
    orpc,
} from '../../../platform/shell/index.ts';
import { CreditMemoDialog } from '../credit-memo/credit-memo-dialog.tsx';
import { PaymentCancelDialog } from '../payment/payment-cancel-dialog.tsx';
import { PaymentForm } from '../payment/payment-form.tsx';
import { useVisitHolds } from './visit-holds.ts';

// Form Pembayaran Kuta 1: panel Pasien (atau panel Penjualan untuk penjualan tanpa kunjungan), Rincian Biaya, dan Detail
// Pembayaran. Nilai dihitung server dengan rumus kasir Kuta (invoice.totals.ts); tagihan yang sudah dibayar menampilkan
// pembayarannya. Rincian menampilkan nilai baris apa adanya; sistem lama membulatkan tampilan baris ke atas per 1.000,
// padahal yang ditagih nilai tepatnya. Pembayaran yang clerk-nya masih
// berjalan dikoreksi dengan Batal Pembayaran; sesudah Clerk End, dengan Nota Kredit. Header menampilkan hal yang masih
// ditunggu kunjungan belum bayar, misalnya resep yang belum disiapkan farmasi, dan tagihan dibaca ulang begitu status
// itu berubah, karena obat yang disiapkan farmasi masuk tagihan di transaksi yang sama.

const route = getRouteApi('/_app/billing/payments/$visitId');

function PaymentPage(): ReactNode {
    return <PaymentRecord id={route.useParams().visitId} />;
}

// Satu pembayaran, dibuka dari Daftar Pembayaran atau dari tombol di kotak error layar lain (record `core.payment`). id
// adalah dokumen sumber tagihan: kunjungan atau penjualan.
function PaymentRecord({ id }: { id: string }): ReactNode {
    const { data, refetch } = useSuspenseQuery(
        orpc.billingVisitShow.queryOptions({
            input: { params: { id } },
            select: (response) => response.body.data,
        }),
    );
    const { visit, charges, totals, payment } = data;
    const number = data.visit
        ? data.visit.registration_number
        : data.sale.number;
    // Penjualan tidak pernah menunggu apa pun, jadi status tunggu hanya dibaca untuk kunjungan.
    const holds = useVisitHolds(
        visit ? { from: visit.date, to: visit.date } : { from: '', to: '' },
    );
    const waiting = visit && !payment ? (holds?.get(visit.id) ?? []) : [];
    const waitingKey = holds === undefined ? null : waiting.join('|');
    const shownWaiting = useRef(waitingKey);
    useEffect(() => {
        if (
            waitingKey !== null &&
            shownWaiting.current !== null &&
            shownWaiting.current !== waitingKey
        )
            void refetch();
        shownWaiting.current = waitingKey;
    }, [waitingKey, refetch]);
    const [correcting, setCorrecting] = useState(false);
    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    const groupCount = new Set(
        charges.map(
            (charge) => `${charge.charge_group}:${charge.service_group_id}`,
        ),
    ).size;
    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <RecordActionBar
                title={`Pembayaran ${number}`}
                trailing={
                    waiting.length > 0 &&
                    waiting.map((hold) => (
                        <Badge key={hold} variant="outline">
                            <Hourglass aria-hidden="true" />
                            {hold}
                        </Badge>
                    ))
                }
            >
                {payment && data.can_cancel && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="command"
                        onClick={() => setCorrecting(true)}
                    >
                        {payment.clerk_ended ? (
                            <>
                                <ReceiptText aria-hidden="true" />
                                Nota Kredit
                            </>
                        ) : (
                            <>
                                <Undo2 aria-hidden="true" />
                                Batal Pembayaran
                            </>
                        )}
                    </Button>
                )}
            </RecordActionBar>
            {payment &&
                correcting &&
                (payment.credit_memo ? (
                    <CreditMemoDialog
                        payment={payment}
                        preview={payment.credit_memo}
                        amountDecimals={data.amount_decimals}
                        localCurrency={data.local_currency}
                        onClose={() => setCorrecting(false)}
                        onPosted={async () => {
                            setCorrecting(false);
                            await refetch();
                        }}
                    />
                ) : (
                    <PaymentCancelDialog
                        payment={payment}
                        onClose={() => setCorrecting(false)}
                        onCancelled={async () => {
                            setCorrecting(false);
                            await refetch();
                        }}
                    />
                ))}
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <CollapsibleSectionGroup
                    defaultValue={['patient', 'sale', 'charges', 'cashier']}
                >
                    {data.visit ? (
                        <CollapsibleSection
                            value="patient"
                            title="Pasien"
                            summary={`(${data.visit.patient_medical_record_number}) ${data.visit.patient_name}`}
                        >
                            <FormGrid>
                                <FormControl>
                                    <Input
                                        label="No. Registrasi"
                                        value={data.visit.registration_number}
                                        readOnly
                                    />
                                </FormControl>
                                <FormControl>
                                    <Input
                                        label="NRM"
                                        value={
                                            data.visit
                                                .patient_medical_record_number
                                        }
                                        readOnly
                                    />
                                </FormControl>
                                <FormControl>
                                    <Input
                                        label="Tgl Reg"
                                        value={displayDate(data.visit.date)}
                                        readOnly
                                    />
                                </FormControl>
                                <FormControl>
                                    <Input
                                        label="Nama Pasien"
                                        value={data.visit.patient_name}
                                        readOnly
                                    />
                                </FormControl>
                                <FormControl>
                                    <Input
                                        label="Ruangan"
                                        value={data.visit.sections}
                                        readOnly
                                    />
                                </FormControl>
                                <FormControl>
                                    <Input
                                        label="Tipe Pasien"
                                        value={data.visit.patient_type_name}
                                        readOnly
                                    />
                                </FormControl>
                                <FormControl>
                                    <Input
                                        label="Penjamin"
                                        value={data.visit.guarantor_name ?? ''}
                                        readOnly
                                    />
                                </FormControl>
                                <FormControl>
                                    <Input
                                        label="Tipe Perawatan"
                                        value="RJ"
                                        readOnly
                                    />
                                </FormControl>
                            </FormGrid>
                        </CollapsibleSection>
                    ) : (
                        <CollapsibleSection
                            value="sale"
                            title="Penjualan"
                            summary={`${data.sale.number} · ${data.sale.buyer_name ?? 'Pembeli umum'}`}
                        >
                            <FormGrid>
                                <FormControl>
                                    <Input
                                        label="No. Bukti"
                                        value={data.sale.number}
                                        readOnly
                                    />
                                </FormControl>
                                <FormControl>
                                    <Input
                                        label="Waktu"
                                        value={new Date(
                                            data.sale.sold_at,
                                        ).toLocaleString('id-ID', {
                                            dateStyle: 'short',
                                            timeStyle: 'short',
                                        })}
                                        readOnly
                                    />
                                </FormControl>
                                <FormControl>
                                    <Input
                                        label="Pembeli"
                                        value={
                                            data.sale.buyer_name ??
                                            'Pembeli umum'
                                        }
                                        readOnly
                                    />
                                </FormControl>
                            </FormGrid>
                        </CollapsibleSection>
                    )}
                    <CollapsibleSection
                        value="charges"
                        title="Rincian Biaya"
                        summary={`${charges.length} baris · ${groupCount} kelompok`}
                    >
                        <DataTable
                            data={charges}
                            getRowKey={(charge) => charge.id}
                            getRowLabel={(charge) => charge.name}
                            scrollMode="inline"
                            showRowNumbers
                            emptyMessage="Tagihan ini belum punya baris biaya."
                            columns={[
                                {
                                    id: 'group',
                                    header: 'Group Biaya',
                                    width: 120,
                                    cell: (charge) => text(charge.charge_group),
                                },
                                {
                                    id: 'service_group',
                                    header: 'Kategori Biaya',
                                    width: 170,
                                    cell: (charge) =>
                                        text(charge.service_group_name ?? ''),
                                },
                                {
                                    id: 'name',
                                    header: 'Jenis',
                                    width: 240,
                                    cell: (charge) => text(charge.name),
                                },
                                {
                                    id: 'quantity',
                                    header: 'Qty',
                                    width: 80,
                                    align: 'right',
                                    cell: (charge) =>
                                        text(displayNumber(charge.quantity)),
                                },
                                {
                                    id: 'value',
                                    header: 'Nilai',
                                    width: 130,
                                    align: 'right',
                                    cell: (charge) =>
                                        text(displayNumber(charge.value)),
                                },
                                {
                                    id: 'discount',
                                    header: 'Disc %',
                                    width: 80,
                                    align: 'right',
                                    cell: (charge) =>
                                        text(
                                            displayNumber(
                                                charge.discount_percent,
                                            ),
                                        ),
                                },
                                {
                                    id: 'section',
                                    header: 'Section',
                                    width: 150,
                                    cell: (charge) =>
                                        text(charge.section_name ?? ''),
                                },
                                {
                                    id: 'doctor',
                                    header: 'Dokter',
                                    width: 180,
                                    cell: (charge) =>
                                        text(charge.doctor_name ?? ''),
                                },
                                {
                                    id: 'date',
                                    header: 'Tanggal',
                                    width: 110,
                                    cell: (charge) =>
                                        text(displayDate(charge.date)),
                                },
                            ]}
                        />
                    </CollapsibleSection>
                    <CollapsibleSection
                        value="cashier"
                        title={
                            payment
                                ? `Pembayaran ${payment.number}`
                                : 'Detail Pembayaran'
                        }
                        summary={`Nilai ${displayAmount(totals.value, data.amount_decimals)}`}
                    >
                        {data.credit_memos.length > 0 && (
                            <FormGrid className="mb-4">
                                {data.credit_memos.map((memo) => (
                                    <FormControl key={memo.number}>
                                        <Input
                                            label={`Pembayaran ${memo.payment_number}`}
                                            value={`Dikoreksi dengan nota kredit ${memo.number}`}
                                            readOnly
                                        />
                                    </FormControl>
                                ))}
                            </FormGrid>
                        )}
                        {payment ? (
                            <FormGrid>
                                <FormControl
                                    hint={
                                        payment.automatic
                                            ? 'Lunas otomatis saat kunjungan selesai, karena tipe pasiennya lunas otomatis di kasir.'
                                            : undefined
                                    }
                                >
                                    <Input
                                        label="Nilai"
                                        value={displayAmount(
                                            totals.value,
                                            data.amount_decimals,
                                        )}
                                        readOnly
                                    />
                                </FormControl>
                                {payment.discounts.map((discount, index) => (
                                    <FormControl
                                        key={`discount-${index}`}
                                        hint={[
                                            `${displayNumber(discount.percent)}%`,
                                            discount.procedure_name,
                                            discount.doctor_name,
                                            discount.note,
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    >
                                        <Input
                                            label={discount.name}
                                            value={displayAmount(
                                                discount.amount,
                                                data.amount_decimals,
                                            )}
                                            readOnly
                                        />
                                    </FormControl>
                                ))}
                                {payment.discount !== '0' && (
                                    <FormControl>
                                        <Input
                                            label="Nilai Discount"
                                            value={displayAmount(
                                                payment.discount,
                                                data.amount_decimals,
                                            )}
                                            readOnly
                                        />
                                    </FormControl>
                                )}
                                {(payment.received !== '0' ||
                                    payment.change !== '0') && (
                                    <FormControl>
                                        <Input
                                            label={
                                                payment.cash_label ??
                                                'Uang diterima'
                                            }
                                            value={displayAmount(
                                                payment.received,
                                                data.amount_decimals,
                                            )}
                                            readOnly
                                        />
                                    </FormControl>
                                )}
                                {payment.lines.map((line) => (
                                    <FormControl
                                        key={line.label}
                                        hint={
                                            line.currency_code ===
                                            data.local_currency
                                                ? undefined
                                                : `${line.currency_code} ${displayNumber(line.currency_amount)} dengan kurs ${displayNumber(line.rate)}.`
                                        }
                                    >
                                        <Input
                                            label={line.label}
                                            value={displayAmount(
                                                line.amount,
                                                data.amount_decimals,
                                            )}
                                            readOnly
                                        />
                                    </FormControl>
                                ))}
                                <FormControl>
                                    <Input
                                        label="Kembalian"
                                        value={displayAmount(
                                            payment.change,
                                            data.amount_decimals,
                                        )}
                                        readOnly
                                    />
                                </FormControl>
                            </FormGrid>
                        ) : data.can_pay ? (
                            <PaymentForm form={data} reload={() => refetch()} />
                        ) : (
                            <FormGrid>
                                <FormControl hint="Jumlah Qty x (Nilai - Disc %) + HExt semua baris, dibulatkan ke rupiah.">
                                    <Input
                                        label="Nilai"
                                        value={displayAmount(
                                            totals.value,
                                            data.amount_decimals,
                                        )}
                                        readOnly
                                    />
                                </FormControl>
                            </FormGrid>
                        )}
                    </CollapsibleSection>
                </CollapsibleSectionGroup>
            </div>
        </div>
    );
}

export const page = definePage({
    path: '/billing/payments/$visitId',
    layout: 'app',
    title: 'Pembayaran',
    component: PaymentPage,
});

export const record = defineRecordPage({
    key: 'core.payment',
    title: 'Pembayaran',
    component: PaymentRecord,
});
