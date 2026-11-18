import { ActionButton } from '@operations-metta/ui/action-button';
import {
    displayAmount,
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
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

type ChargeChoice = { id: string; code: string; name: string };

const codeColumn: DataTableColumn<ChargeChoice> = {
    id: 'code',
    header: 'Kode',
    width: 120,
    cell: (choice) => choice.code,
};
const nameColumn: DataTableColumn<ChargeChoice> = {
    id: 'name',
    header: 'Nama',
    width: 240,
    cell: (choice) => choice.name,
};

function ChargeLookup({
    label,
    required = false,
    choices,
    columns,
    value,
    onChange,
    error,
    field,
    emptyMessage,
    portalContainer,
}: {
    label: string;
    required?: boolean;
    choices: ChargeChoice[];
    columns: DataTableColumn<ChargeChoice>[];
    value: string;
    onChange: (id: string) => void;
    error: string | undefined;
    field: string;
    emptyMessage: string;
    portalContainer: RefObject<HTMLFormElement | null>;
}): ReactNode {
    return (
        <FormControl error={error} data-error-field={field}>
            <InlineLookup<ChargeChoice>
                label={label}
                required={required}
                items={choices}
                value={choices.find((choice) => choice.id === value) ?? null}
                onValueChange={(choice) => onChange(choice.id)}
                getItemValue={(choice) => choice.id}
                getItemLabel={(choice) =>
                    choice.code
                        ? `${choice.code} · ${choice.name}`
                        : choice.name
                }
                emptyMessage={emptyMessage}
                portalContainer={portalContainer}
                columns={columns}
            />
        </FormControl>
    );
}

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
    ].map(([id, name]) => ({ id, code: '', name }));
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
                                { code: charge.code, name: charge.name },
                            ]),
                    ),
                ].map(([id, procedure]) => ({ id, ...procedure }));
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
                        <ChargeLookup
                            label="Nama Dokter"
                            choices={[
                                { id: '', code: '', name: 'Semua dokter' },
                                ...doctors,
                            ]}
                            columns={[nameColumn]}
                            value={row.doctorId}
                            onChange={(doctorId) => set(index, { doctorId })}
                            error={errors[field(index, 'doctor_id')]?.[0]}
                            field={field(index, 'doctor_id')}
                            emptyMessage="Tidak ada dokter di rincian biaya ini."
                            portalContainer={portalContainer}
                        />
                        <ChargeLookup
                            label="Nama Jasa"
                            required={master?.kind === 'komponen'}
                            choices={
                                master?.kind === 'komponen'
                                    ? procedures
                                    : [
                                          {
                                              id: '',
                                              code: '',
                                              name: 'Semua jasa',
                                          },
                                          ...procedures,
                                      ]
                            }
                            columns={[codeColumn, nameColumn]}
                            value={row.procedureId}
                            onChange={(procedureId) =>
                                set(index, { procedureId })
                            }
                            error={errors[field(index, 'procedure_id')]?.[0]}
                            field={field(index, 'procedure_id')}
                            emptyMessage="Tidak ada jasa yang cocok dengan diskon ini."
                            portalContainer={portalContainer}
                        />
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
