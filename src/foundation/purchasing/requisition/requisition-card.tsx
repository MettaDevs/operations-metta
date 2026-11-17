import { ActionButton } from '@operations-metta/ui/action-button';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
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
import { useId, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    type ErrorAction,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import {
    itemColumns,
    label,
    loadItems,
    loadLocations,
    loadVendors,
    today,
    UnitLookup,
    unitText,
    useLoader,
    type ItemChoice,
    type Reference,
    type UnitChoice,
} from '../purchase-lines.tsx';
import type { Vendor } from '../vendor/vendor-card.tsx';

export type Requisition = ApiBody<'purchasingRequisitionShow'>['data'];
export type RequisitionPermissions =
    ApiBody<'purchasingRequisitionList'>['permissions'];
type Location = ApiBody<'inventoryLocationList'>['data'][number];
type Errors = Record<string, string[]>;

type Form = {
    location: Reference | null;
    item: ItemChoice | null;
    unit: UnitChoice | null;
    quantity: string;
    due_date: string;
    description: string;
    vendor: { id: string; number: string; name: string } | null;
    unit_cost: string;
    accepted: boolean;
};

function formOf(requisition: Requisition | null): Form {
    if (!requisition)
        return {
            location: null,
            item: null,
            unit: null,
            quantity: '',
            due_date: today(),
            description: '',
            vendor: null,
            unit_cost: '',
            accepted: false,
        };
    const unit = {
        ...requisition.unit,
        quantity_per_unit: requisition.quantity_per_unit,
    };
    return {
        location: requisition.location,
        item: {
            id: requisition.item.id,
            code: requisition.item.code,
            name: requisition.item.name,
            base_unit: { id: '', code: requisition.item.base_unit, name: '' },
            purchase_unit: unit,
            batch_required: false,
            expiry_required: false,
        },
        unit,
        quantity: requisition.quantity,
        due_date: requisition.due_date,
        description: requisition.description ?? '',
        vendor: requisition.vendor,
        unit_cost: requisition.unit_cost ?? '',
        accepted: requisition.accepted,
    };
}

// Satu baris permintaan pembelian (Requisition Line di BC). Lokasi mengisi barang, jumlah, dan tanggal dibutuhkan;
// petugas pembelian mengisi vendor dan harga lalu menandainya disetujui.
export function RequisitionCard({
    requisition: initial,
    permissions,
    portalContainer,
    onSaved,
    onClose,
}: {
    requisition: Requisition | null;
    permissions: RequisitionPermissions;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (requisition: Requisition) => void;
    onClose: () => void;
}): ReactNode {
    const [requisition, setRequisition] = useState(initial);
    const editable = permissions.update && !requisition?.order;
    const purchasing = editable && permissions.process;
    const [form, setForm] = useState(() => formOf(initial));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [errorActions, setErrorActions] = useState<readonly ErrorAction[]>(
        [],
    );
    const [message, setMessage] = useState<string | null>(null);
    const [operation, setOperation] = useState('Permintaan belum disimpan');
    const { confirm, confirmation } = useConfirmation();
    const locationLoader = useLoader(loadLocations);
    const itemLoader = useLoader(loadItems);
    const vendorLoader = useLoader(loadVendors);
    const acceptedId = useId();
    const pristine =
        JSON.stringify(form) === JSON.stringify(formOf(requisition));
    usePageDialogRecord({
        recordTitle: requisition
            ? `${requisition.item.name} untuk ${requisition.location.name}`
            : 'Permintaan baru',
        editing: editable,
        dirty: !pristine,
    });
    const error = (field: string) => errors[field]?.join(' ');
    const set = (patch: Partial<Form>) =>
        setForm((current) => ({ ...current, ...patch }));

    const failed = (caught: unknown, failure: string) => {
        setOperation(failure);
        if (caught instanceof ApiError && caught.status === 422) {
            setErrors(caught.errors);
            setErrorActions(caught.actions);
        } else setMessage(errorText(caught, failure + '.'));
    };

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setErrorActions([]);
        setMessage(null);
        const body = {
            location_id: form.location?.id ?? '',
            item_id: form.item?.id ?? '',
            unit_id: form.unit?.id ?? null,
            quantity: form.quantity,
            due_date: form.due_date,
            description: form.description || null,
            vendor_id: form.vendor?.id ?? null,
            unit_cost: form.unit_cost || null,
            accepted: form.accepted,
        };
        try {
            const { body: saved } = requisition
                ? await api.purchasingRequisitionUpdate({
                      params: { id: requisition.id },
                      body: { ...body, version: requisition.version },
                  })
                : await api.purchasingRequisitionCreate({ body });
            toast.success(
                requisition ? 'Permintaan diperbarui.' : 'Permintaan diajukan.',
            );
            setRequisition(saved.data);
            setForm(formOf(saved.data));
            onSaved(saved.data);
        } catch (caught) {
            failed(caught, 'Permintaan belum disimpan');
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!requisition) return;
        if (
            !(await confirm({
                title: 'Delete permintaan ini?',
                description:
                    'Permintaan ini tidak tampil lagi di daftar permintaan pembelian.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        try {
            await api.purchasingRequisitionDelete({
                params: { id: requisition.id },
                body: { version: requisition.version },
            });
            toast.success('Permintaan dihapus.');
            onClose();
        } catch (caught) {
            failed(caught, 'Permintaan belum dihapus');
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
                if (editable) void submit();
            }}
        >
            <PageDialogToolbar>
                {editable && (
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
                                if (!requisition) {
                                    onClose();
                                    return;
                                }
                                setForm(formOf(requisition));
                                setErrors({});
                                setErrorActions([]);
                                setMessage(null);
                            }}
                        />
                    </>
                )}
                {requisition && editable && (
                    <ActionButton
                        action="archive"
                        disabled={busy}
                        onClick={() => void remove()}
                    />
                )}
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                errorActions={errorActions}
                message={message}
                operation={operation}
            />
            <PageDialogBody className="space-y-4 py-3">
                <FormGrid>
                    <FormControl
                        error={error('location_id')}
                        data-error-field="location_id"
                        hint="Lokasi yang membutuhkan barang. Barang dipesan untuk dikirim ke sini."
                    >
                        {editable ? (
                            <InlineLookup<Location>
                                label="Untuk lokasi"
                                required
                                loadItems={locationLoader}
                                value={
                                    form.location
                                        ? {
                                              ...form.location,
                                              operating_unit: {
                                                  id: '',
                                                  name: '',
                                              },
                                              is_transit: false,
                                              restricted_to_employees: false,
                                              picking_method: null,
                                              transfer_mode: null,
                                              version: 0,
                                          }
                                        : null
                                }
                                displayValue={
                                    form.location ? label(form.location) : ''
                                }
                                onValueChange={(location) =>
                                    set({
                                        location: {
                                            id: location.id,
                                            code: location.code,
                                            name: location.name,
                                        },
                                    })
                                }
                                getItemValue={(location) => location.id}
                                getItemLabel={label}
                                placeholder="Cari kode atau nama lokasi…"
                                emptyMessage="Lokasi tidak ditemukan."
                                showDetails={false}
                                portalContainer={portalContainer}
                                columns={[
                                    {
                                        id: 'code',
                                        header: 'Kode',
                                        width: 110,
                                        cell: (location) => location.code,
                                    },
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        width: 200,
                                        cell: (location) => location.name,
                                    },
                                ]}
                            />
                        ) : (
                            <Input
                                label="Untuk lokasi"
                                readOnly
                                value={
                                    form.location ? label(form.location) : ''
                                }
                            />
                        )}
                    </FormControl>
                    <FormControl
                        error={error('item_id')}
                        data-error-field="item_id"
                    >
                        {editable ? (
                            <InlineLookup<ItemChoice>
                                label="Barang"
                                required
                                loadItems={itemLoader}
                                value={form.item}
                                displayValue={form.item ? label(form.item) : ''}
                                onValueChange={(item) =>
                                    set({ item, unit: item.purchase_unit })
                                }
                                getItemValue={(item) => item.id}
                                getItemLabel={label}
                                placeholder="Cari kode atau nama barang…"
                                emptyMessage="Barang tidak ditemukan."
                                popupClassName="w-[36rem]"
                                showDetails={false}
                                portalContainer={portalContainer}
                                columns={itemColumns}
                            />
                        ) : (
                            <Input
                                label="Barang"
                                readOnly
                                value={form.item ? label(form.item) : ''}
                            />
                        )}
                    </FormControl>
                    {editable && form.item ? (
                        <UnitLookup
                            itemId={form.item.id}
                            value={form.unit}
                            field="unit_id"
                            error={error('unit_id')}
                            onPick={(unit) => set({ unit })}
                        />
                    ) : (
                        <FormControl>
                            <Input
                                label="Satuan"
                                readOnly
                                value={unitText(
                                    form.unit,
                                    form.item?.base_unit.code ?? '',
                                )}
                            />
                        </FormControl>
                    )}
                    <FormControl error={error('quantity')}>
                        <Input
                            label="Jumlah"
                            required
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            data-error-field="quantity"
                            readOnly={!editable}
                            value={form.quantity}
                            onChange={(event) =>
                                set({ quantity: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl error={error('due_date')}>
                        {editable ? (
                            <DatePicker
                                label="Dibutuhkan tanggal"
                                required
                                data-error-field="due_date"
                                value={form.due_date}
                                portalContainer={portalContainer}
                                onValueChange={(due_date) => set({ due_date })}
                            />
                        ) : (
                            <Input
                                label="Dibutuhkan tanggal"
                                readOnly
                                value={displayDate(form.due_date)}
                            />
                        )}
                    </FormControl>
                    <FormControl error={error('description')}>
                        <Input
                            label="Keterangan"
                            maxLength={200}
                            data-error-field="description"
                            readOnly={!editable}
                            value={form.description}
                            onChange={(event) =>
                                set({ description: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl
                        error={error('vendor_id')}
                        data-error-field="vendor_id"
                        hint="Diisi petugas pembelian. Permintaan dengan vendor dan lokasi yang sama digabung menjadi satu purchase order."
                    >
                        {purchasing ? (
                            <InlineLookup<Vendor>
                                label="Vendor"
                                loadItems={vendorLoader}
                                value={
                                    form.vendor
                                        ? {
                                              ...form.vendor,
                                              tax_number: null,
                                              payment_terms: null,
                                              status: 'active',
                                              version: 0,
                                          }
                                        : null
                                }
                                displayValue={form.vendor?.name ?? ''}
                                onValueChange={(vendor) => set({ vendor })}
                                getItemValue={(vendor) => vendor.id}
                                getItemLabel={(vendor) => vendor.name}
                                placeholder="Cari nomor atau nama vendor…"
                                emptyMessage="Vendor tidak ditemukan."
                                showDetails={false}
                                portalContainer={portalContainer}
                                columns={[
                                    {
                                        id: 'number',
                                        header: 'Nomor',
                                        width: 130,
                                        cell: (vendor) => vendor.number,
                                    },
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        width: 240,
                                        cell: (vendor) => vendor.name,
                                    },
                                ]}
                            />
                        ) : (
                            <Input
                                label="Vendor"
                                readOnly
                                value={form.vendor?.name ?? ''}
                            />
                        )}
                    </FormControl>
                    <FormControl
                        error={error('unit_cost')}
                        hint="Kosongkan untuk memakai harga penerimaan terakhir barang ini."
                    >
                        <Input
                            label="Harga satuan"
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            data-error-field="unit_cost"
                            readOnly={!purchasing}
                            value={form.unit_cost}
                            onChange={(event) =>
                                set({ unit_cost: event.target.value })
                            }
                        />
                    </FormControl>
                    <FormControl
                        error={error('accepted')}
                        hint="Hanya permintaan yang disetujui yang dibuatkan purchase order."
                    >
                        <Field
                            orientation="horizontal"
                            className="w-auto"
                            data-error-field="accepted"
                        >
                            <Switch
                                id={acceptedId}
                                checked={form.accepted}
                                disabled={!purchasing}
                                onCheckedChange={(accepted) =>
                                    set({ accepted })
                                }
                            />
                            <FieldLabel
                                htmlFor={acceptedId}
                                className="font-normal"
                            >
                                Disetujui
                            </FieldLabel>
                        </Field>
                    </FormControl>
                    {requisition?.order && (
                        <FormControl>
                            <Input
                                label="Purchase order"
                                readOnly
                                value={requisition.order.number}
                            />
                        </FormControl>
                    )}
                    {requisition?.requested_by && (
                        <FormControl>
                            <Input
                                label="Diminta oleh"
                                readOnly
                                value={requisition.requested_by}
                            />
                        </FormControl>
                    )}
                </FormGrid>
            </PageDialogBody>
            {confirmation}
        </form>
    );
}
