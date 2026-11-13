import { ActionButton } from '@operations-metta/ui/action-button';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Select } from '@operations-metta/ui/select';
import { useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../../platform/shell/index.ts';

export type Vendor = ApiBody<'purchasingVendorList'>['data'][number];
type Errors = Record<string, string[]>;

const statuses = [
    { value: 'active', label: 'Aktif' },
    { value: 'inactive', label: 'Nonaktif' },
];
const isStatus = (value: string | null): value is Vendor['status'] =>
    value === 'active' || value === 'inactive';

// Kartu vendor, dipakai daftar vendor dan pilihan Baru di dokumen penerimaan. Nomor terbit saat vendor disimpan.
export function VendorCard({
    vendor,
    canManage,
    portalContainer,
    onSaved,
    onClose,
}: {
    vendor: Vendor | null;
    canManage: boolean;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (vendor: Vendor) => void;
    onClose: () => void;
}): ReactNode {
    const editing = vendor === null || canManage;
    const blank = {
        name: vendor?.name ?? '',
        tax_number: vendor?.tax_number ?? '',
        status: vendor?.status ?? 'active',
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const dirty = JSON.stringify(form) !== JSON.stringify(blank);
    usePageDialogRecord({
        recordTitle: vendor ? `${vendor.number} ${vendor.name}` : 'Vendor baru',
        editing,
        dirty,
    });

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            name: form.name,
            tax_number: form.tax_number || null,
            status: form.status,
        };
        try {
            const { body: saved } = vendor
                ? await api.purchasingVendorUpdate({
                      params: { id: vendor.id },
                      body: { ...body, version: vendor.version },
                  })
                : await api.purchasingVendorCreate({ body });
            toast.success(vendor ? 'Vendor diperbarui.' : 'Vendor dibuat.');
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Vendor belum disimpan.'));
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
                                if (!vendor) {
                                    onClose();
                                    return;
                                }
                                setForm(blank);
                                setErrors({});
                            }}
                        />
                    </>
                )}
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Vendor belum disimpan"
            />
            <PageDialogBody className="py-3">
                <FormGrid>
                    <FormControl
                        error={errors.name?.[0]}
                        hint="Nama organisasi vendor di buku alamat."
                    >
                        <Input
                            label="Nama vendor"
                            required
                            maxLength={200}
                            data-error-field="name"
                            value={form.name}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({ ...form, name: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl error={errors.tax_number?.[0]}>
                        <Input
                            label="NPWP"
                            maxLength={32}
                            data-error-field="tax_number"
                            value={form.tax_number}
                            readOnly={!editing}
                            onChange={(event) =>
                                setForm({
                                    ...form,
                                    tax_number: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    <FormControl
                        error={errors.status?.[0]}
                        hint="Vendor nonaktif tidak bisa dipilih di penerimaan baru."
                        data-error-field="status"
                    >
                        {editing ? (
                            <Select
                                label="Status"
                                items={statuses}
                                value={form.status}
                                portalContainer={portalContainer}
                                onValueChange={(value) => {
                                    if (isStatus(value))
                                        setForm({ ...form, status: value });
                                }}
                            />
                        ) : (
                            <Input
                                label="Status"
                                readOnly
                                value={
                                    form.status === 'active'
                                        ? 'Aktif'
                                        : 'Nonaktif'
                                }
                            />
                        )}
                    </FormControl>
                </FormGrid>
            </PageDialogBody>
        </form>
    );
}
