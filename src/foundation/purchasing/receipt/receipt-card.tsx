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
import { BookCheck, PackageMinus, Undo2 } from 'lucide-react';
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
    PurchaseReturnCard,
    PurchaseReturnsSection,
    useCanReturnToVendor,
} from '../purchase-return/purchase-returns.tsx';
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

export type Receipt = ApiBody<'purchasingReceiptShow'>['data'];
export type ReceiptPermissions =
    ApiBody<'purchasingReceiptList'>['permissions'];
type Location = ApiBody<'inventoryLocationList'>['data'][number];
type CodeEntry = ApiBody<'inventoryFundingSourceList'>['data'][number];
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
    batch_number: string;
    expiry_date: string;
    funding_source: Reference | null;
    procurement_program: Reference | null;
    budget_year: string;
    order_line_id: string | null;
    order_outstanding: string | null;
};
type Header = {
    vendor: { id: string; number: string; name: string } | null;
    location: Reference | null;
    posting_date: string;
    vendor_document_number: string;
    description: string;
    prices_including_vat: boolean;
};

const statusLabels: Record<Receipt['status'], string> = {
    draf: 'Draf',
    diposting: 'Diposting',
    dibatalkan: 'Dibatalkan',
};
function headerOf(receipt: Receipt | null): Header {
    return {
        vendor: receipt?.vendor ?? null,
        location: receipt?.location ?? null,
        posting_date: receipt?.posting_date ?? today(),
        vendor_document_number: receipt?.vendor_document_number ?? '',
        description: receipt?.description ?? '',
        prices_including_vat: receipt?.prices_including_vat ?? false,
    };
}

function linesOf(receipt: Receipt | null): Line[] {
    return (receipt?.lines ?? []).map((line) => ({
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
            batch_required: line.item.batch_required,
            expiry_required: line.item.expiry_required,
        },
        unit: { ...line.unit, quantity_per_unit: line.quantity_per_unit },
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        discount_percent: line.discount_percent,
        vat_percent: line.vat_percent,
        batch_number: line.batch_number ?? '',
        expiry_date: line.expiry_date ?? '',
        funding_source: line.funding_source,
        procurement_program: line.procurement_program,
        budget_year: line.budget_year === null ? '' : String(line.budget_year),
        order_line_id: line.order_line_id,
        order_outstanding: line.order_outstanding,
    }));
}

