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
import { Select } from '@operations-metta/ui/select';
import { SelectRecordsDialog } from '@operations-metta/ui/select-records-dialog';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery } from '@tanstack/react-query';
import {
    CircleCheck,
    PackageSearch,
    TicketPercent,
    Undo2,
    Unlink,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
    type ApiBody,
    type ErrorAction,
} from '../../../platform/shell/index.ts';
import type { AmountDecimals } from '../../currency/index.ts';
import { documentTotals, lineAmount } from '../purchase-line.amounts.ts';
import { loadVendors, nextKey, today, useLoader } from '../purchase-lines.tsx';
import type { Vendor } from '../vendor/vendor-card.tsx';
import { CreditMemoUnapplyDialog } from './credit-memo-unapply-dialog.tsx';

export type PurchaseCreditMemo = ApiBody<'purchasingCreditMemoShow'>['data'];
export type PurchaseCreditMemoPermissions =
    ApiBody<'purchasingCreditMemoList'>['permissions'];
type ReturnLine = ApiBody<'purchasingCreditMemoReturnLines'>['data'][number];
type InvoiceLine = ApiBody<'purchasingCreditMemoInvoiceLines'>['data'][number];
type Errors = Record<string, string[]>;

type Line = {
    key: string;
    id: string | null;
    kind: 'retur' | 'potongan';
    source_id: string;
    source_number: string;
    item: string;
    unit: string;
    description: string;
    quantity: string;
    unit_cost: string;
    discount_percent: string;
    vat_percent: string;
};
type Header = {
    vendor: { id: string; number: string; name: string } | null;
    vendor_credit_memo_number: string;
    document_date: string;
    posting_date: string;
    applies_to_entry_id: string;
    description: string;
};

export const purchaseCreditMemoStatusLabels: Record<
    PurchaseCreditMemo['status'],
    string
> = {
    draf: 'Draf',
    diposting: 'Diposting',
    dibatalkan: 'Dibatalkan',
};

function headerOf(memo: PurchaseCreditMemo | null): Header {
    return {
        vendor: memo?.vendor ?? null,
        vendor_credit_memo_number: memo?.vendor_credit_memo_number ?? '',
        document_date: memo?.document_date ?? today(),
        posting_date: memo?.posting_date ?? today(),
        applies_to_entry_id: memo?.applies_to?.id ?? '',
        description: memo?.description ?? '',
    };
}

function linesOf(memo: PurchaseCreditMemo | null): Line[] {
    return (memo?.lines ?? []).map((line) => ({
        key: line.id,
        id: line.id,
        kind: line.kind,
        source_id: line.return_line_id ?? line.invoice_line_id ?? '',
        source_number: (line.return ?? line.invoice)?.number ?? '',
        item: line.item ? `${line.item.code} - ${line.item.name}` : '',
        unit: line.unit?.code ?? '',
        description: line.description ?? '',
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        discount_percent: line.discount_percent,
        vat_percent: line.vat_percent,
    }));
}

