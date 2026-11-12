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
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
} from '../../../platform/shell/index.ts';
import type { TrackingCode } from './tracking-code-lookup.tsx';

// Kartu profil pelacakan (Item Tracking Code di BC): batch dan tanggal kedaluwarsa apa yang wajib dicatat barang.

type Flag = 'batch_required' | 'expiry_required' | 'strict_expiry';

const formOf = (profile: TrackingCode | null) => ({
    code: profile?.code ?? '',
    name: profile?.name ?? '',
    batch_required: profile?.batch_required ?? false,
    expiry_required: profile?.expiry_required ?? false,
    strict_expiry: profile?.strict_expiry ?? false,
});
type Form = ReturnType<typeof formOf>;

// Tanggal kedaluwarsa dicatat per batch, jadi wajib kedaluwarsa menyalakan wajib batch dan sebaliknya.
const withFlag = (form: Form, flag: Flag, on: boolean): Form => {
    switch (flag) {
        case 'batch_required':
            return {
                ...form,
                batch_required: on,
                expiry_required: on && form.expiry_required,
            };
        case 'expiry_required':
            return {
                ...form,
                expiry_required: on,
                batch_required: on || form.batch_required,
            };
        case 'strict_expiry':
            return { ...form, strict_expiry: on };
        default: {
            const unknown: never = flag;
            throw new Error(`Unknown flag: ${String(unknown)}`);
        }
    }
};

const flags: { flag: Flag; label: string; hint?: string }[] = [
    { flag: 'batch_required', label: 'Wajib nomor batch' },
    {
        flag: 'expiry_required',
        label: 'Wajib tanggal kedaluwarsa',
        hint: 'Tanggal kedaluwarsa dicatat per batch, jadi wajib nomor batch ikut menyala.',
    },
    {
        flag: 'strict_expiry',
        label: 'Tolak keluar setelah kedaluwarsa',
        hint: 'Batch yang sudah lewat tanggal kedaluwarsanya tidak bisa dikeluarkan dari stok.',
    },
];

export function TrackingCodeCard({
    record,
    canManage,
    onSaved,
    onClose,
}: {
    record: TrackingCode | null;
    canManage: boolean;
    onSaved: (profile: TrackingCode) => void;
    onClose: () => void;
}): ReactNode {
    const editing = canManage;
    const [form, setForm] = useState(() => formOf(record));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const { confirm, confirmation } = useConfirmation();
    const idPrefix = useId();
    usePageDialogRecord({
        recordTitle: record
            ? `${record.code} ${record.name}`
            : 'Profil pelacakan baru',
        editing,
    });

    const save = async () => {
        setLastAction('save');
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body: saved } = record
                ? await api.inventoryTrackingCodeUpdate({
                      params: { id: record.id },
                      body: { ...form, version: record.version },
                  })
                : await api.inventoryTrackingCodeCreate({ body: form });
            toast.success(
                record
                    ? 'Profil pelacakan diperbarui.'
                    : 'Profil pelacakan dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Profil pelacakan belum disimpan.'),
                );
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Delete profil pelacakan ${record.code}?`,
                description:
                    'Profil ini tidak bisa dipilih lagi untuk barang dan kategori barang.',
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
            await api.inventoryTrackingCodeDelete({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success('Profil pelacakan dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Profil pelacakan belum dihapus.'),
                );
        } finally {
            setBusy(false);
        }
    };

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
                        ? 'Profil pelacakan belum dihapus'
                        : 'Profil pelacakan belum disimpan'
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
                    {flags.map(({ flag, label, hint }) => (
                        <FormControl
                            key={flag}
                            error={errors[flag]?.[0]}
                            hint={hint}
                            data-error-field={flag}
                        >
                            <Field orientation="horizontal" className="w-auto">
                                <Switch
                                    id={`${idPrefix}-${flag}`}
                                    checked={form[flag]}
                                    disabled={!editing}
                                    onCheckedChange={(on) =>
                                        setForm(withFlag(form, flag, on))
                                    }
                                />
                                <FieldLabel
                                    htmlFor={`${idPrefix}-${flag}`}
                                    className="font-normal"
                                >
                                    {label}
                                </FieldLabel>
                            </Field>
                        </FormControl>
                    ))}
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}
