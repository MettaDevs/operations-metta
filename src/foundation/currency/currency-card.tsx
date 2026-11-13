import { ActionButton } from '@operations-metta/ui/action-button';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Select } from '@operations-metta/ui/select';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../platform/shell/index.ts';

export type CurrencyPrecision = ApiBody<'currencyList'>['data'][number];

// Kartu presisi satu mata uang (Currency BC): angka di belakang koma jumlah dan harga satuan, dan pembulatan tagihan.

const decimalItems = (max: number) =>
    Array.from({ length: max + 1 }, (_, value) => ({
        value: String(value),
        label:
            value === 0
                ? 'Tanpa desimal (1.235)'
                : `${value} angka di belakang koma (${(1234.5678901).toLocaleString('id-ID', { minimumFractionDigits: value, maximumFractionDigits: value })})`,
    }));
export const roundingTypeLabels: Record<string, string> = {
    nearest: 'Ke terdekat',
    up: 'Ke atas',
    down: 'Ke bawah',
};
const typeItems = Object.entries(roundingTypeLabels).map(([value, label]) => ({
    value,
    label,
}));

// Isian awal mata uang baru. Rupiah sudah punya baris sejak tenant disiapkan, jadi yang ditambahkan di sini mata uang
// asing: dua angka di belakang koma untuk jumlah, tiga untuk harga satuan, dan tagihan tidak dibulatkan.
const formOf = (record: CurrencyPrecision | null) => ({
    currency_code: record?.currency_code ?? '',
    amount_decimals: record?.amount_decimals ?? 2,
    unit_amount_decimals: record?.unit_amount_decimals ?? 3,
    invoice_rounding_precision: record?.invoice_rounding_precision ?? '0',
    invoice_rounding_type: record?.invoice_rounding_type ?? 'nearest',
});

export function CurrencyCard({
    record,
    canManage,
    onSaved,
    onClose,
}: {
    record: CurrencyPrecision | null;
    canManage: boolean;
    onSaved: (record: CurrencyPrecision) => void;
    onClose: () => void;
}): ReactNode {
    const editing = canManage;
    const [form, setForm] = useState(() => formOf(record));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const portalContainer = useRef<HTMLFormElement>(null);
    usePageDialogRecord({
        recordTitle: record ? record.currency_code : 'Mata uang baru',
        editing,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = record
                ? await api.currencyUpdate({
                      params: { id: record.id },
                      body: { ...form, version: record.version },
                  })
                : await api.currencyCreate({ body: form });
            toast.success('Presisi mata uang disimpan.');
            onSaved(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Mata uang belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };

    const decimals = (
        field: 'amount_decimals' | 'unit_amount_decimals',
        label: string,
        max: number,
        hint: string,
    ) => (
        <FormControl
            error={errors[field]?.[0]}
            hint={hint}
            data-error-field={field}
        >
            {editing ? (
                <Select
                    label={label}
                    required
                    items={decimalItems(max)}
                    value={String(form[field])}
                    onValueChange={(next) => {
                        if (next !== null)
                            setForm({ ...form, [field]: Number(next) });
                    }}
                    searchPlaceholder="Cari pilihan"
                    emptyMessage="Pilihan tidak ditemukan."
                    portalContainer={portalContainer}
                />
            ) : (
                <Input label={label} value={String(form[field])} readOnly />
            )}
        </FormControl>
    );

    return (
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
                            onClick={() => {
                                if (!record) {
                                    onClose();
                                    return;
                                }
                                setForm(formOf(record));
                                setErrors({});
                                setMessage(null);
                            }}
                        />
                    </>
                )}
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Mata uang belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl error={errors.currency_code?.[0]}>
                        <Input
                            label="Kode mata uang"
                            required
                            maxLength={3}
                            data-error-field="currency_code"
                            value={form.currency_code}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    currency_code: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    {decimals(
                        'amount_decimals',
                        'Presisi jumlah',
                        4,
                        'Total, pembayaran, hitungan Clerk End, dan jumlah yang diposting dibulatkan ke banyak angka di belakang koma ini.',
                    )}
                    {decimals(
                        'unit_amount_decimals',
                        'Presisi harga satuan',
                        6,
                        'Harga satuan obat dan barang dibulatkan ke banyak angka di belakang koma ini. Tidak boleh lebih sedikit dari presisi jumlah.',
                    )}
                    <FormControl
                        error={errors.invoice_rounding_precision?.[0]}
                        hint="Total tagihan kasir dibulatkan ke kelipatan ini, misalnya 1, 100, atau 1000. Isi 0 bila tidak dibulatkan."
                    >
                        <Input
                            label="Pembulatan tagihan ke"
                            required
                            inputMode="decimal"
                            data-error-field="invoice_rounding_precision"
                            value={form.invoice_rounding_precision}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    invoice_rounding_precision:
                                        event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    <FormControl
                        error={errors.invoice_rounding_type?.[0]}
                        data-error-field="invoice_rounding_type"
                    >
                        {editing ? (
                            <Select
                                label="Metode pembulatan"
                                required
                                items={typeItems}
                                value={form.invoice_rounding_type}
                                onValueChange={(next) => {
                                    if (next !== null)
                                        setForm({
                                            ...form,
                                            invoice_rounding_type: next,
                                        });
                                }}
                                searchPlaceholder="Cari metode"
                                emptyMessage="Pilihan tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Metode pembulatan"
                                value={
                                    roundingTypeLabels[
                                        form.invoice_rounding_type
                                    ] ?? ''
                                }
                                readOnly
                            />
                        )}
                    </FormControl>
                </FormGrid>
            </PageDialogBody>
        </form>
    );
}
