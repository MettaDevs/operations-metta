import { ActionButton } from '@operations-metta/ui/action-button';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
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
} from '../../../platform/shell/index.ts';
import type { Reference } from '@operations-metta/ui/master-lookup';
import { TrackingCodeCard } from '../tracking-code/tracking-code-card.tsx';
import { TrackingCodeLookup } from '../tracking-code/tracking-code-lookup.tsx';
import {
    ItemCategoryLookup,
    type ItemCategory,
} from './item-category-lookup.tsx';

// Kartu kategori barang (Item Category Card di BC). Kategori induk dan profil pelacakan boleh kosong; pilihan rujukan
// tidak bisa dikosongkan, jadi masing-masing dibuka lewat saklar seperti kalender dasar di kartu kalender.

const formOf = (category: ItemCategory | null, parent: Reference | null) => {
    const presetParent = category ? category.parent : parent;
    return {
        code: category?.code ?? '',
        name: category?.name ?? '',
        hasParent: presetParent !== null,
        parent: presetParent,
        hasTracking: category?.tracking_code != null,
        trackingCode: category?.tracking_code ?? null,
    };
};

export function ItemCategoryCard({
    record,
    parent = null,
    canManage,
    onSaved,
    onClose,
}: {
    record: ItemCategory | null;
    // Induk bawaan untuk kategori baru, misalnya dari Baru di bawah kategori ini.
    parent?: Reference | null;
    canManage: boolean;
    onSaved: (category: ItemCategory) => void;
    onClose: () => void;
}): ReactNode {
    const editing = canManage;
    const [form, setForm] = useState(() => formOf(record, parent));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const [creatingTracking, setCreatingTracking] = useState(false);
    const { confirm, confirmation } = useConfirmation();
    const idPrefix = useId();
    // Popup pilihan dipasang di dalam kartu, karena pemanggil tidak selalu memberi ref isi dialognya.
    const portalContainer = useRef<HTMLDivElement>(null);
    usePageDialogRecord({
        recordTitle: record
            ? `${record.code} ${record.name}`
            : 'Kategori barang baru',
        editing,
    });

    const save = async () => {
        setLastAction('save');
        setBusy(true);
        setErrors({});
        setMessage(null);
        const missing: Record<string, string[]> = {};
        if (form.hasParent && !form.parent)
            missing.parent_id = ['Pilih kategori induk.'];
        if (form.hasTracking && !form.trackingCode)
            missing.tracking_code_id = ['Pilih profil pelacakan.'];
        if (Object.keys(missing).length) {
            setErrors(missing);
            setBusy(false);
            return;
        }
        const body = {
            code: form.code,
            name: form.name,
            parent_id: form.hasParent ? (form.parent?.id ?? null) : null,
            tracking_code_id: form.hasTracking
                ? (form.trackingCode?.id ?? null)
                : null,
        };
        try {
            const { body: saved } = record
                ? await api.inventoryItemCategoryUpdate({
                      params: { id: record.id },
                      body: { ...body, version: record.version },
                  })
                : await api.inventoryItemCategoryCreate({ body });
            toast.success(
                record
                    ? 'Kategori barang diperbarui.'
                    : 'Kategori barang dibuat.',
            );
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Kategori barang belum disimpan.'),
                );
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Delete kategori ${record.code}?`,
                description:
                    'Kategori ini tidak bisa dipilih lagi untuk barang.',
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
            await api.inventoryItemCategoryDelete({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success('Kategori barang dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(errorText(caught, 'Kategori barang belum dihapus.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div ref={portalContainer} className="flex min-h-0 flex-1 flex-col">
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
                                    setForm(formOf(record, null));
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
                            ? 'Kategori barang belum dihapus'
                            : 'Kategori barang belum disimpan'
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
                                    setForm({
                                        ...form,
                                        code: event.target.value,
                                    })
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
                                    setForm({
                                        ...form,
                                        name: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                        <FormControl>
                            <Field orientation="horizontal" className="w-auto">
                                <Switch
                                    id={`${idPrefix}-has-parent`}
                                    checked={form.hasParent}
                                    disabled={!editing}
                                    onCheckedChange={(hasParent) =>
                                        setForm({ ...form, hasParent })
                                    }
                                />
                                <FieldLabel
                                    htmlFor={`${idPrefix}-has-parent`}
                                    className="font-normal"
                                >
                                    Di bawah kategori lain
                                </FieldLabel>
                            </Field>
                        </FormControl>
                        {form.hasParent && (
                            <ItemCategoryLookup
                                label="Kategori induk"
                                required
                                field="parent_id"
                                value={form.parent}
                                onChange={(category) =>
                                    setForm({ ...form, parent: category })
                                }
                                disabled={!editing}
                                error={errors.parent_id?.[0]}
                                portalContainer={portalContainer}
                            />
                        )}
                        <FormControl hint="Disalin ke barang baru di kategori ini; barang yang sudah ada tidak ikut berubah.">
                            <Field orientation="horizontal" className="w-auto">
                                <Switch
                                    id={`${idPrefix}-has-tracking`}
                                    checked={form.hasTracking}
                                    disabled={!editing}
                                    onCheckedChange={(hasTracking) =>
                                        setForm({ ...form, hasTracking })
                                    }
                                />
                                <FieldLabel
                                    htmlFor={`${idPrefix}-has-tracking`}
                                    className="font-normal"
                                >
                                    Pakai profil pelacakan
                                </FieldLabel>
                            </Field>
                        </FormControl>
                        {form.hasTracking && (
                            <TrackingCodeLookup
                                label="Profil pelacakan"
                                required
                                field="tracking_code_id"
                                value={form.trackingCode}
                                onChange={(trackingCode) =>
                                    setForm({ ...form, trackingCode })
                                }
                                disabled={!editing}
                                error={errors.tracking_code_id?.[0]}
                                portalContainer={portalContainer}
                                onCreate={
                                    editing
                                        ? () => setCreatingTracking(true)
                                        : undefined
                                }
                            />
                        )}
                    </FormGrid>
                </PageDialogBody>
                {confirmation}
            </form>
            {creatingTracking && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setCreatingTracking(false);
                    }}
                >
                    <PageDialogContent title="Profil pelacakan">
                        <TrackingCodeCard
                            record={null}
                            canManage
                            onSaved={(trackingCode) => {
                                setCreatingTracking(false);
                                setForm((current) => ({
                                    ...current,
                                    hasTracking: true,
                                    trackingCode,
                                }));
                            }}
                            onClose={() => setCreatingTracking(false)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </div>
    );
}
