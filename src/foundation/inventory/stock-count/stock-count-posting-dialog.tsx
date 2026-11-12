import {
    Alert,
    AlertDescription,
    AlertTitle,
} from '@operations-metta/ui/alert';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
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
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    orpc,
} from '../../../platform/shell/index.ts';
import type { StockCount } from './stock-count-card.tsx';
import { displayNumber } from '../display-number.ts';
import { label } from './stock-count-fields.tsx';

type Errors = Record<string, string[]>;

const signed = (value: string) =>
    `${value.startsWith('-') || value === '0' ? '' : '+'}${displayNumber(value)}`;

// Konfirmasi Post: jumlah tercatat dihitung ulang sampai tanggal posting, jadi selisih yang diposting bisa berbeda dari
// selisih saat hitung. Barang yang bergerak sesudah hitung dimulai ditandai supaya hitungannya diperiksa lagi; posting
// tetap boleh.
export function StockCountPostingDialog({
    count,
    onClose,
    onPosted,
}: {
    count: StockCount;
    onClose: () => void;
    onPosted: (count: StockCount) => void;
}): ReactNode {
    const contentRef = useRef<HTMLDivElement>(null);
    const [postingDate, setPostingDate] = useState(count.posting_date);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const preview = useQuery(
        orpc.inventoryStockCountPreview.queryOptions({
            input: {
                params: { id: count.id },
                query: { posting_date: postingDate },
            },
            select: (response) => response.body.data.lines,
        }),
    );
    const lines = new Map(count.lines.map((line) => [line.id, line]));
    const rows = (preview.data ?? []).flatMap((entry) => {
        const line = lines.get(entry.id);
        return line ? [{ ...entry, line }] : [];
    });
    const moved = rows.filter((row) => row.moved_after_count_started);
    const differing = rows.filter((row) => Number(row.difference) !== 0);

    const post = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.inventoryStockCountPost({
                params: { id: count.id },
                body: { version: count.version, posting_date: postingDate },
            });
            onPosted(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Opname belum diposting.'));
        } finally {
            setBusy(false);
        }
    };

    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent ref={contentRef} size="full">
                <DialogHeader>
                    <DialogTitle>Post {count.number}?</DialogTitle>
                    <DialogDescription>
                        Jumlah tercatat di {count.location.name} dihitung ulang
                        sampai tanggal posting. Selisih lebih masuk ke stok,
                        selisih kurang dikeluarkan dari batchnya.
                    </DialogDescription>
                </DialogHeader>
                <FormErrorHeader
                    errors={errors}
                    message={
                        message ??
                        (preview.isError
                            ? errorText(
                                  preview.error,
                                  'Selisih belum bisa dihitung.',
                              )
                            : null)
                    }
                    operation="Opname belum diposting"
                />
                <DialogBody className="space-y-4">
                    <FormGrid>
                        <FormControl error={errors.posting_date?.join(' ')}>
                            <DatePicker
                                label="Tanggal posting"
                                required
                                data-error-field="posting_date"
                                value={postingDate}
                                portalContainer={contentRef}
                                onValueChange={setPostingDate}
                            />
                        </FormControl>
                    </FormGrid>
                    {moved.length > 0 && (
                        <Alert>
                            <TriangleAlert
                                aria-hidden="true"
                                className="text-warning"
                            />
                            <AlertTitle>
                                {moved.length} baris bergerak sesudah hitung
                                dimulai
                            </AlertTitle>
                            <AlertDescription>
                                Stoknya masuk atau keluar sesudah hitung
                                dimulai, jadi jumlah dihitung mungkin belum
                                memasukkan gerak itu. Periksa lagi baris yang
                                ditandai sebelum posting.
                            </AlertDescription>
                        </Alert>
                    )}
                    <DataTable
                        data={rows}
                        getRowKey={(row) => row.id}
                        getRowLabel={(row) => row.line.item.name}
                        scrollMode="inline"
                        showRowNumbers
                        emptyMessage={
                            preview.isPending
                                ? 'Menghitung selisih…'
                                : 'Opname ini tidak berisi barang.'
                        }
                        columns={[
                            {
                                id: 'item',
                                header: 'Barang',
                                width: 240,
                                cell: (row) => text(label(row.line.item)),
                            },
                            {
                                id: 'batch',
                                header: 'Batch',
                                width: 120,
                                cell: (row) =>
                                    text(
                                        row.line.batch?.batch_number ??
                                            row.line.batch_number ??
                                            '',
                                    ),
                            },
                            {
                                id: 'quantity_expected',
                                header: 'Tercatat sekarang',
                                width: 120,
                                align: 'right',
                                cell: (row) =>
                                    text(
                                        `${displayNumber(row.quantity_expected)} ${row.line.item.base_unit}`,
                                    ),
                            },
                            {
                                id: 'quantity_counted',
                                header: 'Dihitung',
                                width: 110,
                                align: 'right',
                                cell: (row) =>
                                    text(
                                        `${displayNumber(row.quantity_counted)} ${row.line.item.base_unit}`,
                                    ),
                            },
                            {
                                id: 'difference',
                                header: 'Selisih',
                                width: 110,
                                align: 'right',
                                cell: (row) =>
                                    text(
                                        `${signed(row.difference)} ${row.line.item.base_unit}`,
                                    ),
                            },
                            {
                                id: 'unit_cost',
                                header: 'Harga stok temuan',
                                width: 130,
                                align: 'right',
                                cell: (row) =>
                                    text(
                                        row.unit_cost === null
                                            ? ''
                                            : displayNumber(row.unit_cost),
                                    ),
                            },
                            {
                                id: 'moved',
                                header: 'Bergerak sesudah mulai hitung',
                                width: 140,
                                cell: (row) =>
                                    text(
                                        row.moved_after_count_started
                                            ? 'Ya, periksa lagi'
                                            : 'Tidak',
                                    ),
                            },
                        ]}
                    />
                    <p className="text-sm text-muted-foreground">
                        {differing.length} dari {rows.length} baris berselisih.
                        Harga stok temuan diambil dari penerimaan terakhir batch
                        itu di lokasi ini, lalu dari penerimaan terakhir barang
                        itu, atau 0 bila belum pernah diterima.
                    </p>
                </DialogBody>
                <DialogFooter>
                    <DialogAction
                        type="button"
                        disabled={busy || preview.isPending}
                        onClick={() => void post()}
                    >
                        Post
                    </DialogAction>
                    <DialogCancel disabled={busy} />
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
