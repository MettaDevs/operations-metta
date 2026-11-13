import { ActionButton } from '@operations-metta/ui/action-button';
import {
    displayAmount,
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { Select } from '@operations-metta/ui/select';
import { Switch } from '@operations-metta/ui/switch';
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@operations-metta/ui/tabs';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import { Decimal } from '../../../platform/money/index.ts';
import { PartyLookup, type Party } from './party-lookup.tsx';
import {
    discountPayload,
    discountRowValues,
    PaymentDiscounts,
    type DiscountRow,
} from './payment-discounts.tsx';
import { fromMinor, paymentAmounts, toMinor } from './payment.amounts.ts';

// Tab Pembayaran Form Pembayaran Kuta 1, digambar dari jenis bayar legal entity: jenis bayar tunai menjadi Data Jumlah
// Bayar, penampung sisa menjadi centang Opsi, dan sisanya baris Metode Pembayaran Lain dengan merchan, biaya tambahan,
// nomor referensi, atau pihak bila jenis bayarnya memintanya. Angka dihitung dengan rumus yang sama dengan server.
// Jenis bayar bermata uang asing diisi dalam mata uang itu; kursnya bawaan Sys Admin › Kurs hari ini, bisa diubah oleh
// pemegang izin ubah kurs, dan nilainya dalam mata uang lokal ikut ditampilkan. Kembalian selalu mata uang lokal.
// Jenis bayar yang dikhususkan tipe pasien lain tetap tampil seperti layar lama, dan menolak isian dengan pesannya.

type Form = ApiBody<'billingVisitShow'>['data'];
type Method = Form['payment_methods'][number];
type Line = {
    amount: string;
    merchant: string;
    reference: string;
    surcharge: string;
    party: Party | null;
    // Kurs yang diketik kasir; kosong berarti kurs bawaan.
    rate: string;
};
const emptyLine: Line = {
    amount: '',
    merchant: '',
    reference: '',
    surcharge: '',
    party: null,
    rate: '',
};

// Isian layar (titik ribuan, koma desimal) ke teks desimal API; isian yang tidak terbaca dikirim apa adanya supaya
// server menolaknya per isian.
const typed = (text: string) =>
    text.trim() ? (parseDisplayNumber(text) ?? text.trim()) : '0';
const minor = (text: string) => {
    const value = typed(text);
    return /^\d+(\.\d+)?$/.test(value) ? toMinor(value) : 0n;
};

export function PaymentForm({
    form,
    onSaved,
}: {
    form: Form;
    onSaved: () => Promise<unknown>;
}): ReactNode {
    const localCash = (method: Method) =>
        method.behavior === 'tunai' && !method.currency_code;
    const cash = form.payment_methods.find(localCash);
    const remainderMethod = form.payment_methods.find(
        (method) => method.takes_remainder,
    );
    const others = form.payment_methods.filter(
        (method) => !localCash(method) && !method.takes_remainder,
    );
    const [received, setReceived] = useState('');
    const [lines, setLines] = useState<Record<string, Line>>({});
    const [takeRemainder, setTakeRemainder] = useState(false);
    const [discounts, setDiscounts] = useState<DiscountRow[]>([]);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    // Jenis bayar yang baru saja menolak isian karena dikhususkan tipe pasien lain.
    const [refused, setRefused] = useState<Method | null>(null);
    const refusal = (method: Method) =>
        refused?.id === method.id ? (method.refusal ?? undefined) : undefined;
    // Isian jenis bayar yang ditolak tetap kosong, seperti layar lama yang mengosongkannya.
    const accepts = (method: Method) => {
        if (method.refusal === null) return true;
        setRefused(method);
        return false;
    };
    const { confirm, confirmation } = useConfirmation();
    const switchId = useId();
    const portalContainer = useRef<HTMLFormElement>(null);
    const line = (id: string) => lines[id] ?? emptyLine;
    const setLine = (id: string, next: Partial<Line>) =>
        setLines({ ...lines, [id]: { ...line(id), ...next } });
    const used = others.filter((method) => line(method.id).amount.trim());
    const shown = (value: bigint) =>
        displayAmount(fromMinor(value), form.amount_decimals);
    // Kurs yang dipakai baris bermata uang asing: ketikan kasir, atau kurs bawaan.
    const rateOf = (method: Method) => {
        const typedRate = line(method.id).rate.trim();
        return typedRate ? typed(typedRate) : (method.rate ?? '');
    };
    // Nilai baris dalam mata uang lokal: jumlah valuta x kurs, dibulatkan ke presisi jumlah mata uang lokal.
    const localMinor = (method: Method) => {
        const amount = minor(line(method.id).amount);
        if (!method.currency_code) return amount;
        const rate = rateOf(method);
        if (!/^\d+(\.\d+)?$/.test(rate)) return 0n;
        return toMinor(
            Decimal.of(fromMinor(amount))
                .multipliedBy(Decimal.of(rate))
                .rounded(form.amount_decimals)
                .normalized(),
        );
    };
    const discountTotal = discounts.reduce((sum, row) => {
        const values = discountRowValues(form, row);
        return values ? sum + toMinor(values.amount) : sum;
    }, 0n);
    const amounts = paymentAmounts({
        value: toMinor(form.totals.value),
        discount: discountTotal,
        received: minor(received),
        lines: used.map((method) => ({
            amount: localMinor(method),
            surchargePercent: method.allows_surcharge
                ? minor(line(method.id).surcharge)
                : 0n,
            cash: method.behavior === 'tunai',
        })),
        amountDecimals: form.amount_decimals,
    });

    const save = async () => {
        setErrors({});
        setMessage(null);
        if (amounts.remainder > 0n && !takeRemainder) {
            setMessage('Masih terdapat Sisa pembayaran!!');
            return;
        }
        if (
            !(await confirm({
                title: 'Apakah Anda yakin ingin memproses data ini?',
                description: `Grand Total ${shown(amounts.grandTotal)}.`,
                confirmLabel: 'Simpan',
            }))
        )
            return;
        setBusy(true);
        try {
            const { body } = await api.billingPaymentCreate({
                params: { id: form.visit.id },
                body: {
                    received: typed(received),
                    take_remainder: takeRemainder,
                    discounts: discountPayload(discounts),
                    lines: used.map((method) => ({
                        payment_method_id: method.id,
                        amount: typed(line(method.id).amount),
                        merchant_id: line(method.id).merchant || null,
                        reference: line(method.id).reference || null,
                        surcharge_percent: typed(line(method.id).surcharge),
                        party_id: line(method.id).party?.id ?? null,
                        rate: line(method.id).rate.trim()
                            ? typed(line(method.id).rate)
                            : null,
                    })),
                },
            });
            toast.success(body.message);
            await onSaved();
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

    const readOnly = (label: string, value: bigint, hint?: string) => (
        <FormControl hint={hint}>
            <Input label={label} value={shown(value)} readOnly />
        </FormControl>
    );
    const field = (index: number, name: string) => `lines.${index}.${name}`;

    return (
        <form
            ref={portalContainer}
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
                event.preventDefault();
                void save();
            }}
        >
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Pembayaran belum disimpan"
            />
            <Tabs defaultValue="payment">
                <TabsList>
                    <TabsTrigger value="payment">Pembayaran</TabsTrigger>
                    <TabsTrigger value="discount">Diskon</TabsTrigger>
                </TabsList>
                <TabsContent value="discount">
                    <PaymentDiscounts
                        form={form}
                        rows={discounts}
                        onChange={setDiscounts}
                        errors={errors}
                        portalContainer={portalContainer}
                    />
                </TabsContent>
                <TabsContent value="payment" className="space-y-4">
                    <h3 className="text-sm font-semibold">Data Kasir</h3>
                    <FormGrid>
                        {readOnly('Nilai', toMinor(form.totals.value))}
                        {readOnly('Nilai Discount', discountTotal)}
                        {readOnly('Sub Total', amounts.subTotal)}
                        {readOnly('Tax Kartu Kredit', amounts.surcharge)}
                        {readOnly('Grand Total', amounts.grandTotal)}
                        {readOnly('Total Pembayaran', amounts.paid)}
                        {readOnly('Sisa', amounts.remainder)}
                    </FormGrid>
                    {cash && (
                        <>
                            <h3 className="text-sm font-semibold">
                                Data Jumlah Bayar
                            </h3>
                            <FormGrid>
                                <FormControl
                                    error={
                                        errors.received?.[0] ?? refusal(cash)
                                    }
                                >
                                    <Input
                                        label={cash.label}
                                        inputMode="decimal"
                                        autoFocus
                                        data-error-field="received"
                                        value={received}
                                        onChange={(event) => {
                                            if (accepts(cash))
                                                setReceived(event.target.value);
                                        }}
                                    />
                                </FormControl>
                                {readOnly('Kembalian', amounts.change)}
                            </FormGrid>
                        </>
                    )}
                    {others.length > 0 && (
                        <h3 className="text-sm font-semibold">
                            Metode Pembayaran Lain
                        </h3>
                    )}
                    {others.map((method) => {
                        const index = used.indexOf(method);
                        return (
                            <FormGrid key={method.id}>
                                <FormControl
                                    error={
                                        errors[field(index, 'amount')]?.[0] ??
                                        refusal(method) ??
                                        method.rate_message ??
                                        undefined
                                    }
                                >
                                    <Input
                                        label={
                                            method.currency_code
                                                ? `${method.label} (${method.currency_code})`
                                                : method.label
                                        }
                                        inputMode="decimal"
                                        data-error-field={field(
                                            index,
                                            'amount',
                                        )}
                                        value={line(method.id).amount}
                                        onChange={(event) => {
                                            if (accepts(method))
                                                setLine(method.id, {
                                                    amount: event.target.value,
                                                });
                                        }}
                                    />
                                </FormControl>
                                {method.currency_code &&
                                    method.rate !== null && (
                                        <>
                                            <FormControl
                                                error={
                                                    errors[
                                                        field(index, 'rate')
                                                    ]?.[0]
                                                }
                                                hint={`Nilai 1 ${method.currency_code} dalam ${form.local_currency} dari Sys Admin › Kurs untuk hari ini.${form.can_change_rate ? ' Ubah bila kurs yang disepakati berbeda.' : ''}`}
                                            >
                                                <Input
                                                    label="Kurs"
                                                    inputMode="decimal"
                                                    data-error-field={field(
                                                        index,
                                                        'rate',
                                                    )}
                                                    value={
                                                        line(method.id).rate ||
                                                        displayNumber(
                                                            method.rate,
                                                        )
                                                    }
                                                    readOnly={
                                                        !form.can_change_rate
                                                    }
                                                    onChange={(event) =>
                                                        setLine(method.id, {
                                                            rate: event.target
                                                                .value,
                                                        })
                                                    }
                                                />
                                            </FormControl>
                                            <FormControl>
                                                <Input
                                                    label={`Nilai ${form.local_currency}`}
                                                    value={shown(
                                                        localMinor(method),
                                                    )}
                                                    readOnly
                                                />
                                            </FormControl>
                                        </>
                                    )}
                                {method.requires_merchant && (
                                    <FormControl
                                        error={
                                            errors[
                                                field(index, 'merchant_id')
                                            ]?.[0]
                                        }
                                        data-error-field={field(
                                            index,
                                            'merchant_id',
                                        )}
                                    >
                                        <Select
                                            label="Merchan"
                                            items={form.merchants.map(
                                                (merchant) => ({
                                                    value: merchant.id,
                                                    label: `${merchant.code} · ${merchant.name}`,
                                                }),
                                            )}
                                            value={line(method.id).merchant}
                                            onValueChange={(value) =>
                                                setLine(method.id, {
                                                    merchant: value ?? '',
                                                })
                                            }
                                            searchPlaceholder="Cari merchan"
                                            emptyMessage="Belum ada merchan."
                                            portalContainer={portalContainer}
                                        />
                                    </FormControl>
                                )}
                                {method.allows_surcharge && (
                                    <FormControl
                                        error={
                                            errors[
                                                field(
                                                    index,
                                                    'surcharge_percent',
                                                )
                                            ]?.[0]
                                        }
                                    >
                                        <Input
                                            label="Add Charge (%)"
                                            inputMode="decimal"
                                            data-error-field={field(
                                                index,
                                                'surcharge_percent',
                                            )}
                                            value={line(method.id).surcharge}
                                            onChange={(event) =>
                                                setLine(method.id, {
                                                    surcharge:
                                                        event.target.value,
                                                })
                                            }
                                        />
                                    </FormControl>
                                )}
                                {method.requires_reference && (
                                    <FormControl
                                        error={
                                            errors[
                                                field(index, 'reference')
                                            ]?.[0]
                                        }
                                    >
                                        <Input
                                            label="No Kartu / Referensi"
                                            maxLength={100}
                                            data-error-field={field(
                                                index,
                                                'reference',
                                            )}
                                            value={line(method.id).reference}
                                            onChange={(event) =>
                                                setLine(method.id, {
                                                    reference:
                                                        event.target.value,
                                                })
                                            }
                                        />
                                    </FormControl>
                                )}
                                {method.party === 'pilih_pihak' && (
                                    <PartyLookup
                                        label="Dokter / Karyawan"
                                        field={field(index, 'party_id')}
                                        value={line(method.id).party}
                                        onChange={(party) =>
                                            setLine(method.id, { party })
                                        }
                                        error={
                                            errors[
                                                field(index, 'party_id')
                                            ]?.[0]
                                        }
                                    />
                                )}
                            </FormGrid>
                        );
                    })}
                    {remainderMethod && (
                        <FormControl
                            hint="Sisa tagihan dicatat sebagai piutang pasien."
                            error={refusal(remainderMethod)}
                        >
                            <Field orientation="horizontal" className="w-auto">
                                <Switch
                                    id={switchId}
                                    checked={takeRemainder}
                                    onCheckedChange={(checked) => {
                                        if (
                                            !checked ||
                                            accepts(remainderMethod)
                                        )
                                            setTakeRemainder(checked);
                                    }}
                                />
                                <FieldLabel
                                    htmlFor={switchId}
                                    className="font-normal"
                                >
                                    {remainderMethod.label}
                                </FieldLabel>
                            </Field>
                        </FormControl>
                    )}
                </TabsContent>
            </Tabs>
            <ActionButton
                action="save"
                type="submit"
                disabled={busy}
                pending={busy}
            />
            {confirmation}
        </form>
    );
}
