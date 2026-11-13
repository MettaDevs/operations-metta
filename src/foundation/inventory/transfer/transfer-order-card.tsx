import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { DataTableText } from '@operations-metta/ui/data-table';
import type { DataTableColumn } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { displayNumber } from '@operations-metta/ui/display-number';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialog,
    PageDialogBody,
    PageDialogContent,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import { CircleCheck, CircleX, PackageCheck, Send, Truck } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import {
    PostedTransferCard,
    postedTransferLabels,
    type PostedTransfer,
    type PostedTransferKind,
} from './posted-transfer-card.tsx';

export type TransferOrder = ApiBody<'inventoryTransferOrderShow'>['data'];
export type TransferOrderPermissions =
    ApiBody<'inventoryTransferOrderList'>['permissions'];
type Location = ApiBody<'inventoryLocationList'>['data'][number];
type Item = ApiBody<'inventoryItemList'>['data'][number];
type ItemUnit = ApiBody<'inventoryItemUnitList'>['data'][number];
type StoredLine = TransferOrder['lines'][number];
type Posting = TransferOrder['postings'][number];
type Errors = Record<string, string[]>;

type Reference = { id: string; code: string; name: string };
type ItemChoice = Reference & { base_unit: string; base_unit_id: string };
type UnitChoice = Reference & { quantity_per_unit: string };
type Line = {
    key: string;
    id: string | null;
    item: ItemChoice | null;
    unit: UnitChoice | null;
    quantity: string;
};
type Header = {
    to_location: Reference | null;
    from_location: Reference | null;
    transit_location: Reference | null;
    posting_date: string;
    description: string;
};
type Handling = Record<string, { to_ship: string; to_receive: string }>;

export const transferOrderStatusLabels: Record<
    TransferOrder['status'],
    string
> = {
    draf: 'Draf',
    diajukan: 'Diajukan',
    selesai: 'Selesai',
    dibatalkan: 'Dibatalkan',
};
export const transferModeLabels: Record<
    TransferOrder['transfer_mode'],
    string
> = {
    langsung: 'Langsung',
    kirim_terima: 'Kirim lalu terima',
};
const label = (entry: { code: string; name: string }) =>
    `${entry.code} - ${entry.name}`;
const today = () => new Date().toLocaleDateString('sv-SE');
let keys = 0;
const nextKey = () => `baris-${++keys}`;

function headerOf(order: TransferOrder | null): Header {
    return {
        to_location: order?.to_location ?? null,
        from_location: order?.from_location ?? null,
        transit_location: order?.transit_location ?? null,
        posting_date: order?.posting_date ?? today(),
        description: order?.description ?? '',
    };
}

function linesOf(order: TransferOrder | null): Line[] {
    return (order?.lines ?? []).map((line) => ({
        key: line.id,
        id: line.id,
        item: { ...line.item, base_unit_id: '' },
        unit: { ...line.unit, quantity_per_unit: line.quantity_per_unit },
        quantity: line.quantity,
    }));
}

function handlingOf(order: TransferOrder | null): Handling {
    return Object.fromEntries(
        (order?.lines ?? []).map((line) => [
            line.id,
            {
                to_ship: line.quantity_to_ship,
                to_receive: line.quantity_to_receive,
            },
        ]),
    );
}

function useLoader<T>(
    fetch: (
        query: { q: string; cursor?: string },
        signal: AbortSignal,
    ) => Promise<{ items: T[]; nextCursor: string | null }>,
): LookupLoader<T> {
    return useCallback<LookupLoader<T>>(
        ({ query, cursor, signal }) =>
            fetch({ q: query, ...(cursor ? { cursor } : {}) }, signal),
        [fetch],
    );
}

// Lokasi stok biasa untuk peminta dan pemasok, lokasi transit hanya untuk barang dalam perjalanan.
const locationsWhere =
    (transit: boolean) =>
    async (query: { q: string; cursor?: string }, signal: AbortSignal) => {
        const { body } = await api.inventoryLocationList({ query }, { signal });
        return {
            items: body.data.filter(
                (location: Location) => location.is_transit === transit,
            ),
            nextCursor: body.next_cursor,
        };
    };
const loadStockLocations = locationsWhere(false);
const loadTransitLocations = locationsWhere(true);
const loadItems = async (
    query: { q: string; cursor?: string },
    signal: AbortSignal,
) => {
    const { body } = await api.inventoryItemList({ query }, { signal });
    return {
        items: body.data.map((item: Item): ItemChoice => ({
            id: item.id,
            code: item.code,
            name: item.name,
            base_unit: item.base_unit.code,
            base_unit_id: item.base_unit.id,
        })),
        nextCursor: body.next_cursor,
    };
};

