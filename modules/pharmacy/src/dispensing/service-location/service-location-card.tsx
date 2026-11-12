import { ActionButton } from '@operations-metta/ui/action-button';
import { FormGrid } from '@operations-metta/ui/form-control';
import type { Reference } from '@operations-metta/ui/master-lookup';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '@core/platform/shell/index.ts';
import {
    LocationLookup,
    OperatingUnitLookup,
    SectionLookup,
} from './pharmacy-lookups.tsx';

export type ServiceLocation =
    ApiBody<'pharmacyServiceLocationList'>['data'][number];

const formOf = (row: ServiceLocation | null) => ({
    unit: row ? { ...row.operating_unit, code: '' } : null,
    section: row?.section ? { ...row.section, code: '' } : null,
    location: row?.location ?? null,
});

// Satu baris Lokasi layanan resep. Unit dan section asal adalah identitas baris, jadi hanya lokasinya yang berubah
// setelah disimpan; unit atau section lain berarti baris baru.
export function ServiceLocationCard({
    record,
    canManage,
    onSaved,
    onClose,
}: {
    record: ServiceLocation | null;
    canManage: boolean;
    onSaved: (row: ServiceLocation) => void;
    onClose: () => void;
}): ReactNode {
    const [form, setForm] = useState(() => formOf(record));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const { confirm, confirmation } = useConfirmation();
    const portalContainer = useRef<HTMLDivElement>(null);
    usePageDialogRecord({
        recordTitle: record
            ? `${record.operating_unit.name} · ${record.section?.name ?? 'Semua section'}`
            : 'Lokasi layanan resep baru',
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
                    ? await api.pharmacyServiceLocationUpdate({
                          params: { id: record.id },
                          body: {
                              location_id: form.location?.id ?? '',
                              version: record.version,
                          },
                      })
                    : await api.pharmacyServiceLocationCreate({
                          body: {
                              operating_unit_id: form.unit?.id ?? '',
                              section_id: form.section?.id ?? null,
                              location_id: form.location?.id ?? '',
                          },
                      });
                toast.success('Lokasi layanan resep disimpan.');
                onSaved(body.data);
            },
            'Lokasi layanan resep belum disimpan.',
        );

    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: 'Delete lokasi layanan resep ini?',
                description: record.section
                    ? `Resep dari ${record.section.name} kembali dilayani lokasi bawaan ${record.operating_unit.name}.`
                    : `Resep dari ${record.operating_unit.name} yang tidak punya baris section tidak lagi punya lokasi farmasi sampai dipilih petugas.`,
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run(
            'delete',
            async () => {
                await api.pharmacyServiceLocationDelete({
                    params: { id: record.id },
                    body: { version: record.version },
                });
                toast.success('Lokasi layanan resep dihapus.');
                onClose();
            },
            'Lokasi layanan resep belum dihapus.',
        );
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
                            ? 'Lokasi layanan resep belum dihapus'
                            : 'Lokasi layanan resep belum disimpan'
                    }
                />
                <PageDialogBody className="py-3">
                    <FormGrid>
                        <OperatingUnitLookup
                            label="Operating unit"
                            required
                            field="operating_unit_id"
                            value={form.unit}
                            onChange={(unit: Reference) =>
                                setForm((current) => ({
                                    ...current,
                                    unit,
                                    section: null,
                                }))
                            }
                            disabled={!canManage || record !== null}
                            error={errors.operating_unit_id?.[0]}
                            portalContainer={portalContainer}
                        />
                        <SectionLookup
                            label="Section asal"
                            field="section_id"
                            operatingUnitId={form.unit?.id ?? null}
                            value={form.section}
                            onChange={(section) =>
                                setForm((current) => ({ ...current, section }))
                            }
                            disabled={
                                !canManage || record !== null || !form.unit
                            }
                            error={errors.section_id?.[0]}
                            hint="Kosongkan untuk lokasi bawaan unit ini. Isi bila resep dari satu section, misalnya pusling, dilayani lokasi lain. Section dikenal dari resep yang sudah diterima farmasi."
                            portalContainer={portalContainer}
                        />
                        <LocationLookup
                            label="Lokasi farmasi"
                            required
                            field="location_id"
                            value={form.location}
                            onChange={(location) =>
                                setForm((current) => ({ ...current, location }))
                            }
                            disabled={!canManage}
                            error={errors.location_id?.[0]}
                            hint="Stok obat resep ini diambil dari lokasi ini saat disiapkan."
                            portalContainer={portalContainer}
                        />
                    </FormGrid>
                </PageDialogBody>
                {confirmation}
            </form>
        </div>
    );
}
