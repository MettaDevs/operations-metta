import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
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
import { displayAmount } from '@operations-metta/ui/display-number';
import { FormControl } from '@operations-metta/ui/form-control';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ErrorAction,
} from '../../../platform/shell/index.ts';
import type { AmountDecimals } from '../../currency/index.ts';
import { today } from '../purchase-lines.tsx';
import type { PurchaseCreditMemo } from './purchase-credit-memo-card.tsx';

// Unapply Vendor Entries BC (page 624): penerapan nota ke faktur yang akan dilepas, tanggal pelepasan, lalu Lepas.
export function CreditMemoUnapplyDialog({
    memo,
    amountDecimals,
    onUnapplied,
    onClose,
}: {
    memo: PurchaseCreditMemo;
    amountDecimals: AmountDecimals;
    onUnapplied: (memo: PurchaseCreditMemo) => void;
    onClose: () => void;
}): ReactNode {
    const contentRef = useRef<HTMLDivElement>(null);
    const [postingDate, setPostingDate] = useState(today());
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [errorActions, setErrorActions] = useState<readonly ErrorAction[]>(
        [],
    );
    const [message, setMessage] = useState<string | null>(null);
    const application = memo.applies_to;

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setErrorActions([]);
        setMessage(null);
        try {
            const { body } = await api.purchasingCreditMemoUnapply({
                params: { id: memo.id },
                body: { posting_date: postingDate, version: memo.version },
            });
            toast.success(
                `${memo.number} dilepas dari faktur ${application?.document_number ?? ''}. Utang faktur dan kredit nota kembali terbuka.`,
            );
            onUnapplied(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422) {
                setErrors(caught.errors);
                setErrorActions(caught.actions);
            } else setMessage(errorText(caught, 'Nota belum dilepas.'));
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
            <DialogContent ref={contentRef} className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Lepas {memo.number} dari faktur</DialogTitle>
                    <DialogDescription>
                        Utang faktur bertambah lagi sebesar jumlah di bawah, dan
                        kredit nota kembali bisa dipakai saat membayar atau
                        dibatalkan postingnya.
                    </DialogDescription>
                </DialogHeader>
                <FormErrorHeader
                    errors={errors}
                    errorActions={errorActions}
                    message={message}
                    operation="Nota belum dilepas"
                />
                <DialogBody className="space-y-4">
                    <DataTable
                        data={application ? [application] : []}
                        getRowKey={(row) => row.id}
                        getRowLabel={(row) => row.document_number}
                        columns={[
                            {
                                id: 'posting_date',
                                header: 'Tanggal',
                                width: 110,
                                cell: () => (
                                    <DataTableText>
                                        {displayDate(memo.posting_date)}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'memo',
                                header: 'Nota kredit',
                                width: 150,
                                cell: () => (
                                    <DataTableText>
                                        {`${memo.number} · ${memo.vendor_credit_memo_number}`}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'invoice',
                                header: 'Faktur',
                                width: 170,
                                cell: (row) => (
                                    <DataTableText>
                                        {`${row.document_number} · ${row.vendor_invoice_number}`}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'amount',
                                header: 'Jumlah',
                                width: 130,
                                align: 'right',
                                cell: (row) => (
                                    <DataTableText>
                                        {row.amount === null
                                            ? ''
                                            : displayAmount(
                                                  row.amount,
                                                  amountDecimals,
                                              )}
                                    </DataTableText>
                                ),
                            },
                        ]}
                    />
                    <FormControl error={errors.posting_date?.join(' ')}>
                        <DatePicker
                            label="Tanggal lepas"
                            required
                            data-error-field="posting_date"
                            value={postingDate}
                            portalContainer={contentRef}
                            onValueChange={setPostingDate}
                        />
                    </FormControl>
                </DialogBody>
                <DialogFooter>
                    <DialogCancel disabled={busy}>Tutup</DialogCancel>
                    <DialogAction
                        disabled={busy}
                        onClick={(event) => {
                            event.preventDefault();
                            void submit();
                        }}
                    >
                        Lepas dari faktur
                    </DialogAction>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
