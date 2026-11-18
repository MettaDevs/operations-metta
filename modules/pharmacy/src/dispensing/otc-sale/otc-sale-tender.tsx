import {
    displayAmount,
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type MasterLookupProps,
    type Reference,
} from '@operations-metta/ui/master-lookup';
import { Switch } from '@operations-metta/ui/switch';
import { useId } from 'react';
import type { ReactNode, RefObject } from 'react';
import { divideRounded, Decimal } from '@core/platform/money/index.ts';
import {
    api,
    MerchantLookup,
    type ApiBody,
} from '@core/platform/shell/index.ts';

// Tender loket obat bebas, digambar dari jenis bayar kasir Core seperti tab Pembayaran Form Pembayaran: jenis bayar
// tunai mata uang lokal menjadi uang diterima dengan kembalian, penampung sisa menjadi saklar piutang, dan sisanya baris
// jenis bayar lain dengan merchan, biaya tambahan, referensi, pihak, atau kurs bila jenis bayarnya memintanya. Module
// tidak boleh meng-import layar kasir Core, jadi rumus dan susunan isiannya disalin dari
// src/foundation/billing/payment/payment-form.tsx dan payment.amounts.ts. Server kasir tetap yang memutuskan; angka di
// sini hanya supaya petugas melihat kembalian dan sisa sebelum menekan Simpan dan bayar.

export type Options = ApiBody<'pharmacyOtcSaleOptions'>['data'];
type Method = Options['payment_methods'][number];

export type TenderLine = {
    amount: string;
    merchant: string;
    reference: string;
    surcharge: string;
    party: Reference | null;
    // Kurs yang diketik petugas; kosong berarti kurs bawaan.
    rate: string;
};
export type Tender = {
    received: string;
    lines: Record<string, TenderLine>;
    takeRemainder: boolean;
};
export const emptyTender: Tender = {
    received: '',
    lines: {},
    takeRemainder: false,
};
const emptyLine: TenderLine = {
    amount: '',
    merchant: '',
    reference: '',
    surcharge: '',
    party: null,
    rate: '',
};

const scale = 4;
const one = 10n ** BigInt(scale);
const decimalPattern = /^\d+(\.\d+)?$/;

const toMinor = (value: string): bigint => {
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
    const minor =
        BigInt(whole || '0') * one +
        BigInt((fraction + '0000').slice(0, scale));
    return negative ? -minor : minor;
};
const fromMinor = (minor: bigint): string => {
    const negative = minor < 0n;
    const absolute = negative ? -minor : minor;
    const fraction = (absolute % one)
        .toString()
        .padStart(scale, '0')
        .replace(/0+$/, '');
    return `${negative ? '-' : ''}${absolute / one}${fraction ? `.${fraction}` : ''}`;
};

// Isian layar (titik ribuan, koma desimal) ke teks desimal API; isian yang tidak terbaca dikirim apa adanya supaya
// server menolaknya per isian.
export const typed = (text: string): string =>
    text.trim() ? (parseDisplayNumber(text) ?? text.trim()) : '0';
const minor = (text: string) => {
    const value = typed(text);
    return decimalPattern.test(value) ? toMinor(value) : 0n;
};

const localCash = (method: Method) =>
    method.behavior === 'tunai' && !method.currency_code;
const lineOf = (tender: Tender, id: string) => tender.lines[id] ?? emptyLine;

function layout(options: Options) {
    return {
        cash: options.payment_methods.find(localCash),
        remainderMethod: options.payment_methods.find(
            (method) => method.takes_remainder,
        ),
        others: options.payment_methods.filter(
            (method) => !localCash(method) && !method.takes_remainder,
        ),
    };
}

// Jenis bayar lain yang diisi, berurut seperti dikirim, sehingga indeksnya sama dengan `payment.lines.N` di jawaban
// server.
const usedMethods = (options: Options, tender: Tender) =>
    layout(options).others.filter((method) =>
        lineOf(tender, method.id).amount.trim(),
    );

const rateOf = (method: Method, line: TenderLine) =>
    line.rate.trim() ? typed(line.rate) : (method.rate ?? '');

