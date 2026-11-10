import { Badge } from '@operations-metta/ui/badge';
import { Button } from '@operations-metta/ui/button';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { FieldDescription } from '@operations-metta/ui/field';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
} from '@operations-metta/ui/page-dialog';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery } from '@tanstack/react-query';
import { Eraser, RotateCw } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { api, errorText } from '../../platform/shell/index.ts';

// Status list dan Manual cleanup F&O, di grup Administrasi toolbar daftar dan kartu, bukan bagian di dalam kartu.
// Pesanan nomor yang belum dipakai dokumen punya dua keadaan: masih menunggu dokumennya disimpan, atau sudah lewat
// batas waktu 15 menit. Hanya yang kedua yang dikembalikan Bersihkan manual.

const cleanupText = {
    title: 'Kembalikan nomor yang lewat batas waktu?',
    description:
        'Nomor yang dipesan lebih dari 15 menit lalu dan tidak pernah dipakai dokumen dikembalikan, lalu dipakai lagi oleh dokumen berikutnya. Pesanan yang masih menunggu dokumennya disimpan tidak disentuh.',
    confirmLabel: 'Kembalikan',
};

function time(value: string | null): string {
    return value ? new Date(value).toLocaleString('id-ID') : '-';
}

// Bersihkan manual untuk satu atau beberapa pengaturan nomor, dengan konfirmasi dan pesan hasil yang sama di daftar
// dan di Status list.
export function useCleanup(): {
    cleanup: (ids: string[]) => Promise<boolean>;
    busy: boolean;
    confirmation: ReactNode;
} {
    const [busy, setBusy] = useState(false);
    const { confirm, confirmation } = useConfirmation();
    const cleanup = async (ids: string[]) => {
        if (!(await confirm(cleanupText))) return false;
        setBusy(true);
        try {
            let released = 0;
            for (const id of ids)
                released += (
                    await api.numberSequenceCleanup({
                        params: { id },
                        body: {},
                    })
                ).body.data.released;
            toast.success(
                released
                    ? `${released} nomor dikembalikan.`
                    : 'Tidak ada nomor yang lewat batas waktu.',
            );
            return true;
        } catch (caught) {
            toast.error(errorText(caught, 'Nomor belum dikembalikan.'));
            return false;
        } finally {
            setBusy(false);
        }
    };
    return { cleanup, busy, confirmation };
}

export function StatusListDialog({
    sequenceId,
    title,
    canManage,
    onClose,
}: {
    sequenceId: string;
    title: string;
    canManage: boolean;
    onClose: () => void;
}): ReactNode {
    const { cleanup, busy, confirmation } = useCleanup();
    const list = useQuery({
        queryKey: ['number-sequence-status-list', sequenceId],
        queryFn: async () =>
            (
                await api.numberSequenceStatusList({
                    params: { id: sequenceId },
                })
            ).body.data,
    });
    const cleanupHere = async () => {
        if (await cleanup([sequenceId])) await list.refetch();
    };
    const rows = list.data ?? [];
    const expired = rows.filter((row) => row.expired).length;
    return (
        <PageDialog
            open
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <PageDialogContent
                title="Status list"
                recordTitle={title}
                busy={busy}
            >
                <PageDialogToolbar>
                    {canManage && (
                        <Button
                            type="button"
                            variant="ghost"
                            disabled={busy || expired === 0}
                            onClick={() => void cleanupHere()}
                        >
                            <Eraser aria-hidden="true" />
                            Bersihkan manual
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={list.isFetching}
                        onClick={() => void list.refetch()}
                    >
                        <RotateCw aria-hidden="true" />
                        Muat ulang
                    </Button>
                </PageDialogToolbar>
                <PageDialogBody className="flex flex-col gap-3 py-3">
                    <FieldDescription>
                        Nomor di sini sudah dipesan oleh dokumen yang belum
                        selesai disimpan. Bila dokumennya tidak disimpan dalam
                        15 menit, pesanannya lewat batas waktu dan nomornya bisa
                        dikembalikan dengan Bersihkan manual.
                    </FieldDescription>
                    {list.isError ? (
                        <p className="text-sm text-destructive">
                            {errorText(
                                list.error,
                                'Status nomor belum bisa dimuat.',
                            )}{' '}
                            <Button
                                type="button"
                                variant="link"
                                onClick={() => void list.refetch()}
                            >
                                Coba lagi
                            </Button>
                        </p>
                    ) : (
                        <DataTable
                            data={rows}
                            getRowKey={(row) => row.id}
                            scrollMode="inline"
                            emptyMessage={
                                list.isPending
                                    ? 'Memuat nomor yang sedang dipesan...'
                                    : 'Tidak ada nomor yang sedang dipesan.'
                            }
                            columns={[
                                {
                                    id: 'number',
                                    header: 'Nomor',
                                    cell: (row) => (
                                        <DataTableText>
                                            {row.number}
                                        </DataTableText>
                                    ),
                                },
                                {
                                    id: 'reserved_at',
                                    header: 'Dipesan pada',
                                    cell: (row) => (
                                        <DataTableText>
                                            {time(row.reserved_at)}
                                        </DataTableText>
                                    ),
                                },
                                {
                                    id: 'expires_at',
                                    header: 'Batas waktu',
                                    cell: (row) => (
                                        <DataTableText>
                                            {time(row.expires_at)}
                                        </DataTableText>
                                    ),
                                },
                                {
                                    id: 'state',
                                    header: 'Keadaan',
                                    cell: (row) =>
                                        row.expired ? (
                                            <Badge variant="destructive">
                                                Lewat batas waktu
                                            </Badge>
                                        ) : (
                                            <Badge variant="secondary">
                                                Menunggu dokumen disimpan
                                            </Badge>
                                        ),
                                },
                            ]}
                        />
                    )}
                </PageDialogBody>
                {confirmation}
            </PageDialogContent>
        </PageDialog>
    );
}
