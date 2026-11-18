import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import {
    displayNumber,
    parseDisplayNumber,
} from '@operations-metta/ui/display-number';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { Textarea } from '@operations-metta/ui/textarea';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    PrintAction,
    type ApiBody,
    type ErrorAction,
    LineUnitLookup,
} from '../../../platform/shell/index.ts';

type View = ApiBody<'purchasingReturnList'>;
type Returnable = View['data']['returnable'][number];

const returnsKey = (receiptId: string) => ['purchase-returns', receiptId];

const numberFormat =
    'Tulis angka seperti 2 atau 2,5. Titik untuk ribuan, koma untuk desimal.';
const today = () => new Date().toLocaleDateString('sv-SE');

const baseText = (quantity: string, row: Returnable) =>
    `${displayNumber(quantity)} ${row.base_unit.code}`;

const unitChoices = (row: Returnable) =>
    row.units.some((unit) => unit.id === row.unit.id)
        ? row.units
        : [
              { ...row.unit, quantity_per_unit: row.quantity_per_unit },
              ...row.units,
          ];

const batchText = (row: Returnable) =>
    row.batch_number
        ? `${row.batch_number}${row.expiry_date ? ` · ED ${displayDate(row.expiry_date)}` : ''}`
        : 'Tanpa batch';

function useReturns(receiptId: string, enabled = true) {
    return useQuery({
        queryKey: returnsKey(receiptId),
        queryFn: async () =>
            (await api.purchasingReturnList({ params: { id: receiptId } }))
                .body,
        refetchOnWindowFocus: false,
        enabled,
    });
}

export function useCanReturnToVendor(receiptId: string, enabled: boolean) {
    return useReturns(receiptId, enabled).data?.permissions.create ?? false;
}

