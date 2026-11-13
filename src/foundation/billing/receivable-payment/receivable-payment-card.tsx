import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { displayDate } from '@operations-metta/ui/date-picker';
import {
    displayAmount,
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Select } from '@operations-metta/ui/select';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Decimal } from '../../../platform/money/index.ts';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import { ReceivableLookup, type Receivable } from './receivable-lookup.tsx';
import { ReceivablePaymentCancelDialog } from './receivable-payment-cancel-dialog.tsx';

export type ReceivablePayment =
    ApiBody<'billingReceivablePaymentList'>['data'][number];

// Form Transaksi Pembayaran Hutang sistem lama: kiri invoice yang dilunasi dan pasiennya, kanan Nilai Hutang, Nilai
// Akumulasi Bayar, Kewajiban, Nilai Pembayaran (bawaannya Kewajiban), dan Sisa, lalu jenis bayar dengan merchan, No
// Kartu, dan Add Charge % bila jenis bayarnya memintanya. Pembayaran yang sudah tersimpan hanya bisa dilihat atau
// dibatalkan.

const emptyForm = {
    payment_method_id: '',
    amount: '',
    merchant_id: '',
    reference: '',
    surcharge_percent: '',
};

// Isian layar (titik ribuan, koma desimal) ke teks desimal API; isian yang tidak terbaca dikirim apa adanya supaya
// server menolaknya per isian.
const typed = (text: string) =>
    text.trim() ? (parseDisplayNumber(text) ?? text.trim()) : '0';
const decimal = (text: string) =>
    /^\d+(\.\d+)?$/.test(text) ? Decimal.of(text) : null;

