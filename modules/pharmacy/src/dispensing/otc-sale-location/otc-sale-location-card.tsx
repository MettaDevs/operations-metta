import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { FormGrid } from '@operations-metta/ui/form-control';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
    type Reference,
} from '@operations-metta/ui/master-lookup';
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
    locationLabel,
    LocationLookup,
} from '../service-location/pharmacy-lookups.tsx';

export type OtcSaleLocation =
    ApiBody<'pharmacyOtcSaleLocationList'>['data'][number];

const loadPriceGroups = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.pharmacyPriceGroupLookup(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};

const formOf = (row: OtcSaleLocation | null) => ({
    location: row?.location ?? null,
    priceGroup: row?.price_group ?? null,
});

// Satu baris Lokasi penjualan obat bebas. Lokasi adalah identitas baris, jadi hanya kelompok harganya yang berubah
// setelah disimpan; lokasi lain berarti baris baru.
export function OtcSaleLocationCard({
    record,
    canManage,
    onSaved,
    onClose,
}: {
    record: OtcSaleLocation | null;
    canManage: boolean;
    onSaved: (row: OtcSaleLocation) => void;
    onClose: () => void;
}): ReactNode {
    const [form, setForm] = useState(() => formOf(record));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [lastAction, setLastAction] = useState<'save' | 'delete'>('save');
    const { confirm, confirmation } = useConfirmation();
    const portalContainer = useRef<HTMLDivElement>(null);
    const dirty = JSON.stringify(form) !== JSON.stringify(formOf(record));
    usePageDialogRecord({
        recordTitle: record
            ? locationLabel(record.location)
            : 'Lokasi penjualan obat bebas baru',
        editing: canManage,
        dirty,
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
                    ? await api.pharmacyOtcSaleLocationUpdate({
                          params: { id: record.id },
                          body: {
                              price_group_id: form.priceGroup?.id ?? null,
                              version: record.version,
                          },
                      })
                    : await api.pharmacyOtcSaleLocationCreate({
                          body: {
                              location_id: form.location?.id ?? '',
                              price_group_id: form.priceGroup?.id ?? null,
                          },
                      });
                toast.success('Lokasi penjualan obat bebas disimpan.');
                onSaved(body.data);
            },
            'Lokasi penjualan obat bebas belum disimpan.',
        );

    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: 'Delete lokasi penjualan obat bebas ini?',
                description: `${locationLabel(record.location)} tidak lagi bisa menjual obat bebas di loket. Penjualan yang sudah terjadi tetap tercatat.`,
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run(
            'delete',
            async () => {
                await api.pharmacyOtcSaleLocationDelete({
                    params: { id: record.id },
                    body: { version: record.version },
                });
                toast.success('Lokasi penjualan obat bebas dihapus.');
                onClose();
            },
            'Lokasi penjualan obat bebas belum dihapus.',
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
                            ? 'Lokasi penjualan obat bebas belum dihapus'
                            : 'Lokasi penjualan obat bebas belum disimpan'
                    }
                />
                <PageDialogBody className="py-3">
                    <FormGrid>
                        <LocationLookup
                            label="Lokasi"
                            required
                            field="location_id"
                            value={form.location}
                            onChange={(location) =>
                                setForm((current) => ({ ...current, location }))
                            }
                            disabled={!canManage || record !== null}
                            error={errors.location_id?.[0]}
                            hint="Lokasi stok yang boleh menjual obat bebas di loket. Stok obat yang dijual diambil dari sini."
                            portalContainer={portalContainer}
                        />
                        <MasterLookup<Reference>
                            label="Kelompok harga"
                            field="price_group_id"
                            value={form.priceGroup}
                            onChange={(priceGroup) =>
                                setForm((current) => ({
                                    ...current,
                                    priceGroup,
                                }))
                            }
                            disabled={!canManage}
                            error={errors.price_group_id?.[0]}
                            hint="Harga bawaan penjualan di lokasi ini; petugas loket masih bisa menggantinya per penjualan. Kosong berarti harga dasar."
                            portalContainer={portalContainer}
                            noun="Kelompok harga"
                            load={loadPriceGroups}
                            columns={[codeColumn(), nameColumn(220)]}
                        />
                    </FormGrid>
                    {canManage && form.priceGroup && (
                        <Button
                            type="button"
                            variant="ghost"
                            className="mt-2"
                            disabled={busy}
                            onClick={() =>
                                setForm((current) => ({
                                    ...current,
                                    priceGroup: null,
                                }))
                            }
                        >
                            Pakai harga dasar
                        </Button>
                    )}
                </PageDialogBody>
                {confirmation}
            </form>
        </div>
    );
}
