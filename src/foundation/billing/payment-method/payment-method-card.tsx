import { ActionButton } from '@operations-metta/ui/action-button';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Select } from '@operations-metta/ui/select';
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
import {
    behaviorRule,
    isPaymentMethodBehavior,
    isPaymentMethodParty,
    paymentMethodBehaviors,
    paymentMethodOptionFields,
    paymentMethodParties,
    type PaymentMethodBehavior,
    type PaymentMethodOption,
} from './payment-method.behaviors.ts';

export type PaymentMethod = ApiBody<'billingPaymentMethodList'>['data'][number];

// Kartu jenis bayar. Perilaku menentukan pihak dan isian tambahan yang berlaku; isian lain tidak ditampilkan.

const behaviorItems = Object.entries(paymentMethodBehaviors).map(
    ([value, rule]) => ({ value, label: rule.label }),
);

const noOptions: Record<PaymentMethodOption, boolean> = {
    requires_merchant: false,
    requires_reference: false,
    allows_surcharge: false,
    takes_remainder: false,
    counted_at_close: false,
};

const formOf = (method: PaymentMethod | null) => ({
    code: method?.code ?? '',
    name: method?.name ?? '',
    cashier_label: method?.cashier_label ?? '',
    sort_order: String(method?.sort_order ?? 0),
    behavior: method?.behavior ?? 'non_tunai',
    party: method?.party ?? 'tidak',
    requires_merchant: method?.requires_merchant ?? false,
    requires_reference: method?.requires_reference ?? false,
    allows_surcharge: method?.allows_surcharge ?? false,
    takes_remainder: method?.takes_remainder ?? false,
    counted_at_close: method?.counted_at_close ?? false,
    shown_at_cashier: method?.shown_at_cashier ?? true,
    is_active: method?.is_active ?? true,
    currency_code: method?.currency_code ?? '',
});

