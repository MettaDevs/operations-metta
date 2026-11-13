import { Button } from '@operations-metta/ui/button';
import { DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
import {
    displayAmount,
    displayNumber,
} from '@operations-metta/ui/display-number';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { Link } from '@tanstack/react-router';
import { ClipboardList, Undo2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import {
    api,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import { divideRounded } from '../../../platform/money/index.ts';
import { display, fromNumeric, quantityScale } from '../quantity.ts';

export type PostedTransferKind = 'shipment' | 'receipt';
export type PostedTransfer = ApiBody<'inventoryTransferShipmentShow'>['data'];

export const postedTransferLabels: Record<PostedTransferKind, string> = {
    shipment: 'Mutasi',
    receipt: 'Penerimaan mutasi',
};
export const postedTransferStatusLabels: Record<
    PostedTransfer['status'],
    string
> = {
    diposting: 'Diposting',
    dibatalkan: 'Dibatalkan',
};
const modeLabels: Record<PostedTransfer['transfer_mode'], string> = {
    langsung: 'Langsung',
    kirim_terima: 'Kirim lalu terima',
};
const label = (entry: { code: string; name: string }) =>
    `${entry.code} - ${entry.name}`;

// Jumlah baris terposting dalam satuan dasar, lalu dalam satuan kemasan amprahnya, dibagi dengan bilangan bulat berskala
// dan dibulatkan ke skala jumlah barang.
function quantityText(line: PostedTransfer['lines'][number]) {
    const base = fromNumeric(line.quantity, quantityScale);
    const perUnit = fromNumeric(line.quantity_per_unit, quantityScale);
    const inBase = `${displayNumber(line.quantity)} ${line.item.base_unit}`;
    if (perUnit === 10n ** BigInt(quantityScale)) return inBase;
    const units = divideRounded(base * 10n ** BigInt(quantityScale), perUnit);
    return `${displayNumber(display(units, quantityScale))} ${line.unit.code} (${inBase})`;
}

// Mutasi atau penerimaan mutasi yang sudah diposting: hanya dibaca, dan postingnya bisa dibatalkan selama barangnya
// belum dipakai di lokasi tujuan.
export function PostedTransferCard({
    kind,
    document: initial,
    canReverse,
    orderLink = false,
    onReversed,
}: {
    kind: PostedTransferKind;
    document: PostedTransfer;
    canReverse: boolean;
    orderLink?: boolean;
    onReversed: (document: PostedTransfer) => void;
}): ReactNode {
    const [document, setDocument] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    usePageDialogRecord({
        recordTitle: `${document.number} ${document.to_location.name}`,
        editing: false,
    });

    const reverse = async () => {
        if (
            !(await confirm({
                title: `Batalkan posting ${document.number}?`,
                description:
                    kind === 'shipment'
                        ? 'Barang kembali ke stok lokasi pemasok, dan jumlah dikirim di amprah berkurang. Pembatalan ditolak bila barangnya sudah diterima atau dipakai.'
                        : 'Barang kembali ke lokasi transit, dan jumlah diterima di amprah berkurang. Pembatalan ditolak bila barangnya sudah dipakai.',
                confirmLabel: 'Batalkan posting',
                destructive: true,
            }))
        )
            return;
        setBusy(true);
        setMessage(null);
        try {
            const request = {
                params: { id: document.id },
                body: { version: document.version },
            };
            const { body } =
                kind === 'shipment'
                    ? await api.inventoryTransferShipmentReverse(request)
                    : await api.inventoryTransferReceiptReverse(request);
            toast.success(`Posting ${document.number} dibatalkan.`);
            setDocument(body.data);
            onReversed(body.data);
        } catch (caught) {
            setMessage(errorText(caught, 'Posting belum dibatalkan.'));
        } finally {
            setBusy(false);
        }
    };

    const text = (value: string) => <DataTableText>{value}</DataTableText>;

    return (
        <>
            <PageDialogToolbar>
                {document.status === 'diposting' && canReverse && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="command"
                        disabled={busy}
                        onClick={() => void reverse()}
                    >
                        <Undo2 aria-hidden="true" />
                        Batal posting
                    </Button>
                )}
                {orderLink && (
                    <Button asChild variant="ghost" size="command">
                        <Link
                            to="/sysadmin/inventory/transfer-orders"
                            search={{ q: document.transfer_order.number }}
                        >
                            <ClipboardList aria-hidden="true" />
                            Buka amprah
                        </Link>
                    </Button>
                )}
            </PageDialogToolbar>
            <FormErrorHeader
                errors={{}}
                message={message}
                operation="Posting belum dibatalkan"
            />
            <PageDialogBody className="space-y-4 py-3">
                <FormGrid>
                    <FormControl>
                        <Input
                            label="Tanggal posting"
                            readOnly
                            value={displayDate(document.posting_date)}
                        />
                    </FormControl>
                    <FormControl>
                        <Input
                            label="Amprah"
                            readOnly
                            value={document.transfer_order.number}
                        />
                    </FormControl>
                    <FormControl>
                        <Input
                            label={
                                kind === 'shipment' ? 'Dari' : 'Dari transit'
                            }
                            readOnly
                            value={label(document.from_location)}
                        />
                    </FormControl>
                    <FormControl>
                        <Input
                            label="Ke"
                            readOnly
                            value={label(document.to_location)}
                        />
                    </FormControl>
                    {kind === 'shipment' && document.transit_location && (
                        <FormControl>
                            <Input
                                label="Lewat transit"
                                readOnly
                                value={label(document.transit_location)}
                            />
                        </FormControl>
                    )}
                    {kind === 'shipment' && (
                        <FormControl>
                            <Input
                                label="Cara mutasi"
                                readOnly
                                value={modeLabels[document.transfer_mode]}
                            />
                        </FormControl>
                    )}
                    <FormControl>
                        <Input
                            label="Nilai"
                            readOnly
                            value={displayAmount(
                                document.amount,
                                document.amount_decimals,
                            )}
                        />
                    </FormControl>
                    <FormControl>
                        <Input
                            label="Status"
                            readOnly
                            value={postedTransferStatusLabels[document.status]}
                        />
                    </FormControl>
                </FormGrid>
                <DocumentLines
                    title={
                        kind === 'shipment'
                            ? 'Barang yang dikirim'
                            : 'Barang yang diterima'
                    }
                    data={document.lines}
                    getRowKey={(line) => line.id}
                    getRowLabel={(line) => line.item.name}
                    showRowNumbers
                    readOnly
                    emptyMessage="Dokumen ini tidak berisi barang."
                    columns={[
                        {
                            id: 'item',
                            header: 'Barang',
                            minWidth: 240,
                            cell: (line) => text(label(line.item)),
                        },
                        {
                            id: 'quantity',
                            header: 'Jumlah',
                            minWidth: 170,
                            align: 'right',
                            cell: (line) => text(quantityText(line)),
                        },
                        {
                            id: 'batch',
                            header: 'No. batch',
                            minWidth: 120,
                            cell: (line) =>
                                text(line.batch?.batch_number ?? ''),
                        },
                        {
                            id: 'expiry_date',
                            header: 'Kedaluwarsa',
                            minWidth: 120,
                            cell: (line) =>
                                text(
                                    line.batch?.expiry_date
                                        ? displayDate(line.batch.expiry_date)
                                        : '',
                                ),
                        },
                        {
                            id: 'funding_source',
                            header: 'Sumber dana',
                            minWidth: 130,
                            cell: (line) =>
                                text(line.funding_source?.code ?? ''),
                        },
                        {
                            id: 'procurement_program',
                            header: 'Program',
                            minWidth: 130,
                            cell: (line) =>
                                text(line.procurement_program?.code ?? ''),
                        },
                        {
                            id: 'budget_year',
                            header: 'Tahun anggaran',
                            minWidth: 110,
                            cell: (line) =>
                                text(
                                    line.budget_year === null
                                        ? ''
                                        : String(line.budget_year),
                                ),
                        },
                        {
                            id: 'amount',
                            header: 'Nilai',
                            minWidth: 120,
                            align: 'right',
                            cell: (line) =>
                                text(
                                    displayAmount(
                                        line.amount,
                                        document.amount_decimals,
                                    ),
                                ),
                        },
                    ]}
                />
            </PageDialogBody>
            {confirmation}
        </>
    );
}
