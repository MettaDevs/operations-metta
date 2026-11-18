import { DatePicker } from '@operations-metta/ui/date-picker';
import {
    Dialog,
    DialogAction,
    DialogBody,
    DialogCancel,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@operations-metta/ui/dialog';
import { FormControl } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import {
    codeColumn,
    MasterLookup,
    nameColumn,
    type LookupRequest,
} from '@operations-metta/ui/master-lookup';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
    PaymentMethodLookup,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import { loadVendors, today, useLoader } from '../purchase-lines.tsx';
import type { Vendor } from '../vendor/vendor-card.tsx';

type BankAccount = ApiBody<'bankAccountList'>['data'][number];

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

// Suggest Vendor Payments BC, dijalankan dari tab Prepare Payment Journal.
export function VendorPaymentSuggestionDialog({
    onClose,
    onCreated,
}: {
    onClose: () => void;
    onCreated: () => void;
}): ReactNode {
    const contentRef = useRef<HTMLDivElement>(null);
    const [lastDueDate, setLastDueDate] = useState(today());
    const [postingDate, setPostingDate] = useState(today());
    const [vendor, setVendor] = useState<Vendor | null>(null);
    const [methodId, setMethodId] = useState('');
    const [bankAccount, setBankAccount] = useState<BankAccount | null>(null);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const vendorLoader = useLoader(loadVendors);
    const { data: methods } = useQuery(
        orpc.purchasingVendorPaymentMethods.queryOptions({
            select: (response) => response.body.data,
        }),
    );
    const cash = methods?.find((method) => method.id === methodId)?.cash;
    const error = (field: string) => errors[field]?.join(' ');

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.purchasingVendorPaymentSuggest({
                body: {
                    last_due_date: lastDueDate,
                    vendor_id: vendor?.id ?? null,
                    posting_date: postingDate,
                    payment_method_id: methodId,
                    bank_account_id: cash ? null : (bankAccount?.id ?? null),
                },
            });
            toast.success(
                `${body.data.length} draf pembayaran dibuat: ${body.data.map((payment) => payment.number).join(', ')}.`,
            );
            onCreated();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Saran pembayaran gagal.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent
                ref={contentRef}
                onEscapeKeyDown={(event) => {
                    if (
                        contentRef.current?.querySelector(
                            '[role="combobox"][aria-expanded="true"]',
                        )
                    )
                        event.preventDefault();
                }}
            >
                <DialogHeader>
                    <DialogTitle>Saran pembayaran</DialogTitle>
                    <DialogDescription>
                        Buat draf pembayaran per vendor untuk utang yang jatuh
                        tempo sampai tanggal pilihan, dikurangi kredit vendor
                        yang belum dipakai.
                    </DialogDescription>
                </DialogHeader>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation="Saran pembayaran belum dibuat"
                />
                <form
                    noValidate
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <DialogBody className="space-y-4">
                        <FormControl error={error('last_due_date')}>
                            <DatePicker
                                label="Jatuh tempo sampai"
                                required
                                data-error-field="last_due_date"
                                value={lastDueDate}
                                portalContainer={contentRef}
                                onValueChange={setLastDueDate}
                            />
                        </FormControl>
                        <FormControl
                            error={error('vendor_id')}
                            data-error-field="vendor_id"
                            hint="Kosongkan untuk semua vendor aktif."
                        >
                            <InlineLookup<Vendor>
                                label="Vendor"
                                loadItems={vendorLoader}
                                value={vendor}
                                displayValue={vendor?.name ?? ''}
                                onValueChange={setVendor}
                                getItemValue={(choice) => choice.id}
                                getItemLabel={(choice) => choice.name}
                                placeholder="Semua vendor"
                                emptyMessage="Vendor tidak ditemukan."
                                popupClassName="w-[28rem]"
                                showDetails={false}
                                portalContainer={contentRef}
                                columns={[
                                    {
                                        id: 'number',
                                        header: 'Nomor',
                                        width: 130,
                                        cell: (choice) => choice.number,
                                    },
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        width: 240,
                                        cell: (choice) => choice.name,
                                    },
                                ]}
                            />
                        </FormControl>
                        <FormControl error={error('posting_date')}>
                            <DatePicker
                                label="Tanggal bayar"
                                required
                                data-error-field="posting_date"
                                value={postingDate}
                                portalContainer={contentRef}
                                onValueChange={setPostingDate}
                            />
                        </FormControl>
                        <PaymentMethodLookup
                            label="Cara bayar"
                            required
                            items={methods ?? []}
                            value={methodId}
                            onChange={setMethodId}
                            error={error('payment_method_id')}
                            field="payment_method_id"
                            portalContainer={contentRef}
                        />
                        {cash === false && (
                            <MasterLookup<BankAccount>
                                label="Rekening bank"
                                noun="Rekening"
                                field="bank_account_id"
                                value={bankAccount}
                                load={loadBankAccounts}
                                display={(account) =>
                                    `${account.code} · ${account.name}`
                                }
                                columns={[
                                    codeColumn(),
                                    nameColumn(),
                                    {
                                        id: 'account_number',
                                        header: 'Nomor rekening',
                                        width: 160,
                                        cell: (account) =>
                                            account.account_number,
                                    },
                                ]}
                                onChange={setBankAccount}
                                error={error('bank_account_id')}
                                hint="Rekening asal uang untuk setiap draf. Boleh diisi nanti sebelum posting."
                                portalContainer={contentRef}
                            />
                        )}
                    </DialogBody>
                </form>
                <DialogFooter>
                    <DialogCancel disabled={busy}>Tutup</DialogCancel>
                    <DialogAction
                        disabled={busy}
                        onClick={(event) => {
                            event.preventDefault();
                            void submit();
                        }}
                    >
                        Buat draf
                    </DialogAction>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
