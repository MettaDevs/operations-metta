import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { displayAmount } from '@operations-metta/ui/display-number';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
} from '@operations-metta/ui/master-lookup';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Select } from '@operations-metta/ui/select';
import { SelectRecordsDialog } from '@operations-metta/ui/select-records-dialog';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, ReceiptText, Undo2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import { Decimal } from '../../../platform/money/index.ts';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
    PrintAction,
    type ApiBody,
    type ErrorAction,
} from '../../../platform/shell/index.ts';
import { loadVendors, nextKey, today, useLoader } from '../purchase-lines.tsx';
import { decimalOf } from '../purchase-line.amounts.ts';
import type { Vendor } from '../vendor/vendor-card.tsx';

export type VendorPayment = ApiBody<'purchasingVendorPaymentShow'>['data'];
export type VendorPaymentPermissions =
    ApiBody<'purchasingVendorPaymentList'>['permissions'];
type BankAccount = ApiBody<'bankAccountList'>['data'][number];
type BankAccountChoice = NonNullable<VendorPayment['bank_account']>;
type OpenEntry = ApiBody<'purchasingVendorPaymentOpenEntries'>['data'][number];
type Errors = Record<string, string[]>;

type Line = {
    key: string;
    id: string | null;
    entry_id: string;
    document_number: string;
    vendor_document_number: string;
    due_date: string;
    entry_amount: string;
    remaining: string;
    amount: string;
};
type Header = {
    vendor: { id: string; number: string; name: string } | null;
    posting_date: string;
    payment_method_id: string;
    bank_account: BankAccountChoice | null;
    reference: string;
    description: string;
};

export const vendorPaymentStatusLabels: Record<
    VendorPayment['status'],
    string
> = {
    draf: 'Draf',
    diposting: 'Diposting',
    dibatalkan: 'Dibatalkan',
};

function headerOf(payment: VendorPayment | null): Header {
    return {
        vendor: payment?.vendor ?? null,
        posting_date: payment?.posting_date ?? today(),
        payment_method_id: payment?.payment_method.id ?? '',
        bank_account: payment?.bank_account ?? null,
        reference: payment?.reference ?? '',
        description: payment?.description ?? '',
    };
}

function linesOf(payment: VendorPayment | null): Line[] {
    return (payment?.lines ?? []).map((line) => ({
        key: line.id,
        id: line.id,
        entry_id: line.entry_id,
        document_number: line.document_number,
        vendor_document_number: line.vendor_document_number,
        due_date: line.due_date,
        entry_amount: line.entry_amount,
        remaining: line.remaining,
        amount: line.amount,
    }));
}

