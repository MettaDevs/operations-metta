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
} from '../../../platform/shell/index.ts';

// Satuan dan alasan penyesuaian sama-sama daftar kode dan nama (Units of Measure dan Reason Codes di BC). Kartu yang
// sama dipakai halaman daftarnya dan tombol Baru pada pilihan satuan atau alasan di kartu lain.

export type CodeListEntry = {
    id: string;
    code: string;
    name: string;
    version: number;
};

type Body = { code: string; name: string };

export type CodeListKind = {
    title: string;
    noun: string;
    deleteNote: string;
    create: (body: Body) => Promise<CodeListEntry>;
    update: (
        id: string,
        body: Body & { version: number },
    ) => Promise<CodeListEntry>;
    remove: (id: string, version: number) => Promise<void>;
};

export const unitsOfMeasure: CodeListKind = {
    title: 'Satuan',
    noun: 'satuan',
    deleteNote: 'Satuan ini tidak bisa dipilih lagi untuk barang.',
    create: async (body) =>
        (await api.inventoryUnitOfMeasureCreate({ body })).body.data,
    update: async (id, body) =>
        (await api.inventoryUnitOfMeasureUpdate({ params: { id }, body })).body
            .data,
    remove: async (id, version) => {
        await api.inventoryUnitOfMeasureDelete({
            params: { id },
            body: { version },
        });
    },
};

export const reasonCodes: CodeListKind = {
    title: 'Alasan penyesuaian',
    noun: 'alasan',
    deleteNote: 'Alasan ini tidak bisa dipilih lagi di penyesuaian stok.',
    create: async (body) =>
        (await api.inventoryReasonCodeCreate({ body })).body.data,
    update: async (id, body) =>
        (await api.inventoryReasonCodeUpdate({ params: { id }, body })).body
            .data,
    remove: async (id, version) => {
        await api.inventoryReasonCodeDelete({
            params: { id },
            body: { version },
        });
    },
};

export function CodeListCard({
    kind,
    entry,
    canManage,
    onSaved,
    onClose,
}: {
    kind: CodeListKind;
    entry: CodeListEntry | null;
    canManage: boolean;
    onSaved: (entry: CodeListEntry) => void;
    onClose: () => void;
}): ReactNode {
    const editing = canManage;
    const saved = { code: entry?.code ?? '', name: entry?.name ?? '' };
    const [form, setForm] = useState(saved);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    usePageDialogRecord({
        recordTitle: entry
            ? `${entry.code} ${entry.name}`
            : `${kind.title} baru`,
        editing,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const result = entry
                ? await kind.update(entry.id, {
                      ...form,
                      version: entry.version,
                  })
                : await kind.create(form);
            toast.success(
                entry ? `${kind.title} diperbarui.` : `${kind.title} dibuat.`,
            );
            onSaved(result);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, `${kind.title} belum disimpan.`));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!entry) return;
        if (
            !(await confirm({
                title: `Delete ${kind.noun} ${entry.code}?`,
                description: kind.deleteNote,
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            await kind.remove(entry.id, entry.version);
            toast.success(`${kind.title} dihapus.`);
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, `${kind.title} belum dihapus.`));
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
                                if (!entry) {
                                    onClose();
                                    return;
                                }
                                setForm(saved);
                                setErrors({});
                                setMessage(null);
                            }}
                        />
                    </>
                )}
                {entry && canManage && (
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
                operation={`${kind.title} belum disimpan`}
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
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}
