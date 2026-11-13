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
import {
    isPaymentMethodBehavior,
    paymentMethodBehaviors,
} from './payment-method.behaviors.ts';

type Result = ApiBody<'billingPaymentMethodLegacyImport'>['data'][number];

const legacyQuery =
    'SELECT IDBayar, Description, NoUrut, Kode, Cash, Bank, CC, Jaminan, Others, Active FROM mJenisBayar FOR JSON PATH';

// Impor jenis bayar dari mJenisBayar sistem lama, untuk tim yang memindahkan klinik. Hasil query di bawah ditempel apa
// adanya; server yang memetakan perilakunya dan melaporkan baris yang tidak diimpor beserta alasannya.
export function LegacyImportDialog({
    onClose,
}: {
    onClose: () => void;
}): ReactNode {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [results, setResults] = useState<Result[] | null>(null);

    const submit = async () => {
        setErrors({});
        setMessage(null);
        let rows: unknown;
        try {
            rows = JSON.parse(text);
        } catch {
            setErrors({
                rows: ['Isian ini bukan JSON. Tempel hasil query apa adanya.'],
            });
            return;
        }
        setBusy(true);
        try {
            const { body } = await api.billingPaymentMethodLegacyImport({
                body: { rows },
            });
            setResults(body.data);
            const imported = body.data.filter((row) => row.imported).length;
            toast.success(`${imported} jenis bayar diimpor.`);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Jenis bayar belum diimpor.'));
        } finally {
            setBusy(false);
        }
    };

    const cell = (value: string) => <DataTableText>{value}</DataTableText>;
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent size="wide">
                <DialogHeader>
                    <DialogTitle>
                        Impor jenis bayar dari sistem lama
                    </DialogTitle>
                    <DialogDescription>
                        Jalankan query ini di database klinik sistem lama, lalu
                        tempel hasilnya. Jenis bayar masuk ke legal entity yang
                        sedang aktif. Mengimpor ulang tidak menambah jenis bayar
                        yang sudah diimpor.
                    </DialogDescription>
                </DialogHeader>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation="Jenis bayar belum diimpor"
                />
                <DialogBody className="space-y-4">
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                        {legacyQuery}
                    </pre>
                    {results === null ? (
                        <FormControl error={errors.rows?.[0]}>
                            <Textarea
                                label="Hasil query"
                                required
                                rows={10}
                                data-error-field="rows"
                                value={text}
                                onChange={(event) =>
                                    setText(event.target.value)
                                }
                            />
                        </FormControl>
                    ) : (
                        <DataTable
                            data={results}
                            getRowKey={(row) => String(row.legacy_id)}
                            getRowLabel={(row) => row.legacy_name}
                            scrollMode="inline"
                            showRowNumbers
                            emptyMessage="Tidak ada baris."
                            columns={[
                                {
                                    id: 'legacy',
                                    header: 'Sistem lama',
                                    width: 220,
                                    cell: (row) =>
                                        cell(
                                            `${row.legacy_id} ${row.legacy_name}`,
                                        ),
                                },
                                {
                                    id: 'result',
                                    header: 'Hasil',
                                    width: 200,
                                    cell: (row) =>
                                        cell(
                                            row.imported &&
                                                row.behavior !== null &&
                                                isPaymentMethodBehavior(
                                                    row.behavior,
                                                )
                                                ? `${row.code ?? ''} · ${paymentMethodBehaviors[row.behavior].label}`
                                                : 'Tidak diimpor',
                                        ),
                                },
                                {
                                    id: 'notes',
                                    header: 'Keterangan',
                                    width: 420,
                                    cell: (row) => cell(row.notes.join(' ')),
                                },
                            ]}
                        />
                    )}
                </DialogBody>
                <DialogFooter>
                    {results === null ? (
                        <>
                            <DialogCancel disabled={busy}>Batal</DialogCancel>
                            <DialogAction
                                disabled={busy || !text.trim()}
                                onClick={(event) => {
                                    event.preventDefault();
                                    void submit();
                                }}
                            >
                                Impor
                            </DialogAction>
                        </>
                    ) : (
                        <DialogAction onClick={onClose}>Selesai</DialogAction>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
