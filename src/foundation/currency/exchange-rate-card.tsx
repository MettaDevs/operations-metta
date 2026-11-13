import { ActionButton } from '@operations-metta/ui/action-button';
import { DatePicker } from '@operations-metta/ui/date-picker';
import {
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

export type ExchangeRate = ApiBody<'exchangeRateList'>['data'][number];

// Kartu kurs satu mata uang asing sejak satu tanggal (Currency Exchange Rate BC).

const formOf = (record: ExchangeRate | null, currencies: string[]) => ({
    currency_code: record?.currency_code ?? currencies[0] ?? '',
    starting_date: record?.starting_date ?? '',
    rate: record ? displayNumber(record.rate) : '',
});

export function ExchangeRateCard({
    record,
    currencies,
    canManage,
    onSaved,
    onClose,
}: {
    record: ExchangeRate | null;
    currencies: string[];
    canManage: boolean;
    onSaved: (record: ExchangeRate) => void;
    onClose: () => void;
}): ReactNode {
    const editing = canManage;
    const [form, setForm] = useState(() => formOf(record, currencies));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const { confirm, confirmation } = useConfirmation();
    const portalContainer = useRef<HTMLFormElement>(null);
    usePageDialogRecord({
        recordTitle: record
            ? `${record.currency_code} ${record.starting_date.split('-').reverse().join('/')}`
            : 'Kurs baru',
        editing,
    });

    const save = async () => {
        setLastAction('save');
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            ...form,
            rate: parseDisplayNumber(form.rate) ?? form.rate,
        };
        try {
            const { body: saved } = record
                ? await api.exchangeRateUpdate({
                      params: { id: record.id },
                      body: { ...body, version: record.version },
                  })
                : await api.exchangeRateCreate({ body });
            toast.success('Kurs disimpan.');
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Kurs belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Delete kurs ${record.currency_code}?`,
                description:
                    'Pembayaran sesudah tanggal ini memakai kurs sebelumnya. Pembayaran yang sudah tersimpan tidak berubah.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        setLastAction('delete');
        setErrors({});
        setMessage(null);
        try {
            await api.exchangeRateDelete({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success('Kurs dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Kurs belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

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
                                setForm(formOf(record, currencies));
                                setErrors({});
                                setMessage(null);
                            }}
                        />
                    </>
                )}
                {record && canManage && (
                    <ActionButton
                        action="archive"
                        disabled={busy}
                        onClick={() => void remove()}
                    />
                )}
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation={
                    lastAction === 'delete'
                        ? 'Kurs belum dihapus'
                        : 'Kurs belum disimpan'
                }
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl
                        error={errors.currency_code?.[0]}
                        data-error-field="currency_code"
                        hint="Mata uang asing yang sudah disetel di Mata uang."
                    >
                        {editing ? (
                            <Select
                                label="Mata uang"
                                required
                                items={currencies.map((code) => ({
                                    value: code,
                                    label: code,
                                }))}
                                value={form.currency_code}
                                onValueChange={(next) => {
                                    if (next !== null)
                                        setForm({
                                            ...form,
                                            currency_code: next,
                                        });
                                }}
                                searchPlaceholder="Cari mata uang"
                                emptyMessage="Belum ada mata uang asing. Tambahkan dulu di Mata uang."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Mata uang"
                                value={form.currency_code}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl
                        error={errors.starting_date?.[0]}
                        hint="Kurs ini dipakai sejak tanggal ini sampai ada kurs dengan tanggal yang lebih baru."
                    >
                        <DatePicker
                            label="Tanggal berlaku"
                            required
                            data-error-field="starting_date"
                            value={form.starting_date}
                            readOnly={!editing}
                            onValueChange={(starting_date) =>
                                setForm({ ...form, starting_date })
                            }
                            portalContainer={portalContainer}
                        />
                    </FormControl>
                    <FormControl
                        error={errors.rate?.[0]}
                        hint="Nilai satu satuan mata uang ini dalam rupiah, misalnya 16.250."
                    >
                        <Input
                            label="Kurs"
                            required
                            inputMode="decimal"
                            data-error-field="rate"
                            value={form.rate}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, rate: event.target.value })
                            }
                        />
                    </FormControl>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}
