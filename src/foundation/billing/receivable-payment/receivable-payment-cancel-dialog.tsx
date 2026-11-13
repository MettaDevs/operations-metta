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

type ReceivablePayment =
    ApiBody<'billingReceivablePaymentList'>['data'][number];

// Batal pembayaran hutang (tombol Batal form lama): alasan batal, lalu Proses atau Tutup. Kewajiban invoice-nya kembali
// sebesar pembayaran yang dibatalkan.
export function ReceivablePaymentCancelDialog({
    payment,
    onClose,
    onCancelled,
}: {
    payment: ReceivablePayment;
    onClose: () => void;
    onCancelled: (payment: ReceivablePayment) => void;
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
            const { body } = await api.billingReceivablePaymentCancel({
                params: { id: payment.id },
                body: { reason, version: payment.version },
            });
            toast.success(body.message);
            onCancelled(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else
                setMessage(
                    errorText(caught, 'Pembayaran hutang belum dibatalkan.'),
                );
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
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Batal Pembayaran Hutang</DialogTitle>
                    <DialogDescription>
                        Pembayaran {payment.number} akan dibatalkan, dan
                        kewajiban invoice {payment.invoice_number} kembali
                        bertambah sebesar pembayaran ini.
                    </DialogDescription>
                </DialogHeader>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation="Pembayaran hutang belum dibatalkan"
                />
                <form
                    noValidate
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <DialogBody>
                        <FormControl error={errors.reason?.[0]}>
                            <Textarea
                                label="Alasan Batal"
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
