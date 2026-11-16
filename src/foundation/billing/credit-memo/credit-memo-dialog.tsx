import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
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
import {
    displayAmount,
    displayNumber,
} from '@operations-metta/ui/display-number';
import { FormControl } from '@operations-metta/ui/form-control';
import { Textarea } from '@operations-metta/ui/textarea';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../../platform/shell/index.ts';

type Preview = NonNullable<
    NonNullable<ApiBody<'billingVisitShow'>['data']['payment']>['credit_memo']
>;

// Modal Nota Kredit, dibuka dari pembayaran yang clerk-nya sudah Clerk End: daftar uang yang dikembalikan per jenis bayar
// dan piutang yang dibatalkan, lalu Alasan seperti modal Batal Pembayaran.
export function CreditMemoDialog({
    payment,
    preview,
    amountDecimals,
    localCurrency,
    onClose,
    onPosted,
}: {
    payment: { id: string; number: string; version: number };
    preview: Preview;
    amountDecimals: number;
    localCurrency: string;
    onClose: () => void;
    onPosted: () => Promise<unknown>;
}): ReactNode {
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);

    const submit = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.billingPaymentCreditMemo({
                params: { id: payment.id },
                body: { reason, version: payment.version },
            });
            toast.success(body.message);
            await onPosted();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Nota kredit belum tersimpan.'));
        } finally {
            setBusy(false);
        }
    };

    const rows = [
        ...preview.refunds.map((refund, index) => ({
            key: `refund-${index}`,
            method:
                refund.currency_code === localCurrency
                    ? refund.label
                    : `${refund.label} (${refund.currency_code} ${displayNumber(refund.currency_amount)})`,
            effect: 'Uang dikembalikan',
            amount: refund.amount,
        })),
        ...preview.receivables.map((receivable, index) => ({
            key: `receivable-${index}`,
            method: `${receivable.label} · ${receivable.party_name}`,
            effect: 'Piutang dibatalkan',
            amount: receivable.amount,
        })),
    ];
    const text = (value: string) => <DataTableText>{value}</DataTableText>;

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent size="wide">
                <DialogHeader>
                    <DialogTitle>Nota Kredit</DialogTitle>
                    <DialogDescription>
                        Pembayaran {payment.number} sudah masuk Clerk End, jadi
                        dikoreksi lewat nota kredit. Uangnya dikembalikan lewat
                        jenis bayar yang sama, piutangnya dibatalkan, dan
                        tagihannya kembali belum dibayar.
                    </DialogDescription>
                </DialogHeader>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation="Nota kredit belum tersimpan"
                />
                <form
                    noValidate
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <DialogBody className="space-y-4">
                        <DataTable
                            data={rows}
                            getRowKey={(row) => row.key}
                            getRowLabel={(row) => row.method}
                            scrollMode="inline"
                            emptyMessage="Pembayaran ini tidak punya uang untuk dikembalikan."
                            columns={[
                                {
                                    id: 'method',
                                    header: 'Jenis bayar',
                                    width: 260,
                                    cell: (row) => text(row.method),
                                },
                                {
                                    id: 'effect',
                                    header: 'Yang terjadi',
                                    width: 170,
                                    cell: (row) => text(row.effect),
                                },
                                {
                                    id: 'amount',
                                    header: 'Nilai',
                                    width: 140,
                                    align: 'right',
                                    cell: (row) =>
                                        text(
                                            displayAmount(
                                                row.amount,
                                                amountDecimals,
                                            ),
                                        ),
                                },
                            ]}
                        />
                        <FormControl error={errors.reason?.[0]}>
                            <Textarea
                                label="Alasan"
                                required
                                rows={3}
                                maxLength={200}
                                data-error-field="reason"
                                value={reason}
                                onChange={(event) =>
                                    setReason(event.target.value)
                                }
                            />
                        </FormControl>
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
                        Proses
                    </DialogAction>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
