import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { Lock, LockOpen } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../../platform/shell/index.ts';

export type InventoryPeriod = ApiBody<'inventoryPeriodList'>['data'][number];
export type PeriodPermissions = {
    manage: boolean;
    close: boolean;
    reopen: boolean;
};

type Action = 'save' | 'delete' | 'close' | 'reopen';
const failedOperations: Record<Action, string> = {
    save: 'Periode persediaan belum disimpan',
    delete: 'Periode persediaan belum dihapus',
    close: 'Periode persediaan belum ditutup',
    reopen: 'Periode persediaan belum dibuka lagi',
};

const stampText = (stamp: InventoryPeriod['closed_stamp']) =>
    stamp
        ? `${stamp.user_name ?? 'Pengguna tidak dikenal'}, ${new Date(
              stamp.at,
          ).toLocaleString('id-ID', {
              dateStyle: 'short',
              timeStyle: 'short',
          })}`
        : '';

const formOf = (period: InventoryPeriod | null) => ({
    endingDate: period?.ending_date ?? '',
    name: period?.name ?? '',
});

// Kartu periode persediaan (Inventory Periods di BC). Tutup periode mengunci posting dan pembatalan posting bertanggal
// sampai tanggal akhirnya, termasuk periode lebih awal yang masih terbuka; Buka lagi membukanya bersama periode
// sesudahnya. Tanggal akhir terkunci setelah periodenya pernah ditutup.
export function InventoryPeriodCard({
    record,
    can,
    onSaved,
    onClose,
}: {
    record: InventoryPeriod | null;
    can: PeriodPermissions;
    onSaved: (period: InventoryPeriod) => void;
    onClose: () => void;
}): ReactNode {
    const [form, setForm] = useState(() => formOf(record));
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [action, setAction] = useState<Action>('save');
    const { confirm, confirmation } = useConfirmation();
    const portalContainer = useRef<HTMLDivElement>(null);
    usePageDialogRecord({
        recordTitle: record ? record.name : 'Periode persediaan baru',
        editing: can.manage,
    });
    const dateLocked = record !== null && record.closed_stamp !== null;
    const dirty =
        record !== null &&
        (form.endingDate !== record.ending_date || form.name !== record.name);

    const run = async (
        next: Action,
        work: () => Promise<void>,
    ): Promise<void> => {
        setAction(next);
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            await work();
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, `${failedOperations[next]}.`));
        } finally {
            setBusy(false);
        }
    };

    const save = () =>
        run('save', async () => {
            const body = { ending_date: form.endingDate, name: form.name };
            const { body: saved } = record
                ? await api.inventoryPeriodUpdate({
                      params: { id: record.id },
                      body: { ...body, version: record.version },
                  })
                : await api.inventoryPeriodCreate({ body });
            toast.success(
                record
                    ? 'Periode persediaan diperbarui.'
                    : 'Periode persediaan dibuat.',
            );
            onSaved(saved.data);
        });
    const remove = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Delete periode ${record.name}?`,
                description:
                    'Periode ini hilang dari daftar. Stok dan kartu stok tidak berubah.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run('delete', async () => {
            await api.inventoryPeriodDelete({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success('Periode persediaan dihapus.');
            onClose();
        });
    };
    const closePeriod = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Tutup periode ${record.name}?`,
                description: `Stok bertanggal sampai ${displayDate(record.ending_date)} tidak bisa diposting, dan postingnya tidak bisa dibatalkan, sampai periode ini dibuka lagi. Periode lebih awal yang masih terbuka ikut ditutup.`,
                confirmLabel: 'Tutup periode',
            }))
        )
            return;
        await run('close', async () => {
            const { body } = await api.inventoryPeriodClose({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success(`Periode persediaan ${record.name} ditutup.`);
            onSaved(body.data);
        });
    };
    const reopen = async () => {
        if (!record) return;
        if (
            !(await confirm({
                title: `Buka lagi periode ${record.name}?`,
                description:
                    'Stok bertanggal di periode ini bisa diposting dan dibatalkan postingnya lagi. Periode sesudahnya yang sudah ditutup ikut dibuka.',
                confirmLabel: 'Buka lagi',
            }))
        )
            return;
        await run('reopen', async () => {
            const { body } = await api.inventoryPeriodReopen({
                params: { id: record.id },
                body: { version: record.version },
            });
            toast.success(
                `Periode persediaan ${record.name} dan sesudahnya dibuka lagi.`,
            );
            onSaved(body.data);
        });
    };

    return (
        <div ref={portalContainer} className="flex min-h-0 flex-1 flex-col">
            <form
                noValidate
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void save();
                }}
            >
                <PageDialogToolbar>
                    {can.manage && (
                        <>
                            <ActionButton
                                action="save"
                                type="submit"
                                disabled={busy}
                                pending={busy && action === 'save'}
                            />
                            <ActionButton
                                action="cancel"
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                    if (!record) {
                                        onClose();
                                        return;
                                    }
                                    setForm(formOf(record));
                                    setErrors({});
                                    setMessage(null);
                                }}
                            />
                        </>
                    )}
                    {record && !record.closed && can.manage && (
                        <ActionButton
                            action="archive"
                            disabled={busy}
                            onClick={() => void remove()}
                        />
                    )}
                    {record && !record.closed && can.close && (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy || dirty}
                            title={
                                dirty
                                    ? 'Ada perubahan yang belum disimpan. Simpan atau batalkan dulu.'
                                    : undefined
                            }
                            onClick={() => void closePeriod()}
                        >
                            <Lock aria-hidden="true" />
                            Tutup periode
                        </Button>
                    )}
                    {record?.closed && can.reopen && (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy || dirty}
                            onClick={() => void reopen()}
                        >
                            <LockOpen aria-hidden="true" />
                            Buka lagi
                        </Button>
                    )}
                </PageDialogToolbar>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation={failedOperations[action]}
                />
                <PageDialogBody className="py-3">
                    <FormGrid>
                        <FormControl
                            error={errors.ending_date?.[0]}
                            hint="Setelah periode ditutup, stok bertanggal sampai tanggal ini tidak bisa diposting atau dibatalkan postingnya."
                        >
                            <DatePicker
                                label="Tanggal akhir"
                                required
                                data-error-field="ending_date"
                                value={form.endingDate}
                                readOnly={!can.manage || dateLocked}
                                onValueChange={(endingDate) =>
                                    setForm((current) => ({
                                        ...current,
                                        endingDate,
                                    }))
                                }
                                portalContainer={portalContainer}
                            />
                        </FormControl>
                        <FormControl error={errors.name?.[0]}>
                            <Input
                                label="Nama"
                                maxLength={50}
                                data-error-field="name"
                                placeholder="Bulan dan tahun tanggal akhir"
                                value={form.name}
                                readOnly={!can.manage}
                                onChange={(event) =>
                                    setForm((current) => ({
                                        ...current,
                                        name: event.target.value,
                                    }))
                                }
                            />
                        </FormControl>
                        {record && (
                            <FormControl>
                                <Input
                                    label="Status"
                                    readOnly
                                    value={
                                        record.closed ? 'Ditutup' : 'Terbuka'
                                    }
                                />
                            </FormControl>
                        )}
                        {record?.closed_stamp && (
                            <FormControl>
                                <Input
                                    label={
                                        record.closed
                                            ? 'Ditutup oleh'
                                            : 'Terakhir ditutup oleh'
                                    }
                                    readOnly
                                    value={stampText(record.closed_stamp)}
                                />
                            </FormControl>
                        )}
                        {record?.reopened_stamp && (
                            <FormControl>
                                <Input
                                    label="Dibuka lagi oleh"
                                    readOnly
                                    value={stampText(record.reopened_stamp)}
                                />
                            </FormControl>
                        )}
                    </FormGrid>
                </PageDialogBody>
                {confirmation}
            </form>
        </div>
    );
}
