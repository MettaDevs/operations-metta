import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import {
    displayAmount,
    displayNumber,
} from '@operations-metta/ui/display-number';
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
import { LockOpen, Send } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    type ErrorAction,
    errorText,
    FormErrorHeader,
    PrintAction,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import {
    amountOf,
    itemColumns,
    label,
    loadItems,
    loadLocations,
    loadVendors,
    nextKey,
    today,
    totalsOf,
    UnitLookup,
    unitText,
    useLoader,
    type ItemChoice,
    type Reference,
    type UnitChoice,
} from '../purchase-lines.tsx';
import { VendorCard, type Vendor } from '../vendor/vendor-card.tsx';

export type PurchaseOrder = ApiBody<'purchasingOrderShow'>['data'];
export type PurchaseOrderPermissions =
    ApiBody<'purchasingOrderList'>['permissions'];
type Location = ApiBody<'inventoryLocationList'>['data'][number];
type Errors = Record<string, string[]>;

type Line = {
    key: string;
    id: string | null;
    item: ItemChoice | null;
    unit: UnitChoice | null;
    quantity: string;
    unit_cost: string;
    discount_percent: string;
    vat_percent: string;
    expected_receipt_date: string;
};
type Header = {
    vendor: { id: string; number: string; name: string } | null;
    location: Reference | null;
    order_date: string;
    expected_receipt_date: string;
    description: string;
    prices_including_vat: boolean;
};

export const purchaseOrderStatusLabels: Record<
    PurchaseOrder['status'],
    string
> = {
    terbuka: 'Terbuka',
    dirilis: 'Dirilis',
};

function headerOf(order: PurchaseOrder | null): Header {
    return {
        vendor: order?.vendor ?? null,
        location: order?.location ?? null,
        order_date: order?.order_date ?? today(),
        expected_receipt_date: order?.expected_receipt_date ?? '',
        description: order?.description ?? '',
        prices_including_vat: order?.prices_including_vat ?? false,
    };
}

function linesOf(order: PurchaseOrder | null): Line[] {
    return (order?.lines ?? []).map((line) => ({
        key: line.id,
        id: line.id,
        item: {
            id: line.item.id,
            code: line.item.code,
            name: line.item.name,
            base_unit: { id: '', code: line.item.base_unit, name: '' },
            purchase_unit: {
                ...line.unit,
                quantity_per_unit: line.quantity_per_unit,
            },
            batch_required: false,
            expiry_required: false,
        },
        unit: { ...line.unit, quantity_per_unit: line.quantity_per_unit },
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        discount_percent: line.discount_percent,
        vat_percent: line.vat_percent,
        expected_receipt_date: line.expected_receipt_date ?? '',
    }));
}

