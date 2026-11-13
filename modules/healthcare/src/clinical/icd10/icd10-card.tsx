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
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '@core/platform/shell/index.ts';

export type Icd10 = ApiBody<'healthcareIcd10List'>['data'][number];
export type Icd10Permissions =
    ApiBody<'healthcareIcd10Metadata'>['permissions'];

// Kartu satu kode ICD-10, dipakai daftar ICD-10 di Setup dan tombol Baru pada pilihan ICD-10 baris diagnosa
// pemeriksaan, yang langsung memilih kode yang baru disimpan.
export function Icd10Card({
    icd10,
    permissions,
    onSaved,
    onClose,
}: {
    icd10: Icd10 | null;
    permissions: Icd10Permissions;
    onSaved: (icd10: Icd10) => void;
    onClose: () => void;
}): ReactNode {
    const editing = icd10 === null ? permissions.create : permissions.update;
    const blank = {
        code: icd10?.code ?? '',
        name: icd10?.name ?? '',
        is_active: icd10?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const dirty = JSON.stringify(form) !== JSON.stringify(blank);
    usePageDialogRecord({
        recordTitle: icd10 ? `${icd10.code} ${icd10.name}` : 'ICD-10 baru',
        editing,
        dirty,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body: saved } = icd10
                ? await api.healthcareIcd10Update({
                      params: { id: icd10.id },
                      body: { ...form, version: icd10.version },
                  })
                : await api.healthcareIcd10Create({ body: form });
            toast.success(icd10 ? 'ICD-10 diperbarui.' : 'ICD-10 dibuat.');
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'ICD-10 belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!icd10) return;
        if (
            !(await confirm({
                title: `Delete ICD-10 ${icd10.code}?`,
                description: 'Kode ini tidak bisa dipilih lagi di diagnosa.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcareIcd10Delete({
                params: { id: icd10.id },
                body: { version: icd10.version },
            });
            toast.success('ICD-10 dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'ICD-10 belum dihapus.'));
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
                                if (!icd10) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
                {icd10 && permissions.delete && (
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
                operation="ICD-10 belum disimpan"
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
                            maxLength={250}
                            data-error-field="name"
                            value={form.name}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                    <Field orientation="horizontal" className="w-auto">
                        <Switch
                            id="icd10-active"
                            checked={form.is_active}
                            disabled={!editing}
                            onCheckedChange={(checked) =>
                                setForm({ ...form, is_active: checked })
                            }
                        />
                        <FieldLabel htmlFor="icd10-active">Aktif</FieldLabel>
                    </Field>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}
