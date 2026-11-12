import { ActionButton } from '@operations-metta/ui/action-button';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Switch } from '@operations-metta/ui/switch';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiBody,
} from '@core/platform/shell/index.ts';

export type Drug = ApiBody<'healthcareDrugList'>['data'][number];
export type DrugPermissions = ApiBody<'healthcareDrugMetadata'>['permissions'];
type Option = ApiBody<'healthcareDrugMetadata'>['units'][number];

// Pilihan aktif ditambah yang tersimpan pada obat ini, dan pilihan yang sedang terpilih. Yang tersimpan tetap punya
// nama walau metadata belum dimuat.
function choices(
    options: Option[],
    saved: { id: string | null; name: string | null },
    current: string | null,
) {
    const items = options.filter(
        (option) => option.active || option.id === saved.id,
    );
    const selected =
        items.find((option) => option.id === current) ??
        (current !== null && current === saved.id
            ? { id: current, code: '', name: saved.name ?? '', active: false }
            : null);
    return { items, selected };
}

function OptionLookup({
    label,
    required,
    disabled,
    choice,
    onChange,
    portalContainer,
}: {
    label: string;
    required?: boolean;
    disabled: boolean;
    choice: ReturnType<typeof choices>;
    onChange: (id: string) => void;
    portalContainer: RefObject<HTMLDivElement | null>;
}): ReactNode {
    return (
        <InlineLookup
            label={label}
            required={required}
            disabled={disabled}
            items={choice.items}
            value={choice.selected}
            displayValue={choice.selected?.name ?? ''}
            onValueChange={(item) => onChange(item.id)}
            getItemValue={(item) => item.id}
            getItemLabel={(item) => item.name}
            getSearchText={(item) => `${item.code} ${item.name}`}
            placeholder={`Cari ${label.toLowerCase()}…`}
            emptyMessage={`${label} tidak ditemukan.`}
            showDetails={false}
            showFullList={false}
            portalContainer={portalContainer}
            columns={[
                {
                    id: 'code',
                    header: 'Kode',
                    width: 120,
                    cell: (item) => item.code,
                },
                {
                    id: 'name',
                    header: 'Nama',
                    width: 220,
                    cell: (item) => item.name,
                },
            ]}
        />
    );
}

// Kartu satu obat, dipakai daftar obat di Setup dan tombol Baru pada pilihan obat baris E-Resep pemeriksaan. Kartu
// memuat pilihan satuan dan bentuk sediaannya sendiri supaya bisa dibuka dari mana saja.
export function DrugCard({
    drug,
    permissions,
    onSaved,
    onClose,
}: {
    drug: Drug | null;
    permissions: DrugPermissions;
    onSaved: (drug: Drug) => void;
    onClose: () => void;
}): ReactNode {
    const editing = drug === null ? permissions.create : permissions.update;
    const blank = {
        code: drug?.code ?? '',
        name: drug?.name ?? '',
        unit_id: drug?.unit_id ?? null,
        dosage_form_id: drug?.dosage_form_id ?? null,
        is_active: drug?.is_active ?? true,
    };
    const [form, setForm] = useState(blank);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    // Popup pilihan dipasang di dalam kartu, karena pemanggil tidak selalu memberi ref isi dialognya.
    const portalContainer = useRef<HTMLDivElement>(null);
    const { data: metadata } = useQuery(
        orpc.healthcareDrugMetadata.queryOptions({
            select: (response) => response.body,
        }),
    );
    const title = (value: Drug) =>
        value.code ? `${value.code} ${value.name}` : value.name;
    usePageDialogRecord({
        recordTitle: drug ? title(drug) : 'Obat baru',
        editing,
    });
    const unit = choices(
        metadata?.units ?? [],
        { id: drug?.unit_id ?? null, name: drug?.unit_name ?? null },
        form.unit_id,
    );
    const dosageForm = choices(
        metadata?.dosage_forms ?? [],
        {
            id: drug?.dosage_form_id ?? null,
            name: drug?.dosage_form_name ?? null,
        },
        form.dosage_form_id,
    );

    const save = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body: saved } = drug
                ? await api.healthcareDrugUpdate({
                      params: { id: drug.id },
                      body: { ...form, version: drug.version },
                  })
                : await api.healthcareDrugCreate({ body: form });
            toast.success(drug ? 'Obat diperbarui.' : 'Obat dibuat.');
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Obat belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!drug) return;
        if (
            !(await confirm({
                title: `Delete obat ${title(drug)}?`,
                description: 'Obat ini tidak bisa dipilih lagi di resep.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.healthcareDrugDelete({
                params: { id: drug.id },
                body: { version: drug.version },
            });
            toast.success('Obat dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Obat belum dihapus.'));
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
                                    if (!drug) {
                                        onClose();
                                        return;
                                    }
                                    setForm(blank);
                                    setErrors({});
                                }}
                            />
                        </>
                    )}
                    {drug && permissions.delete && (
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
                    operation="Obat belum disimpan"
                />
                <PageDialogBody className="py-3">
                    <FormGrid>
                        <FormControl error={errors.code?.[0]}>
                            <Input
                                label="Kode"
                                maxLength={30}
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
                                maxLength={200}
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
                        <FormControl
                            error={errors.unit_id?.[0]}
                            data-error-field="unit_id"
                        >
                            <OptionLookup
                                label="Satuan"
                                required
                                disabled={!editing}
                                choice={unit}
                                onChange={(id) =>
                                    setForm({ ...form, unit_id: id })
                                }
                                portalContainer={portalContainer}
                            />
                        </FormControl>
                        <FormControl
                            error={errors.dosage_form_id?.[0]}
                            data-error-field="dosage_form_id"
                        >
                            <OptionLookup
                                label="Bentuk sediaan"
                                disabled={!editing}
                                choice={dosageForm}
                                onChange={(id) =>
                                    setForm({ ...form, dosage_form_id: id })
                                }
                                portalContainer={portalContainer}
                            />
                        </FormControl>
                        <Field orientation="horizontal" className="w-auto">
                            <Switch
                                id="drug-active"
                                checked={form.is_active}
                                disabled={!editing}
                                onCheckedChange={(checked) =>
                                    setForm({ ...form, is_active: checked })
                                }
                            />
                            <FieldLabel htmlFor="drug-active">Aktif</FieldLabel>
                        </Field>
                    </FormGrid>
                </PageDialogBody>
                {confirmation}
            </form>
        </div>
    );
}
