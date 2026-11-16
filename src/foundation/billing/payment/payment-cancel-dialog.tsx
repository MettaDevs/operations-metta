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
} from '../../../platform/shell/index.ts';

// Modal Batal Pembayaran sistem lama: Alasan Batal, lalu Proses atau Tutup. Username dan Password penyetuju sistem lama
// tidak ada lagi: yang membatalkan adalah pengguna yang sedang masuk, dan ia sendiri memegang izin batal pembayaran.
export function PaymentCancelDialog({
    payment,
    onClose,
    onCancelled,
}: {
    payment: { id: string; number: string; version: number };
    onClose: () => void;
    onCancelled: () => Promise<unknown>;
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
            const { body } = await api.billingPaymentCancel({
                params: { id: payment.id },
                body: { reason, version: payment.version },
            });
            toast.success(body.message);
            await onCancelled();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Pembayaran belum dibatalkan.'));
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
                    <DialogTitle>Batal Pembayaran</DialogTitle>
                    <DialogDescription>
                        Pembayaran {payment.number} akan dibatalkan, dan
                        kunjungannya kembali belum dibayar.
                    </DialogDescription>
                </DialogHeader>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation="Pembayaran belum dibatalkan"
                />
                <form
                    noValidate
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <DialogBody className="space-y-4">
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
