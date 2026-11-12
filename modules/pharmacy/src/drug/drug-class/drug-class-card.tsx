import { ActionButton } from '@operations-metta/ui/action-button';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
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

export type DrugClass = ApiBody<'pharmacyDrugClassList'>['data'][number];

const formOf = (row: DrugClass | null) => ({
    code: row?.code ?? '',
    name: row?.name ?? '',
});

// Kartu golongan obat, dibuka dari daftar golongan dan dari Baru pada pilihan golongan di data obat farmasi.
export function DrugClassCard({
    record,
    canManage,
    onSaved,
    onClose,
}: {
    record: DrugClass | null;
    canManage: boolean;
    onSaved: (row: DrugClass) => void;
    onClose: () => void;
}): ReactNode {
    const [form, setForm] = useState(() => formOf(record));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const { confirm, confirmation } = useConfirmation();
    usePageDialogRecord({
        recordTitle: record
            ? `${record.code} ${record.name}`
            : 'Golongan obat baru',
        editing: canManage,
    });

    const run = async (
        action: 'save' | 'delete',
        request: () => Promise<void>,
        failed: string,
    ) => {
        setLastAction(action);
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            await request();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, failed));
        } finally {
            setBusy(false);
        }
    };

    const save = () =>
        run(
            'save',
            async () => {
                const { body } = record
                    ? await api.pharmacyDrugClassUpdate({
                          params: { id: record.id },
                          body: { ...form, version: record.version },
                      })
                    : await api.pharmacyDrugClassCreate({ body: form });
                toast.success(
                    record
                        ? 'Golongan obat diperbarui.'
                        : 'Golongan obat dibuat.',
                );
                onSaved(body.data);
            },
            'Golongan obat belum disimpan.',
        );

    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Delete golongan ${record.name}?`,
                description:
                    'Golongan ini tidak bisa dipilih lagi di data obat farmasi.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run(
            'delete',
            async () => {
                await api.pharmacyDrugClassDelete({
                    params: { id: record.id },
                    body: { version: record.version },
                });
                toast.success('Golongan obat dihapus.');
                onClose();
            },
            'Golongan obat belum dihapus.',
        );
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
                {canManage && (
                    <>
                        <ActionButton
                            action="save"
                            type="submit"
                            disabled={busy}
                            pending={busy && lastAction === 'save'}
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
                        ? 'Golongan obat belum dihapus'
                        : 'Golongan obat belum disimpan'
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
                            readOnly={!canManage}
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
                            readOnly={!canManage}
                            onChange={(event) =>
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}
