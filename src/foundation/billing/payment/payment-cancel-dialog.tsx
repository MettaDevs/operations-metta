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
import { Input } from '@operations-metta/ui/input';
import { Textarea } from '@operations-metta/ui/textarea';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    PasswordInput,
} from '../../../platform/shell/index.ts';

// Modal Batal Pembayaran sistem lama: Username, Password, dan Alasan Batal, lalu Proses atau Tutup. Penyetujunya pengguna
// yang berhak menyetujui batal pembayaran, dan bisa kasir itu sendiri.
export function PaymentCancelDialog({
    payment,
    onClose,
    onCancelled,
}: {
    payment: { id: string; number: string; version: number };
    onClose: () => void;
    onCancelled: () => Promise<unknown>;
}): ReactNode {
    const [form, setForm] = useState({
        approver_email: '',
        approver_password: '',
        reason: '',
    });
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
                body: { ...form, version: payment.version },
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
                        kunjungannya kembali belum dibayar. Penyetuju mengisi
                        username dan password-nya.
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
                        <FormControl error={errors.approver_email?.[0]}>
                            <Input
                                label="Username"
                                required
                                autoComplete="off"
                                placeholder="Email penyetuju"
                                data-error-field="approver_email"
                                value={form.approver_email}
                                onChange={(event) =>
                                    setForm({
                                        ...form,
                                        approver_email: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                        <FormControl error={errors.approver_password?.[0]}>
                            <PasswordInput
                                label="Password"
                                required
                                autoComplete="off"
                                data-error-field="approver_password"
                                value={form.approver_password}
                                onChange={(event) =>
                                    setForm({
                                        ...form,
                                        approver_password: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                        <FormControl error={errors.reason?.[0]}>
                            <Textarea
                                label="Alasan Batal"
                                required
                                rows={3}
                                maxLength={200}
                                data-error-field="reason"
                                value={form.reason}
                                onChange={(event) =>
                                    setForm({
                                        ...form,
                                        reason: event.target.value,
                                    })
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