const itemColumns: DataTableColumn<ItemChoice>[] = [
    { id: 'code', header: 'Kode', width: 110, cell: (item) => item.code },
    { id: 'name', header: 'Nama', width: 260, cell: (item) => item.name },
    {
        id: 'base_unit',
        header: 'Satuan dasar',
        width: 110,
        cell: (item) => item.base_unit,
    },
];
// Barang baru di baris amprah diminta dalam satuan dasarnya; satuan lain dipilih per baris.
const baseUnit = (item: ItemChoice): UnitChoice => ({
    id: item.base_unit_id,
    code: item.base_unit,
    name: '',
    quantity_per_unit: '1',
});

function LocationLookup({
    label: title,
    field,
    error,
    value,
    loader,
    required,
    portalContainer,
    onPick,
}: {
    label: string;
    field: string;
    error: string | undefined;
    value: Reference | null;
    loader: LookupLoader<Location>;
    required: boolean;
    portalContainer: RefObject<HTMLElement | null>;
    onPick: (location: Reference) => void;
}): ReactNode {
    return (
        <FormControl error={error} data-error-field={field}>
            <InlineLookup<Location>
                label={title}
                required={required}
                loadItems={loader}
                value={
                    value
                        ? {
                              ...value,
                              operating_unit: { id: '', name: '' },
                              is_transit: false,
                              picking_method: null,
                              transfer_mode: null,
                              version: 0,
                          }
                        : null
                }
                displayValue={value ? label(value) : ''}
                onValueChange={(location) =>
                    onPick({
                        id: location.id,
                        code: location.code,
                        name: location.name,
                    })
                }
                getItemValue={(location) => location.id}
                getItemLabel={label}
                placeholder="Cari kode atau nama lokasi…"
                emptyMessage="Lokasi tidak ditemukan."
                popupClassName="w-[32rem]"
                showDetails={false}
                portalContainer={portalContainer}
                columns={[
                    {
                        id: 'code',
                        header: 'Kode',
                        width: 110,
                        cell: (location) => location.code,
                    },
                    {
                        id: 'name',
                        header: 'Nama',
                        width: 200,
                        cell: (location) => location.name,
                    },
                    {
                        id: 'operating_unit',
                        header: 'Unit',
                        width: 160,
                        cell: (location) => location.operating_unit.name,
                    },
                ]}
            />
        </FormControl>
    );
}

// Satuan baris hanya dari satuan barangnya: satuan dasar dan satuan kemasannya.
function UnitLookup({
    itemId,
    value,
    error,
    field,
    onPick,
}: {
    itemId: string;
    value: UnitChoice | null;
    error: string | undefined;
    field: string;
    onPick: (unit: UnitChoice) => void;
}): ReactNode {
    const load = useCallback<LookupLoader<UnitChoice>>(
        async ({ query, cursor, signal }) => {
            const { body } = await api.inventoryItemUnitList(
                {
                    query: {
                        item_id: itemId,
                        q: query,
                        ...(cursor ? { cursor } : {}),
                    },
                },
                { signal },
            );
            return {
                items: body.data.map((unit: ItemUnit): UnitChoice => ({
                    id: unit.id,
                    code: unit.code,
                    name: unit.name,
                    quantity_per_unit: unit.quantity_per_unit,
                })),
                nextCursor: body.next_cursor,
            };
        },
        [itemId],
    );
    return (
        <FormControl error={error} data-error-field={field}>
            <InlineLookup<UnitChoice>
                label="Satuan"
                required
                loadItems={load}
                value={value}
                displayValue={value?.code ?? ''}
                onValueChange={onPick}
                getItemValue={(unit) => unit.id}
                getItemLabel={(unit) => unit.code}
                emptyMessage="Satuan tidak ditemukan. Tambahkan satuan kemasan di Satuan barang."
                showDetails={false}
                columns={[
                    {
                        id: 'code',
                        header: 'Satuan',
                        width: 90,
                        cell: (unit) => unit.code,
                    },
                    {
                        id: 'name',
                        header: 'Nama',
                        width: 160,
                        cell: (unit) => unit.name,
                    },
                    {
                        id: 'quantity_per_unit',
                        header: 'Isi',
                        width: 80,
                        align: 'right',
                        cell: (unit) => unit.quantity_per_unit,
                    },
                ]}
            />
        </FormControl>
    );
}

