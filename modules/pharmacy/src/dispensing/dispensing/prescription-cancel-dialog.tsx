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
} from '@core/platform/shell/index.ts';

type View = ApiBody<'pharmacyDispensingShow'>;

// Batal resep yang tidak diambil pasien. Resep yang sudah disiapkan ikut dibatalkan penyiapannya, jadi penjelasannya
// menyebut stok dan tagihan kasir.
export function PrescriptionCancelDialog({
    prescription,
    dispensingVersion,
    prepared,
    onClose,
    onCancelled,
}: {
    prescription: { id: string; prescription_number: string };
    dispensingVersion: number | null;
    prepared: boolean;
    onClose: () => void;
    onCancelled: (view: View) => void;
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
            const { body } = await api.pharmacyPrescriptionCancel({
                params: { id: prescription.id },
                body: { reason, version: dispensingVersion },
            });
            toast.success(
                `Resep ${prescription.prescription_number} dibatalkan.`,
            );
            onCancelled(body);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Resep belum dibatalkan.'));
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
                    <DialogTitle>
                        Batalkan resep {prescription.prescription_number}
                    </DialogTitle>
                    <DialogDescription>
                        {prepared
                            ? 'Obat yang sudah disiapkan kembali ke stok lokasinya dan keluar dari tagihan kasir. '
                            : ''}
                        Resep keluar dari antrean dan tidak bisa disiapkan lagi.
                        Dokter melihat resep ini dibatalkan di E-Resep.
                    </DialogDescription>
                </DialogHeader>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation="Resep belum dibatalkan"
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
                                label="Alasan batal"
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
                    <DialogAction
                        disabled={busy}
                        onClick={(event) => {
                            event.preventDefault();
                            void submit();
                        }}
                    >
                        Batalkan resep
                    </DialogAction>
                    <DialogCancel disabled={busy}>Tutup</DialogCancel>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
