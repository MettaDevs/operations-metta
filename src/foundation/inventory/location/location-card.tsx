import { ActionButton } from '@operations-metta/ui/action-button';
import {
    CollapsibleSection,
    CollapsibleSectionGroup,
} from '@operations-metta/ui/collapsible-section';
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
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
} from '../../../platform/shell/index.ts';
import type { Reference } from '../master-lookup.tsx';
import {
    pickingLabels,
    PolicySelect,
    transferLabels,
} from '../setup/stock-policy-options.tsx';
import { OperatingUnitLookup, type Location } from './location-lookup.tsx';

// Kartu lokasi (Location Card di BC). Cara pengambilan dan cara mutasi yang kosong mengikuti setelan di atasnya.

const formOf = (location: Location | null) => ({
    code: location?.code ?? '',
    name: location?.name ?? '',
    operatingUnit: location
        ? ({ ...location.operating_unit, code: '' } satisfies Reference)
        : null,
    isTransit: location?.is_transit ?? false,
    picking: location?.picking_method ?? null,
    transferMode: location?.transfer_mode ?? null,
});

export function LocationCard({
    record,
    canManage,
    onSaved,
    onClose,
}: {
    record: Location | null;
    canManage: boolean;
    onSaved: (location: Location) => void;
    onClose: () => void;
}): ReactNode {
    const editing = canManage;
    const [form, setForm] = useState(() => formOf(record));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const { confirm, confirmation } = useConfirmation();
    // Popup pilihan dipasang di dalam kartu, karena pemanggil tidak selalu memberi ref isi dialognya.
    const portalContainer = useRef<HTMLDivElement>(null);
    usePageDialogRecord({
        recordTitle: record ? `${record.code} ${record.name}` : 'Lokasi baru',
        editing,
    });

    const save = async () => {
        setLastAction('save');
        setBusy(true);
        setErrors({});
        setMessage(null);
        const body = {
            code: form.code,
            name: form.name,
            operating_unit_id: form.operatingUnit?.id ?? '',
            is_transit: form.isTransit,
            picking_method: form.picking,
            transfer_mode: form.transferMode,
        };
        try {
            const { body: saved } = record
                ? await api.inventoryLocationUpdate({
                      params: { id: record.id },
                      body: { ...body, version: record.version },
                  })
                : await api.inventoryLocationCreate({ body });
            toast.success(record ? 'Lokasi diperbarui.' : 'Lokasi dibuat.');
            onSaved(saved.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Lokasi belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Delete lokasi ${record.code}?`,
                description:
                    'Lokasi ini tidak bisa dipilih lagi di penyesuaian stok dan mutasi.',
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
            await api.inventoryLocationDelete({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success('Lokasi dihapus.');
            onClose();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Lokasi belum dihapus.'));
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
                            ? 'Lokasi belum dihapus'
                            : 'Lokasi belum disimpan'
                    }
                />
                <PageDialogBody className="py-3">
                    <CollapsibleSectionGroup
                        defaultValue={['general', 'settings']}
                    >
                        <CollapsibleSection
                            value="general"
                            title="Umum"
                            summary={[
                                form.operatingUnit?.name,
                                form.isTransit ? 'Lokasi transit' : null,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        >
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
                                        maxLength={150}
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
                                <OperatingUnitLookup
                                    label="Operating unit"
                                    required
                                    field="operating_unit_id"
                                    value={form.operatingUnit}
                                    onChange={(unit) =>
                                        setForm({
                                            ...form,
                                            operatingUnit: unit,
                                        })
                                    }
                                    disabled={!editing}
                                    error={errors.operating_unit_id?.[0]}
                                    portalContainer={portalContainer}
                                />
                                <FormControl
                                    error={errors.is_transit?.[0]}
                                    hint="Tempat singgah stok pada mutasi kirim lalu terima. Lokasi transit tidak bisa dipilih di penyesuaian stok."
                                    data-error-field="is_transit"
                                >
                                    <Field
                                        orientation="horizontal"
                                        className="w-auto"
                                    >
                                        <Switch
                                            id="location-transit"
                                            checked={form.isTransit}
                                            disabled={!editing}
                                            onCheckedChange={(isTransit) =>
                                                setForm({ ...form, isTransit })
                                            }
                                        />
                                        <FieldLabel
                                            htmlFor="location-transit"
                                            className="font-normal"
                                        >
                                            Lokasi transit
                                        </FieldLabel>
                                    </Field>
                                </FormControl>
                            </FormGrid>
                        </CollapsibleSection>
                        <CollapsibleSection
                            value="settings"
                            title="Setelan"
                            summary={`${form.picking ? pickingLabels[form.picking] : 'Pengambilan mengikuti operating unit'} · ${form.transferMode ? `Mutasi ${transferLabels[form.transferMode].toLowerCase()}` : 'Mutasi mengikuti setelan persediaan'}`}
                        >
                            <FormGrid>
                                <FormControl
                                    error={errors.picking_method?.[0]}
                                    hint="Ikuti operating unit memakai cara pengambilan operating unit lokasi ini, atau setelan persediaan bila operating unit tidak mengaturnya."
                                    data-error-field="picking_method"
                                >
                                    <PolicySelect
                                        label="Cara pengambilan"
                                        labels={pickingLabels}
                                        inherit="Ikuti operating unit"
                                        value={form.picking}
                                        editing={editing}
                                        onChange={(picking) =>
                                            setForm({ ...form, picking })
                                        }
                                        portalContainer={portalContainer}
                                    />
                                </FormControl>
                                <FormControl
                                    error={errors.transfer_mode?.[0]}
                                    data-error-field="transfer_mode"
                                >
                                    <PolicySelect
                                        label="Cara mutasi"
                                        labels={transferLabels}
                                        inherit="Ikuti setelan persediaan"
                                        value={form.transferMode}
                                        editing={editing}
                                        onChange={(transferMode) =>
                                            setForm({ ...form, transferMode })
                                        }
                                        portalContainer={portalContainer}
                                    />
                                </FormControl>
                            </FormGrid>
                        </CollapsibleSection>
                    </CollapsibleSectionGroup>
                </PageDialogBody>
                {confirmation}
            </form>
        </div>
    );
}