const loadBankAccounts = async ({ query, cursor, signal }: LookupRequest) => {
    const { body } = await api.bankAccountList(
        { query: { q: query, usable: '1', ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data,
        nextCursor: body.next_cursor,
        canCreate: body.can_manage,
    };
};

const bankAccountText = (account: BankAccountChoice | null) =>
    account
        ? `${account.code} · ${account.bank_name} ${account.account_number}`
        : '';

// Kartu pembayaran ke vendor (Payment Journal yang diterapkan ke Vendor Ledger Entries di BC).
export function VendorPaymentCard({
    payment: initial,
    permissions,
    amountDecimals,
    portalContainer,
    onSaved,
    onClose,
}: {
    payment: VendorPayment | null;
    permissions: VendorPaymentPermissions;
    amountDecimals: number;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (payment: VendorPayment) => void;
    onClose: () => void;
}): ReactNode {
    const [payment, setPayment] = useState(initial);
    const editable =
        (payment === null || payment.status === 'draf') && permissions.update;
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
    const [operation, setOperation] = useState('Pembayaran belum disimpan');
    const { confirm, confirmation } = useConfirmation();
    const vendorLoader = useLoader(loadVendors);
    const { data: methods } = useQuery({
        ...orpc.purchasingVendorPaymentMethods.queryOptions({
            select: (response) => response.body.data,
        }),
        enabled: editable,
    });
    const pristine =
        JSON.stringify([header, lines]) ===
        JSON.stringify([headerOf(payment), linesOf(payment)]);
    usePageDialogRecord({
        recordTitle: payment
            ? `${payment.number} ${payment.vendor.name}`
            : 'Pembayaran ke vendor baru',
        editing: editable,
        dirty: !pristine,
    });

    const vendorId = header.vendor?.id ?? '';
    const paymentId = payment?.id;
    const entryLoader = useCallback<LookupLoader<OpenEntry>>(
        async ({ query, signal }) => {
            const { body } = await api.purchasingVendorPaymentOpenEntries(
                {
                    query: {
                        vendor_id: vendorId,
                        ...(paymentId ? { payment_id: paymentId } : {}),
                    },
                },
                { signal },
            );
            const needle = query.trim().toLowerCase();
            return {
                items: body.data.filter(
                    (entry) =>
                        !needle ||
                        [
                            entry.document_number,
                            entry.vendor_document_number,
                        ].some((value) => value.toLowerCase().includes(needle)),
                ),
                nextCursor: null,
            };
        },
        [vendorId, paymentId],
    );

    const error = (field: string) => errors[field]?.join(' ');
    const field = (index: number, name: string) => `lines.${index}.${name}`;
    const total = lines.reduce(
        (sum, line) => sum.plus(decimalOf(line.amount) ?? Decimal.of('0')),
        Decimal.of('0'),
    );

    const payload = () => ({
        vendor_id: header.vendor?.id ?? '',
        posting_date: header.posting_date,
        payment_method_id: header.payment_method_id,
        bank_account_id: header.bank_account?.id ?? null,
        reference: header.reference || null,
        description: header.description || null,
        lines: lines.map((line) => ({
            id: line.id,
            entry_id: line.entry_id,
            amount: line.amount,
        })),
    });

    const failed = (caught: unknown, failure: string) => {
        setOperation(failure);
        if (caught instanceof ApiError && caught.status === 422) {
            setErrors(caught.errors);
            setErrorActions(caught.actions);
        } else setMessage(errorText(caught, failure + '.'));
    };

    const reset = () => {
        setErrors({});
        setErrorActions([]);
        setMessage(null);
    };

    const save = async (): Promise<VendorPayment | null> => {
        reset();
        try {
            const { body } = payment
                ? await api.purchasingVendorPaymentUpdate({
                      params: { id: payment.id },
                      body: { ...payload(), version: payment.version },
                  })
                : await api.purchasingVendorPaymentCreate({ body: payload() });
            return body.data;
        } catch (caught) {
            failed(caught, 'Pembayaran belum disimpan');
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

    const adopt = (next: VendorPayment) => {
        setPayment(next);
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
                payment ? 'Pembayaran diperbarui.' : 'Pembayaran dibuat.',
            );
            adopt(saved);
        });

    const post = async () => {
        if (
            !(await confirm({
                title: 'Posting pembayaran ini?',
                description:
                    'Sisa utang faktur di baris berkurang sebesar jumlah bayarnya, faktur yang lunas ditutup, dan pembayaran tidak bisa diubah lagi.',
                confirmLabel: 'Posting',
            }))
        )
            return;
        await run(async () => {
            const saved = pristine && payment ? payment : await save();
            if (!saved) return;
            if (saved !== payment) adopt(saved);
            try {
                const { body } = await api.purchasingVendorPaymentPost({
                    params: { id: saved.id },
                    body: { version: saved.version },
                });
                toast.success(
                    `Pembayaran ${body.data.number} diposting. Sisa utangnya berkurang di Utang vendor.`,
                );
                adopt(body.data);
            } catch (caught) {
                failed(caught, 'Pembayaran belum diposting');
            }
        });
    };

    const reverse = async () => {
        if (!payment) return;
        if (
            !(await confirm({
                title: `Batalkan posting ${payment.number}?`,
                description:
                    'Sisa utang faktur yang dibayarnya kembali seperti sebelum pembayaran ini, dan faktur yang sudah lunas terbuka lagi.',
                confirmLabel: 'Batalkan posting',
                destructive: true,
            }))
        )
            return;
        await run(async () => {
            reset();
            try {
                const { body } = await api.purchasingVendorPaymentReverse({
                    params: { id: payment.id },
                    body: { version: payment.version },
                });
                toast.success(
                    `Posting pembayaran ${payment.number} dibatalkan.`,
                );
                adopt(body.data);
            } catch (caught) {
                failed(caught, 'Posting pembayaran belum dibatalkan');
            }
        });
    };

    const remove = async () => {
        if (!payment) return;
        if (
            !(await confirm({
                title: `Delete pembayaran ${payment.number}?`,
                description:
                    'Draf ini tidak tampil lagi di daftar pembayaran ke vendor.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run(async () => {
            try {
                await api.purchasingVendorPaymentDelete({
                    params: { id: payment.id },
                    body: { version: payment.version },
                });
                toast.success('Pembayaran dihapus.');
                onClose();
            } catch (caught) {
                failed(caught, 'Pembayaran belum dihapus');
            }
        });
    };

    const takeEntries = (chosen: OpenEntry[]) =>
        setLines((current) => [
            ...current,
            ...chosen
                .filter(
                    (entry) =>
                        !current.some(
                            (line) => line.entry_id === entry.entry_id,
                        ),
                )
                .map((entry) => ({
                    key: nextKey(),
                    id: null,
                    entry_id: entry.entry_id,
                    document_number: entry.document_number,
                    vendor_document_number: entry.vendor_document_number,
                    due_date: entry.due_date,
                    entry_amount: entry.amount,
                    remaining: entry.open,
                    amount: entry.open,
                })),
        ]);

    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    const amount = (value: string) =>
        text(displayAmount(value, amountDecimals));
    const methodName = payment
        ? `${payment.payment_method.code} - ${payment.payment_method.name}`
        : '';
    const cash = editable
        ? methods?.find((method) => method.id === header.payment_method_id)
              ?.cash
        : payment?.payment_method.cash;

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
                                if (!payment) {
                                    onClose();
                                    return;
                                }
                                setHeader(headerOf(payment));
                                setLines(linesOf(payment));
                                reset();
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
                        title="Kurangi sisa utang faktur di baris sebesar jumlah bayarnya."
                        onClick={() => void post()}
                    >
                        <CircleCheck aria-hidden="true" />
                        Posting
                    </Button>
                )}
                {payment?.status === 'diposting' && permissions.reverse && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="command"
                        disabled={busy}
                        title="Kembalikan sisa utang faktur yang dibayar pembayaran ini."
                        onClick={() => void reverse()}
                    >
                        <Undo2 aria-hidden="true" />
                        Batal posting
                    </Button>
                )}
                {payment && editable && (
                    <ActionButton
                        action="archive"
                        disabled={busy}
                        onClick={() => void remove()}
                    />
                )}
                {payment && (
                    <PrintAction
                        report="core.vendor-payment"
                        recordId={payment.id}
                        label="Bukti pembayaran"
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
                                ? 'Mengganti vendor menghapus baris utang vendor sebelumnya.'
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
                                    setHeader({ ...header, vendor });
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
                    <FormControl error={error('posting_date')}>
                        {editable ? (
                            <DatePicker
                                label="Tanggal bayar"
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
                                label="Tanggal bayar"
                                readOnly
                                value={displayDate(header.posting_date)}
                            />
                        )}
                    </FormControl>
                    <FormControl
                        error={error('payment_method_id')}
                        data-error-field="payment_method_id"
                        hint={
                            editable && methods?.length === 0
                                ? 'Belum ada jenis bayar tunai atau non tunai. Tambahkan di Kasir › Setup › Jenis bayar.'
                                : undefined
                        }
                    >
                        {editable ? (
                            <Select
                                label="Cara bayar"
                                required
                                items={(methods ?? []).map((method) => ({
                                    value: method.id,
                                    label: `${method.code} - ${method.name}`,
                                }))}
                                value={header.payment_method_id}
                                onValueChange={(value) =>
                                    setHeader({
                                        ...header,
                                        payment_method_id: value ?? '',
                                        bank_account: methods?.find(
                                            (method) => method.id === value,
                                        )?.cash
                                            ? null
                                            : header.bank_account,
                                    })
                                }
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <Input
                                label="Cara bayar"
                                readOnly
                                value={methodName}
                            />
                        )}
                    </FormControl>
                    {cash === false &&
                        (editable ? (
                            <MasterLookup<BankAccount>
                                label="Rekening bank"
                                noun="Rekening"
                                field="bank_account_id"
                                value={header.bank_account}
                                load={loadBankAccounts}
                                display={(account) =>
                                    `${account.code} · ${account.name}`
                                }
                                columns={[
                                    codeColumn(),
                                    nameColumn(),
                                    {
                                        id: 'bank_name',
                                        header: 'Bank',
                                        width: 140,
                                        cell: (account) => account.bank_name,
                                    },
                                    {
                                        id: 'account_number',
                                        header: 'Nomor rekening',
                                        width: 160,
                                        cell: (account) =>
                                            account.account_number,
                                    },
                                ]}
                                onChange={(account) =>
                                    setHeader({
                                        ...header,
                                        bank_account: {
                                            id: account.id,
                                            code: account.code,
                                            name: account.name,
                                            bank_name: account.bank_name,
                                            account_number:
                                                account.account_number,
                                        },
                                    })
                                }
                                error={error('bank_account_id')}
                                hint="Rekening asal uang. Wajib sebelum posting pembayaran non tunai."
                                portalContainer={portalContainer}
                            />
                        ) : (
                            <FormControl>
                                <Input
                                    label="Rekening bank"
                                    readOnly
                                    value={bankAccountText(header.bank_account)}
                                />
                            </FormControl>
                        ))}
                    {payment?.bank && (
                        <FormControl hint="Bank yang diketik sebelum ada master rekening bank.">
                            <Input label="Bank" readOnly value={payment.bank} />
                        </FormControl>
                    )}
                    <FormControl
                        error={error('reference')}
                        hint="Misalnya nomor bukti transfer atau nomor kuitansi dari vendor."
                    >
                        <Input
                            label="No. referensi"
                            maxLength={35}
                            data-error-field="reference"
                            value={header.reference}
                            readOnly={!editable}
                            onChange={(event) =>
                                setHeader({
                                    ...header,
                                    reference: event.target.value,
                                })
                            }
                        />
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
                    {payment && (
                        <FormControl>
                            <Input
                                label="Status"
                                readOnly
                                value={
                                    vendorPaymentStatusLabels[payment.status]
                                }
                            />
                        </FormControl>
                    )}
                </FormGrid>
                <div data-error-field="lines">
                    <DocumentLines
                        title="Utang yang dibayar"
                        data={lines.map((line, index) => ({ index, line }))}
                        getRowKey={(row) => row.line.key}
                        getRowLabel={(row) => row.line.document_number}
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
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="command"
                                    disabled={busy || !header.vendor}
                                    title={
                                        header.vendor
                                            ? 'Pilih faktur vendor ini yang belum lunas, dan nota kredit yang kreditnya belum dipakai.'
                                            : 'Pilih vendor lebih dulu.'
                                    }
                                    onClick={() => setPicking(true)}
                                >
                                    <ReceiptText aria-hidden="true" />
                                    Ambil utang terbuka
                                </Button>
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
                                ? 'Belum ada baris. Pilih Ambil utang terbuka untuk membayar faktur vendor ini.'
                                : 'Pembayaran ini tidak berisi baris.'
                        }
                        footer={
                            <p className="flex justify-end text-sm">
                                <span>
                                    Total dibayar{' '}
                                    <span className="font-semibold">
                                        {displayAmount(
                                            total.normalized(),
                                            amountDecimals,
                                        )}
                                    </span>
                                </span>
                            </p>
                        }
                        columns={[
                            {
                                id: 'document_number',
                                header: 'Dokumen',
                                minWidth: 140,
                                cell: ({ index, line }) => (
                                    <FormControl
                                        error={error(field(index, 'entry_id'))}
                                        data-error-field={field(
                                            index,
                                            'entry_id',
                                        )}
                                    >
                                        {text(line.document_number)}
                                    </FormControl>
                                ),
                            },
                            {
                                id: 'vendor_document_number',
                                header: 'No. dokumen vendor',
                                minWidth: 150,
                                cell: ({ line }) =>
                                    text(line.vendor_document_number),
                            },
                            {
                                id: 'due_date',
                                header: 'Jatuh tempo',
                                minWidth: 110,
                                cell: ({ line }) =>
                                    text(displayDate(line.due_date)),
                            },
                            {
                                id: 'entry_amount',
                                header: 'Nilai',
                                minWidth: 130,
                                align: 'right',
                                cell: ({ line }) => amount(line.entry_amount),
                            },
                            {
                                id: 'remaining',
                                header:
                                    payment?.status === 'diposting'
                                        ? 'Sisa sesudah bayar'
                                        : 'Sisa utang',
                                minWidth: 130,
                                align: 'right',
                                cell: ({ line }) => amount(line.remaining),
                            },
                            {
                                id: 'amount',
                                header: 'Jumlah bayar',
                                required: true,
                                content: editable ? 'control' : 'text',
                                minWidth: 140,
                                align: 'right',
                                cell: ({ index, line }) =>
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(index, 'amount'),
                                            )}
                                        >
                                            <Input
                                                label="Jumlah bayar"
                                                required
                                                type="number"
                                                step="any"
                                                inputMode="decimal"
                                                data-error-field={field(
                                                    index,
                                                    'amount',
                                                )}
                                                value={line.amount}
                                                onChange={(event) =>
                                                    setLines((current) =>
                                                        current.map(
                                                            (other, at) =>
                                                                at === index
                                                                    ? {
                                                                          ...other,
                                                                          amount: event
                                                                              .target
                                                                              .value,
                                                                      }
                                                                    : other,
                                                        ),
                                                    )
                                                }
                                            />
                                        </FormControl>
                                    ) : (
                                        amount(line.amount)
                                    ),
                            },
                        ]}
                    />
                </div>
            </PageDialogBody>
            {confirmation}
            {picking && (
                <SelectRecordsDialog<OpenEntry>
                    noun="utang"
                    loadItems={entryLoader}
                    getItemValue={(entry) => entry.entry_id}
                    getItemLabel={(entry) => entry.document_number}
                    columns={[
                        {
                            id: 'document_number',
                            header: 'Dokumen',
                            width: 140,
                            cell: (entry) => entry.document_number,
                        },
                        {
                            id: 'vendor_document_number',
                            header: 'No. dokumen vendor',
                            width: 150,
                            cell: (entry) => entry.vendor_document_number,
                        },
                        {
                            id: 'due_date',
                            header: 'Jatuh tempo',
                            width: 110,
                            cell: (entry) => displayDate(entry.due_date),
                        },
                        {
                            id: 'amount',
                            header: 'Nilai',
                            width: 130,
                            align: 'right',
                            cell: (entry) =>
                                displayAmount(entry.amount, amountDecimals),
                        },
                        {
                            id: 'open',
                            header: 'Sisa',
                            width: 130,
                            align: 'right',
                            cell: (entry) =>
                                displayAmount(entry.open, amountDecimals),
                        },
                    ]}
                    onConfirm={(chosen) => {
                        takeEntries(chosen);
                        setPicking(false);
                    }}
                    onClose={() => setPicking(false)}
                />
            )}
        </form>
    );
}
