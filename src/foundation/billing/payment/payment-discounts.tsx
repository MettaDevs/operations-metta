import { ActionButton } from '@operations-metta/ui/action-button';
import {
    displayAmount,
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { Select } from '@operations-metta/ui/select';
import type { ReactNode, RefObject } from 'react';
import type { ApiBody } from '../../../platform/shell/index.ts';
import {
    discountBase,
    discountLine,
    isDiscountKind,
} from './payment.discount.ts';

// Tab Diskon Form Pembayaran (form/discount.php sistem lama): satu baris per diskon, berisi Nama Diskon, Dokter, Jasa,
// Persen, Nilai Diskon, dan Keterangan. Persen dan nilai saling menghitung dengan rumus yang sama dengan server; yang
// diketik terakhir yang dikirim.

type Form = ApiBody<'billingVisitShow'>['data'];

export type DiscountRow = {
    key: string;
    discountId: string;
    doctorId: string;
    procedureId: string;
    percent: string;
    amount: string;
    typed: 'percent' | 'amount';
    note: string;
};

export const newDiscountRow = (): DiscountRow => ({
    key: crypto.randomUUID(),
    discountId: '',
    doctorId: '',
    procedureId: '',
    percent: '',
    amount: '',
    typed: 'percent',
    note: '',
});

const numeric = (text: string) => {
    const value = text.trim() ? parseDisplayNumber(text) : null;
    return value !== null && /^\d+(\.\d+)?$/.test(value) ? value : null;
};

// Persen dan nilai baris yang dihitung dari isian yang diketik terakhir, atau null bila belum bisa dihitung.
export function discountRowValues(
    form: Form,
    row: DiscountRow,
): { percent: string; amount: string } | null {
    const master = form.discounts.find((item) => item.id === row.discountId);
    if (!master || !isDiscountKind(master.kind)) return null;
    const base = discountBase(master.kind, {
        invoiceValue: form.totals.value,
        componentId: master.charge_component_id,
        procedureId: row.procedureId || null,
        doctorId: row.doctorId || null,
        charges: form.charges.map((charge) => ({
            procedureId: charge.procedure_id,
            doctorId: charge.doctor_id,
            quantity: charge.quantity,
            components: charge.components.map((component) => ({
                componentId: component.charge_component_id,
                value: component.value,
            })),
        })),
    });
    const percent = numeric(row.percent);
    const amount = numeric(row.amount);
    if (row.typed === 'percent')
        return percent === null
            ? null
            : discountLine(base, { percent }, form.amount_decimals);
    return amount === null
        ? null
        : discountLine(base, { amount }, form.amount_decimals);
}

// Isian baris yang dikirim ke server: persen atau nilai, mana yang diketik terakhir.
export const discountPayload = (rows: DiscountRow[]) =>
    rows.map((row) => ({
        discount_id: row.discountId,
        doctor_id: row.doctorId || null,
        procedure_id: row.procedureId || null,
        ...(row.typed === 'percent'
            ? { percent: parseDisplayNumber(row.percent) ?? row.percent }
            : { amount: parseDisplayNumber(row.amount) ?? row.amount }),
        note: row.note.trim() || null,
    }));

export function PaymentDiscounts({
    form,
    rows,
    onChange,
    errors,
    portalContainer,
}: {
    form: Form;
    rows: DiscountRow[];
    onChange: (rows: DiscountRow[]) => void;
    errors: Record<string, string[]>;
    portalContainer: RefObject<HTMLFormElement | null>;
}): ReactNode {
    const set = (index: number, next: Partial<DiscountRow>) =>
        onChange(
            rows.map((row, at) => (at === index ? { ...row, ...next } : row)),
        );
    const doctors = [
        ...new Map(
            form.charges
                .filter((charge) => charge.doctor_id !== null)
                .map((charge) => [
                    charge.doctor_id ?? '',
                    charge.doctor_name ?? '',
                ]),
        ),
    ].map(([value, label]) => ({ value, label }));
    const field = (index: number, name: string) => `discounts.${index}.${name}`;
    return (
        <div className="space-y-4">
            {rows.length === 0 && (
                <p className="text-sm text-muted-foreground">
                    Belum ada diskon untuk pembayaran ini.
                </p>
            )}
            {rows.map((row, index) => {
                const master = form.discounts.find(
                    (item) => item.id === row.discountId,
                );
                const procedures = [
                    ...new Map(
                        form.charges
                            .filter(
                                (charge) =>
                                    (master?.kind !== 'kelompok_jasa' ||
                                        charge.service_group_id ===
                                            master.service_group_id) &&
                                    (master?.kind !== 'komponen' ||
                                        charge.components.some(
                                            (component) =>
                                                component.charge_component_id ===
                                                master.charge_component_id,
                                        )),
                            )
                            .map((charge) => [
                                charge.procedure_id,
                                `${charge.code} · ${charge.name}`,
                            ]),
                    ),
                ].map(([value, label]) => ({ value, label }));
                const values = discountRowValues(form, row);
                return (
                    <FormGrid key={row.key}>
                        <FormControl
                            error={errors[field(index, 'discount_id')]?.[0]}
                            data-error-field={field(index, 'discount_id')}
                        >
                            <Select
                                label="Nama Diskon"
                                required
                                items={form.discounts.map((discount) => ({
                                    value: discount.id,
                                    label: `${discount.code} · ${discount.name}`,
                                }))}
                                value={row.discountId}
                                onValueChange={(value) =>
                                    set(index, {
                                        discountId: value ?? '',
                                        procedureId: '',
                                    })
                                }
                                searchPlaceholder="Cari diskon"
                                emptyMessage="Belum ada diskon aktif."
                                portalContainer={portalContainer}
                            />
                        </FormControl>
                        <FormControl
                            error={errors[field(index, 'doctor_id')]?.[0]}
                            data-error-field={field(index, 'doctor_id')}
                        >
                            <Select
                                label="Nama Dokter"
                                items={doctors}
                                value={row.doctorId}
                                onValueChange={(value) =>
                                    set(index, { doctorId: value ?? '' })
                                }
                                emptyMessage="Rincian biaya tanpa dokter."
                                portalContainer={portalContainer}
                            />
                        </FormControl>
                        <FormControl
                            error={errors[field(index, 'procedure_id')]?.[0]}
                            data-error-field={field(index, 'procedure_id')}
                        >
                            <Select
                                label="Nama Jasa"
                                required={master?.kind === 'komponen'}
                                items={procedures}
                                value={row.procedureId}
                                onValueChange={(value) =>
                                    set(index, { procedureId: value ?? '' })
                                }
                                searchPlaceholder="Cari jasa"
                                emptyMessage="Tidak ada jasa yang cocok dengan diskon ini."
                                portalContainer={portalContainer}
                            />
                        </FormControl>
                        <FormControl
                            error={errors[field(index, 'percent')]?.[0]}
                            hint={
                                master?.kind === 'kelompok_jasa'
                                    ? 'Persen diskon kelompok jasa tidak dihitung. Isi nilai diskonnya.'
                                    : undefined
                            }
                        >
                            <Input
                                label="Persen (%)"
                                inputMode="decimal"
                                data-error-field={field(index, 'percent')}
                                value={
                                    row.typed === 'amount' && values
                                        ? displayNumber(values.percent)
                                        : row.percent
                                }
                                onChange={(event) =>
                                    set(index, {
                                        percent: event.target.value,
                                        typed: 'percent',
                                    })
                                }
                            />
                        </FormControl>
                        <FormControl
                            error={errors[field(index, 'amount')]?.[0]}
                        >
                            <Input
                                label="Nilai Diskon"
                                inputMode="decimal"
                                data-error-field={field(index, 'amount')}
                                value={
                                    row.typed === 'percent' && values
                                        ? displayAmount(
                                              values.amount,
                                              form.amount_decimals,
                                          )
                                        : row.amount
                                }
                                onChange={(event) =>
                                    set(index, {
                                        amount: event.target.value,
                                        typed: 'amount',
                                    })
                                }
                            />
                        </FormControl>
                        <FormControl error={errors[field(index, 'note')]?.[0]}>
                            <Input
                                label="Keterangan"
                                maxLength={100}
                                data-error-field={field(index, 'note')}
                                value={row.note}
                                onChange={(event) =>
                                    set(index, { note: event.target.value })
                                }
                            />
                        </FormControl>
                        <div className="flex items-end">
                            <ActionButton
                                action="delete"
                                onClick={() =>
                                    onChange(
                                        rows.filter((_, at) => at !== index),
                                    )
                                }
                            />
                        </div>
                    </FormGrid>
                );
            })}
            <ActionButton
                action="add"
                type="button"
                onClick={() => onChange([...rows, newDiscountRow()])}
            />
        </div>
    );
}