export function ReceivablePaymentCard({
    record,
    canPay,
    onSaved,
    onClose,
}: {
    record: ReceivablePayment | null;
    canPay: boolean;
    onSaved: (payment: ReceivablePayment) => void;
    onClose: () => void;
}): ReactNode {
    const editing = record === null && canPay;
    const [receivable, setReceivable] = useState<Receivable | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [busy, setBusy] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const portalContainer = useRef<HTMLFormElement>(null);
    const { data: metadata } = useQuery(
        orpc.billingReceivablePaymentMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const dirty =
        receivable !== null ||
        JSON.stringify(form) !== JSON.stringify(emptyForm);
    usePageDialogRecord({
        recordTitle: record
            ? `${record.number} ${record.patient_name}`
            : 'Pembayaran hutang baru',
        editing,
        dirty,
    });
    const money = (value: string) =>
        displayAmount(value, metadata?.amount_decimals ?? 0);
    const method = metadata?.payment_methods.find(
        (candidate) => candidate.id === form.payment_method_id,
    );

    const invoice = record ?? {
        number: '',
        date: metadata?.date ?? '',
        invoice_date: receivable?.invoice_date ?? '',
        registration_number: receivable?.registration_number ?? '',
        patient_medical_record_number:
            receivable?.patient_medical_record_number ?? '',
        patient_name: receivable?.patient_name ?? '',
        patient_type_name: receivable?.patient_type_name ?? '',
        receivable_amount: receivable?.amount ?? '0',
        previously_paid: receivable?.paid ?? '0',
    };
    const obligation = Decimal.of(invoice.receivable_amount).minus(
        Decimal.of(invoice.previously_paid),
    );
    const amount = decimal(record ? record.amount : typed(form.amount));
    const remaining = amount ? obligation.minus(amount) : obligation;

    const save = async () => {
        setErrors({});
        setMessage(null);
        if (
            !(await confirm({
                title: 'Apakah Anda yakin ingin memproses data ini?',
                description: `Nilai Pembayaran ${money(amount?.normalized() ?? '0')}.`,
                confirmLabel: 'Simpan',
            }))
        )
            return;
        setBusy(true);
        try {
            const { body } = await api.billingReceivablePaymentCreate({
                body: {
                    receivable_id: receivable?.id ?? '',
                    payment_method_id: form.payment_method_id,
                    amount: typed(form.amount),
                    merchant_id: form.merchant_id || null,
                    reference: form.reference || null,
                    surcharge_percent: typed(form.surcharge_percent),
                },
            });
            toast.success(body.message);
            onSaved(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(
                        caught,
                        'Operasi buat data gagal! Silakan coba lagi.',
                    ),
                );
        } finally {
            setBusy(false);
        }
    };

    const shown = (label: string, value: string) => (
        <FormControl>
            <Input label={label} value={value} readOnly />
        </FormControl>
    );
    const edited = (
        field: 'amount' | 'reference' | 'surcharge_percent',
        label: string,
        input: { inputMode?: 'decimal'; maxLength?: number },
    ) => (
        <FormControl error={errors[field]?.[0]}>
            <Input
                label={label}
                required={field !== 'surcharge_percent'}
                data-error-field={field}
                value={form[field]}
                onChange={(event) =>
                    setForm({ ...form, [field]: event.target.value })
                }
                {...input}
            />
        </FormControl>
    );

    return (
        <>
            <form
                ref={portalContainer}
                noValidate
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void save();
                }}
            >
                <PageDialogToolbar>
                    {editing && (
                        <>
                            <ActionButton
                                action="save"
                                type="submit"
                                disabled={busy}
                                pending={busy}
                            />
                            <ActionButton
                                action="cancel"
                                type="button"
                                disabled={busy}
                                onClick={onClose}
                            />
                        </>
                    )}
                    {record?.status === 'diposting' && canPay && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            onClick={() => setCancelling(true)}
                        >
                            <Undo2 aria-hidden="true" />
                            Batal
                        </Button>
                    )}
                </PageDialogToolbar>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation="Pembayaran hutang belum disimpan"
                />
                <PageDialogBody className="py-3">
                    <div className="grid gap-x-6 sm:grid-cols-2">
                        <FormGrid columns={1}>
                            {shown('Nomor Bukti', invoice.number)}
                            {shown('Tanggal', displayDate(invoice.date))}
                            {record ? (
                                shown('Nomor Invoice', record.invoice_number)
                            ) : (
                                <ReceivableLookup
                                    label="Nomor Invoice"
                                    required
                                    field="receivable_id"
                                    value={receivable}
                                    disabled={!editing}
                                    error={errors.receivable_id?.[0]}
                                    portalContainer={portalContainer}
                                    onChange={(next) => {
                                        setReceivable(next);
                                        setForm({
                                            ...form,
                                            amount: displayNumber(
                                                next.remaining,
                                            ),
                                        });
                                    }}
                                />
                            )}
                            {shown(
                                'Tanggal Invoice',
                                displayDate(invoice.invoice_date),
                            )}
                            {shown(
                                'Nomor Registrasi',
                                invoice.registration_number,
                            )}
                            {shown(
                                'NRM',
                                invoice.patient_medical_record_number,
                            )}
                            {shown('Nama Pasien', invoice.patient_name)}
                            {shown('Tipe Pasien', invoice.patient_type_name)}
                        </FormGrid>
                        <FormGrid columns={1}>
                            {shown(
                                'Nilai Hutang',
                                money(invoice.receivable_amount),
                            )}
                            {shown(
                                'Nilai Akumulasi Bayar',
                                money(invoice.previously_paid),
                            )}
                            {shown('Kewajiban', money(obligation.normalized()))}
                            {record
                                ? shown(
                                      'Nilai Pembayaran',
                                      money(record.amount),
                                  )
                                : edited('amount', 'Nilai Pembayaran', {
                                      inputMode: 'decimal',
                                  })}
                            {shown('Sisa', money(remaining.normalized()))}
                            {record ? (
                                <>
                                    {shown(
                                        'Jenis Bayar',
                                        record.payment_method_name,
                                    )}
                                    {record.merchant_name !== null &&
                                        shown('Merchan', record.merchant_name)}
                                    {record.reference !== null &&
                                        shown('No Kartu', record.reference)}
                                    {Decimal.of(
                                        record.surcharge_percent,
                                    ).compare(Decimal.of('0')) !== 0 &&
                                        shown(
                                            'Add Charge (%)',
                                            displayNumber(
                                                record.surcharge_percent,
                                            ),
                                        )}
                                    {record.status === 'batal' &&
                                        shown(
                                            'Alasan Batal',
                                            record.cancel_reason ?? '',
                                        )}
                                </>
                            ) : (
                                <>
                                    <FormControl
                                        error={errors.payment_method_id?.[0]}
                                        data-error-field="payment_method_id"
                                    >
                                        <Select
                                            label="Jenis Bayar"
                                            required
                                            items={(
                                                metadata?.payment_methods ?? []
                                            ).map((candidate) => ({
                                                value: candidate.id,
                                                label: candidate.label,
                                            }))}
                                            value={form.payment_method_id}
                                            onValueChange={(value) =>
                                                setForm({
                                                    ...form,
                                                    payment_method_id:
                                                        value ?? '',
                                                })
                                            }
                                            portalContainer={portalContainer}
                                        />
                                    </FormControl>
                                    {method?.requires_merchant && (
                                        <FormControl
                                            error={errors.merchant_id?.[0]}
                                            data-error-field="merchant_id"
                                        >
                                            <Select
                                                label="Merchan"
                                                required
                                                items={(
                                                    metadata?.merchants ?? []
                                                ).map((merchant) => ({
                                                    value: merchant.id,
                                                    label: `${merchant.code} · ${merchant.name}`,
                                                }))}
                                                value={form.merchant_id}
                                                onValueChange={(value) =>
                                                    setForm({
                                                        ...form,
                                                        merchant_id:
                                                            value ?? '',
                                                    })
                                                }
                                                searchPlaceholder="Cari merchan"
                                                emptyMessage="Belum ada merchan."
                                                portalContainer={
                                                    portalContainer
                                                }
                                            />
                                        </FormControl>
                                    )}
                                    {method?.requires_reference &&
                                        edited('reference', 'No Kartu', {
                                            maxLength: 100,
                                        })}
                                    {method?.allows_surcharge &&
                                        edited(
                                            'surcharge_percent',
                                            'Add Charge (%)',
                                            { inputMode: 'decimal' },
                                        )}
                                </>
                            )}
                        </FormGrid>
                    </div>
                </PageDialogBody>
                {confirmation}
            </form>
            {record && cancelling && (
                <ReceivablePaymentCancelDialog
                    payment={record}
                    onClose={() => setCancelling(false)}
                    onCancelled={(cancelled) => {
                        setCancelling(false);
                        onSaved(cancelled);
                    }}
                />
            )}
        </>
    );
}
