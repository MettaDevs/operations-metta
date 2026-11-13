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
import { Undo2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { definePage, orpc } from '../../../platform/shell/index.ts';
import { PaymentCancelDialog } from '../payment/payment-cancel-dialog.tsx';
import { PaymentForm } from '../payment/payment-form.tsx';

// Form Pembayaran Kuta 1: panel Pasien, Rincian Biaya, dan Detail Pembayaran. Nilai dihitung server dengan rumus
// kasir Kuta (invoice.totals.ts); kunjungan yang sudah dibayar menampilkan pembayarannya. Rincian menampilkan nilai baris apa adanya; sistem lama
// membulatkan tampilan baris ke atas per 1.000, padahal yang ditagih nilai tepatnya.

const route = getRouteApi('/_app/billing/payments/$visitId');

function PaymentPage(): ReactNode {
    const { visitId } = route.useParams();
    const { data, refetch } = useSuspenseQuery(
        orpc.billingVisitShow.queryOptions({
            input: { params: { id: visitId } },
            select: (response) => response.body.data,
        }),
    );
    const { visit, charges, totals, payment } = data;
    const [cancelling, setCancelling] = useState(false);
    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    const groupCount = new Set(
        charges.map(
            (charge) => `${charge.charge_group}:${charge.service_group_id}`,
        ),
    ).size;
    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <RecordActionBar title={`Pembayaran ${visit.registration_number}`}>
                {payment && data.can_pay && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="command"
                        onClick={() => setCancelling(true)}
                    >
                        <Undo2 aria-hidden="true" />
                        Batal Pembayaran
                    </Button>
                )}
            </RecordActionBar>
            {payment && cancelling && (
                <PaymentCancelDialog
                    payment={payment}
                    onClose={() => setCancelling(false)}
                    onCancelled={async () => {
                        setCancelling(false);
                        await refetch();
                    }}
                />
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <CollapsibleSectionGroup
                    defaultValue={['patient', 'charges', 'cashier']}
                >
                    <CollapsibleSection
                        value="patient"
                        title="Pasien"
                        summary={`(${visit.patient_medical_record_number}) ${visit.patient_name}`}
                    >
                        <FormGrid>
                            <FormControl>
                                <Input
                                    label="No. Registrasi"
                                    value={visit.registration_number}
                                    readOnly
                                />
                            </FormControl>
                            <FormControl>
                                <Input
                                    label="NRM"
                                    value={visit.patient_medical_record_number}
                                    readOnly
                                />
                            </FormControl>
                            <FormControl>
                                <Input
                                    label="Tgl Reg"
                                    value={displayDate(visit.date)}
                                    readOnly
                                />
                            </FormControl>
                            <FormControl>
                                <Input
                                    label="Nama Pasien"
                                    value={visit.patient_name}
                                    readOnly
                                />
                            </FormControl>
                            <FormControl>
                                <Input
                                    label="Ruangan"
                                    value={visit.sections}
                                    readOnly
                                />
                            </FormControl>
                            <FormControl>
                                <Input
                                    label="Tipe Pasien"
                                    value={visit.patient_type_name}
                                    readOnly
                                />
                            </FormControl>
                            <FormControl>
                                <Input
                                    label="Penjamin"
                                    value={visit.guarantor_name ?? ''}
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
                            emptyMessage="Kunjungan ini belum punya baris biaya."
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
                        {payment ? (
                            <FormGrid>
                                <FormControl>
                                    <Input
                                        label="Nilai"
                                        value={displayAmount(
                                            totals.value,
                                            data.amount_decimals,
                                        )}
                                        readOnly
                                    />
                                </FormControl>
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
                            <PaymentForm
                                form={data}
                                onSaved={() => refetch()}
                            />
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