const loadFundingSources = async (
    query: { q: string; cursor?: string },
    signal: AbortSignal,
) => {
    const { body } = await api.inventoryFundingSourceList(
        { query },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};
const loadPrograms = async (
    query: { q: string; cursor?: string },
    signal: AbortSignal,
) => {
    const { body } = await api.inventoryProcurementProgramList(
        { query },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};

const codeColumns = [
    {
        id: 'code',
        header: 'Kode',
        width: 100,
        cell: (entry: Reference) => entry.code,
    },
    {
        id: 'name',
        header: 'Nama',
        width: 220,
        cell: (entry: Reference) => entry.name,
    },
];

// Dokumen penerimaan barang dari vendor: kepala dokumen lalu baris barang, seperti Purchase Order BC yang langsung
// diterima. Draf disimpan dengan Simpan; Posting menyimpan perubahan yang tertunda lebih dulu, lalu memposting.
export function ReceiptCard({
    receipt: initial,
    permissions,
    amountDecimals,
    portalContainer,
    onSaved,
    onClose,
}: {
    receipt: Receipt | null;
    permissions: ReceiptPermissions;
    amountDecimals: number;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (receipt: Receipt) => void;
    onClose: () => void;
}): ReactNode {
    // Dokumen yang tersimpan dipegang kartu sendiri, supaya kesalahan posting sesudah draf baru disimpan tetap terlihat.
    const [receipt, setReceipt] = useState(initial);
    const editable =
        (receipt === null || receipt.status === 'draf') && permissions.update;
    const [header, setHeader] = useState(() => headerOf(initial));
    const [lines, setLines] = useState(() => linesOf(initial));
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [errorActions, setErrorActions] = useState<readonly ErrorAction[]>(
        [],
    );
    const [message, setMessage] = useState<string | null>(null);
    const [operation, setOperation] = useState('Penerimaan belum disimpan');
    const [creatingVendor, setCreatingVendor] = useState(false);
    const vendorDialog = useRef<HTMLDivElement>(null);
    const posted = receipt?.status === 'diposting';
    const canReturn = useCanReturnToVendor(receipt?.id ?? '', posted);
    const [returning, setReturning] = useState(false);
    const returnDialog = useRef<HTMLDivElement>(null);
    const { confirm, confirmation } = useConfirmation();
    const vendorLoader = useLoader(loadVendors);
    const locationLoader = useLoader(loadLocations);
    const itemLoader = useLoader(loadItems);
    const fundingLoader = useLoader(loadFundingSources);
    const programLoader = useLoader(loadPrograms);
    const pristine =
        JSON.stringify([header, lines]) ===
        JSON.stringify([headerOf(receipt), linesOf(receipt)]);
    usePageDialogRecord({
        recordTitle: receipt
            ? `${receipt.number} ${receipt.vendor.name}`
            : 'Penerimaan baru',
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
    const showBatch = lines.some(
        (line) => line.item?.batch_required || line.batch_number,
    );
    const showExpiry = lines.some(
        (line) => line.item?.expiry_required || line.expiry_date,
    );
    const { subtotal, vat } = totalsOf(lines, amountDecimals);
    const pricesIncludingVatId = useId();

    const payload = () => ({
        vendor_id: header.vendor?.id ?? '',
        location_id: header.location?.id ?? '',
        posting_date: header.posting_date,
        vendor_document_number: header.vendor_document_number || null,
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
            batch_number: line.batch_number || null,
            expiry_date: line.expiry_date || null,
            funding_source_id: line.funding_source?.id ?? null,
            procurement_program_id: line.procurement_program?.id ?? null,
            budget_year: line.budget_year ? Number(line.budget_year) : null,
            order_line_id: line.order_line_id,
        })),
    });

    // Judul ringkasan kesalahan menyebut tindakan yang gagal: simpan, posting, batal posting, atau hapus.
    const failed = (caught: unknown, failure: string) => {
        setOperation(failure);
        if (caught instanceof ApiError && caught.status === 422) {
            setErrors(caught.errors);
            setErrorActions(caught.actions);
        } else setMessage(errorText(caught, failure + '.'));
    };

    const save = async (): Promise<Receipt | null> => {
        setErrors({});
        setErrorActions([]);
        setMessage(null);
        try {
            const { body } = receipt
                ? await api.purchasingReceiptUpdate({
                      params: { id: receipt.id },
                      body: { ...payload(), version: receipt.version },
                  })
                : await api.purchasingReceiptCreate({ body: payload() });
            return body.data;
        } catch (caught) {
            failed(caught, 'Penerimaan belum disimpan');
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

    const adopt = (next: Receipt) => {
        setReceipt(next);
        setHeader(headerOf(next));
        setLines(linesOf(next));
        setSelected([]);
        onSaved(next);
    };

    const submit = () =>
        run(async () => {
            const saved = await save();
            if (!saved) return;
            toast.success(
                receipt ? 'Penerimaan diperbarui.' : 'Penerimaan dibuat.',
            );
            adopt(saved);
        });

    const post = async () => {
        if (
            !(await confirm({
                title: 'Posting penerimaan ini?',
                description: `Stok barang di ${header.location?.name ?? 'lokasi tujuan'} bertambah sesuai baris dokumen. Sesudah diposting, dokumen tidak bisa diubah lagi.`,
                confirmLabel: 'Posting',
            }))
        )
            return;
        await run(async () => {
            const saved = pristine && receipt ? receipt : await save();
            if (!saved) return;
            if (saved !== receipt) adopt(saved);
            try {
                const { body } = await api.purchasingReceiptPost({
                    params: { id: saved.id },
                    body: { version: saved.version },
                });
                toast.success(`Penerimaan ${body.data.number} diposting.`);
                adopt(body.data);
            } catch (caught) {
                failed(caught, 'Penerimaan belum diposting');
            }
        });
    };

    const reverse = async () => {
        if (!receipt) return;
        if (
            !(await confirm({
                title: `Batalkan posting ${receipt.number}?`,
                description:
                    'Stok yang masuk lewat dokumen ini dikeluarkan lagi. Pembatalan ditolak bila sebagian stoknya sudah dipakai.',
                confirmLabel: 'Batalkan posting',
                destructive: true,
            }))
        )
            return;
        await run(async () => {
            try {
                const { body } = await api.purchasingReceiptReverse({
                    params: { id: receipt.id },
                    body: { version: receipt.version },
                });
                toast.success(`Posting ${receipt.number} dibatalkan.`);
                adopt(body.data);
            } catch (caught) {
                failed(caught, 'Posting belum dibatalkan');
            }
        });
    };

    const remove = async () => {
        if (!receipt) return;
        if (
            !(await confirm({
                title: `Delete draf ${receipt.number}?`,
                description:
                    'Draf ini tidak tampil lagi di daftar penerimaan. Stok tidak berubah karena draf belum diposting.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run(async () => {
            try {
                await api.purchasingReceiptDelete({
                    params: { id: receipt.id },
                    body: { version: receipt.version },
                });
                toast.success('Draf penerimaan dihapus.');
                onClose();
            } catch (caught) {
                failed(caught, 'Draf belum dihapus');
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
                    batch_number: '',
                    expiry_date: '',
                    // Satu penerimaan biasanya satu PPN %, sumber dana, dan program (layar lama mengisi PPN sekali
                    // untuk semua baris), jadi baris baru meneruskan isian baris sebelumnya; tetap bisa diganti per baris.
                    vat_percent: previous?.vat_percent ?? '',
                    funding_source: previous?.funding_source ?? null,
                    procurement_program: previous?.procurement_program ?? null,
                    budget_year: previous?.budget_year ?? '',
                    order_line_id: null,
                    order_outstanding: null,
                })),
            ];
        });

    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    const control = editable ? ('control' as const) : ('text' as const);
    // Penerimaan dari purchase order: vendor, lokasi, dan barangnya milik order; petugas hanya mengubah jumlah yang
    // datang, batch, kedaluwarsa, dan sumber dana, atau menghapus baris yang belum datang.
    const fromOrder = Boolean(receipt?.order);

    // Kartu vendor baru berada di luar form dokumen: event submit dari portal ikut naik ke induk React-nya.
    return (
        <>
            <form
                noValidate
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(event) => {
                    event.preventDefault();
                    // Retur ke vendor tampil di dalam form ini; submit dari tombol atau dialognya tidak menyimpan
                    // penerimaan yang sudah diposting.
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
                                    if (!receipt) {
                                        onClose();
                                        return;
                                    }
                                    setHeader(headerOf(receipt));
                                    setLines(linesOf(receipt));
                                    setErrors({});
                                    setErrorActions([]);
                                    setMessage(null);
                                }}
                            />
                        </>
                    )}
                    {editable && permissions.post && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            onClick={() => void post()}
                        >
                            <BookCheck aria-hidden="true" />
                            Posting
                        </Button>
                    )}
                    {posted && canReturn && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            title="Kembalikan sebagian barang penerimaan ini ke vendor; stoknya keluar dari lokasi penerimaan."
                            onClick={() => setReturning(true)}
                        >
                            <PackageMinus aria-hidden="true" />
                            Retur ke vendor
                        </Button>
                    )}
                    {posted && permissions.reverse && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            onClick={() => void reverse()}
                        >
                            <Undo2 aria-hidden="true" />
                            Batal posting
                        </Button>
                    )}
                    {receipt && editable && (
                        <ActionButton
                            action="archive"
                            disabled={busy}
                            onClick={() => void remove()}
                        />
                    )}
                    {receipt && (
                        <PrintAction
                            report="core.purchase-receipt"
                            recordId={receipt.id}
                            label="Penerimaan"
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
                            {editable && !fromOrder ? (
                                <InlineLookup<Vendor>
                                    label="Vendor"
                                    required
                                    loadItems={vendorLoader}
                                    value={
                                        header.vendor
                                            ? {
                                                  ...header.vendor,
                                                  tax_number: null,
                                                  payment_terms: null,
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
                        >
                            {editable && !fromOrder ? (
                                <InlineLookup<Location>
                                    label="Lokasi tujuan"
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
                                    label="Lokasi tujuan"
                                    readOnly
                                    value={
                                        header.location
                                            ? label(header.location)
                                            : ''
                                    }
                                />
                            )}
                        </FormControl>
                        <FormControl error={error('posting_date')}>
                            {editable ? (
                                <DatePicker
                                    label="Tanggal terima"
                                    required
                                    data-error-field="posting_date"
                                    value={header.posting_date}
                                    portalContainer={portalContainer}
                                    onValueChange={(posting_date) =>
                                        setHeader({ ...header, posting_date })
                                    }
                                />
                            ) : (
                                <Input
                                    label="Tanggal terima"
                                    readOnly
                                    value={displayDate(header.posting_date)}
                                />
                            )}
                        </FormControl>
                        <FormControl
                            error={error('vendor_document_number')}
                            hint="Nomor faktur, surat jalan, atau surat bukti barang keluar dari vendor."
                        >
                            <Input
                                label="Nomor dokumen vendor"
                                maxLength={50}
                                data-error-field="vendor_document_number"
                                value={header.vendor_document_number}
                                readOnly={!editable}
                                onChange={(event) =>
                                    setHeader({
                                        ...header,
                                        vendor_document_number:
                                            event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                        <FormControl
                            error={error('prices_including_vat')}
                            hint="Tandai bila harga dari vendor sudah termasuk PPN. Tanda ini dicatat untuk pembukuan pajak dan tidak mengubah harga dasar barang maupun nilai PPN dokumen."
                        >
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
                        {receipt?.order && (
                            <FormControl hint="Barang di penerimaan ini datang dari purchase order ini. Jumlah yang diposting menambah jumlah diterima di ordernya.">
                                <Input
                                    label="Purchase order"
                                    readOnly
                                    value={receipt.order.number}
                                />
                            </FormControl>
                        )}
                        {receipt && (
                            <FormControl>
                                <Input
                                    label="Status"
                                    readOnly
                                    value={statusLabels[receipt.status]}
                                />
                            </FormControl>
                        )}
                    </FormGrid>
                    <DocumentLines
                        title="Baris penerimaan"
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
                        onAddRow={
                            editable && !fromOrder
                                ? () => addLines([null])
                                : undefined
                        }
                        selectRecords={
                            editable && !fromOrder
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
                                ? 'Belum ada barang. Pilih Tambah atau Tambah banyak untuk menambahkan barang yang diterima.'
                                : 'Dokumen ini tidak berisi barang.'
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
                                    editable && !line.order_line_id ? (
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
                                    editable &&
                                    line.item &&
                                    !line.order_line_id ? (
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
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(index, 'quantity'),
                                            )}
                                        >
                                            <Input
                                                label="Jumlah"
                                                required
                                                type="number"
                                                min={0}
                                                step="any"
                                                inputMode="decimal"
                                                data-error-field={field(
                                                    index,
                                                    'quantity',
                                                )}
                                                value={line.quantity}
                                                onChange={(event) =>
                                                    change(index, {
                                                        quantity:
                                                            event.target.value,
                                                    })
                                                }
                                            />
                                        </FormControl>
                                    ) : (
                                        text(displayNumber(line.quantity))
                                    ),
                            },
                            ...(fromOrder
                                ? [
                                      {
                                          id: 'order_outstanding',
                                          header: 'Sisa order',
                                          minWidth: 110,
                                          align: 'right' as const,
                                          cell: ({ line }: { line: Line }) =>
                                              text(
                                                  line.order_outstanding
                                                      ? displayNumber(
                                                            line.order_outstanding,
                                                        )
                                                      : '',
                                              ),
                                      },
                                  ]
                                : []),
                            {
                                id: 'unit_cost',
                                header: 'Harga satuan',
                                required: true,
                                content: control,
                                minWidth: 130,
                                align: 'right',
                                cell: ({ index, line }) =>
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(index, 'unit_cost'),
                                            )}
                                        >
                                            <Input
                                                label="Harga satuan"
                                                required
                                                type="number"
                                                min={0}
                                                step="any"
                                                inputMode="decimal"
                                                data-error-field={field(
                                                    index,
                                                    'unit_cost',
                                                )}
                                                value={line.unit_cost}
                                                onChange={(event) =>
                                                    change(index, {
                                                        unit_cost:
                                                            event.target.value,
                                                    })
                                                }
                                            />
                                        </FormControl>
                                    ) : (
                                        text(displayNumber(line.unit_cost))
                                    ),
                            },
                            {
                                id: 'discount_percent',
                                header: 'Diskon %',
                                content: control,
                                minWidth: 90,
                                align: 'right',
                                cell: ({ index, line }) =>
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(
                                                    index,
                                                    'discount_percent',
                                                ),
                                            )}
                                        >
                                            <Input
                                                label="Diskon %"
                                                type="number"
                                                min={0}
                                                max={100}
                                                step="any"
                                                inputMode="decimal"
                                                data-error-field={field(
                                                    index,
                                                    'discount_percent',
                                                )}
                                                value={line.discount_percent}
                                                onChange={(event) =>
                                                    change(index, {
                                                        discount_percent:
                                                            event.target.value,
                                                    })
                                                }
                                            />
                                        </FormControl>
                                    ) : (
                                        text(
                                            Number(line.discount_percent)
                                                ? displayNumber(
                                                      line.discount_percent,
                                                  )
                                                : '',
                                        )
                                    ),
                            },
                            {
                                id: 'vat_percent',
                                header: 'PPN %',
                                content: control,
                                minWidth: 90,
                                align: 'right',
                                cell: ({ index, line }) =>
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(index, 'vat_percent'),
                                            )}
                                        >
                                            <Input
                                                label="PPN %"
                                                type="number"
                                                min={0}
                                                max={100}
                                                step="any"
                                                inputMode="decimal"
                                                data-error-field={field(
                                                    index,
                                                    'vat_percent',
                                                )}
                                                value={line.vat_percent}
                                                onChange={(event) =>
                                                    change(index, {
                                                        vat_percent:
                                                            event.target.value,
                                                    })
                                                }
                                            />
                                        </FormControl>
                                    ) : (
                                        text(
                                            Number(line.vat_percent)
                                                ? displayNumber(
                                                      line.vat_percent,
                                                  )
                                                : '',
                                        )
                                    ),
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
                            ...(showBatch
                                ? [
                                      {
                                          id: 'batch_number',
                                          header: 'No. batch',
                                          content: control,
                                          minWidth: 140,
                                          cell: ({
                                              index,
                                              line,
                                          }: {
                                              index: number;
                                              line: Line;
                                          }) =>
                                              editable ? (
                                                  <FormControl
                                                      error={error(
                                                          field(
                                                              index,
                                                              'batch_number',
                                                          ),
                                                      )}
                                                  >
                                                      <Input
                                                          label="No. batch"
                                                          required={
                                                              line.item
                                                                  ?.batch_required
                                                          }
                                                          maxLength={50}
                                                          data-error-field={field(
                                                              index,
                                                              'batch_number',
                                                          )}
                                                          value={
                                                              line.batch_number
                                                          }
                                                          onChange={(event) =>
                                                              change(index, {
                                                                  batch_number:
                                                                      event
                                                                          .target
                                                                          .value,
                                                              })
                                                          }
                                                      />
                                                  </FormControl>
                                              ) : (
                                                  text(line.batch_number)
                                              ),
                                      },
                                  ]
                                : []),
                            ...(showExpiry
                                ? [
                                      {
                                          id: 'expiry_date',
                                          header: 'Kedaluwarsa',
                                          content: control,
                                          minWidth: 150,
                                          cell: ({
                                              index,
                                              line,
                                          }: {
                                              index: number;
                                              line: Line;
                                          }) =>
                                              editable ? (
                                                  <FormControl
                                                      error={error(
                                                          field(
                                                              index,
                                                              'expiry_date',
                                                          ),
                                                      )}
                                                  >
                                                      <DatePicker
                                                          label="Kedaluwarsa"
                                                          required={
                                                              line.item
                                                                  ?.expiry_required
                                                          }
                                                          data-error-field={field(
                                                              index,
                                                              'expiry_date',
                                                          )}
                                                          value={
                                                              line.expiry_date
                                                          }
                                                          onValueChange={(
                                                              expiry_date,
                                                          ) =>
                                                              change(index, {
                                                                  expiry_date,
                                                              })
                                                          }
                                                      />
                                                  </FormControl>
                                              ) : (
                                                  text(
                                                      line.expiry_date
                                                          ? displayDate(
                                                                line.expiry_date,
                                                            )
                                                          : '',
                                                  )
                                              ),
                                      },
                                  ]
                                : []),
                            {
                                id: 'funding_source_id',
                                header: 'Sumber dana',
                                content: control,
                                minWidth: 160,
                                cell: ({ index, line }) =>
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(
                                                    index,
                                                    'funding_source_id',
                                                ),
                                            )}
                                            data-error-field={field(
                                                index,
                                                'funding_source_id',
                                            )}
                                        >
                                            <InlineLookup<CodeEntry>
                                                label="Sumber dana"
                                                loadItems={fundingLoader}
                                                value={
                                                    line.funding_source
                                                        ? {
                                                              ...line.funding_source,
                                                              version: 0,
                                                          }
                                                        : null
                                                }
                                                displayValue={
                                                    line.funding_source?.code ??
                                                    ''
                                                }
                                                onValueChange={(entry) =>
                                                    change(index, {
                                                        funding_source: entry,
                                                    })
                                                }
                                                getItemValue={(entry) =>
                                                    entry.id
                                                }
                                                getItemLabel={(entry) =>
                                                    entry.code
                                                }
                                                emptyMessage="Sumber dana tidak ditemukan."
                                                showDetails={false}
                                                columns={codeColumns}
                                            />
                                        </FormControl>
                                    ) : (
                                        text(line.funding_source?.code ?? '')
                                    ),
                            },
                            {
                                id: 'procurement_program_id',
                                header: 'Program',
                                content: control,
                                minWidth: 160,
                                cell: ({ index, line }) =>
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(
                                                    index,
                                                    'procurement_program_id',
                                                ),
                                            )}
                                            data-error-field={field(
                                                index,
                                                'procurement_program_id',
                                            )}
                                        >
                                            <InlineLookup<CodeEntry>
                                                label="Program"
                                                loadItems={programLoader}
                                                value={
                                                    line.procurement_program
                                                        ? {
                                                              ...line.procurement_program,
                                                              version: 0,
                                                          }
                                                        : null
                                                }
                                                displayValue={
                                                    line.procurement_program
                                                        ?.code ?? ''
                                                }
                                                onValueChange={(entry) =>
                                                    change(index, {
                                                        procurement_program:
                                                            entry,
                                                    })
                                                }
                                                getItemValue={(entry) =>
                                                    entry.id
                                                }
                                                getItemLabel={(entry) =>
                                                    entry.code
                                                }
                                                emptyMessage="Program tidak ditemukan."
                                                showDetails={false}
                                                columns={codeColumns}
                                            />
                                        </FormControl>
                                    ) : (
                                        text(
                                            line.procurement_program?.code ??
                                                '',
                                        )
                                    ),
                            },
                            {
                                id: 'budget_year',
                                header: 'Tahun anggaran',
                                content: control,
                                minWidth: 110,
                                cell: ({ index, line }) =>
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(index, 'budget_year'),
                                            )}
                                        >
                                            <Input
                                                label="Tahun anggaran"
                                                type="number"
                                                min={1900}
                                                max={2999}
                                                step={1}
                                                inputMode="numeric"
                                                data-error-field={field(
                                                    index,
                                                    'budget_year',
                                                )}
                                                value={line.budget_year}
                                                onChange={(event) =>
                                                    change(index, {
                                                        budget_year:
                                                            event.target.value,
                                                    })
                                                }
                                            />
                                        </FormControl>
                                    ) : (
                                        text(line.budget_year)
                                    ),
                            },
                        ]}
                    />
                    {receipt && receipt.status !== 'draf' && (
                        <PurchaseReturnsSection receiptId={receipt.id} />
                    )}
                </PageDialogBody>
                {confirmation}
            </form>
            {returning && receipt && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setReturning(false);
                    }}
                >
                    <PageDialogContent
                        ref={returnDialog}
                        title="Retur ke vendor"
                    >
                        <PurchaseReturnCard
                            receiptId={receipt.id}
                            onDone={() => setReturning(false)}
                            portalContainer={returnDialog}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
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