// Purchase Credit Memo di BC. Kurangi utang faktur adalah Applies-to Doc. No.
export function PurchaseCreditMemoCard({
    creditMemo: initial,
    permissions,
    amountDecimals,
    portalContainer,
    onSaved,
    onClose,
}: {
    creditMemo: PurchaseCreditMemo | null;
    permissions: PurchaseCreditMemoPermissions;
    amountDecimals: AmountDecimals;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (memo: PurchaseCreditMemo) => void;
    onClose: () => void;
}): ReactNode {
    const [memo, setMemo] = useState(initial);
    const editable =
        (memo === null || memo.status === 'draf') && permissions.update;
    const [header, setHeader] = useState(() => headerOf(initial));
    const [lines, setLines] = useState(() => linesOf(initial));
    const [selected, setSelected] = useState<string[]>([]);
    const [picking, setPicking] = useState<'retur' | 'potongan' | null>(null);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [errorActions, setErrorActions] = useState<readonly ErrorAction[]>(
        [],
    );
    const [message, setMessage] = useState<string | null>(null);
    const [operation, setOperation] = useState('Nota kredit belum disimpan');
    const { confirm, confirmation } = useConfirmation();
    const [unapplying, setUnapplying] = useState(false);
    const vendorLoader = useLoader(loadVendors);
    const pristine =
        JSON.stringify([header, lines]) ===
        JSON.stringify([headerOf(memo), linesOf(memo)]);
    usePageDialogRecord({
        recordTitle: memo
            ? `${memo.number} ${memo.vendor.name}`
            : 'Nota kredit pembelian baru',
        editing: editable,
        dirty: !pristine,
    });

    const vendorId = header.vendor?.id ?? '';
    const memoId = memo?.id;
    const { data: openInvoices } = useQuery({
        ...orpc.purchasingCreditMemoInvoiceEntries.queryOptions({
            input: { query: { vendor_id: vendorId } },
            select: (response) => response.body.data,
        }),
        enabled: editable && vendorId !== '',
    });
    const returnLineLoader = useCallback<LookupLoader<ReturnLine>>(
        async ({ query, signal }) => {
            const { body } = await api.purchasingCreditMemoReturnLines(
                {
                    query: {
                        vendor_id: vendorId,
                        ...(memoId ? { credit_memo_id: memoId } : {}),
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
                            line.return.number,
                            line.receipt.number,
                            line.item.code,
                            line.item.name,
                        ].some((value) => value.toLowerCase().includes(needle)),
                ),
                nextCursor: null,
            };
        },
        [vendorId, memoId],
    );
    const invoiceLineLoader = useCallback<LookupLoader<InvoiceLine>>(
        async ({ query, signal }) => {
            const { body } = await api.purchasingCreditMemoInvoiceLines(
                { query: { vendor_id: vendorId } },
                { signal },
            );
            const needle = query.trim().toLowerCase();
            return {
                items: body.data.filter(
                    (line) =>
                        !needle ||
                        [
                            line.invoice.number,
                            line.invoice.vendor_invoice_number,
                            line.description,
                        ].some((value) => value.toLowerCase().includes(needle)),
                ),
                nextCursor: null,
            };
        },
        [vendorId],
    );

    const error = (field: string) => errors[field]?.join(' ');
    const field = (index: number, name: string) => `lines.${index}.${name}`;
    const change = (index: number, patch: Partial<Line>) =>
        setLines((current) =>
            current.map((line, at) =>
                at === index ? { ...line, ...patch } : line,
            ),
        );
    const { subtotal, vat } = documentTotals(lines, amountDecimals);

    const payload = () => ({
        vendor_id: vendorId,
        vendor_credit_memo_number: header.vendor_credit_memo_number,
        document_date: header.document_date,
        posting_date: header.posting_date,
        applies_to_entry_id: header.applies_to_entry_id || null,
        description: header.description || null,
        lines: lines.map((line) => {
            const priced = {
                id: line.id,
                quantity: line.quantity,
                unit_cost: line.unit_cost,
                discount_percent: line.discount_percent || null,
                vat_percent: line.vat_percent || null,
            };
            return line.kind === 'retur'
                ? { ...priced, kind: line.kind, return_line_id: line.source_id }
                : {
                      ...priced,
                      kind: line.kind,
                      invoice_line_id: line.source_id,
                      description: line.description,
                  };
        }),
    });

    const failed = (caught: unknown, failure: string) => {
        setOperation(failure);
        if (caught instanceof ApiError && caught.status === 422) {
            setErrors(caught.errors);
            setErrorActions(caught.actions);
        } else setMessage(errorText(caught, failure + '.'));
    };

    const save = async (): Promise<PurchaseCreditMemo | null> => {
        setErrors({});
        setErrorActions([]);
        setMessage(null);
        try {
            const { body } = memo
                ? await api.purchasingCreditMemoUpdate({
                      params: { id: memo.id },
                      body: { ...payload(), version: memo.version },
                  })
                : await api.purchasingCreditMemoCreate({ body: payload() });
            return body.data;
        } catch (caught) {
            failed(caught, 'Nota kredit belum disimpan');
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

    const adopt = (next: PurchaseCreditMemo) => {
        setMemo(next);
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
                memo ? 'Nota kredit diperbarui.' : 'Nota kredit dibuat.',
            );
            adopt(saved);
        });

    const post = async () => {
        if (
            !(await confirm({
                title: 'Posting nota kredit ini?',
                description: header.applies_to_entry_id
                    ? 'Utang faktur yang dipilih langsung berkurang sebesar total nota, dan nota tidak bisa diubah lagi.'
                    : 'Kredit dari vendor tercatat dan bisa dipakai saat membayar vendor ini, dan nota tidak bisa diubah lagi.',
                confirmLabel: 'Posting',
            }))
        )
            return;
        await run(async () => {
            const saved = pristine && memo ? memo : await save();
            if (!saved) return;
            if (saved !== memo) adopt(saved);
            try {
                const { body } = await api.purchasingCreditMemoPost({
                    params: { id: saved.id },
                    body: { version: saved.version },
                });
                toast.success(
                    `Nota kredit ${body.data.number} diposting. Kreditnya tampil di Utang vendor.`,
                );
                adopt(body.data);
            } catch (caught) {
                failed(caught, 'Nota kredit belum diposting');
            }
        });
    };

    const reverse = async () => {
        if (!memo) return;
        if (
            !(await confirm({
                title: `Batalkan posting ${memo.number}?`,
                description:
                    'Kreditnya ditutup dan barang retur bisa dikreditkan lagi. Nomor nota vendor tetap tercatat.',
                confirmLabel: 'Batalkan posting',
                destructive: true,
            }))
        )
            return;
        await run(async () => {
            try {
                const { body } = await api.purchasingCreditMemoReverse({
                    params: { id: memo.id },
                    body: { version: memo.version },
                });
                toast.success(`Posting nota kredit ${memo.number} dibatalkan.`);
                adopt(body.data);
            } catch (caught) {
                failed(caught, 'Posting nota kredit belum dibatalkan');
            }
        });
    };

    const remove = async () => {
        if (!memo) return;
        if (
            !(await confirm({
                title: `Delete nota kredit ${memo.number}?`,
                description:
                    'Draf ini tidak tampil lagi di daftar nota kredit pembelian.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run(async () => {
            try {
                await api.purchasingCreditMemoDelete({
                    params: { id: memo.id },
                    body: { version: memo.version },
                });
                toast.success('Nota kredit dihapus.');
                onClose();
            } catch (caught) {
                failed(caught, 'Nota kredit belum dihapus');
            }
        });
    };

    const takeReturnLines = (chosen: ReturnLine[]) =>
        setLines((current) => [
            ...current,
            ...chosen
                .filter(
                    (choice) =>
                        !current.some(
                            (line) =>
                                line.kind === 'retur' &&
                                line.source_id === choice.return_line_id,
                        ),
                )
                .map((choice) => ({
                    key: nextKey(),
                    id: null,
                    kind: 'retur' as const,
                    source_id: choice.return_line_id,
                    source_number: choice.return.number,
                    item: `${choice.item.code} - ${choice.item.name}`,
                    unit: choice.unit.code,
                    description: '',
                    quantity: choice.open,
                    unit_cost: choice.unit_cost,
                    discount_percent: choice.discount_percent,
                    vat_percent: choice.vat_percent,
                })),
        ]);

    const takeInvoiceLines = (chosen: InvoiceLine[]) =>
        setLines((current) => [
            ...current,
            ...chosen.map((choice) => ({
                key: nextKey(),
                id: null,
                kind: 'potongan' as const,
                source_id: choice.invoice_line_id,
                source_number: choice.invoice.number,
                item: choice.description,
                unit: choice.unit?.code ?? '',
                description: 'Potongan harga',
                quantity: choice.quantity,
                unit_cost: '',
                discount_percent: '',
                vat_percent: choice.vat_percent,
            })),
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
    const appliesToText = memo?.applies_to
        ? `${memo.applies_to.document_number} · ${memo.applies_to.vendor_invoice_number}${memo.applies_to.unapplied_date ? ` · dilepas ${displayDate(memo.applies_to.unapplied_date)}` : ''}`
        : 'Tidak, kredit dipakai saat membayar';
    const unapplicable =
        memo?.status === 'diposting' &&
        permissions.reverse &&
        memo.applies_to !== null &&
        memo.applies_to.amount !== null &&
        memo.applies_to.unapplied_date === null;

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
                                if (!memo) {
                                    onClose();
                                    return;
                                }
                                setHeader(headerOf(memo));
                                setLines(linesOf(memo));
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
                        title="Catat kredit dari vendor sebesar total nota ini."
                        onClick={() => void post()}
                    >
                        <CircleCheck aria-hidden="true" />
                        Posting
                    </Button>
                )}
                {unapplicable && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="command"
                        disabled={busy}
                        title="Kembalikan utang faktur dan kredit nota seperti sebelum nota ini mengurangi faktur."
                        onClick={() => setUnapplying(true)}
                    >
                        <Unlink aria-hidden="true" />
                        Lepas dari faktur
                    </Button>
                )}
                {memo?.status === 'diposting' && permissions.reverse && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="command"
                        disabled={busy}
                        title="Tutup kreditnya dan kembalikan barang retur ke daftar yang belum dikreditkan, selama kreditnya belum dipakai."
                        onClick={() => void reverse()}
                    >
                        <Undo2 aria-hidden="true" />
                        Batal posting
                    </Button>
                )}
                {memo && editable && (
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
                            editable && lines.length
                                ? 'Mengganti vendor menghapus semua baris dari vendor sebelumnya.'
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
                                    setHeader({
                                        ...header,
                                        vendor,
                                        applies_to_entry_id: '',
                                    });
                                    setLines([]);
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
                        error={error('vendor_credit_memo_number')}
                        hint="Nomor yang tertulis di nota kredit dari vendor. Satu nomor hanya bisa dicatat sekali per vendor."
                    >
                        <Input
                            label="No. nota vendor"
                            required
                            maxLength={35}
                            data-error-field="vendor_credit_memo_number"
                            value={header.vendor_credit_memo_number}
                            readOnly={!editable}
                            onChange={(event) =>
                                setHeader({
                                    ...header,
                                    vendor_credit_memo_number:
                                        event.target.value,
                                })
                            }
                        />
                    </FormControl>
                    <FormControl error={error('document_date')}>
                        {editable ? (
                            <DatePicker
                                label="Tanggal nota vendor"
                                required
                                data-error-field="document_date"
                                value={header.document_date}
                                portalContainer={portalContainer}
                                onValueChange={(document_date) =>
                                    setHeader({ ...header, document_date })
                                }
                            />
                        ) : (
                            <Input
                                label="Tanggal nota vendor"
                                readOnly
                                value={displayDate(header.document_date)}
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
                    <FormControl
                        error={error('applies_to_entry_id')}
                        data-error-field="applies_to_entry_id"
                        hint="Pilih faktur bila kredit ini langsung mengurangi utang faktur itu. Kosongkan untuk dipakai saat membayar vendor."
                    >
                        {editable ? (
                            <Select
                                label="Kurangi utang faktur"
                                items={[
                                    {
                                        value: '',
                                        label: 'Tidak, kredit dipakai saat membayar',
                                    },
                                    ...(openInvoices ?? []).map((entry) => ({
                                        value: entry.entry_id,
                                        label: `${entry.document_number} · ${entry.vendor_invoice_number} · sisa ${displayAmount(entry.remaining, amountDecimals)}`,
                                    })),
                                    ...(memo?.applies_to &&
                                    !(openInvoices ?? []).some(
                                        (entry) =>
                                            entry.entry_id ===
                                            memo.applies_to?.id,
                                    )
                                        ? [
                                              {
                                                  value: memo.applies_to.id,
                                                  label: appliesToText,
                                              },
                                          ]
                                        : []),
                                ]}
                                value={header.applies_to_entry_id}
                                onValueChange={(value) =>
                                    setHeader({
                                        ...header,
                                        applies_to_entry_id: value ?? '',
                                    })
                                }
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Kurangi utang faktur"
                                readOnly
                                value={appliesToText}
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
                    {memo && (
                        <FormControl>
                            <Input
                                label="Status"
                                readOnly
                                value={
                                    purchaseCreditMemoStatusLabels[memo.status]
                                }
                            />
                        </FormControl>
                    )}
                    {memo?.remaining !== null &&
                        memo?.remaining !== undefined && (
                            <FormControl hint="Kredit yang belum dipakai mengurangi utang vendor ini.">
                                <Input
                                    label="Sisa kredit"
                                    readOnly
                                    value={displayAmount(
                                        memo.remaining,
                                        amountDecimals,
                                    )}
                                />
                            </FormControl>
                        )}
                </FormGrid>
                <div data-error-field="lines">
                    <DocumentLines
                        title="Baris nota kredit"
                        data={lines.map((line, index) => ({ index, line }))}
                        getRowKey={(row) => row.line.key}
                        getRowLabel={(row) =>
                            row.line.item || `Baris ${row.index + 1}`
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
                                                ? 'Pilih barang yang sudah diretur ke vendor ini dan belum dikreditkan.'
                                                : 'Pilih vendor lebih dulu.'
                                        }
                                        onClick={() => setPicking('retur')}
                                    >
                                        <PackageSearch aria-hidden="true" />
                                        Ambil baris retur
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="command"
                                        disabled={busy || !header.vendor}
                                        title={
                                            header.vendor
                                                ? 'Pilih baris faktur yang harganya dipotong vendor tanpa barang yang kembali.'
                                                : 'Pilih vendor lebih dulu.'
                                        }
                                        onClick={() => setPicking('potongan')}
                                    >
                                        <TicketPercent aria-hidden="true" />
                                        Potongan harga
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
                                ? 'Belum ada baris. Pilih Ambil baris retur untuk barang yang dikembalikan, atau Potongan harga.'
                                : 'Nota kredit ini tidak berisi baris.'
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
                                    Total nota{' '}
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
                                id: 'source',
                                header: 'Retur atau faktur',
                                minWidth: 140,
                                cell: ({ index, line }) => (
                                    <FormControl
                                        error={error(
                                            field(
                                                index,
                                                line.kind === 'retur'
                                                    ? 'return_line_id'
                                                    : 'invoice_line_id',
                                            ),
                                        )}
                                        data-error-field={field(
                                            index,
                                            line.kind === 'retur'
                                                ? 'return_line_id'
                                                : 'invoice_line_id',
                                        )}
                                    >
                                        {text(line.source_number)}
                                    </FormControl>
                                ),
                            },
                            {
                                id: 'item',
                                header: 'Barang',
                                minWidth: 220,
                                cell: ({ line }) => text(line.item),
                            },
                            {
                                id: 'description',
                                header: 'Alasan potongan',
                                content: control,
                                minWidth: 200,
                                cell: ({ index, line }) =>
                                    line.kind === 'potongan' && editable ? (
                                        <FormControl
                                            error={error(
                                                field(index, 'description'),
                                            )}
                                        >
                                            <Input
                                                label="Alasan potongan"
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
                                        text(
                                            line.kind === 'retur'
                                                ? 'Retur'
                                                : line.description,
                                        )
                                    ),
                            },
                            {
                                id: 'quantity',
                                header: 'Jumlah',
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
                                        : text(
                                              `${displayNumber(line.quantity)} ${line.unit}`,
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
                                              line.kind === 'potongan'
                                                  ? 'Potongan per satuan'
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
                                            lineAmount(
                                                line,
                                                amountDecimals,
                                            ).normalized(),
                                            amountDecimals,
                                        ),
                                    ),
                            },
                        ]}
                    />
                </div>
            </PageDialogBody>
            {unapplying && memo && (
                <CreditMemoUnapplyDialog
                    memo={memo}
                    amountDecimals={amountDecimals}
                    onUnapplied={(next) => {
                        setUnapplying(false);
                        adopt(next);
                    }}
                    onClose={() => setUnapplying(false)}
                />
            )}
            {confirmation}
            {picking === 'retur' && (
                <SelectRecordsDialog<ReturnLine>
                    noun="baris retur"
                    loadItems={returnLineLoader}
                    getItemValue={(line) => line.return_line_id}
                    getItemLabel={(line) =>
                        `${line.return.number} ${line.item.name}`
                    }
                    columns={[
                        {
                            id: 'return',
                            header: 'Retur',
                            width: 140,
                            cell: (line) => line.return.number,
                        },
                        {
                            id: 'date',
                            header: 'Tanggal',
                            width: 110,
                            cell: (line) =>
                                displayDate(line.return.posting_date),
                        },
                        {
                            id: 'receipt',
                            header: 'Penerimaan',
                            width: 140,
                            cell: (line) => line.receipt.number,
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
                            header: 'Belum dikreditkan',
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
                        takeReturnLines(chosen);
                        setPicking(null);
                    }}
                    onClose={() => setPicking(null)}
                />
            )}
            {picking === 'potongan' && (
                <SelectRecordsDialog<InvoiceLine>
                    noun="baris faktur"
                    loadItems={invoiceLineLoader}
                    getItemValue={(line) => line.invoice_line_id}
                    getItemLabel={(line) =>
                        `${line.invoice.number} ${line.description}`
                    }
                    columns={[
                        {
                            id: 'invoice',
                            header: 'Faktur',
                            width: 140,
                            cell: (line) => line.invoice.number,
                        },
                        {
                            id: 'vendor_invoice',
                            header: 'No. faktur vendor',
                            width: 150,
                            cell: (line) => line.invoice.vendor_invoice_number,
                        },
                        {
                            id: 'description',
                            header: 'Barang atau biaya',
                            width: 240,
                            cell: (line) => line.description,
                        },
                        {
                            id: 'quantity',
                            header: 'Jumlah',
                            width: 110,
                            align: 'right',
                            cell: (line) =>
                                `${displayNumber(line.quantity)} ${line.unit?.code ?? ''}`,
                        },
                        {
                            id: 'unit_cost',
                            header: 'Harga faktur',
                            width: 120,
                            align: 'right',
                            cell: (line) => displayNumber(line.unit_cost),
                        },
                    ]}
                    onConfirm={(chosen) => {
                        takeInvoiceLines(chosen);
                        setPicking(null);
                    }}
                    onClose={() => setPicking(null)}
                />
            )}
        </form>
    );
}
