import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import {
    displayAmount,
    displayNumber,
} from '@operations-metta/ui/display-number';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { SelectRecordsDialog } from '@operations-metta/ui/select-records-dialog';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { CircleCheck, PackageSearch, Plus, Undo2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
    type ErrorAction,
} from '../../../platform/shell/index.ts';
import { Decimal } from '../../../platform/money/index.ts';
import {
    paymentTermsChoice,
    PaymentTermsLookup,
    paymentTermsText,
    type PaymentTermsChoice,
} from '../payment-terms/payment-terms-lookup.tsx';
import {
    amountOf,
    loadVendors,
    nextKey,
    today,
    totalsOf,
    useLoader,
} from '../purchase-lines.tsx';
import type { Vendor } from '../vendor/vendor-card.tsx';

export type PurchaseInvoice = ApiBody<'purchasingInvoiceShow'>['data'];
export type PurchaseInvoicePermissions =
    ApiBody<'purchasingInvoiceList'>['permissions'];
type ReceiptLine = ApiBody<'purchasingInvoiceReceiptLines'>['data'][number];
type Errors = Record<string, string[]>;

type Line = {
    key: string;
    id: string | null;
    kind: 'barang' | 'biaya';
    receipt_line_id: string | null;
    receipt_number: string;
    item: string;
    unit: string;
    description: string;
    quantity: string;
    unit_cost: string;
    discount_percent: string;
    vat_percent: string;
    receipt_unit_cost: string;
    receipt_discount_percent: string;
};
type Header = {
    vendor: { id: string; number: string; name: string } | null;
    vendor_invoice_number: string;
    document_date: string;
    posting_date: string;
    payment_terms: PaymentTermsChoice | null;
    due_date: string;
    description: string;
};

export const purchaseInvoiceStatusLabels: Record<
    PurchaseInvoice['status'],
    string
> = {
    draf: 'Draf',
    diposting: 'Diposting',
    dibatalkan: 'Dibatalkan',
};