// Amprah (Transfer Order BC): lokasi peminta menyusun draf lalu mengajukannya; lokasi pemasok mengisi jumlah akan
// dikirim lalu Post kirim; lokasi peminta mengisi jumlah akan diterima lalu Post terima bila barang lewat lokasi
// transit. Setiap posting tercatat di Riwayat posting dan bisa dibuka untuk dibatalkan postingnya.
export function TransferOrderCard({
    order: initial,
    permissions,
    portalContainer,
    onSaved,
    onClose,
}: {
    order: TransferOrder | null;
    permissions: TransferOrderPermissions;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (order: TransferOrder) => void;
    onClose: () => void;
}): ReactNode {
    const [order, setOrder] = useState(initial);
    const draft = order === null || order.status === 'draf';
    const editable = draft && permissions.update;
    const open = order?.status === 'diajukan';
    const [header, setHeader] = useState(() => headerOf(initial));
    const [lines, setLines] = useState(() => linesOf(initial));
    const [handling, setHandling] = useState(() => handlingOf(initial));
    const [postingDate, setPostingDate] = useState(today);
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const [operation, setOperation] = useState('Amprah belum disimpan');
    const [viewing, setViewing] = useState<{
        kind: PostedTransferKind;
        document: PostedTransfer;
        reverse: boolean;
    } | null>(null);
    const postingDialog = useRef<HTMLDivElement>(null);
    const { confirm, confirmation } = useConfirmation();
    const stockLocations = useLoader(loadStockLocations);
    const transitLocations = useLoader(loadTransitLocations);
    const itemLoader = useLoader(loadItems);
    const stored = new Map<string, StoredLine>(
        (order?.lines ?? []).map((line) => [line.id, line]),
    );
    const twoStep =
        order?.transfer_mode === 'kirim_terima' ||
        (order?.lines ?? []).some((line) => Number(line.quantity_in_transit));
    const shipping = open && permissions.ship;
    const receiving = open && permissions.receive && twoStep;
    const pristine =
        JSON.stringify([header, lines]) ===
        JSON.stringify([headerOf(order), linesOf(order)]);
    const handled =
        JSON.stringify(handling) !== JSON.stringify(handlingOf(order));
    const outstanding = (order?.lines ?? []).some((line) =>
        Number(line.quantity_outstanding),
    );
    const inTransit = (order?.lines ?? []).some((line) =>
        Number(line.quantity_in_transit),
    );
    const shippedAny = (order?.lines ?? []).some((line) =>
        Number(line.quantity_shipped),
    );
    usePageDialogRecord({
        recordTitle: order
            ? `${order.number} ${order.to_location.name}`
            : 'Amprah baru',
        editing: editable || shipping || receiving,
        dirty: !pristine || handled,
    });

    const error = (field: string) => errors[field]?.join(' ');
    const field = (index: number, name: string) => `lines.${index}.${name}`;
    const change = (index: number, patch: Partial<Line>) =>
        setLines((current) =>
            current.map((line, at) =>
                at === index ? { ...line, ...patch } : line,
            ),
        );
    const handle = (
        id: string,
        patch: Partial<{ to_ship: string; to_receive: string }>,
    ) =>
        setHandling((current) => {
            const previous = current[id] ?? { to_ship: '', to_receive: '' };
            return { ...current, [id]: { ...previous, ...patch } };
        });

    const failed = (caught: unknown, failure: string) => {
        setOperation(failure);
        if (caught instanceof ApiError && caught.status === 422)
            setErrors(caught.errors);
        else setMessage(errorText(caught, failure + '.'));
    };
    const clear = () => {
        setErrors({});
        setMessage(null);
    };
    const run = async (work: () => Promise<void>) => {
        setBusy(true);
        try {
            await work();
        } finally {
            setBusy(false);
        }
    };
    const adopt = (next: TransferOrder) => {
        setOrder(next);
        setHeader(headerOf(next));
        setLines(linesOf(next));
        setHandling(handlingOf(next));
        setSelected([]);
        onSaved(next);
    };

    const payload = () => ({
        to_location_id: header.to_location?.id ?? '',
        from_location_id: header.from_location?.id ?? '',
        transit_location_id: header.transit_location?.id ?? null,
        posting_date: header.posting_date,
        description: header.description || null,
        lines: lines.map((line) => ({
            id: line.id,
            item_id: line.item?.id ?? '',
            unit_id: line.unit?.id ?? '',
            quantity: line.quantity,
        })),
    });

    const save = async (): Promise<TransferOrder | null> => {
        clear();
        try {
            const { body } = order
                ? await api.inventoryTransferOrderUpdate({
                      params: { id: order.id },
                      body: { ...payload(), version: order.version },
                  })
                : await api.inventoryTransferOrderCreate({ body: payload() });
            return body.data;
        } catch (caught) {
            failed(caught, 'Amprah belum disimpan');
            return null;
        }
    };

    // Jumlah akan dikirim dan diterima hanya dikirim sesuai hak pengguna.
    const saveHandling = async (
        current: TransferOrder,
    ): Promise<TransferOrder | null> => {
        clear();
        try {
            const { body } = await api.inventoryTransferOrderQuantities({
                params: { id: current.id },
                body: {
                    version: current.version,
                    lines: current.lines.map((line) => ({
                        id: line.id,
                        ...(shipping
                            ? {
                                  quantity_to_ship:
                                      handling[line.id]?.to_ship ?? '0',
                              }
                            : {}),
                        ...(receiving
                            ? {
                                  quantity_to_receive:
                                      handling[line.id]?.to_receive ?? '0',
                              }
                            : {}),
                    })),
                },
            });
            return body.data;
        } catch (caught) {
            failed(caught, 'Jumlah belum disimpan');
            return null;
        }
    };

    const submit = () =>
        run(async () => {
            if (order?.status === 'diajukan') {
                const saved = await saveHandling(order);
                if (!saved) return;
                toast.success('Jumlah akan dikirim dan diterima disimpan.');
                adopt(saved);
                return;
            }
            const saved = await save();
            if (!saved) return;
            toast.success(order ? 'Amprah diperbarui.' : 'Amprah dibuat.');
            adopt(saved);
        });

    const command = async (
        work: (
            current: TransferOrder,
        ) => Promise<{ body: { data: TransferOrder } }>,
        failure: string,
        success: (next: TransferOrder) => string,
        prepare: () => Promise<TransferOrder | null>,
    ) =>
        run(async () => {
            const current = await prepare();
            if (!current) return;
            if (current !== order) adopt(current);
            try {
                const { body } = await work(current);
                toast.success(success(body.data));
                adopt(body.data);
            } catch (caught) {
                failed(caught, failure);
            }
        });

    const latest = (next: TransferOrder, kind: Posting['kind']) =>
        next.postings.filter((posting) => posting.kind === kind).at(-1)
            ?.number ?? '';

    const submitOrder = async () => {
        if (
            !(await confirm({
                title: 'Ajukan amprah ini?',
                description: `Permintaan dikirim ke ${header.from_location?.name ?? 'lokasi pemasok'}. Sesudah diajukan, barang dan jumlah yang diminta tidak bisa diubah lagi.`,
                confirmLabel: 'Ajukan',
            }))
        )
            return;
        await command(
            (current) =>
                api.inventoryTransferOrderSubmit({
                    params: { id: current.id },
                    body: { version: current.version },
                }),
            'Amprah belum diajukan',
            (next) => `Amprah ${next.number} diajukan.`,
            async () => (pristine && order ? order : save()),
        );
    };

    const prepareHandling = async () => {
        if (!order) return null;
        return handled ? saveHandling(order) : order;
    };

    const shipOrder = async () => {
        if (
            !(await confirm({
                title: 'Post kirim amprah ini?',
                description:
                    order?.transfer_mode === 'kirim_terima'
                        ? `Stok sebanyak jumlah akan dikirim keluar dari ${header.from_location?.name ?? 'lokasi pemasok'} dan menunggu di lokasi transit sampai diterima.`
                        : `Stok sebanyak jumlah akan dikirim pindah dari ${header.from_location?.name ?? 'lokasi pemasok'} ke ${header.to_location?.name ?? 'lokasi peminta'}.`,
                confirmLabel: 'Post kirim',
            }))
        )
            return;
        await command(
            (current) =>
                api.inventoryTransferOrderShip({
                    params: { id: current.id },
                    body: {
                        version: current.version,
                        posting_date: postingDate,
                    },
                }),
            'Mutasi belum diposting',
            (next) => `Mutasi ${latest(next, 'shipment')} diposting.`,
            prepareHandling,
        );
    };

    const receiveOrder = async () => {
        if (
            !(await confirm({
                title: 'Post terima amprah ini?',
                description: `Barang sebanyak jumlah akan diterima masuk ke stok ${header.to_location?.name ?? 'lokasi peminta'}.`,
                confirmLabel: 'Post terima',
            }))
        )
            return;
        await command(
            (current) =>
                api.inventoryTransferOrderReceive({
                    params: { id: current.id },
                    body: {
                        version: current.version,
                        posting_date: postingDate,
                    },
                }),
            'Penerimaan mutasi belum diposting',
            (next) => `Penerimaan mutasi ${latest(next, 'receipt')} diposting.`,
            prepareHandling,
        );
    };

    const closeOrder = async () => {
        if (
            !(await confirm({
                title: `Tutup ${order?.number ?? 'amprah'}?`,
                description:
                    'Barang yang belum dikirim tidak akan dikirim lagi, tetapi jumlahnya tetap tercatat di amprah ini.',
                confirmLabel: 'Tutup',
            }))
        )
            return;
        await command(
            (current) =>
                api.inventoryTransferOrderClose({
                    params: { id: current.id },
                    body: { version: current.version },
                }),
            'Amprah belum ditutup',
            (next) => `Amprah ${next.number} ditutup.`,
            () => Promise.resolve(order),
        );
    };

    const cancelOrder = async () => {
        if (
            !(await confirm({
                title: `Batalkan ${order?.number ?? 'amprah'}?`,
                description:
                    'Permintaan ini tidak akan dikirim. Amprah tetap tercatat dengan status dibatalkan.',
                confirmLabel: 'Batalkan amprah',
                destructive: true,
            }))
        )
            return;
        await command(
            (current) =>
                api.inventoryTransferOrderCancel({
                    params: { id: current.id },
                    body: { version: current.version },
                }),
            'Amprah belum dibatalkan',
            (next) => `Amprah ${next.number} dibatalkan.`,
            () => Promise.resolve(order),
        );
    };

    const remove = async () => {
        if (!order) return;
        if (
            !(await confirm({
                title: `Delete draf ${order.number}?`,
                description:
                    'Draf ini tidak tampil lagi di daftar amprah. Stok tidak berubah karena draf belum diajukan.',
                confirmLabel: 'Delete',
                destructive: true,
            }))
        )
            return;
        await run(async () => {
            try {
                await api.inventoryTransferOrderDelete({
                    params: { id: order.id },
                    body: { version: order.version },
                });
                toast.success('Draf amprah dihapus.');
                onClose();
            } catch (caught) {
                failed(caught, 'Draf belum dihapus');
            }
        });
    };

    // Dokumen terposting yang dibatalkan postingnya mengubah jumlah kumulatif amprah, jadi amprah dimuat ulang.
    const reload = async () => {
        if (!order) return;
        try {
            const { body } = await api.inventoryTransferOrderShow({
                params: { id: order.id },
            });
            adopt(body.data);
        } catch (caught) {
            failed(caught, 'Amprah belum dimuat ulang');
        }
    };

    // Riwayat posting hanya membawa ringkasan, jadi dokumen terpostingnya dimuat saat dibuka.
    const openPosting = async (posting: Posting) => {
        try {
            const { body } =
                posting.kind === 'shipment'
                    ? await api.inventoryTransferShipmentShow({
                          params: { id: posting.id },
                      })
                    : await api.inventoryTransferReceiptShow({
                          params: { id: posting.id },
                      });
            setViewing({
                kind: posting.kind,
                document: body.data,
                reverse: body.permissions.reverse,
            });
        } catch (caught) {
            toast.error(errorText(caught, 'Dokumen belum bisa dibuka.'));
        }
    };

    const addLines = (items: (ItemChoice | null)[]) =>
        setLines((current) => [
            ...current,
            ...items.map((item) => ({
                key: nextKey(),
                id: null,
                item,
                unit: item ? baseUnit(item) : null,
                quantity: '',
            })),
        ]);

    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    // Jumlah barang dari API, teks desimal berskala jumlah barang.
    const amount = (value: string | undefined) =>
        value === undefined ? '' : displayNumber(value);
    const quantityInput = (
        index: number,
        name: string,
        title: string,
        value: string,
        onChange: (value: string) => void,
    ) => (
        <FormControl
            error={
                error(field(index, name)) ??
                (name === 'quantity'
                    ? undefined
                    : error(field(index, 'quantity')))
            }
        >
            <Input
                label={title}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                data-error-field={field(index, name)}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            />
        </FormControl>
    );
    const storedOf = (line: Line) =>
        line.id === null ? undefined : stored.get(line.id);
    const control = editable ? ('control' as const) : ('text' as const);

    return (
        <>
            <form
                noValidate
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                }}
            >
                <PageDialogToolbar>
                    {(editable || shipping || receiving) && (
                        <>
                            <ActionButton
                                action="save"
                                type="submit"
                                disabled={busy || (open && !handled)}
                                pending={busy}
                            />
                            <ActionButton
                                action="cancel"
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                    if (!order) {
                                        onClose();
                                        return;
                                    }
                                    setHeader(headerOf(order));
                                    setLines(linesOf(order));
                                    setHandling(handlingOf(order));
                                    clear();
                                }}
                            />
                        </>
                    )}
                    {editable && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            onClick={() => void submitOrder()}
                        >
                            <Send aria-hidden="true" />
                            Ajukan
                        </Button>
                    )}
                    {shipping && outstanding && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            onClick={() => void shipOrder()}
                        >
                            <Truck aria-hidden="true" />
                            Post kirim
                        </Button>
                    )}
                    {receiving && inTransit && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            onClick={() => void receiveOrder()}
                        >
                            <PackageCheck aria-hidden="true" />
                            Post terima
                        </Button>
                    )}
                    {open && permissions.update && !inTransit && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            onClick={() => void closeOrder()}
                        >
                            <CircleCheck aria-hidden="true" />
                            Tutup
                        </Button>
                    )}
                    {open && permissions.update && !shippedAny && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            onClick={() => void cancelOrder()}
                        >
                            <CircleX aria-hidden="true" />
                            Batalkan amprah
                        </Button>
                    )}
                    {order && editable && (
                        <ActionButton
                            action="archive"
                            disabled={busy}
                            onClick={() => void remove()}
                        />
                    )}
                </PageDialogToolbar>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation={operation}
                />
                <PageDialogBody className="space-y-4 py-3">
                    <FormGrid>
                        {editable ? (
                            <LocationLookup
                                label="Lokasi peminta"
                                field="to_location_id"
                                error={error('to_location_id')}
                                value={header.to_location}
                                loader={stockLocations}
                                required
                                portalContainer={portalContainer}
                                onPick={(to_location) =>
                                    setHeader({ ...header, to_location })
                                }
                            />
                        ) : (
                            <FormControl>
                                <Input
                                    label="Lokasi peminta"
                                    readOnly
                                    value={
                                        header.to_location
                                            ? label(header.to_location)
                                            : ''
                                    }
                                />
                            </FormControl>
                        )}
                        {editable ? (
                            <LocationLookup
                                label="Lokasi pemasok"
                                field="from_location_id"
                                error={error('from_location_id')}
                                value={header.from_location}
                                loader={stockLocations}
                                required
                                portalContainer={portalContainer}
                                onPick={(from_location) =>
                                    setHeader({ ...header, from_location })
                                }
                            />
                        ) : (
                            <FormControl>
                                <Input
                                    label="Lokasi pemasok"
                                    readOnly
                                    value={
                                        header.from_location
                                            ? label(header.from_location)
                                            : ''
                                    }
                                />
                            </FormControl>
                        )}
                        {editable ? (
                            <FormControl error={error('posting_date')}>
                                <DatePicker
                                    label="Tanggal amprah"
                                    required
                                    data-error-field="posting_date"
                                    value={header.posting_date}
                                    portalContainer={portalContainer}
                                    onValueChange={(posting_date) =>
                                        setHeader({ ...header, posting_date })
                                    }
                                />
                            </FormControl>
                        ) : (
                            <FormControl>
                                <Input
                                    label="Tanggal amprah"
                                    readOnly
                                    value={displayDate(header.posting_date)}
                                />
                            </FormControl>
                        )}
                        {editable ? (
                            <LocationLookup
                                label="Lokasi transit"
                                field="transit_location_id"
                                error={error('transit_location_id')}
                                value={header.transit_location}
                                loader={transitLocations}
                                required={false}
                                portalContainer={portalContainer}
                                onPick={(transit_location) =>
                                    setHeader({ ...header, transit_location })
                                }
                            />
                        ) : (
                            (twoStep || header.transit_location) && (
                                <FormControl
                                    error={error('transit_location_id')}
                                >
                                    <Input
                                        label="Lokasi transit"
                                        readOnly
                                        data-error-field="transit_location_id"
                                        value={
                                            header.transit_location
                                                ? label(header.transit_location)
                                                : ''
                                        }
                                    />
                                </FormControl>
                            )
                        )}
                        <FormControl error={error('description')}>
                            <Input
                                label="Keterangan"
                                maxLength={200}
                                data-error-field="description"
                                value={header.description}
                                readOnly={!editable}
                                onChange={(event) =>
                                    setHeader({
                                        ...header,
                                        description: event.target.value,
                                    })
                                }
                            />
                        </FormControl>
                        {order && (
                            <FormControl>
                                <Input
                                    label="Cara mutasi"
                                    readOnly
                                    value={
                                        transferModeLabels[order.transfer_mode]
                                    }
                                />
                            </FormControl>
                        )}
                        {order && (
                            <FormControl>
                                <Input
                                    label="Status"
                                    readOnly
                                    value={
                                        transferOrderStatusLabels[order.status]
                                    }
                                />
                            </FormControl>
                        )}
                        {(shipping || receiving) && (
                            <FormControl error={error('posting_date')}>
                                <DatePicker
                                    label="Tanggal posting"
                                    required
                                    data-error-field="posting_date"
                                    value={postingDate}
                                    portalContainer={portalContainer}
                                    onValueChange={setPostingDate}
                                />
                            </FormControl>
                        )}
                    </FormGrid>
                    <DocumentLines
                        title="Baris amprah"
                        data={lines.map((line, index) => ({ index, line }))}
                        getRowKey={(row) => row.line.key}
                        getRowLabel={(row) =>
                            row.line.item?.name ?? `Barang ${row.index + 1}`
                        }
                        showRowNumbers
                        readOnly={!editable}
                        disabled={busy}
                        portalContainer={portalContainer}
                        selection={
                            editable
                                ? {
                                      selectedKeys: selected,
                                      onSelectedKeysChange: (keys) =>
                                          setSelected(keys.map(String)),
                                  }
                                : undefined
                        }
                        onAddRow={editable ? () => addLines([null]) : undefined}
                        selectRecords={
                            editable
                                ? {
                                      noun: 'barang',
                                      loadItems: itemLoader,
                                      columns: itemColumns,
                                      getItemValue: (item) => item.id,
                                      getItemLabel: label,
                                      focusColumnId: 'quantity',
                                      onAdd: addLines,
                                  }
                                : undefined
                        }
                        onDeleteRows={
                            editable
                                ? (removed) =>
                                      setLines((current) =>
                                          current.filter(
                                              (line) =>
                                                  !removed.some(
                                                      (row) =>
                                                          row.line.key ===
                                                          line.key,
                                                  ),
                                          ),
                                      )
                                : undefined
                        }
                        emptyMessage={
                            editable
                                ? 'Belum ada barang. Pilih Tambah atau Tambah banyak untuk menambahkan barang yang diminta.'
                                : 'Amprah ini tidak berisi barang.'
                        }
                        columns={[
                            {
                                id: 'item_id',
                                header: 'Barang',
                                required: editable,
                                content: control,
                                minWidth: 220,
                                cell: ({ index, line }) =>
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(index, 'item_id'),
                                            )}
                                            data-error-field={field(
                                                index,
                                                'item_id',
                                            )}
                                        >
                                            <InlineLookup<ItemChoice>
                                                label="Barang"
                                                required
                                                loadItems={itemLoader}
                                                value={line.item}
                                                displayValue={
                                                    line.item
                                                        ? label(line.item)
                                                        : ''
                                                }
                                                onValueChange={(item) =>
                                                    change(index, {
                                                        item,
                                                        unit: baseUnit(item),
                                                    })
                                                }
                                                getItemValue={(item) => item.id}
                                                getItemLabel={label}
                                                placeholder="Cari kode atau nama barang…"
                                                emptyMessage="Barang tidak ditemukan."
                                                popupClassName="w-[36rem]"
                                                showDetails={false}
                                                columns={itemColumns}
                                            />
                                        </FormControl>
                                    ) : (
                                        text(line.item ? label(line.item) : '')
                                    ),
                            },
                            {
                                id: 'unit_id',
                                header: 'Satuan',
                                required: editable,
                                content: control,
                                minWidth: 110,
                                cell: ({ index, line }) =>
                                    editable && line.item ? (
                                        <UnitLookup
                                            itemId={line.item.id}
                                            value={line.unit}
                                            field={field(index, 'unit_id')}
                                            error={error(
                                                field(index, 'unit_id'),
                                            )}
                                            onPick={(unit) =>
                                                change(index, { unit })
                                            }
                                        />
                                    ) : (
                                        text(
                                            line.unit
                                                ? line.unit
                                                      .quantity_per_unit === '1'
                                                    ? line.unit.code
                                                    : `${line.unit.code} (${line.unit.quantity_per_unit} ${line.item?.base_unit ?? ''})`
                                                : '',
                                        )
                                    ),
                            },
                            {
                                id: 'quantity',
                                header: 'Diminta',
                                required: editable,
                                content: control,
                                minWidth: 100,
                                align: 'right',
                                cell: ({ index, line }) =>
                                    editable
                                        ? quantityInput(
                                              index,
                                              'quantity',
                                              'Diminta',
                                              line.quantity,
                                              (quantity) =>
                                                  change(index, { quantity }),
                                          )
                                        : text(amount(line.quantity)),
                            },
                            {
                                id: 'supplier_stock',
                                header: 'Stok pemasok',
                                minWidth: 120,
                                align: 'right',
                                cell: ({ line }) => {
                                    const current = storedOf(line);
                                    return text(
                                        current
                                            ? `${amount(current.supplier_stock)} ${current.item.base_unit}`
                                            : '',
                                    );
                                },
                            },
                            ...(draft
                                ? []
                                : [
                                      {
                                          id: 'quantity_shipped',
                                          header: 'Dikirim',
                                          minWidth: 90,
                                          align: 'right' as const,
                                          cell: ({ line }: { line: Line }) =>
                                              text(
                                                  amount(
                                                      storedOf(line)
                                                          ?.quantity_shipped,
                                                  ),
                                              ),
                                      },
                                      {
                                          id: 'quantity_received',
                                          header: 'Diterima',
                                          minWidth: 90,
                                          align: 'right' as const,
                                          cell: ({ line }: { line: Line }) =>
                                              text(
                                                  amount(
                                                      storedOf(line)
                                                          ?.quantity_received,
                                                  ),
                                              ),
                                      },
                                  ]),
                            ...(!draft && twoStep
                                ? [
                                      {
                                          id: 'quantity_in_transit',
                                          header: 'Dalam perjalanan',
                                          minWidth: 120,
                                          align: 'right' as const,
                                          cell: ({ line }: { line: Line }) =>
                                              text(
                                                  amount(
                                                      storedOf(line)
                                                          ?.quantity_in_transit,
                                                  ),
                                              ),
                                      },
                                  ]
                                : []),
                            ...(open
                                ? [
                                      {
                                          id: 'quantity_to_ship',
                                          header: 'Akan dikirim',
                                          content: shipping
                                              ? ('control' as const)
                                              : ('text' as const),
                                          minWidth: 120,
                                          align: 'right' as const,
                                          cell: ({
                                              index,
                                              line,
                                          }: {
                                              index: number;
                                              line: Line;
                                          }) =>
                                              shipping && line.id
                                                  ? quantityInput(
                                                        index,
                                                        'quantity_to_ship',
                                                        'Akan dikirim',
                                                        handling[line.id]
                                                            ?.to_ship ?? '',
                                                        (to_ship) =>
                                                            line.id &&
                                                            handle(line.id, {
                                                                to_ship,
                                                            }),
                                                    )
                                                  : text(
                                                        amount(
                                                            storedOf(line)
                                                                ?.quantity_to_ship,
                                                        ),
                                                    ),
                                      },
                                  ]
                                : []),
                            ...(open && twoStep
                                ? [
                                      {
                                          id: 'quantity_to_receive',
                                          header: 'Akan diterima',
                                          content: receiving
                                              ? ('control' as const)
                                              : ('text' as const),
                                          minWidth: 120,
                                          align: 'right' as const,
                                          cell: ({
                                              index,
                                              line,
                                          }: {
                                              index: number;
                                              line: Line;
                                          }) =>
                                              receiving &&
                                              line.id &&
                                              Number(
                                                  storedOf(line)
                                                      ?.quantity_in_transit,
                                              ) > 0
                                                  ? quantityInput(
                                                        index,
                                                        'quantity_to_receive',
                                                        'Akan diterima',
                                                        handling[line.id]
                                                            ?.to_receive ?? '',
                                                        (to_receive) =>
                                                            line.id &&
                                                            handle(line.id, {
                                                                to_receive,
                                                            }),
                                                    )
                                                  : text(
                                                        amount(
                                                            storedOf(line)
                                                                ?.quantity_to_receive,
                                                        ),
                                                    ),
                                      },
                                  ]
                                : []),
                        ]}
                    />
                    {order && order.postings.length > 0 && (
                        <DocumentLines
                            title="Riwayat posting"
                            data={order.postings}
                            getRowKey={(posting) => posting.id}
                            getRowLabel={(posting) => posting.number}
                            readOnly
                            actionsPlacement="inline"
                            actions={[{ id: 'open', label: 'Buka' }]}
                            onRowAction={(_, posting) =>
                                void openPosting(posting)
                            }
                            onRowClick={(posting) => void openPosting(posting)}
                            columns={[
                                {
                                    id: 'number',
                                    header: 'Nomor',
                                    minWidth: 150,
                                    cell: (posting) => text(posting.number),
                                },
                                {
                                    id: 'kind',
                                    header: 'Jenis',
                                    minWidth: 160,
                                    cell: (posting) =>
                                        text(
                                            postedTransferLabels[posting.kind],
                                        ),
                                },
                                {
                                    id: 'posting_date',
                                    header: 'Tanggal',
                                    minWidth: 110,
                                    cell: (posting) =>
                                        text(displayDate(posting.posting_date)),
                                },
                                {
                                    id: 'status',
                                    header: 'Status',
                                    minWidth: 120,
                                    cell: (posting) =>
                                        text(
                                            posting.status === 'diposting'
                                                ? 'Diposting'
                                                : 'Dibatalkan',
                                        ),
                                },
                            ]}
                        />
                    )}
                </PageDialogBody>
                {confirmation}
            </form>
            {viewing && (
                <PageDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setViewing(null);
                    }}
                >
                    <PageDialogContent
                        ref={postingDialog}
                        title={postedTransferLabels[viewing.kind]}
                    >
                        <PostedTransferCard
                            kind={viewing.kind}
                            document={viewing.document}
                            canReverse={viewing.reverse}
                            onReversed={(document) => {
                                setViewing({ ...viewing, document });
                                void reload();
                            }}
                        />
                    </PageDialogContent>
                </PageDialog>
            )}
        </>
    );
}