// Nilai baris dalam mata uang lokal: jumlah valuta x kurs, dibulatkan ke presisi jumlah mata uang lokal.
function localMinor(method: Method, line: TenderLine, decimals: number) {
    const amount = minor(line.amount);
    if (!method.currency_code) return amount;
    const rate = rateOf(method, line);
    if (!decimalPattern.test(rate)) return 0n;
    return toMinor(
        Decimal.of(fromMinor(amount))
            .multipliedBy(Decimal.of(rate))
            .rounded(decimals)
            .normalized(),
    );
}

// Rumus layar Pembayaran (payment.amounts.ts) tanpa diskon kasir.
function amounts(options: Options, total: string, tender: Tender) {
    const decimals = options.amount_decimals;
    const step = 10n ** BigInt(scale - Math.min(decimals, scale));
    const lines = usedMethods(options, tender).map((method) => {
        const line = lineOf(tender, method.id);
        const amount = localMinor(method, line, decimals);
        return {
            amount,
            surcharge: method.allows_surcharge
                ? divideRounded(
                      amount * minor(line.surcharge),
                      100n * one * step,
                  ) * step
                : 0n,
            cash: method.behavior === 'tunai',
        };
    });
    const surcharge = lines.reduce((sum, line) => sum + line.surcharge, 0n);
    const othersTotal = lines.reduce(
        (sum, line) => (line.cash ? sum : sum + line.amount),
        0n,
    );
    const tendered = lines.reduce(
        (sum, line) => (line.cash ? sum + line.amount : sum),
        minor(tender.received),
    );
    const grandTotal = toMinor(total) + surcharge;
    const due = grandTotal - surcharge - othersTotal;
    const change =
        tendered > 0n && due > 0n && tendered > due ? tendered - due : 0n;
    const sum = othersTotal + tendered + surcharge;
    const paid = sum < grandTotal ? sum : grandTotal;
    return {
        surcharge,
        grandTotal,
        paid,
        remainder: grandTotal - paid,
        change,
    };
}

export function tenderChange(
    options: Options,
    total: string,
    tender: Tender,
): string {
    return displayAmount(
        fromMinor(amounts(options, total, tender).change),
        options.amount_decimals,
    );
}

// Isian `payment` Simpan dan bayar, bentuk yang sama dengan Simpan pembayaran kasir.
export function tenderPayload(options: Options, tender: Tender) {
    return {
        received: typed(tender.received),
        take_remainder: tender.takeRemainder,
        lines: usedMethods(options, tender).map((method) => {
            const line = lineOf(tender, method.id);
            return {
                payment_method_id: method.id,
                amount: typed(line.amount),
                merchant_id: line.merchant || null,
                reference: line.reference || null,
                surcharge_percent: typed(line.surcharge),
                party_id: line.party?.id ?? null,
                rate: line.rate.trim() ? typed(line.rate) : null,
            };
        }),
    };
}

const loadParties = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.partyList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data.map((party): Reference => ({
            id: party.id,
            code: '',
            name: party.name,
        })),
        nextCursor: body.next_cursor,
    };
};

// Pihak buku alamat Core, untuk pembeli dan jenis bayar yang pihaknya dipilih saat bayar.
export function PartyLookup(props: MasterLookupProps<Reference>): ReactNode {
    return (
        <MasterLookup<Reference>
            {...props}
            noun="Pihak"
            placeholder="Cari nama…"
            load={loadParties}
            columns={[nameColumn(260)]}
        />
    );
}