export function PaymentMethodCard({
    record,
    canManage,
    currencies,
    onSaved,
    onClose,
}: {
    record: PaymentMethod | null;
    canManage: boolean;
    // Mata uang lokal tenant dan mata uang asing yang sudah disetel di Sys Admin › Mata uang.
    currencies: { local: string; foreign: string[] };
    onSaved: (method: PaymentMethod) => void;
    onClose: () => void;
}): ReactNode {
    const editing = canManage;
    const [form, setForm] = useState(() => formOf(record));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const { confirm, confirmation } = useConfirmation();
    const switchId = useId();
    const portalContainer = useRef<HTMLFormElement>(null);
    usePageDialogRecord({
        recordTitle: record
            ? `${record.code} ${record.name}`
            : 'Jenis bayar baru',
        editing,
    });
    const rule = isPaymentMethodBehavior(form.behavior)
        ? behaviorRule(form.behavior)
        : null;
    const partyItems = (rule?.parties ?? []).map((party) => ({
        value: party,
        label: paymentMethodParties[party],
    }));
    const legacyId = record?.legacy_id ?? null;
    const partyLabel = isPaymentMethodParty(form.party)
        ? paymentMethodParties[form.party]
        : form.party;

    // Perilaku baru membawa pihak bawaannya dan mematikan isian yang tidak berlaku untuknya.
    const chooseBehavior = (behavior: PaymentMethodBehavior) => {
        const next = behaviorRule(behavior);
        setForm({
            ...form,
            ...noOptions,
            ...Object.fromEntries(
                next.options.map((option) => [option, form[option]]),
            ),
            behavior,
            party: next.parties[0] ?? 'tidak',
        });
    };

    const save = async () => {
        setLastAction('save');
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            ...form,
            cashier_label: form.cashier_label.trim() || null,
            currency_code: form.takes_remainder
                ? null
                : form.currency_code || null,
        };
        try {
            const { body: saved } = record
                ? await api.billingPaymentMethodUpdate({
                      params: { id: record.id },
                      body: { ...body, version: record.version },
                  })
                : await api.billingPaymentMethodCreate({ body });
            toast.success(
                record ? 'Jenis bayar diperbarui.' : 'Jenis bayar dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Jenis bayar belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Delete jenis bayar ${record.code}?`,
                description: 'Jenis bayar ini tidak tampil lagi di kasir.',
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
            await api.billingPaymentMethodDelete({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success('Jenis bayar dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Jenis bayar belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    const toggle = (
        key: string,
        label: string,
        checked: boolean,
        onChange: (checked: boolean) => void,
        hint: string,
    ) => (
        <FormControl key={key} hint={hint} error={errors[key]?.[0]}>
            <Field
                orientation="horizontal"
                className="w-auto"
                data-error-field={key}
            >
                <Switch
                    id={`${switchId}-${key}`}
                    checked={checked}
                    disabled={!editing}
                    onCheckedChange={onChange}
                />
                <FieldLabel
                    htmlFor={`${switchId}-${key}`}
                    className="font-normal"
                >
                    {label}
                </FieldLabel>
            </Field>
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
                        ? 'Jenis bayar belum dihapus'
                        : 'Jenis bayar belum disimpan'
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
                    <FormControl
                        error={errors.name?.[0]}
                        hint="Nama di kuitansi, invoice, dan laporan."
                    >
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
                    <FormControl
                        error={errors.cashier_label?.[0]}
                        hint="Isi bila label di layar kasir beda dari nama, misalnya Pasien BON. Kosongkan untuk memakai nama."
                    >
                        <Input
                            label="Label di kasir"
                            maxLength={100}
                            data-error-field="cashier_label"
                            value={form.cashier_label}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    cashier_label: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    <FormControl
                        error={errors.sort_order?.[0]}
                        hint="Urutan isian di layar kasir dan di laporan, dari yang terkecil."
                    >
                        <Input
                            label="Urutan"
                            required
                            inputMode="numeric"
                            maxLength={3}
                            data-error-field="sort_order"
                            value={form.sort_order}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    sort_order: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    <FormControl
                        error={errors.behavior?.[0]}
                        hint={rule?.description}
                        data-error-field="behavior"
                    >
                        {editing ? (
                            <Select
                                label="Perilaku"
                                required
                                items={behaviorItems}
                                value={form.behavior}
                                onValueChange={(value) => {
                                    if (value && isPaymentMethodBehavior(value))
                                        chooseBehavior(value);
                                }}
                                searchPlaceholder="Cari perilaku"
                                emptyMessage="Pilihan tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Perilaku"
                                value={rule?.label ?? form.behavior}
                                readOnly
                            />
                        )}
                    </FormControl>
                    <FormControl
                        error={errors.party?.[0]}
                        hint="Pihak yang menanggung pembayaran ini."
                        data-error-field="party"
                    >
                        {editing && partyItems.length > 1 ? (
                            <Select
                                label="Pihak"
                                required
                                items={partyItems}
                                value={form.party}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        party: value ?? form.party,
                                    })
                                }
                                searchPlaceholder="Cari pihak"
                                emptyMessage="Pilihan tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input label="Pihak" value={partyLabel} readOnly />
                        )}
                    </FormControl>
                    <FormControl
                        error={errors.currency_code?.[0]}
                        hint="Isi bila jenis bayar ini hanya menerima satu mata uang asing, misalnya tunai valuta. Jumlahnya diisi dalam mata uang itu dan dihitung ke mata uang lokal dengan kurs hari pembayaran."
                        data-error-field="currency_code"
                    >
                        {editing && !form.takes_remainder ? (
                            <Select
                                label="Mata uang"
                                items={[
                                    {
                                        value: '',
                                        label: `${currencies.local} (mata uang lokal)`,
                                    },
                                    ...currencies.foreign.map((code) => ({
                                        value: code,
                                        label: code,
                                    })),
                                ]}
                                value={form.currency_code}
                                onValueChange={(value) =>
                                    setForm({
                                        ...form,
                                        currency_code: value ?? '',
                                    })
                                }
                                searchPlaceholder="Cari mata uang"
                                emptyMessage="Pilihan tidak ditemukan."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Mata uang"
                                value={
                                    form.currency_code ||
                                    `${currencies.local} (mata uang lokal)`
                                }
                                readOnly
                            />
                        )}
                    </FormControl>
                    {legacyId !== null && (
                        <FormControl hint="IDBayar jenis bayar ini di sistem lama, dari impor.">
                            <Input
                                label="ID sistem lama"
                                value={String(legacyId)}
                                readOnly
                            />
                        </FormControl>
                    )}
                    {paymentMethodOptionFields
                        .filter(({ option }) => rule?.options.includes(option))
                        .map(({ option, label, hint }) =>
                            toggle(
                                option,
                                label,
                                form[option],
                                (checked) =>
                                    setForm({ ...form, [option]: checked }),
                                hint,
                            ),
                        )}
                    {toggle(
                        'shown_at_cashier',
                        'Tampil di kasir',
                        form.shown_at_cashier,
                        (checked) =>
                            setForm({ ...form, shown_at_cashier: checked }),
                        'Matikan untuk jenis bayar yang hanya dipakai di luar layar kasir.',
                    )}
                    {toggle(
                        'is_active',
                        'Aktif',
                        form.is_active,
                        (checked) => setForm({ ...form, is_active: checked }),
                        'Jenis bayar nonaktif tidak bisa dipakai di pembayaran baru. Pembayaran yang sudah memakainya tetap tersimpan.',
                    )}
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}