function dueDateOf(documentDate: string, terms: PaymentTermsChoice | null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(documentDate)) return '';
    const date = new Date(`${documentDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + (terms?.due_days ?? 0));
    return date.toISOString().slice(0, 10);
}

function headerOf(invoice: PurchaseInvoice | null): Header {
    const documentDate = invoice?.document_date ?? today();
    return {
        vendor: invoice?.vendor ?? null,
        vendor_invoice_number: invoice?.vendor_invoice_number ?? '',
        document_date: documentDate,
        posting_date: invoice?.posting_date ?? today(),
        payment_terms: invoice?.payment_terms ?? null,
        due_date: invoice?.due_date ?? dueDateOf(documentDate, null),
        description: invoice?.description ?? '',
    };
}

function linesOf(invoice: PurchaseInvoice | null): Line[] {
    return (invoice?.lines ?? []).map((line) => ({
        key: line.id,
        id: line.id,
        kind: line.kind,
        receipt_line_id: line.receipt_line_id,
        receipt_number: line.receipt?.number ?? '',
        item: line.item ? `${line.item.code} - ${line.item.name}` : '',
        unit: line.unit?.code ?? '',
        description: line.description ?? '',
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        discount_percent: line.discount_percent,
        vat_percent: line.vat_percent,
        receipt_unit_cost: line.receipt_unit_cost ?? '',
        receipt_discount_percent: line.receipt_discount_percent ?? '',
    }));
}

function differenceOf(line: Line) {
    return amountOf(line).minus(
        amountOf({
            quantity: line.quantity,
            unit_cost: line.receipt_unit_cost,
            discount_percent: line.receipt_discount_percent,
            vat_percent: '0',
        }),
    );
}

// Kartu faktur pembelian (Purchase Invoice di BC). Barang diambil dari baris penerimaan yang sudah diposting dan belum
// difakturkan; harga, diskon, dan PPN mengikuti faktur vendor, dengan selisihnya terhadap penerimaan di kolom Selisih.
export function PurchaseInvoiceCard({
    invoice: initial,
    permissions,
    amountDecimals,
    portalContainer,
    onSaved,
    onClose,
}: {
    invoice: PurchaseInvoice | null;
    permissions: PurchaseInvoicePermissions;
    amountDecimals: number;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (invoice: PurchaseInvoice) => void;
    onClose: () => void;
}): ReactNode {
    const [invoice, setInvoice] = useState(initial);
    const editable =
        (invoice === null || invoice.status === 'draf') && permissions.update;
    const [header, setHeader] = useState(() => headerOf(initial));
    const [lines, setLines] = useState(() => linesOf(initial));
    const [selected, setSelected] = useState<string[]>([]);
    const [picking, setPicking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [errorActions, setErrorActions] = useState<readonly ErrorAction[]>(
        [],
    );
    const [message, setMessage] = useState<string | null>(null);
    const [operation, setOperation] = useState('Faktur belum disimpan');
    const { confirm, confirmation } = useConfirmation();
    const vendorLoader = useLoader(loadVendors);
    const pristine =
        JSON.stringify([header, lines]) ===
        JSON.stringify([headerOf(invoice), linesOf(invoice)]);
    usePageDialogRecord({
        recordTitle: invoice
            ? `${invoice.number} ${invoice.vendor.name}`
            : 'Faktur pembelian baru',
        editing: editable,
        dirty: !pristine,
    });

    const vendorId = header.vendor?.id ?? '';
    const invoiceId = invoice?.id;
    const receiptLineLoader = useCallback<LookupLoader<ReceiptLine>>(
        async ({ query, signal }) => {
            const { body } = await api.purchasingInvoiceReceiptLines(
                {
                    query: {
                        vendor_id: vendorId,
                        ...(invoiceId ? { invoice_id: invoiceId } : {}),
                    },
                },
                { signal },
            );
            const needle = query.trim().toLowerCase();
            return {
                items: body.data.filter(
                    (line) =>
                        !needle ||
                        [
                            line.receipt.number,
                            line.receipt.vendor_document_number ?? '',
                            line.item.code,
                            line.item.name,
                        ].some((value) => value.toLowerCase().includes(needle)),
                ),
                nextCursor: null,
            };
        },
        [vendorId, invoiceId],
    );

    const error = (field: string) => errors[field]?.join(' ');
    const field = (index: number, name: string) => `lines.${index}.${name}`;
    const change = (index: number, patch: Partial<Line>) =>
        setLines((current) =>
            current.map((line, at) =>
                at === index ? { ...line, ...patch } : line,
            ),
        );
    const { subtotal, vat } = totalsOf(lines, amountDecimals);

    const payload = () => ({
        vendor_id: header.vendor?.id ?? '',
        vendor_invoice_number: header.vendor_invoice_number,
        document_date: header.document_date,
        posting_date: header.posting_date,
        payment_terms_id: header.payment_terms?.id ?? null,
        due_date: header.due_date || null,
        description: header.description || null,
        lines: lines.map((line) => {
            const priced = {
                id: line.id,
                unit_cost: line.unit_cost,
                discount_percent: line.discount_percent || null,
                vat_percent: line.vat_percent || null,
            };
            return line.kind === 'barang'
                ? {
                      ...priced,
                      kind: line.kind,
                      receipt_line_id: line.receipt_line_id ?? '',
                      quantity: line.quantity,
                  }
                : { ...priced, kind: line.kind, description: line.description };
        }),
    });

    const failed = (caught: unknown, failure: string) => {
        setOperation(failure);
        if (caught instanceof ApiError && caught.status === 422) {
            setErrors(caught.errors);
            setErrorActions(caught.actions);
        } else setMessage(errorText(caught, failure + '.'));
    };

    const save = async (): Promise<PurchaseInvoice | null> => {
        setErrors({});
        setErrorActions([]);
        setMessage(null);
        try {
            const { body } = invoice
                ? await api.purchasingInvoiceUpdate({
                      params: { id: invoice.id },
                      body: { ...payload(), version: invoice.version },
                  })
                : await api.purchasingInvoiceCreate({ body: payload() });
            return body.data;
        } catch (caught) {
            failed(caught, 'Faktur belum disimpan');
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

    const adopt = (next: PurchaseInvoice) => {
        setInvoice(next);
        setHeader(headerOf(next));
        setLines(linesOf(next));
        setSelected([]);
        onSaved(next);
    };

    const submit = () =>
        run(async () => {
            const saved = await save();
            if (!saved) return;
            toast.success(invoice ? 'Faktur diperbarui.' : 'Faktur dibuat.');
            adopt(saved);
        });

    const post = async () => {
        if (
            !(await confirm({
                title: 'Posting faktur ini?',
                description:
                    'Utang ke vendor tercatat sebesar total faktur dengan jatuh tempo yang tertera, dan faktur tidak bisa diubah lagi.',
                confirmLabel: 'Posting',
            }))
        )
            return;
        await run(async () => {
            const saved = pristine && invoice ? invoice : await save();
            if (!saved) return;
            if (saved !== invoice) adopt(saved);
            try {
                const { body } = await api.purchasingInvoicePost({
                    params: { id: saved.id },
                    body: { version: saved.version },
                });
                toast.success(
                    `Faktur ${body.data.number} diposting. Utangnya tampil di Utang vendor.`,
                );
                adopt(body.data);
            } catch (caught) {
                failed(caught, 'Faktur belum diposting');
            }
        });
    };

    const reverse = async () => {
        if (!invoice) return;
        if (
            !(await confirm({
                title: `Batalkan posting ${invoice.number}?`,
                description:
                    'Utangnya ditutup, barang di penerimaan bisa difakturkan lagi, dan nomor faktur vendor bisa dicatat ulang.',
                confirmLabel: 'Batalkan posting',
                destructive: true,
            }))
        )
            return;
        await run(async () => {
            try {
                const { body } = await api.purchasingInvoiceReverse({
                    params: { id: invoice.id },
                    body: { version: invoice.version },
                });
                toast.success(`Posting faktur ${invoice.number} dibatalkan.`);
                adopt(body.data);
            } catch (caught) {
                failed(caught, 'Posting faktur belum dibatalkan');
            }
        });
    };

    const remove = async () => {
        if (!invoice) return;
        if (
            !(await confirm({
                title: `Delete faktur ${invoice.number}?`,
                description:
                    'Draf ini tidak tampil lagi di daftar faktur pembelian.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run(async () => {
            try {
                await api.purchasingInvoiceDelete({
                    params: { id: invoice.id },
                    body: { version: invoice.version },
                });
                toast.success('Faktur dihapus.');
                onClose();
            } catch (caught) {
                failed(caught, 'Faktur belum dihapus');
            }
        });
    };

    const takeReceiptLines = (chosen: ReceiptLine[]) =>
        setLines((current) => [
            ...current,
            ...chosen
                .filter(
                    (choice) =>
                        !current.some(
                            (line) =>
                                line.receipt_line_id === choice.receipt_line_id,
                        ),
                )
                .map((choice) => ({
                    key: nextKey(),
                    id: null,
                    kind: 'barang' as const,
                    receipt_line_id: choice.receipt_line_id,
                    receipt_number: choice.receipt.number,
                    item: `${choice.item.code} - ${choice.item.name}`,
                    unit: choice.unit.code,
                    description: '',
                    quantity: choice.open,
                    unit_cost: choice.unit_cost,
                    discount_percent: choice.discount_percent,
                    vat_percent: choice.vat_percent,
                    receipt_unit_cost: choice.unit_cost,
                    receipt_discount_percent: choice.discount_percent,
                })),
        ]);

    const addCost = () =>
        setLines((current) => [
            ...current,
            {
                key: nextKey(),
                id: null,
                kind: 'biaya',
                receipt_line_id: null,
                receipt_number: '',
                item: '',
                unit: '',
                description: '',
                quantity: '1',
                unit_cost: '',
                discount_percent: '',
                vat_percent: current.at(-1)?.vat_percent ?? '',
                receipt_unit_cost: '',
                receipt_discount_percent: '',
            },
        ]);

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
    const setDocument = (patch: Partial<Header>) => {
        const next = { ...header, ...patch };
        setHeader({
            ...next,
            due_date: dueDateOf(next.document_date, next.payment_terms),
        });
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
                                if (!invoice) {
                                    onClose();
                                    return;
                                }
                                setHeader(headerOf(invoice));
                                setLines(linesOf(invoice));
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
                        title="Catat utang ke vendor sebesar total faktur ini."
                        onClick={() => void post()}
                    >
                        <CircleCheck aria-hidden="true" />
                        Posting
                    </Button>
                )}
                {invoice?.status === 'diposting' && permissions.reverse && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="command"
                        disabled={busy}
                        title="Tutup utangnya dan kembalikan barangnya ke daftar yang belum difakturkan, selama belum dibayar."
                        onClick={() => void reverse()}
                    >
                        <Undo2 aria-hidden="true" />
                        Batal posting
                    </Button>
                )}
                {invoice && editable && (
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
                        error={error('vendor_id')}
                        data-error-field="vendor_id"
                        hint={
                            editable && lines.some((l) => l.kind === 'barang')
                                ? 'Mengganti vendor menghapus baris barang dari penerimaan vendor sebelumnya.'
                                : undefined
                        }
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
                                              payment_terms: null,
                                              status: 'active',
                                              version: 0,
                                          }
                                        : null
                                }
                                displayValue={header.vendor?.name ?? ''}
                                onValueChange={(vendor) => {
                                    if (vendor.id === header.vendor?.id) return;
                                    setDocument({
                                        vendor,
                                        payment_terms: vendor.payment_terms,
                                    });
                                    setLines((current) =>
                                        current.filter(
                                            (line) => line.kind === 'biaya',
                                        ),
                                    );
                                }}
                                getItemValue={(vendor) => vendor.id}
                                getItemLabel={(vendor) => vendor.name}
                                placeholder="Cari nomor atau nama vendor…"
                                emptyMessage="Vendor tidak ditemukan."
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
                        error={error('vendor_invoice_number')}
                        hint="Nomor yang tertulis di faktur dari vendor. Satu nomor hanya bisa dicatat sekali per vendor."
                    >
                        <Input
                            label="No. faktur vendor"
                            required
                            maxLength={35}
                            data-error-field="vendor_invoice_number"
                            value={header.vendor_invoice_number}
                            readOnly={!editable}
                            onChange={(event) =>
                                setHeader({
                                    ...header,
                                    vendor_invoice_number: event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    <FormControl
                        error={error('document_date')}
                        hint="Tanggal di faktur vendor. Jatuh tempo dihitung dari tanggal ini."
                    >
                        {editable ? (
                            <DatePicker
                                label="Tanggal faktur vendor"
                                required
                                data-error-field="document_date"
                                value={header.document_date}
                                portalContainer={portalContainer}
                                onValueChange={(document_date) =>
                                    setDocument({ document_date })
                                }
                            />
                        ) : (
                            <Input
                                label="Tanggal faktur vendor"
                                readOnly
                                value={displayDate(header.document_date)}
                            />
                        )}
                    </FormControl>
                    {editable ? (
                        <PaymentTermsLookup
                            label="Termin pembayaran"
                            field="payment_terms_id"
                            value={header.payment_terms}
                            onChange={(terms) =>
                                setDocument({
                                    payment_terms: paymentTermsChoice(terms),
                                })
                            }
                            error={error('payment_terms_id')}
                            hint="Diisi dari termin vendor. Mengganti termin menghitung ulang jatuh tempo."
                            portalContainer={portalContainer}
                        />
                    ) : (
                        <FormControl>
                            <Input
                                label="Termin pembayaran"
                                readOnly
                                value={paymentTermsText(header.payment_terms)}
                            />
                        </FormControl>
                    )}
                    <FormControl
                        error={error('due_date')}
                        hint="Tanggal faktur vendor ditambah hari termin. Boleh diubah bila vendor memberi tanggal lain."
                    >
                        {editable ? (
                            <DatePicker
                                label="Jatuh tempo"
                                required
                                data-error-field="due_date"
                                value={header.due_date}
                                portalContainer={portalContainer}
                                onValueChange={(due_date) =>
                                    setHeader({ ...header, due_date })
                                }
                            />
                        ) : (
                            <Input
                                label="Jatuh tempo"
                                readOnly
                                value={displayDate(header.due_date)}
                            />
                        )}
                    </FormControl>
                    <FormControl error={error('posting_date')}>
                        {editable ? (
                            <DatePicker
                                label="Tanggal posting"
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
                                label="Tanggal posting"
                                readOnly
                                value={displayDate(header.posting_date)}
                            />
                        )}
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
                    {invoice && (
                        <FormControl>
                            <Input
                                label="Status"
                                readOnly
                                value={
                                    purchaseInvoiceStatusLabels[invoice.status]
                                }
                            />
                        </FormControl>
                    )}
                </FormGrid>
                <div data-error-field="lines">
                    <DocumentLines
                        title="Baris faktur"
                        data={lines.map((line, index) => ({ index, line }))}
                        getRowKey={(row) => row.line.key}
                        getRowLabel={(row) =>
                            row.line.item ||
                            row.line.description ||
                            `Baris ${row.index + 1}`
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
                        toolbar={
                            editable && (
                                <>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="command"
                                        disabled={busy || !header.vendor}
                                        title={
                                            header.vendor
                                                ? 'Pilih barang yang sudah diterima dari vendor ini dan belum difakturkan.'
                                                : 'Pilih vendor lebih dulu.'
                                        }
                                        onClick={() => setPicking(true)}
                                    >
                                        <PackageSearch aria-hidden="true" />
                                        Ambil baris penerimaan
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="command"
                                        disabled={busy}
                                        title="Tambahkan biaya di luar barang, misalnya ongkos angkut."
                                        onClick={addCost}
                                    >
                                        <Plus aria-hidden="true" />
                                        Tambah biaya
                                    </Button>
                                </>
                            )
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
                                ? 'Belum ada baris. Pilih Ambil baris penerimaan untuk menagih barang yang sudah diterima.'
                                : 'Faktur ini tidak berisi baris.'
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
                                    Total faktur{' '}
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
                                id: 'receipt',
                                header: 'Penerimaan',
                                minWidth: 140,
                                cell: ({ line }) =>
                                    text(
                                        line.kind === 'barang'
                                            ? line.receipt_number
                                            : 'Biaya',
                                    ),
                            },
                            {
                                id: 'description',
                                header: 'Barang atau keterangan',
                                content: control,
                                minWidth: 260,
                                cell: ({ index, line }) =>
                                    line.kind === 'biaya' && editable ? (
                                        <FormControl
                                            error={error(
                                                field(index, 'description'),
                                            )}
                                        >
                                            <Input
                                                label="Keterangan biaya"
                                                required
                                                maxLength={200}
                                                data-error-field={field(
                                                    index,
                                                    'description',
                                                )}
                                                value={line.description}
                                                onChange={(event) =>
                                                    change(index, {
                                                        description:
                                                            event.target.value,
                                                    })
                                                }
                                            />
                                        </FormControl>
                                    ) : (
                                        <FormControl
                                            error={error(
                                                field(index, 'receipt_line_id'),
                                            )}
                                            data-error-field={field(
                                                index,
                                                'receipt_line_id',
                                            )}
                                        >
                                            {text(
                                                line.kind === 'barang'
                                                    ? line.item
                                                    : line.description,
                                            )}
                                        </FormControl>
                                    ),
                            },
                            {
                                id: 'quantity',
                                header: 'Jumlah',
                                content: control,
                                minWidth: 100,
                                align: 'right',
                                cell: ({ index, line }) =>
                                    editable && line.kind === 'barang'
                                        ? numberInput(
                                              index,
                                              'quantity',
                                              'Jumlah',
                                              { required: true },
                                          )
                                        : text(
                                              line.kind === 'barang'
                                                  ? `${displayNumber(line.quantity)} ${line.unit}`
                                                  : '',
                                          ),
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
                                              line.kind === 'biaya'
                                                  ? 'Nilai biaya'
                                                  : 'Harga satuan',
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
                                id: 'difference',
                                header: 'Selisih dari penerimaan',
                                minWidth: 150,
                                align: 'right',
                                cell: ({ line }) => {
                                    if (line.kind !== 'barang') return text('');
                                    const difference = differenceOf(line);
                                    return text(
                                        difference.compare(Decimal.of('0')) ===
                                            0
                                            ? ''
                                            : displayAmount(
                                                  difference.normalized(),
                                                  amountDecimals,
                                              ),
                                    );
                                },
                            },
                        ]}
                    />
                </div>
            </PageDialogBody>
            {confirmation}
            {picking && (
                <SelectRecordsDialog<ReceiptLine>
                    noun="baris penerimaan"
                    loadItems={receiptLineLoader}
                    getItemValue={(line) => line.receipt_line_id}
                    getItemLabel={(line) =>
                        `${line.receipt.number} ${line.item.name}`
                    }
                    columns={[
                        {
                            id: 'receipt',
                            header: 'Penerimaan',
                            width: 140,
                            cell: (line) => line.receipt.number,
                        },
                        {
                            id: 'date',
                            header: 'Tanggal',
                            width: 110,
                            cell: (line) =>
                                displayDate(line.receipt.posting_date),
                        },
                        {
                            id: 'vendor_document',
                            header: 'Dokumen vendor',
                            width: 140,
                            cell: (line) =>
                                line.receipt.vendor_document_number ?? '',
                        },
                        {
                            id: 'item',
                            header: 'Barang',
                            width: 240,
                            cell: (line) =>
                                `${line.item.code} - ${line.item.name}`,
                        },
                        {
                            id: 'open',
                            header: 'Belum difakturkan',
                            width: 140,
                            align: 'right',
                            cell: (line) =>
                                `${displayNumber(line.open)} ${line.unit.code}`,
                        },
                        {
                            id: 'unit_cost',
                            header: 'Harga terima',
                            width: 120,
                            align: 'right',
                            cell: (line) => displayNumber(line.unit_cost),
                        },
                    ]}
                    onConfirm={(chosen) => {
                        takeReceiptLines(chosen);
                        setPicking(false);
                    }}
                    onClose={() => setPicking(false)}
                />
            )}
        </form>
    );
}