export function OtcSaleTender({
    options,
    total,
    tender,
    onChange,
    errors,
    portalContainer,
}: {
    options: Options;
    // Total quote terakhir; null selama belum ada obat yang dihargai.
    total: string | null;
    tender: Tender;
    onChange: (tender: Tender) => void;
    errors: Record<string, string[]>;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    const switchId = useId();
    const { cash, remainderMethod, others } = layout(options);
    const used = usedMethods(options, tender);
    const figures = amounts(options, total ?? '0', tender);
    const shown = (value: bigint) =>
        displayAmount(fromMinor(value), options.amount_decimals);
    const setLine = (id: string, next: Partial<TenderLine>) =>
        onChange({
            ...tender,
            lines: {
                ...tender.lines,
                [id]: { ...lineOf(tender, id), ...next },
            },
        });
    const field = (index: number, name: string) =>
        `payment.lines.${index}.${name}`;
    const error = (name: string) => errors[name]?.[0];
    const readOnly = (label: string, value: bigint) => (
        <FormControl>
            <Input label={label} value={shown(value)} readOnly />
        </FormControl>
    );

    return (
        <div className="space-y-4">
            <FormGrid>
                {figures.surcharge > 0n &&
                    readOnly('Biaya kartu', figures.surcharge)}
                {readOnly('Harus dibayar', figures.grandTotal)}
                {cash && (
                    <FormControl error={error('payment.received')}>
                        <Input
                            label={`${cash.label} diterima`}
                            inputMode="decimal"
                            data-error-field="payment.received"
                            value={tender.received}
                            onChange={(event) =>
                                onChange({
                                    ...tender,
                                    received: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                )}
                {readOnly('Kembalian', figures.change)}
                {figures.remainder > 0n && readOnly('Sisa', figures.remainder)}
            </FormGrid>
            {others.map((method) => {
                const line = lineOf(tender, method.id);
                const index = used.indexOf(method);
                return (
                    <FormGrid key={method.id}>
                        <FormControl
                            error={
                                error(field(index, 'amount')) ??
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
                                data-error-field={field(index, 'amount')}
                                value={line.amount}
                                onChange={(event) =>
                                    setLine(method.id, {
                                        amount: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                        {method.currency_code && method.rate !== null && (
                            <>
                                <FormControl
                                    error={error(field(index, 'rate'))}
                                    hint={`Nilai 1 ${method.currency_code} dalam ${options.local_currency} dari Sys Admin › Kurs untuk hari ini.${options.can_change_rate ? ' Ubah bila kurs yang disepakati berbeda.' : ''}`}
                                >
                                    <Input
                                        label="Kurs"
                                        inputMode="decimal"
                                        data-error-field={field(index, 'rate')}
                                        value={
                                            line.rate ||
                                            displayNumber(method.rate)
                                        }
                                        readOnly={!options.can_change_rate}
                                        onChange={(event) =>
                                            setLine(method.id, {
                                                rate: event.target.value,
                                            })
                                        }
                                    />
                                </FormControl>
                                {readOnly(
                                    `Nilai ${options.local_currency}`,
                                    localMinor(
                                        method,
                                        line,
                                        options.amount_decimals,
                                    ),
                                )}
                            </>
                        )}
                        {method.requires_merchant && (
                            <MerchantLookup
                                items={options.merchants}
                                value={line.merchant}
                                onChange={(merchant) =>
                                    setLine(method.id, { merchant })
                                }
                                error={error(field(index, 'merchant_id'))}
                                field={field(index, 'merchant_id')}
                                portalContainer={portalContainer}
                            />
                        )}
                        {method.allows_surcharge && (
                            <FormControl
                                error={error(field(index, 'surcharge_percent'))}
                            >
                                <Input
                                    label="Biaya kartu (%)"
                                    inputMode="decimal"
                                    data-error-field={field(
                                        index,
                                        'surcharge_percent',
                                    )}
                                    value={line.surcharge}
                                    onChange={(event) =>
                                        setLine(method.id, {
                                            surcharge: event.target.value,
                                        })
                                    }
                                />
                            </FormControl>
                        )}
                        {method.requires_reference && (
                            <FormControl
                                error={error(field(index, 'reference'))}
                            >
                                <Input
                                    label="No kartu / referensi"
                                    maxLength={100}
                                    data-error-field={field(index, 'reference')}
                                    value={line.reference}
                                    onChange={(event) =>
                                        setLine(method.id, {
                                            reference: event.target.value,
                                        })
                                    }
                                />
                            </FormControl>
                        )}
                        {method.party === 'pilih_pihak' &&
                            options.can_search_buyers && (
                                <PartyLookup
                                    label="Dokter / karyawan"
                                    field={field(index, 'party_id')}
                                    value={line.party}
                                    onChange={(party) =>
                                        setLine(method.id, { party })
                                    }
                                    error={error(field(index, 'party_id'))}
                                    portalContainer={portalContainer}
                                />
                            )}
                    </FormGrid>
                );
            })}
            {remainderMethod && (
                <FormControl hint="Sisa yang belum dibayar dicatat sebagai piutang pembeli. Pembeli harus dipilih dari buku alamat.">
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id={switchId}
                            checked={tender.takeRemainder}
                            onCheckedChange={(checked) =>
                                onChange({ ...tender, takeRemainder: checked })
                            }
                        />
                        <FieldLabel htmlFor={switchId} className="font-normal">
                            {remainderMethod.label}
                        </FieldLabel>
                    </Field>
                </FormControl>
            )}
        </div>
    );
}
