import { ActionButton } from '@operations-metta/ui/action-button';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { Select } from '@operations-metta/ui/select';
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
import {
    chargeComponentOptionFields,
    chargeComponentOptions,
    type ChargeComponentOption,
} from './charge-component.options.ts';

export type ChargeComponent =
    ApiBody<'pricingChargeComponentList'>['data'][number];

// Kartu komponen biaya, isian form Komponen jasa sistem lama (SIMmKomponenBiaya).

const optionItems = (option: ChargeComponentOption) =>
    Object.entries(chargeComponentOptions[option]).map(([value, label]) => ({
        value,
        label,
    }));

const formOf = (component: ChargeComponent | null) => ({
    code: component?.code ?? '',
    name: component?.name ?? '',
    sort_order: String(component?.sort_order ?? 0),
    account_group: component?.account_group ?? 'Pendapatan',
    posting_to: component?.posting_to ?? 'GL',
    payable_to: component?.payable_to ?? 'None',
    service_group: component?.service_group ?? 'Jasa Pelayanan',
    includes_incentive: component?.includes_incentive ?? false,
    excludes_hospital_cost: component?.excludes_hospital_cost ?? false,
    is_active: component?.is_active ?? true,
});

export function ChargeComponentCard({
    record,
    canManage,
    onSaved,
    onClose,
}: {
    record: ChargeComponent | null;
    canManage: boolean;
    onSaved: (component: ChargeComponent) => void;
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
    const flagId = useId();
    const portalContainer = useRef<HTMLFormElement>(null);
    usePageDialogRecord({
        recordTitle: record
            ? `${record.code} ${record.name}`
            : 'Komponen biaya baru',
        editing,
    });

    const save = async () => {
        setLastAction('save');
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body: saved } = record
                ? await api.pricingChargeComponentUpdate({
                      params: { id: record.id },
                      body: { ...form, version: record.version },
                  })
                : await api.pricingChargeComponentCreate({ body: form });
            toast.success(
                record
                    ? 'Komponen biaya diperbarui.'
                    : 'Komponen biaya dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(errorText(caught, 'Komponen biaya belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Delete komponen biaya ${record.code}?`,
                description: 'Komponen ini tidak tampil lagi di kartu tarif.',
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
            await api.pricingChargeComponentDelete({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success('Komponen biaya dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Komponen biaya belum dihapus.'));
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
                        ? 'Komponen biaya belum dihapus'
                        : 'Komponen biaya belum disimpan'
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
                    <FormControl
                        error={errors.sort_order?.[0]}
                        hint="Urutan isian komponen di kartu tarif, dari yang terkecil."
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
                    {chargeComponentOptionFields.map(({ option, label }) => (
                        <FormControl
                            key={option}
                            error={errors[option]?.[0]}
                            data-error-field={option}
                        >
                            {editing ? (
                                <Select
                                    label={label}
                                    required
                                    items={optionItems(option)}
                                    value={form[option]}
                                    onValueChange={(value) =>
                                        setForm({
                                            ...form,
                                            [option]: value ?? form[option],
                                        })
                                    }
                                    searchPlaceholder={`Cari ${label.toLowerCase()}`}
                                    emptyMessage="Pilihan tidak ditemukan."
                                    portalContainer={portalContainer}
                                />
                            ) : (
                                <Input
                                    label={label}
                                    value={
                                        optionItems(option).find(
                                            (item) =>
                                                item.value === form[option],
                                        )?.label ?? form[option]
                                    }
                                    readOnly
                                />
                            )}
                        </FormControl>
                    ))}
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id={`${flagId}-incentive`}
                            checked={form.includes_incentive}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({
                                    ...form,
                                    includes_incentive: checked,
                                })
                            }
                        />
                        <FieldLabel
                            htmlFor={`${flagId}-incentive`}
                            className="font-normal"
                        >
                            Include Insentif
                        </FieldLabel>
                    </Field>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id={`${flagId}-cost`}
                            checked={form.excludes_hospital_cost}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({
                                    ...form,
                                    excludes_hospital_cost: checked,
                                })
                            }
                        />
                        <FieldLabel
                            htmlFor={`${flagId}-cost`}
                            className="font-normal"
                        >
                            Exclude Cost RS
                        </FieldLabel>
                    </Field>
                    <FormControl hint="Komponen nonaktif tidak tampil di kartu tarif. Tarif yang sudah memakainya tetap tersimpan.">
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