// Retur ke vendor: per baris penerimaan, berapa yang diterima, berapa yang sudah diretur, dan berapa yang masih ada di
// lokasi dan boleh dikembalikan sekarang. Stok keluar dari baris penerimaan itu sendiri, dengan harga dan batchnya.
export function PurchaseReturnCard({
    receiptId,
    onDone,
    portalContainer,
}: {
    receiptId: string;
    onDone: (saved: boolean) => void;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    const queryClient = useQueryClient();
    const stored = useReturns(receiptId);
    const [postingDate, setPostingDate] = useState(today);
    const [quantities, setQuantities] = useState<Record<string, string>>({});
    const [units, setUnits] = useState<Record<string, string>>({});
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    usePageDialogRecord({
        recordTitle: 'Retur ke vendor baru',
        editing: true,
        dirty:
            reason !== '' ||
            Object.values(quantities).some((typed) => typed.trim() !== '') ||
            Object.keys(units).length > 0,
    });
    const rows = stored.data?.data.returnable ?? [];
    const unitOf = (row: Returnable) =>
        units[row.receipt_line_id] ?? row.unit.id;

    const save = async () => {
        const invalid: Record<string, string[]> = {};
        const lines = rows.map((row, index) => {
            const typed = (quantities[row.receipt_line_id] ?? '').trim();
            const quantity = typed ? parseDisplayNumber(typed) : '0';
            if (quantity === null)
                invalid[`lines.${index}.quantity`] = [numberFormat];
            return {
                receipt_line_id: row.receipt_line_id,
                quantity: quantity ?? typed,
                unit_id: unitOf(row),
            };
        });
        setMessage(null);
        if (Object.keys(invalid).length) {
            setErrors(invalid);
            return;
        }
        setBusy(true);
        setErrors({});
        try {
            const { body } = await api.purchasingReturnCreate({
                params: { id: receiptId },
                body: { posting_date: postingDate, reason, lines },
            });
            queryClient.setQueryData(returnsKey(receiptId), body);
            const created = body.data.returns.at(-1);
            toast.success(
                `Retur ${created?.number ?? ''} diposting. Barangnya keluar dari stok lokasi penerimaan.`,
            );
            onDone(true);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Retur belum disimpan.'));
        } finally {
            setBusy(false);
        }
    };

    return (
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
                <ActionButton
                    action="save"
                    type="submit"
                    disabled={busy || !stored.data}
                    pending={busy}
                />
                <ActionButton
                    action="cancel"
                    type="button"
                    disabled={busy}
                    onClick={() => onDone(false)}
                />
            </PageDialogToolbar>
            <FormErrorHeader
                errors={errors}
                message={message}
                operation="Retur belum disimpan"
            />
            <PageDialogBody className="space-y-4 py-3">
                <FormGrid>
                    <FormControl error={errors.posting_date?.[0]}>
                        <DatePicker
                            label="Tanggal retur"
                            required
                            data-error-field="posting_date"
                            value={postingDate}
                            portalContainer={portalContainer}
                            onValueChange={setPostingDate}
                        />
                    </FormControl>
                    <FormControl error={errors.reason?.[0]}>
                        <Textarea
                            label="Alasan retur"
                            required
                            maxLength={200}
                            rows={2}
                            data-error-field="reason"
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                        />
                    </FormControl>
                </FormGrid>
                <div data-error-field="lines">
                    <DocumentLines
                        title="Barang yang dikembalikan"
                        data={rows.map((row, index) => ({ row, index }))}
                        getRowKey={({ row }) => row.receipt_line_id}
                        getRowLabel={({ row }) => row.item.name}
                        showRowNumbers
                        emptyMessage={
                            stored.isError
                                ? errorText(
                                      stored.error,
                                      'Baris penerimaan belum dapat dimuat.',
                                  )
                                : stored.data
                                  ? 'Penerimaan ini tidak punya barang yang bisa diretur.'
                                  : 'Memuat baris penerimaan…'
                        }
                        columns={[
                            {
                                id: 'item',
                                header: 'Barang',
                                minWidth: 220,
                                cell: ({ row }) => (
                                    <DataTableText>
                                        {`${row.item.code} · ${row.item.name}`}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'batch',
                                header: 'Batch',
                                width: 190,
                                cell: ({ row }) => (
                                    <DataTableText>
                                        {batchText(row)}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'received',
                                header: 'Diterima',
                                width: 110,
                                align: 'right',
                                cell: ({ row }) => (
                                    <DataTableText>
                                        {baseText(row.received, row)}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'returned',
                                header: 'Sudah diretur',
                                width: 120,
                                align: 'right',
                                cell: ({ row }) => (
                                    <DataTableText>
                                        {baseText(row.returned, row)}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'returnable',
                                header: 'Masih di lokasi',
                                width: 130,
                                align: 'right',
                                cell: ({ row }) => (
                                    <DataTableText>
                                        {baseText(row.returnable, row)}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'unit',
                                header: 'Satuan',
                                content: 'control',
                                minWidth: 150,
                                cell: ({ row, index }) => (
                                    <FormControl
                                        error={
                                            errors[
                                                `lines.${index}.unit_id`
                                            ]?.[0]
                                        }
                                        data-error-field={`lines.${index}.unit_id`}
                                    >
                                        <LineUnitLookup
                                            required
                                            units={unitChoices(row)}
                                            value={unitOf(row)}
                                            onPick={(unit) =>
                                                setUnits((current) => ({
                                                    ...current,
                                                    [row.receipt_line_id]:
                                                        unit.id,
                                                }))
                                            }
                                            portalContainer={portalContainer}
                                        />
                                    </FormControl>
                                ),
                            },
                            {
                                id: 'quantity',
                                header: 'Diretur sekarang',
                                content: 'control',
                                minWidth: 140,
                                cell: ({ row, index }) => (
                                    <FormControl
                                        error={
                                            errors[
                                                `lines.${index}.quantity`
                                            ]?.[0] ??
                                            errors[
                                                `lines.${index}.receipt_line_id`
                                            ]?.[0]
                                        }
                                    >
                                        <Input
                                            label="Diretur sekarang"
                                            inputMode="decimal"
                                            data-error-field={`lines.${index}.quantity`}
                                            value={
                                                quantities[
                                                    row.receipt_line_id
                                                ] ?? ''
                                            }
                                            onChange={(event) =>
                                                setQuantities((current) => ({
                                                    ...current,
                                                    [row.receipt_line_id]:
                                                        event.target.value,
                                                }))
                                            }
                                        />
                                    </FormControl>
                                ),
                            },
                        ]}
                    />
                </div>
            </PageDialogBody>
        </form>
    );
}

// Retur yang sudah tercatat atas penerimaan ini, dengan Batal retur.
export function PurchaseReturnsSection({
    receiptId,
}: {
    receiptId: string;
}): ReactNode {
    const queryClient = useQueryClient();
    const stored = useReturns(receiptId);
    const [message, setMessage] = useState<string | null>(null);
    const [errorActions, setErrorActions] = useState<readonly ErrorAction[]>(
        [],
    );
    const { confirm, confirmation } = useConfirmation();
    const returns = stored.data?.data.returns ?? [];
    const canReverse = stored.data?.permissions.reverse ?? false;
    type Row = (typeof returns)[number];

    const reverse = async (row: Row) => {
        if (
            !(await confirm({
                title: `Batal retur ${row.number}?`,
                description:
                    'Barang yang keluar lewat retur ini masuk lagi ke stok lokasi penerimaan dengan batch dan harga yang sama.',
                confirmLabel: 'Batal retur',
                destructive: true,
            }))
        )
            return;
        setMessage(null);
        setErrorActions([]);
        try {
            const { body } = await api.purchasingReturnReverse({
                params: { id: receiptId, returnId: row.id },
                body: { version: row.version },
            });
            queryClient.setQueryData(returnsKey(receiptId), body);
            toast.success(`Retur ${row.number} dibatalkan.`);
        } catch (caught) {
            if (caught instanceof ApiError) setErrorActions(caught.actions);
            setMessage(
                caught instanceof ApiError && caught.status === 422
                    ? (Object.values(caught.errors).flat()[0] ?? caught.message)
                    : errorText(caught, 'Retur belum dibatalkan.'),
            );
        }
    };

    return (
        <section aria-label="Retur ke vendor" className="space-y-3">
            <h3 className="text-sm font-semibold">Retur ke vendor</h3>
            <FormErrorHeader
                message={message}
                errorActions={errorActions}
                operation="Retur belum dibatalkan"
            />
            <DataTable
                data={returns}
                getRowKey={(row) => row.id}
                getRowLabel={(row) => row.number}
                scrollMode="inline"
                actionsPlacement="inline"
                actions={
                    canReverse ? [{ id: 'reverse', label: 'Batal retur' }] : []
                }
                getRowActions={(row) =>
                    row.status === 'diposting' && canReverse
                        ? [{ id: 'reverse', label: 'Batal retur' }]
                        : []
                }
                onRowAction={(_, row) => void reverse(row)}
                emptyMessage={
                    stored.isError
                        ? errorText(stored.error, 'Retur belum dapat dimuat.')
                        : 'Belum ada barang yang diretur ke vendor.'
                }
                columns={[
                    {
                        id: 'number',
                        header: 'No retur',
                        width: 170,
                        cell: (row) => (
                            <DataTableText>{row.number}</DataTableText>
                        ),
                    },
                    {
                        id: 'date',
                        header: 'Tanggal',
                        width: 110,
                        cell: (row) => (
                            <DataTableText>
                                {displayDate(row.posting_date)}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'lines',
                        header: 'Barang',
                        width: 300,
                        cell: (row) => (
                            <DataTableText multiline>
                                {row.lines.map((line, at) => (
                                    <span key={at} className="block">
                                        {`${line.item_name} · ${line.batch_number ?? 'tanpa batch'} · ${displayNumber(line.quantity)} ${line.unit_code}`}
                                    </span>
                                ))}
                            </DataTableText>
                        ),
                    },
                    {
                        id: 'print',
                        header: 'Surat retur',
                        content: 'control',
                        width: 130,
                        cell: (row) => (
                            <PrintAction
                                report="core.purchase-return"
                                recordId={row.id}
                            />
                        ),
                    },
                    {
                        id: 'reason',
                        header: 'Alasan',
                        width: 220,
                        cell: (row) => (
                            <DataTableText>{row.reason}</DataTableText>
                        ),
                    },
                    {
                        id: 'status',
                        header: 'Status',
                        width: 120,
                        cell: (row) => (
                            <Badge
                                variant={
                                    row.status === 'diposting'
                                        ? 'secondary'
                                        : 'outline'
                                }
                            >
                                {row.status === 'diposting'
                                    ? 'Diretur'
                                    : 'Dibatalkan'}
                            </Badge>
                        ),
                    },
                ]}
            />
            {confirmation}
        </section>
    );
}
