import { ActionButton } from '@operations-metta/ui/action-button';
import { DataTableText } from '@operations-metta/ui/data-table';
import {
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Textarea } from '@operations-metta/ui/textarea';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
    type ErrorAction,
} from '@core/platform/shell/index.ts';

type View = ApiBody<'pharmacyDispensingShow'>;

const numberFormat =
    'Tulis angka seperti 1500 atau 2,5. Titik untuk ribuan, koma untuk desimal.';

type PricedLine = {
    id: string;
    name: string;
    quantity: string;
    unitCode: string;
    computedUnitPrice: string;
    computedDiscount: string;
};

// Ubah harga satuan dan diskon obat, dan nilai biaya racik atau resep, sesudah resep disiapkan. Hanya tampil untuk
// pemegang izin ubah harga; server tetap menolak pengguna lain. Isian bawaannya harga yang sedang dipakai, hitungan
// sistem tampil di sampingnya, dan alasan wajib bila ada yang berbeda dengan hitungan.
export function DispensingPriceCard({
    view,
    onDone,
}: {
    view: View;
    onDone: (next: View | null) => void;
}): ReactNode {
    const { prescription, dispensing } = view.data;
    const lines: PricedLine[] = view.data.lines.flatMap((line) =>
        line.id && line.price
            ? [
                  {
                      id: line.id,
                      name: `${line.item.code} · ${line.item.name}`,
                      quantity: line.quantity,
                      unitCode: line.unit.code,
                      computedUnitPrice: line.price.computed_unit_price,
                      computedDiscount: line.price.computed_discount_percent,
                  },
              ]
            : [],
    );
    const initial = {
        prices: Object.fromEntries(
            view.data.lines.flatMap((line) =>
                line.id && line.price
                    ? [
                          [
                              line.id,
                              {
                                  unitPrice: displayNumber(
                                      line.price.unit_price,
                                  ),
                                  discount: displayNumber(
                                      line.price.discount_percent,
                                  ),
                              },
                          ],
                      ]
                    : [],
            ),
        ),
        fees: Object.fromEntries(
            view.data.fees.map((fee) => [fee.id, displayNumber(fee.amount)]),
        ),
    };
    const [prices, setPrices] = useState(initial.prices);
    const [fees, setFees] = useState(initial.fees);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [errorActions, setErrorActions] = useState<readonly ErrorAction[]>(
        [],
    );
    const [message, setMessage] = useState<string | null>(null);
    usePageDialogRecord({
        recordTitle: `Ubah harga ${dispensing?.number ?? ''}`,
        editing: true,
        dirty:
            reason !== '' ||
            JSON.stringify({ prices, fees }) !== JSON.stringify(initial),
    });

    const save = async () => {
        if (!dispensing) return;
        const invalid: Record<string, string[]> = {};
        const read = (field: string, typed: string) => {
            const value = parseDisplayNumber(typed);
            if (value === null) invalid[field] = [numberFormat];
            return value ?? typed;
        };
        const body = {
            reason: reason.trim() || null,
            lines: lines.map((line, index) => ({
                id: line.id,
                unit_price: read(
                    `lines.${index}.unit_price`,
                    prices[line.id]?.unitPrice ?? '',
                ),
                discount_percent: read(
                    `lines.${index}.discount_percent`,
                    prices[line.id]?.discount ?? '',
                ),
            })),
            fees: view.data.fees.map((fee, index) => ({
                id: fee.id,
                amount: read(`fees.${index}.amount`, fees[fee.id] ?? ''),
            })),
            version: dispensing.version,
        };
        setMessage(null);
        setErrorActions([]);
        if (Object.keys(invalid).length) {
            setErrors(invalid);
            return;
        }
        setBusy(true);
        setErrors({});
        try {
            const { body: next } = await api.pharmacyDispensingChangePrices({
                params: { id: prescription.id },
                body,
            });
            toast.success(
                `Harga ${dispensing.number} disimpan. Tagihan kasir ikut berubah.`,
            );
            onDone(next);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422) {
                setErrors(caught.errors);
                setErrorActions(caught.actions);
            } else setMessage(errorText(caught, 'Harga belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };

    const error = (field: string) => errors[field]?.[0];
    const computed = (value: string) => (
        <DataTableText>
            <span className="text-muted-foreground tabular-nums">
                {displayNumber(value)}
            </span>
        </DataTableText>
    );

    return (
        <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void save();
            }}
        >
            <PageDialogToolbar>
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
                    onClick={() => onDone(null)}
                />
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                errorActions={errorActions}
                message={message}
                operation="Harga belum disimpan"
            />
            <PageDialogBody className="space-y-4 py-3">
                <div data-error-field="lines">
                    <DocumentLines
                        title="Obat"
                        data={lines.map((line, index) => ({ line, index }))}
                        getRowKey={({ line }) => line.id}
                        getRowLabel={({ line }) => line.name}
                        showRowNumbers
                        emptyMessage="Tidak ada obat yang berharga."
                        columns={[
                            {
                                id: 'item',
                                header: 'Obat',
                                minWidth: 240,
                                cell: ({ line }) => (
                                    <DataTableText>{line.name}</DataTableText>
                                ),
                            },
                            {
                                id: 'quantity',
                                header: 'Jumlah',
                                width: 110,
                                align: 'right',
                                cell: ({ line }) => (
                                    <DataTableText>
                                        {`${displayNumber(line.quantity)} ${line.unitCode}`}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'computed_unit_price',
                                header: 'Harga sistem',
                                width: 120,
                                align: 'right',
                                cell: ({ line }) =>
                                    computed(line.computedUnitPrice),
                            },
                            {
                                id: 'unit_price',
                                header: 'Harga satuan',
                                content: 'control',
                                minWidth: 140,
                                cell: ({ line, index }) => (
                                    <FormControl
                                        error={error(
                                            `lines.${index}.unit_price`,
                                        )}
                                    >
                                        <Input
                                            label="Harga satuan"
                                            required
                                            inputMode="decimal"
                                            data-error-field={`lines.${index}.unit_price`}
                                            value={
                                                prices[line.id]?.unitPrice ?? ''
                                            }
                                            onChange={(event) =>
                                                setPrices((current) => ({
                                                    ...current,
                                                    [line.id]: {
                                                        unitPrice:
                                                            event.target.value,
                                                        discount:
                                                            current[line.id]
                                                                ?.discount ??
                                                            '',
                                                    },
                                                }))
                                            }
                                        />
                                    </FormControl>
                                ),
                            },
                            {
                                id: 'computed_discount',
                                header: 'Diskon sistem %',
                                width: 120,
                                align: 'right',
                                cell: ({ line }) =>
                                    computed(line.computedDiscount),
                            },
                            {
                                id: 'discount_percent',
                                header: 'Diskon %',
                                content: 'control',
                                minWidth: 110,
                                cell: ({ line, index }) => (
                                    <FormControl
                                        error={error(
                                            `lines.${index}.discount_percent`,
                                        )}
                                    >
                                        <Input
                                            label="Diskon %"
                                            required
                                            inputMode="decimal"
                                            data-error-field={`lines.${index}.discount_percent`}
                                            value={
                                                prices[line.id]?.discount ?? ''
                                            }
                                            onChange={(event) =>
                                                setPrices((current) => ({
                                                    ...current,
                                                    [line.id]: {
                                                        unitPrice:
                                                            current[line.id]
                                                                ?.unitPrice ??
                                                            '',
                                                        discount:
                                                            event.target.value,
                                                    },
                                                }))
                                            }
                                        />
                                    </FormControl>
                                ),
                            },
                        ]}
                    />
                </div>
                {view.data.fees.length > 0 && (
                    <div data-error-field="fees">
                        <DocumentLines
                            title="Biaya racik dan resep"
                            data={view.data.fees.map((fee, index) => ({
                                fee,
                                index,
                            }))}
                            getRowKey={({ fee }) => fee.id}
                            getRowLabel={({ fee }) => fee.name}
                            showRowNumbers
                            emptyMessage="Tidak ada biaya."
                            columns={[
                                {
                                    id: 'name',
                                    header: 'Biaya',
                                    minWidth: 240,
                                    cell: ({ fee }) => (
                                        <DataTableText>
                                            {fee.name}
                                        </DataTableText>
                                    ),
                                },
                                {
                                    id: 'computed_amount',
                                    header: 'Nilai sistem',
                                    width: 120,
                                    align: 'right',
                                    cell: ({ fee }) =>
                                        computed(fee.computed_amount),
                                },
                                {
                                    id: 'amount',
                                    header: 'Nilai',
                                    content: 'control',
                                    minWidth: 140,
                                    cell: ({ fee, index }) => (
                                        <FormControl
                                            error={error(
                                                `fees.${index}.amount`,
                                            )}
                                        >
                                            <Input
                                                label="Nilai biaya"
                                                required
                                                inputMode="decimal"
                                                data-error-field={`fees.${index}.amount`}
                                                value={fees[fee.id] ?? ''}
                                                onChange={(event) =>
                                                    setFees((current) => ({
                                                        ...current,
                                                        [fee.id]:
                                                            event.target.value,
                                                    }))
                                                }
                                            />
                                        </FormControl>
                                    ),
                                },
                            ]}
                        />
                    </div>
                )}
                <FormGrid columns={1}>
                    <FormControl
                        error={error('reason')}
                        hint="Wajib bila harga, diskon, atau biaya berbeda dengan hitungan sistem. Tercatat bersama nama Anda dan waktunya."
                    >
                        <Textarea
                            label="Alasan ubah harga"
                            maxLength={200}
                            rows={2}
                            data-error-field="reason"
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                        />
                    </FormControl>
                </FormGrid>
            </PageDialogBody>
        </form>
    );
}
