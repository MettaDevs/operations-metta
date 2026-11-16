import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
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
import { Select } from '@operations-metta/ui/select';
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
import { LocationLookup } from '../service-location/pharmacy-lookups.tsx';

export type DispensingFee =
    ApiBody<'pharmacyDispensingFeeList'>['data'][number];

export const feeKinds = [
    { value: 'racik', label: 'Biaya racik' },
    { value: 'resep', label: 'Biaya resep' },
] as const;

export const feeKindLabel = (kind: string) =>
    feeKinds.find((option) => option.value === kind)?.label ?? kind;

const loadPriceGroups = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.pharmacyPriceGroupLookup(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};

const formOf = (row: DispensingFee | null) => ({
    kind: row?.kind ?? '',
    location: row?.location ?? null,
    priceGroup: row?.price_group ?? null,
    amount: row?.amount.replace('.', ',') ?? '',
});

// Satu nilai biaya racik atau biaya resep. Lokasi dan kelompok harga kosong berarti berlaku untuk semuanya.
export function DispensingFeeCard({
    record,
    canManage,
    onSaved,
    onClose,
}: {
    record: DispensingFee | null;
    canManage: boolean;
    onSaved: (row: DispensingFee) => void;
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
        recordTitle: record ? feeKindLabel(record.kind) : 'Biaya baru',
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
                const body = {
                    kind: form.kind,
                    location_id: form.location?.id ?? null,
                    price_group_id: form.priceGroup?.id ?? null,
                    amount: form.amount.trim().replace(',', '.'),
                };
                const { body: saved } = record
                    ? await api.pharmacyDispensingFeeUpdate({
                          params: { id: record.id },
                          body: { ...body, version: record.version },
                      })
                    : await api.pharmacyDispensingFeeCreate({ body });
                toast.success('Biaya disimpan.');
                onSaved(saved.data);
            },
            'Biaya belum disimpan.',
        );

    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: 'Delete biaya ini?',
                description:
                    'Resep yang disiapkan dan penjualan yang disimpan sesudahnya tidak lagi memakai nilai ini. Biaya yang sudah ditagih tidak berubah.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run(
            'delete',
            async () => {
                await api.pharmacyDispensingFeeDelete({
                    params: { id: record.id },
                    body: { version: record.version },
                });
                toast.success('Biaya dihapus.');
                onClose();
            },
            'Biaya belum dihapus.',
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
                            ? 'Biaya belum dihapus'
                            : 'Biaya belum disimpan'
                    }
                />
                <PageDialogBody className="py-3">
                    <FormGrid>
                        <FormControl
                            error={errors.kind?.[0]}
                            hint="Biaya racik ditagih sekali per racikan. Biaya resep ditagih sekali per obat yang bukan racikan, tidak dikali jumlahnya."
                        >
                            <div data-error-field="kind">
                                {canManage ? (
                                    <Select
                                        label="Jenis biaya"
                                        required
                                        placeholder="Pilih jenis biaya"
                                        items={[...feeKinds]}
                                        value={form.kind}
                                        onValueChange={(kind) =>
                                            setForm((current) => ({
                                                ...current,
                                                kind: kind ?? '',
                                            }))
                                        }
                                        portalContainer={portalContainer}
                                    />
                                ) : (
                                    <Input
                                        label="Jenis biaya"
                                        value={feeKindLabel(form.kind)}
                                        disabled
                                    />
                                )}
                            </div>
                        </FormControl>
                        <FormControl
                            error={errors.amount?.[0]}
                            hint="Isi 0 supaya biaya ini tidak ditagih, misalnya untuk kelompok harga karyawan."
                        >
                            <Input
                                label="Nilai"
                                required
                                inputMode="decimal"
                                data-error-field="amount"
                                value={form.amount}
                                onChange={(event) =>
                                    setForm((current) => ({
                                        ...current,
                                        amount: event.target.value,
                                    }))
                                }
                                disabled={!canManage}
                            />
                        </FormControl>
                        <LocationLookup
                            label="Lokasi"
                            field="location_id"
                            value={form.location}
                            onChange={(location) =>
                                setForm((current) => ({ ...current, location }))
                            }
                            disabled={!canManage}
                            error={errors.location_id?.[0]}
                            hint="Kosongkan supaya berlaku di semua lokasi. Nilai untuk satu lokasi menggantikan nilai semua lokasi."
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
                            hint="Kosongkan supaya berlaku untuk semua pembeli. Nilai untuk satu kelompok harga menggantikan nilai lokasi."
                            portalContainer={portalContainer}
                            noun="Kelompok harga"
                            load={loadPriceGroups}
                            columns={[codeColumn(), nameColumn(220)]}
                        />
                    </FormGrid>
                    {canManage &&
                        (form.location !== null ||
                            form.priceGroup !== null) && (
                            <div className="mt-2 flex gap-2">
                                {form.location && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={() =>
                                            setForm((current) => ({
                                                ...current,
                                                location: null,
                                            }))
                                        }
                                    >
                                        Berlaku di semua lokasi
                                    </Button>
                                )}
                                {form.priceGroup && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={() =>
                                            setForm((current) => ({
                                                ...current,
                                                priceGroup: null,
                                            }))
                                        }
                                    >
                                        Berlaku untuk semua kelompok harga
                                    </Button>
                                )}
                            </div>
                        )}
                </PageDialogBody>
                {confirmation}
            </form>
        </div>
    );
}
