import { ActionButton } from '@operations-metta/ui/action-button';
import { Badge } from '@operations-metta/ui/badge';
import { DataTable, DataTableText } from '@operations-metta/ui/data-table';
import { displayDate } from '@operations-metta/ui/date-picker';
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
import { Select } from '@operations-metta/ui/select';
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
    type ApiBody,
} from '@core/platform/shell/index.ts';

type View = ApiBody<'pharmacyReturnList'>;
type Returnable = View['data']['returnable'][number];

// Dokumen yang diretur: resep atau penjualan obat bebas. Keduanya memakai retur yang sama; yang berbeda hanya alamat API
// dan sebutan orang yang mengembalikan obatnya.
export type ReturnTarget = { kind: 'prescription' | 'otc-sale'; id: string };

const targets = {
    prescription: {
        list: api.pharmacyReturnList,
        create: api.pharmacyReturnCreate,
        reverse: api.pharmacyReturnReverse,
        returner: 'pasien',
    },
    'otc-sale': {
        list: api.pharmacyOtcSaleReturnList,
        create: api.pharmacyOtcSaleReturnCreate,
        reverse: api.pharmacyOtcSaleReturnReverse,
        returner: 'pembeli',
    },
} as const satisfies Record<ReturnTarget['kind'], unknown>;

const returnsKey = (target: ReturnTarget) => [
    'pharmacy-returns',
    target.kind,
    target.id,
];

const numberFormat =
    'Tulis angka seperti 2 atau 2,5. Titik untuk ribuan, koma untuk desimal.';

const baseText = (quantity: string, row: Returnable) =>
    `${displayNumber(quantity)} ${row.base_unit?.code ?? ''}`;

const unitChoices = (row: Returnable) =>
    row.unit && !row.units.some((unit) => unit.id === row.unit?.id)
        ? [
              { ...row.unit, quantity_per_unit: row.quantity_per_unit ?? '1' },
              ...row.units,
          ]
        : row.units;

const batchText = (row: Returnable) =>
    row.batch
        ? `${row.batch.batch_number}${row.batch.expiry_date ? ` · ED ${displayDate(row.batch.expiry_date)}` : ''}`
        : 'Tanpa batch';

function useReturns(target: ReturnTarget, enabled = true) {
    return useQuery({
        queryKey: returnsKey(target),
        queryFn: async () =>
            (await targets[target.kind].list({ params: { id: target.id } }))
                .body,
        refetchOnWindowFocus: false,
        enabled,
    });
}

