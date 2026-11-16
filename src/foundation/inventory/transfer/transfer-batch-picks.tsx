import { Button } from '@operations-metta/ui/button';
import { displayDate } from '@operations-metta/ui/date-picker';
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
import { displayNumber } from '@operations-metta/ui/display-number';
import { DataTableText } from '@operations-metta/ui/data-table';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Decimal } from '../../../platform/money/index.ts';
import type { ApiBody } from '../../../platform/shell/index.ts';

type StoredLine =
    ApiBody<'inventoryTransferOrderShow'>['data']['lines'][number];
export type BatchPick = StoredLine['batches'][number];

const zero = Decimal.of(0);

// Isian jumlah ke Decimal: kosong berarti 0, isian yang bukan angka null.
function amountOf(text: string): Decimal | null {
    try {
        return text.trim() === '' ? zero : Decimal.of(text);
    } catch {
        return null;
    }
}

// Urutan batch pilihan sama dengan urutan dari server, kedaluwarsa terdekat lebih dulu, supaya isian yang tidak berubah
// tidak terbaca berubah.
const byExpiry = (left: BatchPick, right: BatchPick) =>
    (left.expiry_date ?? '9999-12-31').localeCompare(
        right.expiry_date ?? '9999-12-31',
    ) || left.batch_number.localeCompare(right.batch_number);

// Item Tracking Lines BC saat Transfer Order dikirim: pengirim mengisi jumlah yang diambil dari tiap batch di lokasi
// pemasok, dalam satuan dasar. Simpan hanya mengubah isian kartu; pilihan tersimpan bersama jumlah akan dikirim saat
// kartu disimpan atau saat Post kirim.
export function TransferBatchPicksDialog({
    line,
    location,
    toShip,
    picks,
    onApply,
    onClose,
}: {
    line: StoredLine;
    location: string;
    // Jumlah akan dikirim dalam satuan baris, sebagaimana diisi di kartu.
    toShip: string;
    picks: BatchPick[];
    onApply: (picks: BatchPick[]) => void;
    onClose: () => void;
}): ReactNode {
    const contentRef = useRef<HTMLDivElement>(null);
    const unit = line.item.base_unit;
    // Batch yang sudah dipilih tetap tampil walau stoknya sudah habis, supaya pilihannya bisa dikosongkan.
    const rows: BatchPick[] = [
        ...line.supplier_batches,
        ...picks
            .filter(
                (pick) =>
                    !line.supplier_batches.some(
                        (batch) => batch.batch_id === pick.batch_id,
                    ),
            )
            .map((pick) => ({ ...pick, quantity: '0' })),
    ];
    const [taken, setTaken] = useState<Record<string, string>>(() =>
        Object.fromEntries(picks.map((pick) => [pick.batch_id, pick.quantity])),
    );
    const needed =
        amountOf(toShip)?.multipliedBy(Decimal.of(line.quantity_per_unit)) ??
        null;
    const total = rows.reduce<Decimal | null>((sum, row) => {
        const value = amountOf(taken[row.batch_id] ?? '');
        return sum && value ? sum.plus(value) : null;
    }, zero);
    const shown = (value: Decimal) =>
        `${displayNumber(value.normalized())} ${unit}`;

    const status = () => {
        if (total === null) return 'Periksa jumlah yang diisi.';
        if (total.compare(zero) === 0)
            return 'Belum ada batch yang diisi. Batch diambil otomatis saat Post kirim.';
        if (needed === null) return `Dipilih ${shown(total)}.`;
        const difference = total.compare(needed);
        const picked = `Dipilih ${displayNumber(total.normalized())} dari ${shown(needed)}.`;
        if (difference === 0) return picked;
        return difference < 0
            ? `${picked} Kurang ${shown(needed.minus(total))}.`
            : `${picked} Lebih ${shown(total.minus(needed))}.`;
    };

    const apply = () =>
        onApply(
            rows
                .flatMap((row) => {
                    const text = (taken[row.batch_id] ?? '').trim();
                    const value = amountOf(text);
                    return text === '' || value?.compare(zero) === 0
                        ? []
                        : [{ ...row, quantity: text }];
                })
                .sort(byExpiry),
        );

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <DialogContent ref={contentRef} size="wide">
                <DialogHeader>
                    <DialogTitle>Pilih batch</DialogTitle>
                    <DialogDescription>
                        {`${line.item.code} - ${line.item.name}. Isi jumlah yang diambil dari tiap batch di ${location}, dalam ${unit}. Batch yang tidak diisi tidak diambil; tanpa isian sama sekali, batch diambil otomatis saat Post kirim menurut cara pengambilan lokasi itu (FEFO atau FIFO).`}
                    </DialogDescription>
                </DialogHeader>
                <DialogBody>
                    <DocumentLines
                        title={`Stok ${location}`}
                        data={rows}
                        getRowKey={(row) => row.batch_id}
                        getRowLabel={(row) => row.batch_number}
                        portalContainer={contentRef}
                        emptyMessage={`Tidak ada batch barang ini yang punya stok di ${location}.`}
                        columns={[
                            {
                                id: 'batch_number',
                                header: 'Batch',
                                minWidth: 160,
                                cell: (row) => (
                                    <DataTableText>
                                        {row.batch_number}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'expiry_date',
                                header: 'Kedaluwarsa',
                                minWidth: 120,
                                cell: (row) => (
                                    <DataTableText>
                                        {row.expiry_date
                                            ? displayDate(row.expiry_date)
                                            : ''}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'stock',
                                header: `Stok (${unit})`,
                                minWidth: 110,
                                align: 'right',
                                cell: (row) => (
                                    <DataTableText>
                                        {displayNumber(row.quantity)}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'quantity',
                                header: `Diambil (${unit})`,
                                content: 'control',
                                minWidth: 130,
                                cell: (row) => {
                                    const value = amountOf(
                                        taken[row.batch_id] ?? '',
                                    );
                                    return (
                                        <FormControl
                                            error={
                                                value &&
                                                value.compare(
                                                    Decimal.of(row.quantity),
                                                ) > 0
                                                    ? 'Melebihi stok batch ini.'
                                                    : undefined
                                            }
                                        >
                                            <Input
                                                label="Diambil"
                                                type="number"
                                                min={0}
                                                step="any"
                                                inputMode="decimal"
                                                value={
                                                    taken[row.batch_id] ?? ''
                                                }
                                                onChange={(event) =>
                                                    setTaken((current) => ({
                                                        ...current,
                                                        [row.batch_id]:
                                                            event.target.value,
                                                    }))
                                                }
                                            />
                                        </FormControl>
                                    );
                                },
                            },
                        ]}
                    />
                </DialogBody>
                <DialogFooter>
                    <p
                        role="status"
                        className="me-auto text-sm text-muted-foreground"
                    >
                        {status()}
                    </p>
                    <DialogAction type="button" onClick={apply}>
                        Simpan
                    </DialogAction>
                    <Button
                        type="button"
                        variant="ghost"
                        size="command"
                        onClick={() => onApply([])}
                    >
                        Otomatis
                    </Button>
                    <DialogCancel />
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