// Purchase order ke vendor: kepala order lalu baris barang, seperti Purchase Order BC. Order terbuka disimpan dengan
// Simpan; Rilis menyimpan perubahan yang tertunda lebih dulu, lalu mengunci order. Buka lagi membukanya untuk diubah.
export function PurchaseOrderCard({
    order: initial,
    permissions,
    amountDecimals,
    portalContainer,
    onSaved,
    onClose,
}: {
    order: PurchaseOrder | null;
    permissions: PurchaseOrderPermissions;
    amountDecimals: number;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (order: PurchaseOrder) => void;
    onClose: () => void;
}): ReactNode {
    const [order, setOrder] = useState(initial);
    const editable =
        (order === null || order.status === 'terbuka') && permissions.update;
    const [header, setHeader] = useState(() => headerOf(initial));
    const [lines, setLines] = useState(() => linesOf(initial));
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [errorActions, setErrorActions] = useState<readonly ErrorAction[]>(
        [],
    );
    const [message, setMessage] = useState<string | null>(null);
    const [operation, setOperation] = useState('Order belum disimpan');
    const [creatingVendor, setCreatingVendor] = useState(false);
    const vendorDialog = useRef<HTMLDivElement>(null);
    const { confirm, confirmation } = useConfirmation();
    const vendorLoader = useLoader(loadVendors);
    const locationLoader = useLoader(loadLocations);
    const itemLoader = useLoader(loadItems);
    const pristine =
        JSON.stringify([header, lines]) ===
        JSON.stringify([headerOf(order), linesOf(order)]);
    usePageDialogRecord({
        recordTitle: order
            ? `${order.number} ${order.vendor.name}`
            : 'Purchase order baru',
        editing: editable,
        dirty: !pristine,
    });

    const error = (field: string) => errors[field]?.join(' ');
    const field = (index: number, name: string) => `lines.${index}.${name}`;
    const change = (index: number, patch: Partial<Line>) =>
        setLines((current) =>
            current.map((line, at) =>
                at === index ? { ...line, ...patch } : line,
            ),
        );
    const { subtotal, vat } = totalsOf(lines, amountDecimals);
    const pricesIncludingVatId = useId();

    const payload = () => ({
        vendor_id: header.vendor?.id ?? '',
        location_id: header.location?.id ?? '',
        order_date: header.order_date,
        expected_receipt_date: header.expected_receipt_date || null,
        description: header.description || null,
        prices_including_vat: header.prices_including_vat,
        lines: lines.map((line) => ({
            id: line.id,
            item_id: line.item?.id ?? '',
            unit_id: line.unit?.id ?? '',
            quantity: line.quantity,
            unit_cost: line.unit_cost,
            discount_percent: line.discount_percent || null,
            vat_percent: line.vat_percent || null,
            expected_receipt_date: line.expected_receipt_date || null,
        })),
    });

    const failed = (caught: unknown, failure: string) => {
        setOperation(failure);
        if (caught instanceof ApiError && caught.status === 422) {
            setErrors(caught.errors);
            setErrorActions(caught.actions);
        } else setMessage(errorText(caught, failure + '.'));
    };

    const save = async (): Promise<PurchaseOrder | null> => {
        setErrors({});
        setErrorActions([]);
        setMessage(null);
        try {
            const { body } = order
                ? await api.purchasingOrderUpdate({
                      params: { id: order.id },
                      body: { ...payload(), version: order.version },
                  })
                : await api.purchasingOrderCreate({ body: payload() });
            return body.data;
        } catch (caught) {
            failed(caught, 'Order belum disimpan');
            return null;
        }
    };

    const run = async (work: () => Promise<void>) => {
        setBusy(true);
        try {
            await work();
        } finally {
            setBusy(false);
        }
    };

    const adopt = (next: PurchaseOrder) => {
        setOrder(next);
        setHeader(headerOf(next));
        setLines(linesOf(next));
        setSelected([]);
        onSaved(next);
    };

    const submit = () =>
        run(async () => {
            const saved = await save();
            if (!saved) return;
            toast.success(order ? 'Order diperbarui.' : 'Order dibuat.');
            adopt(saved);
        });

    const release = () =>
        run(async () => {
            const saved = pristine && order ? order : await save();
            if (!saved) return;
            if (saved !== order) adopt(saved);
            try {
                const { body } = await api.purchasingOrderRelease({
                    params: { id: saved.id },
                    body: { version: saved.version },
                });
                toast.success(
                    `Order ${body.data.number} dirilis. Isinya terkunci dan siap dikirim ke vendor.`,
                );
                adopt(body.data);
            } catch (caught) {
                failed(caught, 'Order belum dirilis');
            }
        });

    const reopen = () =>
        run(async () => {
            if (!order) return;
            try {
                const { body } = await api.purchasingOrderReopen({
                    params: { id: order.id },
                    body: { version: order.version },
                });
                toast.success(`Order ${order.number} bisa diubah lagi.`);
                adopt(body.data);
            } catch (caught) {
                failed(caught, 'Order belum dibuka lagi');
            }
        });

    const remove = async () => {
        if (!order) return;
        if (
            !(await confirm({
                title: `Delete order ${order.number}?`,
                description:
                    'Order ini tidak tampil lagi di daftar purchase order.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run(async () => {
            try {
                await api.purchasingOrderDelete({
                    params: { id: order.id },
                    body: { version: order.version },
                });
                toast.success('Order dihapus.');
                onClose();
            } catch (caught) {
                failed(caught, 'Order belum dihapus');
            }
        });
    };

    const addLines = (items: (ItemChoice | null)[]) =>
        setLines((current) => {
            const previous = current.at(-1);
            return [
                ...current,
                ...items.map((item) => ({
                    key: nextKey(),
                    id: null,
                    item,
                    unit: item?.purchase_unit ?? null,
                    quantity: '',
                    unit_cost: '',
                    discount_percent: '',
                    // Satu order biasanya satu PPN %, jadi baris baru meneruskan PPN baris sebelumnya.
                    vat_percent: previous?.vat_percent ?? '',
                    expected_receipt_date: '',
                })),
            ];
        });

    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    const control = editable ? ('control' as const) : ('text' as const);
    const numberInput = (
        index: number,
        name: 'quantity' | 'unit_cost' | 'discount_percent' | 'vat_percent',
        caption: string,
        options: { required?: boolean; max?: number } = {},
    ) => (
        <FormControl error={error(field(index, name))}>
            <Input
                label={caption}
                required={options.required}
                type="number"
                min={0}
                max={options.max}
                step="any"
                inputMode="decimal"
                data-error-field={field(index, name)}
                value={lines[index]?.[name] ?? ''}
                onChange={(event) =>
                    change(index, { [name]: event.target.value })
                }
            />
        </FormControl>
    );
    const optionalNumber = (value: string) =>
        text(Number(value) ? displayNumber(value) : '');

    return (
        <>
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
                                    if (!order) {
                                        onClose();
                                        return;
                                    }
                                    setHeader(headerOf(order));
                                    setLines(linesOf(order));
                                    setErrors({});
                                    setErrorActions([]);
                                    setMessage(null);
                                }}
                            />
                        </>
                    )}
                    {editable && permissions.release && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            title="Kunci isi order supaya sama dengan yang dikirim ke vendor."
                            onClick={() => void release()}
                        >
                            <Send aria-hidden="true" />
                            Rilis
                        </Button>
                    )}
                    {order?.status === 'dirilis' && permissions.release && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            title="Buka kunci order supaya isinya bisa diubah."
                            onClick={() => void reopen()}
                        >
                            <LockOpen aria-hidden="true" />
                            Buka lagi
                        </Button>
                    )}
                    {order && editable && (
                        <ActionButton
                            action="archive"
                            disabled={busy}
                            onClick={() => void remove()}
                        />
                    )}
                    {order && (
                        <PrintAction
                            report="core.purchase-order"
                            recordId={order.id}
                            label="Purchase order"
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
                            error={error('vendor_id')}
                            data-error-field="vendor_id"
                        >
                            {editable ? (
                                <InlineLookup<Vendor>
                                    label="Vendor"
                                    required
                                    loadItems={vendorLoader}
                                    value={
                                        header.vendor
                                            ? {
                                                  ...header.vendor,
                                                  tax_number: null,
                                                  status: 'active',
                                                  version: 0,
                                              }
                                            : null
                                    }
                                    displayValue={header.vendor?.name ?? ''}
                                    onValueChange={(vendor) =>
                                        setHeader({ ...header, vendor })
                                    }
                                    getItemValue={(vendor) => vendor.id}
                                    getItemLabel={(vendor) => vendor.name}
                                    placeholder="Cari nomor atau nama vendor…"
                                    emptyMessage={
                                        permissions.create_vendor
                                            ? 'Vendor tidak ditemukan. Pilih Baru untuk menambahkan.'
                                            : 'Vendor tidak ditemukan.'
                                    }
                                    popupClassName="w-[32rem]"
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
                                            width: 260,
                                            cell: (vendor) => vendor.name,
                                        },
                                    ]}
                                    onCreate={
                                        permissions.create_vendor
                                            ? () => setCreatingVendor(true)
                                            : undefined
                                    }
                                />
                            ) : (
                                <Input
                                    label="Vendor"
                                    readOnly
                                    value={header.vendor?.name ?? ''}
                                />
                            )}
                        </FormControl>
                        <FormControl
                            error={error('location_id')}
                            data-error-field="location_id"
                            hint="Lokasi yang menerima barang saat datang."
                        >
                            {editable ? (
                                <InlineLookup<Location>
                                    label="Dikirim ke"
                                    required
                                    loadItems={locationLoader}
                                    value={
                                        header.location
                                            ? {
                                                  ...header.location,
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
                                        header.location
                                            ? label(header.location)
                                            : ''
                                    }
                                    onValueChange={(location) =>
                                        setHeader({
                                            ...header,
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
                                    popupClassName="w-[32rem]"
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
                                        {
                                            id: 'operating_unit',
                                            header: 'Unit',
                                            width: 160,
                                            cell: (location) =>
                                                location.operating_unit.name,
                                        },
                                    ]}
                                />
                            ) : (
                                <Input
                                    label="Dikirim ke"
                                    readOnly
                                    value={
                                        header.location
                                            ? label(header.location)
                                            : ''
                                    }
                                />
                            )}
                        </FormControl>
                        <FormControl error={error('order_date')}>
                            {editable ? (
                                <DatePicker
                                    label="Tanggal order"
                                    required
                                    data-error-field="order_date"
                                    value={header.order_date}
                                    portalContainer={portalContainer}
                                    onValueChange={(order_date) =>
                                        setHeader({ ...header, order_date })
                                    }
                                />
                            ) : (
                                <Input
                                    label="Tanggal order"
                                    readOnly
                                    value={displayDate(header.order_date)}
                                />
                            )}
                        </FormControl>
                        <FormControl
                            error={error('expected_receipt_date')}
                            hint="Tanggal barang diharapkan datang. Baris yang tanggalnya kosong mengikuti tanggal ini."
                        >
                            {editable ? (
                                <DatePicker
                                    label="Diharapkan datang"
                                    data-error-field="expected_receipt_date"
                                    value={header.expected_receipt_date}
                                    portalContainer={portalContainer}
                                    onValueChange={(expected_receipt_date) =>
                                        setHeader({
                                            ...header,
                                            expected_receipt_date,
                                        })
                                    }
                                />
                            ) : (
                                <Input
                                    label="Diharapkan datang"
                                    readOnly
                                    value={
                                        header.expected_receipt_date
                                            ? displayDate(
                                                  header.expected_receipt_date,
                                              )
                                            : ''
                                    }
                                />
                            )}
                        </FormControl>
                        <FormControl hint="Tandai bila harga dari vendor sudah termasuk PPN. Tanda ini ikut tercetak di order.">
                            <Field
                                orientation="horizontal"
                                className="w-auto"
                                data-error-field="prices_including_vat"
                            >
                                <Switch
                                    id={pricesIncludingVatId}
                                    checked={header.prices_including_vat}
                                    disabled={!editable}
                                    onCheckedChange={(checked) =>
                                        setHeader({
                                            ...header,
                                            prices_including_vat: checked,
                                        })
                                    }
                                />
                                <FieldLabel
                                    htmlFor={pricesIncludingVatId}
                                    className="font-normal"
                                >
                                    Harga vendor termasuk PPN
                                </FieldLabel>
                            </Field>
                        </FormControl>
                        <FormControl error={error('description')}>
                            <Input
                                label="Keterangan"
                                maxLength={200}
                                data-error-field="description"
                                value={header.description}
                                readOnly={!editable}
                                onChange={(event) =>
                                    setHeader({
                                        ...header,
                                        description: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                        {order && (
                            <FormControl>
                                <Input
                                    label="Status"
                                    readOnly
                                    value={
                                        purchaseOrderStatusLabels[order.status]
                                    }
                                />
                            </FormControl>
                        )}
                    </FormGrid>
                    <DocumentLines
                        title="Baris order"
                        data={lines.map((line, index) => ({ index, line }))}
                        getRowKey={(row) => row.line.key}
                        getRowLabel={(row) =>
                            row.line.item?.name ?? `Barang ${row.index + 1}`
                        }
                        showRowNumbers
                        readOnly={!editable}
                        disabled={busy}
                        portalContainer={portalContainer}
                        selection={
                            editable
                                ? {
                                      selectedKeys: selected,
                                      onSelectedKeysChange: (keys) =>
                                          setSelected(keys.map(String)),
                                  }
                                : undefined
                        }
                        onAddRow={editable ? () => addLines([null]) : undefined}
                        selectRecords={
                            editable
                                ? {
                                      noun: 'barang',
                                      loadItems: itemLoader,
                                      columns: itemColumns,
                                      getItemValue: (item) => item.id,
                                      getItemLabel: label,
                                      focusColumnId: 'quantity',
                                      onAdd: addLines,
                                  }
                                : undefined
                        }
                        onDeleteRows={
                            editable
                                ? (removed) =>
                                      setLines((current) =>
                                          current.filter(
                                              (line) =>
                                                  !removed.some(
                                                      (row) =>
                                                          row.line.key ===
                                                          line.key,
                                                  ),
                                          ),
                                      )
                                : undefined
                        }
                        emptyMessage={
                            editable
                                ? 'Belum ada barang. Pilih Tambah atau Tambah banyak untuk menambahkan barang yang dipesan.'
                                : 'Order ini tidak berisi barang.'
                        }
                        footer={
                            <p className="flex flex-wrap justify-end gap-x-6 text-sm">
                                <span>
                                    Subtotal{' '}
                                    {displayAmount(
                                        subtotal.normalized(),
                                        amountDecimals,
                                    )}
                                </span>
                                <span>
                                    PPN{' '}
                                    {displayAmount(
                                        vat.normalized(),
                                        amountDecimals,
                                    )}
                                </span>
                                <span>
                                    Total nilai{' '}
                                    <span className="font-semibold">
                                        {displayAmount(
                                            subtotal.plus(vat).normalized(),
                                            amountDecimals,
                                        )}
                                    </span>
                                </span>
                            </p>
                        }
                        columns={[
                            {
                                id: 'item_id',
                                header: 'Barang',
                                required: true,
                                content: control,
                                minWidth: 260,
                                cell: ({ index, line }) =>
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(index, 'item_id'),
                                            )}
                                            data-error-field={field(
                                                index,
                                                'item_id',
                                            )}
                                        >
                                            <InlineLookup<ItemChoice>
                                                label="Barang"
                                                required
                                                loadItems={itemLoader}
                                                value={line.item}
                                                displayValue={
                                                    line.item
                                                        ? label(line.item)
                                                        : ''
                                                }
                                                onValueChange={(item) =>
                                                    change(index, {
                                                        item,
                                                        unit: item.purchase_unit,
                                                    })
                                                }
                                                getItemValue={(item) => item.id}
                                                getItemLabel={label}
                                                placeholder="Cari kode atau nama barang…"
                                                emptyMessage="Barang tidak ditemukan."
                                                popupClassName="w-[36rem]"
                                                showDetails={false}
                                                columns={itemColumns}
                                            />
                                        </FormControl>
                                    ) : (
                                        text(line.item ? label(line.item) : '')
                                    ),
                            },
                            {
                                id: 'unit_id',
                                header: 'Satuan',
                                required: true,
                                content: control,
                                minWidth: 120,
                                cell: ({ index, line }) =>
                                    editable && line.item ? (
                                        <UnitLookup
                                            itemId={line.item.id}
                                            value={line.unit}
                                            field={field(index, 'unit_id')}
                                            error={error(
                                                field(index, 'unit_id'),
                                            )}
                                            onPick={(unit) =>
                                                change(index, { unit })
                                            }
                                        />
                                    ) : (
                                        text(
                                            unitText(
                                                line.unit,
                                                line.item?.base_unit.code ?? '',
                                            ),
                                        )
                                    ),
                            },
                            {
                                id: 'quantity',
                                header: 'Jumlah',
                                required: true,
                                content: control,
                                minWidth: 100,
                                align: 'right',
                                cell: ({ index, line }) =>
                                    editable
                                        ? numberInput(
                                              index,
                                              'quantity',
                                              'Jumlah',
                                              { required: true },
                                          )
                                        : text(displayNumber(line.quantity)),
                            },
                            {
                                id: 'unit_cost',
                                header: 'Harga satuan',
                                required: true,
                                content: control,
                                minWidth: 130,
                                align: 'right',
                                cell: ({ index, line }) =>
                                    editable
                                        ? numberInput(
                                              index,
                                              'unit_cost',
                                              'Harga satuan',
                                              { required: true },
                                          )
                                        : text(displayNumber(line.unit_cost)),
                            },
                            {
                                id: 'discount_percent',
                                header: 'Diskon %',
                                content: control,
                                minWidth: 90,
                                align: 'right',
                                cell: ({ index, line }) =>
                                    editable
                                        ? numberInput(
                                              index,
                                              'discount_percent',
                                              'Diskon %',
                                              { max: 100 },
                                          )
                                        : optionalNumber(line.discount_percent),
                            },
                            {
                                id: 'vat_percent',
                                header: 'PPN %',
                                content: control,
                                minWidth: 90,
                                align: 'right',
                                cell: ({ index, line }) =>
                                    editable
                                        ? numberInput(
                                              index,
                                              'vat_percent',
                                              'PPN %',
                                              { max: 100 },
                                          )
                                        : optionalNumber(line.vat_percent),
                            },
                            {
                                id: 'amount',
                                header: 'Nilai',
                                minWidth: 130,
                                align: 'right',
                                cell: ({ line }) =>
                                    text(
                                        displayAmount(
                                            amountOf(line).normalized(),
                                            amountDecimals,
                                        ),
                                    ),
                            },
                            {
                                id: 'expected_receipt_date',
                                header: 'Diharapkan datang',
                                content: control,
                                minWidth: 150,
                                cell: ({ index, line }) =>
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(
                                                    index,
                                                    'expected_receipt_date',
                                                ),
                                            )}
                                        >
                                            <DatePicker
                                                label="Diharapkan datang"
                                                data-error-field={field(
                                                    index,
                                                    'expected_receipt_date',
                                                )}
                                                value={
                                                    line.expected_receipt_date
                                                }
                                                onValueChange={(
                                                    expected_receipt_date,
                                                ) =>
                                                    change(index, {
                                                        expected_receipt_date,
                                                    })
                                                }
                                            />
                                        </FormControl>
                                    ) : (
                                        text(
                                            line.expected_receipt_date
                                                ? displayDate(
                                                      line.expected_receipt_date,
                                                  )
                                                : '',
                                        )
                                    ),
                            },
                        ]}
                    />
                </PageDialogBody>
                {confirmation}
            </form>
            {creatingVendor && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setCreatingVendor(false);
                    }}
                >
                    <PageDialogContent ref={vendorDialog} title="Vendor">
                        <VendorCard
                            vendor={null}
                            canManage
                            portalContainer={vendorDialog}
                            onSaved={(vendor) => {
                                setCreatingVendor(false);
                                setHeader((current) => ({
                                    ...current,
                                    vendor,
                                }));
                            }}
                            onClose={() => setCreatingVendor(false)}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}