// Retur dari pasien atau pembeli: obat dan batch yang diserahkan, berapa yang sudah kembali, dan berapa yang kembali sekarang. Stok
// masuk lagi ke lokasi penyerahan dengan batch, harga satuan, dan sumber dana yang sama dengan saat keluar.
export function ReturnCard({
    target,
    onDone,
    portalContainer,
}: {
    target: ReturnTarget;
    onDone: (saved: boolean) => void;
    portalContainer: RefObject<HTMLElement | null>;
}): ReactNode {
    const queryClient = useQueryClient();
    const stored = useReturns(target);
    const [quantities, setQuantities] = useState<Record<string, string>>({});
    const [units, setUnits] = useState<Record<string, string>>({});
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});
    const [message, setMessage] = useState<string | null>(null);
    usePageDialogRecord({
        recordTitle: 'Retur obat baru',
        editing: true,
        dirty:
            reason !== '' ||
            Object.values(quantities).some((typed) => typed.trim() !== '') ||
            Object.keys(units).length > 0,
    });
    const rows = stored.data?.data.returnable ?? [];
    const key = (row: Returnable) =>
        `${row.dispensing_line_id}:${row.batch?.id ?? '-'}`;
    const unitOf = (row: Returnable) => units[key(row)] ?? row.unit?.id ?? null;

    const save = async () => {
        const invalid: Record<string, string[]> = {};
        const lines = rows.map((row, index) => {
            const typed = (quantities[key(row)] ?? '').trim();
            const quantity = typed ? parseDisplayNumber(typed) : '0';
            if (quantity === null)
                invalid[`lines.${index}.quantity`] = [numberFormat];
            return {
                dispensing_line_id: row.dispensing_line_id,
                batch_id: row.batch?.id ?? null,
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
            const { body } = await targets[target.kind].create({
                params: { id: target.id },
                body: { reason, lines },
            });
            queryClient.setQueryData(returnsKey(target), body);
            const created = body.data.returns.at(-1);
            toast.success(
                `Retur ${created?.number ?? ''} tersimpan. Obatnya kembali ke stok lokasi farmasi.`,
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
                <FormGrid columns={1}>
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
                        title="Obat yang kembali"
                        data={rows.map((row, index) => ({ row, index }))}
                        getRowKey={({ row }) => key(row)}
                        getRowLabel={({ row }) => row.item?.name ?? ''}
                        showRowNumbers
                        emptyMessage={
                            stored.isError
                                ? errorText(
                                      stored.error,
                                      'Obat yang diserahkan belum dapat dimuat.',
                                  )
                                : stored.data
                                  ? 'Tidak ada obat yang diserahkan dari stok.'
                                  : 'Memuat obat yang diserahkan…'
                        }
                        columns={[
                            {
                                id: 'item',
                                header: 'Obat',
                                minWidth: 240,
                                cell: ({ row }) => (
                                    <DataTableText>
                                        {`${row.item?.code ?? ''} · ${row.item?.name ?? ''}`}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'batch',
                                header: 'Batch',
                                width: 200,
                                cell: ({ row }) => (
                                    <DataTableText>
                                        {batchText(row)}
                                    </DataTableText>
                                ),
                            },
                            {
                                id: 'dispensed',
                                header: 'Diserahkan',
                                width: 110,
                                align: 'right',
                                cell: ({ row }) => (
                                    <DataTableText>
                                        {baseText(row.dispensed, row)}
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
                                        <Select
                                            label="Satuan"
                                            required
                                            items={unitChoices(row).map(
                                                (unit) => ({
                                                    value: unit.id,
                                                    label: `${unit.code} · isi ${displayNumber(unit.quantity_per_unit)}`,
                                                }),
                                            )}
                                            value={unitOf(row)}
                                            onValueChange={(value) =>
                                                setUnits((current) => ({
                                                    ...current,
                                                    [key(row)]:
                                                        value ??
                                                        row.unit?.id ??
                                                        '',
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
                                                `lines.${index}.dispensing_line_id`
                                            ]?.[0]
                                        }
                                    >
                                        <Input
                                            label="Diretur sekarang"
                                            inputMode="decimal"
                                            data-error-field={`lines.${index}.quantity`}
                                            value={quantities[key(row)] ?? ''}
                                            onChange={(event) =>
                                                setQuantities((current) => ({
                                                    ...current,
                                                    [key(row)]:
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

// Retur yang sudah tercatat untuk penyerahan ini, dengan Batal retur selama stoknya belum terpakai.
export function ReturnsSection({
    target,
    onReversed,
}: {
    target: ReturnTarget;
    onReversed?: () => void;
}): ReactNode {
    const queryClient = useQueryClient();
    const stored = useReturns(target);
    const [message, setMessage] = useState<string | null>(null);
    const { confirm, confirmation } = useConfirmation();
    const returns = stored.data?.data.returns ?? [];
    const canReverse = stored.data?.permissions.reverse ?? false;
    type Row = (typeof returns)[number];

    const reverse = async (row: Row) => {
        if (
            !(await confirm({
                title: `Batal retur ${row.number}?`,
                description:
                    'Obat yang masuk lewat retur ini keluar lagi dari stok lokasi farmasi. Batal retur ditolak bila stoknya sudah terpakai.',
                confirmLabel: 'Batal retur',
                destructive: true,
            }))
        )
            return;
        setMessage(null);
        try {
            const { body } = await targets[target.kind].reverse({
                params: { id: target.id, returnId: row.id },
                body: { version: row.version },
            });
            queryClient.setQueryData(returnsKey(target), body);
            toast.success(`Retur ${row.number} dibatalkan.`);
            onReversed?.();
        } catch (caught) {
            setMessage(
                caught instanceof ApiError && caught.status === 422
                    ? (Object.values(caught.errors).flat()[0] ?? caught.message)
                    : errorText(caught, 'Retur belum dibatalkan.'),
            );
        }
    };

    return (
        <div className="space-y-3">
            {message && (
                <p role="alert" className="text-sm text-destructive">
                    {message}
                </p>
            )}
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
                        : `Belum ada obat yang diretur ${targets[target.kind].returner}.`
                }
                columns={[
                    {
                        id: 'number',
                        header: 'No retur',
                        width: 190,
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
                        header: 'Obat',
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
        </div>
    );
}

export function useCanReturn(target: ReturnTarget, enabled: boolean) {
    return useReturns(target, enabled).data?.permissions.create ?? false;
}
