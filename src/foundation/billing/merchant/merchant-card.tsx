import { ActionButton } from '@operations-metta/ui/action-button';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Switch } from '@operations-metta/ui/switch';
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
import { displayNumber } from '@operations-metta/ui/display-number';

export type Merchant = ApiBody<'billingMerchantList'>['data'][number];

// Kartu merchan, isian form Merchan sistem lama (SIMmMerchan) tanpa rekening, yang menunggu finance.

const percentFields = [
    {
        field: 'debit_surcharge_percent',
        label: 'Add Charge Debet (%)',
        hint: 'Biaya tambahan kartu debit, dalam persen.',
    },
    {
        field: 'credit_surcharge_percent',
        label: 'Add Charge Kredit (%)',
        hint: 'Biaya tambahan kartu kredit, dalam persen.',
    },
    {
        field: 'discount_percent',
        label: 'Diskon (%)',
        hint: 'Potongan dari bank atau penyedia EDC, dalam persen.',
    },
] as const;

const formOf = (merchant: Merchant | null) => ({
    code: merchant?.code ?? '',
    name: merchant?.name ?? '',
    debit_surcharge_percent: displayNumber(
        merchant?.debit_surcharge_percent ?? '0',
    ),
    credit_surcharge_percent: displayNumber(
        merchant?.credit_surcharge_percent ?? '0',
    ),
    discount_percent: displayNumber(merchant?.discount_percent ?? '0'),
    is_active: merchant?.is_active ?? true,
});

export function MerchantCard({
    record,
    canManage,
    onSaved,
    onClose,
}: {
    record: Merchant | null;
    canManage: boolean;
    onSaved: (merchant: Merchant) => void;
    onClose: () => void;
}): ReactNode {
    const editing = canManage;
    const [form, setForm] = useState(() => formOf(record));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const { confirm, confirmation } = useConfirmation();
    const activeId = useId();
    const portalContainer = useRef<HTMLFormElement>(null);
    usePageDialogRecord({
        recordTitle: record ? `${record.code} ${record.name}` : 'Merchan baru',
        editing,
    });

    const save = async () => {
        setLastAction('save');
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body: saved } = record
                ? await api.billingMerchantUpdate({
                      params: { id: record.id },
                      body: { ...form, version: record.version },
                  })
                : await api.billingMerchantCreate({ body: form });
            toast.success(record ? 'Merchan diperbarui.' : 'Merchan dibuat.');
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Merchan belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Delete merchan ${record.code}?`,
                description: 'Merchan ini tidak bisa dipilih lagi di kasir.',
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
            await api.billingMerchantDelete({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success('Merchan dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Merchan belum dihapus.'));
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
                                setForm(formOf(record));
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
                        ? 'Merchan belum dihapus'
                        : 'Merchan belum disimpan'
                }
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl error={errors.code?.[0]}>
                        <Input
                            label="Kode"
                            required
                            maxLength={20}
                            data-error-field="code"
                            value={form.code}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, code: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl error={errors.name?.[0]}>
                        <Input
                            label="Nama"
                            required
                            maxLength={100}
                            data-error-field="name"
                            value={form.name}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                    {percentFields.map(({ field, label, hint }) => (
                        <FormControl
                            key={field}
                            error={errors[field]?.[0]}
                            hint={hint}
                        >
                            <Input
                                label={label}
                                required
                                inputMode="decimal"
                                maxLength={6}
                                data-error-field={field}
                                value={form[field]}
                                readOnly={!editing}
                                onChange={(event) =>
                                    setForm({
                                        ...form,
                                        [field]: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                    ))}
                    <FormControl hint="Merchan nonaktif tidak bisa dipilih di kasir. Pembayaran yang sudah memakainya tetap tersimpan.">
                        <Field orientation="horizontal" className="w-auto">
                            <Switch
                                id={activeId}
                                checked={form.is_active}
                                disabled={!editing}
                                onCheckedChange={(checked) =>
                                    setForm({ ...form, is_active: checked })
                                }
                            />
                            <FieldLabel
                                htmlFor={activeId}
                                className="font-normal"
                            >
                                Aktif
                            </FieldLabel>
                        </Field>
                    </FormControl>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}
