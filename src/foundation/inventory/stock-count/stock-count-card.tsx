import { ActionButton } from '@operations-metta/ui/action-button';
import { Button } from '@operations-metta/ui/button';
import { DataTableText } from '@operations-metta/ui/data-table';
import { DatePicker, displayDate } from '@operations-metta/ui/date-picker';
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Input } from '@operations-metta/ui/input';
import {
    PageDialogBody,
    PageDialogToolbar,
    usePageDialogRecord,
} from '@operations-metta/ui/page-dialog';
import { useConfirmation } from '@operations-metta/ui/use-confirmation';
import {
    Calculator,
    ClipboardCheck,
    CircleX,
    PencilLine,
    Send,
    Undo2,
} from 'lucide-react';
import { useCallback, useState } from 'react';
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
    decimal,
    ItemLookup,
    label,
    type ItemChoice,
    type Position,
} from './stock-count-fields.tsx';
import { StockCountLinesDialog } from './stock-count-lines-dialog.tsx';
import { StockCountPostingDialog } from './stock-count-posting-dialog.tsx';

export type StockCount = ApiBody<'inventoryStockCountShow'>['data'];
export type StockCountPermissions =
    ApiBody<'inventoryStockCountList'>['permissions'];
type Location = ApiBody<'inventoryLocationList'>['data'][number];
type ItemUnit = ApiBody<'inventoryItemUnitList'>['data'][number];
type StoredLine = StockCount['lines'][number];
type Errors = Record<string, string[]>;

type Reference = { id: string; code: string; name: string };
type UnitChoice = Reference & { quantity_per_unit: string };
type Batch = { id: string; batch_number: string; expiry_date: string | null };
// Baris dari Hitung baris dan baris tersimpan menunjuk barang dan batchnya; baris yang ditambah tangan memilih barang
// dan boleh membawa nomor batch temuan beserta kedaluwarsanya.
type Line = {
    key: string;
    id: string | null;
    manual: boolean;
    item: ItemChoice | null;
    batch: Batch | null;
    batch_number: string;
    expiry_date: string;
    unit: UnitChoice | null;
    expected: string | null;
    quantity_counted: string;
    description: string;
};
type Header = {
    location: Reference | null;
    count_date: string;
    posting_date: string;
    description: string;
};

export const stockCountStatusLabels: Record<StockCount['status'], string> = {
    draf: 'Draf',
    dihitung: 'Selesai dihitung',
    diposting: 'Diposting',
    dibatalkan: 'Dibatalkan',
};
const today = () => new Date().toLocaleDateString('sv-SE');
let keys = 0;
const nextKey = () => `baris-${++keys}`;
const scale = 10_000;
// Hitungan dalam satuan baris dikali isi satuannya, dibulatkan ke empat angka di belakang koma seperti kartu gudang.
const inBase = (quantity: string, perUnit: string) =>
    Math.round(Number(quantity) * Number(perUnit) * scale) / scale;

function headerOf(count: StockCount | null): Header {
    return {
        location: count?.location ?? null,
        count_date: count?.count_date ?? today(),
        posting_date: count?.posting_date ?? today(),
        description: count?.description ?? '',
    };
}

function lineOf(line: StoredLine): Line {
    return {
        key: line.id,
        id: line.id,
        manual: false,
        item: { ...line.item, base_unit_id: '' },
        batch: line.batch,
        batch_number: line.batch_number ?? '',
        expiry_date: line.expiry_date ?? '',
        unit: { ...line.unit, quantity_per_unit: line.quantity_per_unit },
        expected: line.quantity_expected,
        quantity_counted: line.quantity_counted ?? '',
        description: line.description ?? '',
    };
}

const linesOf = (count: StockCount | null) => (count?.lines ?? []).map(lineOf);
const positionKey = (line: { item: Reference | null; batch: Batch | null }) =>
    `${line.item?.id ?? ''}:${line.batch?.id ?? ''}`;

const loadStockLocations: LookupLoader<Location> = async ({
    query,
    cursor,
    signal,
}) => {
    const { body } = await api.inventoryLocationList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return {
        items: body.data.filter((location) => !location.is_transit),
        nextCursor: body.next_cursor,
    };
};

// Satuan isian hanya dari satuan barangnya: satuan dasar dan satuan kemasannya.
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

// Opname stok (Physical Inventory Order BC): pilih lokasi, Hitung baris dari stoknya atau tambah barang temuan, isi
// jumlah dihitung, Selesai hitung, lalu Post. Stok tidak dibekukan; Post menghitung ulang jumlah tercatat dan
// memperlihatkan selisihnya lebih dulu.
export function StockCountCard({
    count: initial,
    permissions,
    portalContainer,
    onSaved,
    onClose,
}: {
    count: StockCount | null;
    permissions: StockCountPermissions;
    portalContainer: RefObject<HTMLElement | null>;
    onSaved: (count: StockCount) => void;
    onClose: () => void;
}): ReactNode {
    const [count, setCount] = useState(initial);
    const draft = count === null || count.status === 'draf';
    const editable = draft && permissions.update;
    const counted = count?.status === 'dihitung';
    const posted =
        count?.status === 'diposting' ||
        (count?.status === 'dibatalkan' && count.posted_at !== null);
    const [header, setHeader] = useState(() => headerOf(initial));
    const [lines, setLines] = useState(() => linesOf(initial));
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const [operation, setOperation] = useState('Opname belum disimpan');
    const [calculating, setCalculating] = useState(false);
    const [posting, setPosting] = useState(false);
    const { confirm, confirmation } = useConfirmation();
    const pristine =
        JSON.stringify([header, lines]) ===
        JSON.stringify([headerOf(count), linesOf(count)]);
    usePageDialogRecord({
        recordTitle: count
            ? `${count.number} ${count.location.name}`
            : 'Opname baru',
        editing: editable,
    });

    const error = (field: string) => errors[field]?.join(' ');
    const field = (index: number, name: string) => `lines.${index}.${name}`;
    const change = (index: number, patch: Partial<Line>) =>
        setLines((current) =>
            current.map((line, at) =>
                at === index ? { ...line, ...patch } : line,
            ),
        );
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
    const adopt = (next: StockCount) => {
        setCount(next);
        setHeader(headerOf(next));
        setLines(linesOf(next));
        setSelected([]);
        onSaved(next);
    };

    const payload = () => ({
        location_id: header.location?.id ?? '',
        count_date: header.count_date,
        posting_date: header.posting_date,
        description: header.description || null,
        lines: lines.map((line) => ({
            id: line.id,
            item_id: line.item?.id ?? '',
            batch_id: line.batch?.id ?? null,
            batch_number: line.batch ? null : line.batch_number || null,
            expiry_date: line.batch ? null : line.expiry_date || null,
            unit_id: line.unit?.id ?? '',
            quantity_counted: line.quantity_counted,
            description: line.description || null,
        })),
    });

    const save = async (): Promise<StockCount | null> => {
        clear();
        try {
            const { body } = count
                ? await api.inventoryStockCountUpdate({
                      params: { id: count.id },
                      body: { ...payload(), version: count.version },
                  })
                : await api.inventoryStockCountCreate({ body: payload() });
            return body.data;
        } catch (caught) {
            failed(caught, 'Opname belum disimpan');
            return null;
        }
    };

    const submit = () =>
        run(async () => {
            const saved = await save();
            if (!saved) return;
            toast.success(count ? 'Opname diperbarui.' : 'Opname dibuat.');
            adopt(saved);
        });

    const command = async (
        work: (current: StockCount) => Promise<{ body: { data: StockCount } }>,
        failure: string,
        success: (next: StockCount) => string,
        prepare: () => Promise<StockCount | null>,
    ) =>
        run(async () => {
            const current = await prepare();
            if (!current) return;
            if (current !== count) adopt(current);
            clear();
            try {
                const { body } = await work(current);
                toast.success(success(body.data));
                adopt(body.data);
            } catch (caught) {
                failed(caught, failure);
            }
        });
    const current = () => Promise.resolve(count);

    const finish = async () => {
        if (
            !(await confirm({
                title: 'Selesaikan hitungan opname ini?',
                description:
                    'Barang dan jumlah dihitung tidak bisa diubah lagi kecuali opname dibuka lagi. Sesudahnya opname siap diposting.',
                confirmLabel: 'Selesai hitung',
            }))
        )
            return;
        await command(
            (next) =>
                api.inventoryStockCountFinish({
                    params: { id: next.id },
                    body: { version: next.version },
                }),
            'Hitungan belum diselesaikan',
            (next) => `Hitungan ${next.number} selesai.`,
            async () => (pristine && count ? count : save()),
        );
    };

    const reopen = () =>
        command(
            (next) =>
                api.inventoryStockCountReopen({
                    params: { id: next.id },
                    body: { version: next.version },
                }),
            'Opname belum dibuka lagi',
            (next) => `${next.number} dibuka lagi untuk diubah.`,
            current,
        );

    const cancel = async () => {
        if (
            !(await confirm({
                title: `Batalkan ${count?.number ?? 'opname'}?`,
                description:
                    'Hitungan ini tidak akan diposting dan stok tidak berubah. Opname tetap tercatat dengan status dibatalkan.',
                confirmLabel: 'Batalkan opname',
                destructive: true,
            }))
        )
            return;
        await command(
            (next) =>
                api.inventoryStockCountCancel({
                    params: { id: next.id },
                    body: { version: next.version },
                }),
            'Opname belum dibatalkan',
            (next) => `Opname ${next.number} dibatalkan.`,
            current,
        );
    };

    const reverse = async () => {
        if (
            !(await confirm({
                title: `Batalkan posting ${count?.number ?? 'opname'}?`,
                description:
                    'Selisih yang sudah diposting dikembalikan, sehingga stok kembali seperti sebelum opname ini. Pembatalan ditolak bila stok temuan yang dimasukkan opname ini sudah dipakai.',
                confirmLabel: 'Batal posting',
                destructive: true,
            }))
        )
            return;
        await command(
            (next) =>
                api.inventoryStockCountReverse({
                    params: { id: next.id },
                    body: { version: next.version },
                }),
            'Posting belum dibatalkan',
            (next) => `Posting ${next.number} dibatalkan.`,
            current,
        );
    };

    const addLine = () =>
        setLines((existing) => [
            ...existing,
            {
                key: nextKey(),
                id: null,
                manual: true,
                item: null,
                batch: null,
                batch_number: '',
                expiry_date: '',
                unit: null,
                expected: null,
                quantity_counted: '',
                description: '',
            },
        ]);

    // Posisi stok yang sudah ada di dokumen tidak ditambahkan lagi.
    const appendPositions = (positions: Position[]) => {
        const present = new Set(lines.map(positionKey));
        const fresh = positions
            .filter((position) => !present.has(positionKey(position)))
            .map((position): Line => ({
                key: nextKey(),
                id: null,
                manual: false,
                item: position.item,
                batch: position.batch,
                batch_number: '',
                expiry_date: '',
                unit: {
                    id: position.item.base_unit_id,
                    code: position.item.base_unit,
                    name: '',
                    quantity_per_unit: '1',
                },
                expected: position.quantity,
                quantity_counted: '',
                description: '',
            }));
        setLines((existing) => [...existing, ...fresh]);
        toast.success(
            fresh.length
                ? `${fresh.length} baris ditambahkan. Isi jumlah dihitung, lalu Simpan.`
                : 'Tidak ada baris baru: semua stok yang cocok sudah ada di opname ini.',
        );
    };

    const text = (value: string) => <DataTableText>{value}</DataTableText>;
    const amount = (value: string | null | undefined) =>
        value === null || value === undefined || value === ''
            ? ''
            : decimal.format(Number(value));
    const stored = new Map<string, StoredLine>(
        (count?.lines ?? []).map((line) => [line.id, line]),
    );
    const storedOf = (line: Line) =>
        line.id === null ? undefined : stored.get(line.id);
    // Selisih dalam satuan dasar: sebelum posting terhadap jumlah tercatat saat baris dibuat, sesudahnya terhadap
    // jumlah tercatat yang dihitung ulang saat posting.
    const difference = (line: Line) => {
        const atPosting = storedOf(line)?.quantity_expected_at_posting;
        const expected = posted ? atPosting : line.expected;
        if (
            expected === null ||
            expected === undefined ||
            line.quantity_counted === '' ||
            !line.unit
        )
            return '';
        const value =
            inBase(line.quantity_counted, line.unit.quantity_per_unit) -
            Number(expected);
        return `${value > 0 ? '+' : ''}${decimal.format(Math.round(value * scale) / scale)}`;
    };
    const batchText = (line: Line) =>
        line.batch?.batch_number ?? line.batch_number;
    const expiryText = (line: Line) => {
        const value = line.batch ? line.batch.expiry_date : line.expiry_date;
        return value ? displayDate(value) : '';
    };
    const control = editable ? ('control' as const) : ('text' as const);
    const unitOf = (line: Line) => line.item?.base_unit ?? '';

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
                    {editable && (
                        <>
                            <ActionButton
                                action="save"
                                type="submit"
                                disabled={busy}
                                pending={busy}
                            />
                            <ActionButton
                                action="cancel"
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                    if (!count) {
                                        onClose();
                                        return;
                                    }
                                    setHeader(headerOf(count));
                                    setLines(linesOf(count));
                                    clear();
                                }}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="command"
                                disabled={busy}
                                onClick={() => {
                                    if (!header.location) {
                                        setOperation('Baris belum dihitung');
                                        setErrors({
                                            location_id: [
                                                'Pilih lokasi yang dihitung lebih dulu.',
                                            ],
                                        });
                                        return;
                                    }
                                    clear();
                                    setCalculating(true);
                                }}
                            >
                                <Calculator aria-hidden="true" />
                                Hitung baris
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="command"
                                disabled={busy}
                                onClick={() => void finish()}
                            >
                                <ClipboardCheck aria-hidden="true" />
                                Selesai hitung
                            </Button>
                        </>
                    )}
                    {counted && permissions.post && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            onClick={() => {
                                clear();
                                setPosting(true);
                            }}
                        >
                            <Send aria-hidden="true" />
                            Post
                        </Button>
                    )}
                    {counted && permissions.update && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            onClick={() => void reopen()}
                        >
                            <PencilLine aria-hidden="true" />
                            Buka lagi
                        </Button>
                    )}
                    {count?.status === 'diposting' && permissions.reverse && (
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
                    {count && (draft || counted) && permissions.update && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="command"
                            disabled={busy}
                            onClick={() => void cancel()}
                        >
                            <CircleX aria-hidden="true" />
                            Batalkan opname
                        </Button>
                    )}
                </PageDialogToolbar>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation={operation}
                />
                <PageDialogBody className="space-y-4 py-3">
                    <FormGrid>
                        <FormControl
                            error={error('location_id')}
                            data-error-field="location_id"
                            hint={
                                editable && lines.length > 0
                                    ? 'Lokasi terkunci karena opname sudah punya baris. Hapus semua baris untuk menggantinya.'
                                    : undefined
                            }
                        >
                            {editable && lines.length === 0 ? (
                                <InlineLookup<Location>
                                    label="Lokasi"
                                    required
                                    loadItems={loadStockLocations}
                                    value={
                                        header.location
                                            ? {
                                                  ...header.location,
                                                  operating_unit: {
                                                      id: '',
                                                      name: '',
                                                  },
                                                  is_transit: false,
                                                  picking_method: null,
                                                  transfer_mode: null,
                                                  version: 0,
                                              }
                                            : null
                                    }
                                    displayValue={
                                        header.location
                                            ? label(header.location)
                                            : ''
                                    }
                                    onValueChange={(location) =>
                                        setHeader({
                                            ...header,
                                            location: {
                                                id: location.id,
                                                code: location.code,
                                                name: location.name,
                                            },
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
                                            cell: (location) =>
                                                location.operating_unit.name,
                                        },
                                    ]}
                                />
                            ) : (
                                <Input
                                    label="Lokasi"
                                    readOnly
                                    value={
                                        header.location
                                            ? label(header.location)
                                            : ''
                                    }
                                />
                            )}
                        </FormControl>
                        {editable ? (
                            <FormControl error={error('count_date')}>
                                <DatePicker
                                    label="Tanggal hitung"
                                    required
                                    data-error-field="count_date"
                                    value={header.count_date}
                                    portalContainer={portalContainer}
                                    onValueChange={(count_date) =>
                                        setHeader({ ...header, count_date })
                                    }
                                />
                            </FormControl>
                        ) : (
                            <FormControl>
                                <Input
                                    label="Tanggal hitung"
                                    readOnly
                                    value={displayDate(header.count_date)}
                                />
                            </FormControl>
                        )}
                        {editable ? (
                            <FormControl
                                error={error('posting_date')}
                                hint="Tanggal selisih opname dicatat di kartu stok. Jumlah tercatat dihitung sampai tanggal ini."
                            >
                                <DatePicker
                                    label="Tanggal posting"
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
                                    label="Tanggal posting"
                                    readOnly
                                    value={displayDate(header.posting_date)}
                                />
                            </FormControl>
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
                        {count && (
                            <FormControl>
                                <Input
                                    label="Status"
                                    readOnly
                                    value={stockCountStatusLabels[count.status]}
                                />
                            </FormControl>
                        )}
                        {count?.count_started_at && (
                            <FormControl hint="Gerak stok sesudah waktu ini ditandai saat posting, karena hitungannya mungkin belum memasukkan gerak itu.">
                                <Input
                                    label="Mulai hitung"
                                    readOnly
                                    value={new Date(
                                        count.count_started_at,
                                    ).toLocaleString('id-ID', {
                                        dateStyle: 'short',
                                        timeStyle: 'short',
                                    })}
                                />
                            </FormControl>
                        )}
                    </FormGrid>
                    <DocumentLines
                        title="Baris opname"
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
                        onAddRow={editable ? addLine : undefined}
                        onDeleteRows={
                            editable
                                ? (removed) =>
                                      setLines((existing) =>
                                          existing.filter(
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
                                ? 'Belum ada barang. Pilih Hitung baris untuk mengambil stok lokasi ini, atau Tambah untuk barang temuan.'
                                : 'Opname ini tidak berisi barang.'
                        }
                        columns={[
                            {
                                id: 'item_id',
                                header: 'Barang',
                                required: editable,
                                content: control,
                                minWidth: 220,
                                cell: ({ index, line }) =>
                                    editable && line.manual ? (
                                        <ItemLookup
                                            value={line.item}
                                            field={field(index, 'item_id')}
                                            error={error(
                                                field(index, 'item_id'),
                                            )}
                                            portalContainer={portalContainer}
                                            onPick={(item) =>
                                                change(index, {
                                                    item,
                                                    unit: {
                                                        id: item.base_unit_id,
                                                        code: item.base_unit,
                                                        name: '',
                                                        quantity_per_unit: '1',
                                                    },
                                                })
                                            }
                                        />
                                    ) : (
                                        text(line.item ? label(line.item) : '')
                                    ),
                            },
                            {
                                id: 'batch_number',
                                header: 'Batch',
                                content: control,
                                minWidth: 130,
                                cell: ({ index, line }) =>
                                    editable && line.manual ? (
                                        <FormControl
                                            error={
                                                error(
                                                    field(
                                                        index,
                                                        'batch_number',
                                                    ),
                                                ) ??
                                                error(field(index, 'batch_id'))
                                            }
                                        >
                                            <Input
                                                label="Batch"
                                                required={
                                                    line.item?.batch_required
                                                }
                                                maxLength={50}
                                                data-error-field={field(
                                                    index,
                                                    'batch_number',
                                                )}
                                                value={line.batch_number}
                                                onChange={(event) =>
                                                    change(index, {
                                                        batch_number:
                                                            event.target.value,
                                                    })
                                                }
                                            />
                                        </FormControl>
                                    ) : (
                                        text(batchText(line))
                                    ),
                            },
                            {
                                id: 'expiry_date',
                                header: 'Kedaluwarsa',
                                content: control,
                                minWidth: 140,
                                cell: ({ index, line }) =>
                                    editable && line.manual ? (
                                        <FormControl
                                            error={error(
                                                field(index, 'expiry_date'),
                                            )}
                                        >
                                            <DatePicker
                                                label="Kedaluwarsa"
                                                required={
                                                    line.item?.expiry_required
                                                }
                                                data-error-field={field(
                                                    index,
                                                    'expiry_date',
                                                )}
                                                value={line.expiry_date}
                                                portalContainer={
                                                    portalContainer
                                                }
                                                onValueChange={(expiry_date) =>
                                                    change(index, {
                                                        expiry_date,
                                                    })
                                                }
                                            />
                                        </FormControl>
                                    ) : (
                                        text(expiryText(line))
                                    ),
                            },
                            {
                                id: 'quantity_expected',
                                header: posted
                                    ? 'Tercatat saat hitung'
                                    : 'Tercatat',
                                minWidth: 110,
                                align: 'right',
                                cell: ({ line }) =>
                                    text(
                                        line.expected === null
                                            ? ''
                                            : `${amount(line.expected)} ${unitOf(line)}`,
                                    ),
                            },
                            ...(posted
                                ? [
                                      {
                                          id: 'quantity_expected_at_posting',
                                          header: 'Tercatat saat posting',
                                          minWidth: 120,
                                          align: 'right' as const,
                                          cell: ({ line }: { line: Line }) =>
                                              text(
                                                  `${amount(storedOf(line)?.quantity_expected_at_posting)} ${unitOf(line)}`,
                                              ),
                                      },
                                  ]
                                : []),
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
                                                    : `${line.unit.code} (${line.unit.quantity_per_unit} ${unitOf(line)})`
                                                : '',
                                        )
                                    ),
                            },
                            {
                                id: 'quantity_counted',
                                header: 'Dihitung',
                                required: editable,
                                content: control,
                                minWidth: 100,
                                align: 'right',
                                cell: ({ index, line }) =>
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(
                                                    index,
                                                    'quantity_counted',
                                                ),
                                            )}
                                        >
                                            <Input
                                                label="Dihitung"
                                                type="number"
                                                min={0}
                                                step="any"
                                                inputMode="decimal"
                                                data-error-field={field(
                                                    index,
                                                    'quantity_counted',
                                                )}
                                                value={line.quantity_counted}
                                                onChange={(event) =>
                                                    change(index, {
                                                        quantity_counted:
                                                            event.target.value,
                                                    })
                                                }
                                            />
                                        </FormControl>
                                    ) : (
                                        text(amount(line.quantity_counted))
                                    ),
                            },
                            {
                                id: 'difference',
                                header: 'Selisih',
                                minWidth: 100,
                                align: 'right',
                                cell: ({ line }) => {
                                    const value = difference(line);
                                    return text(
                                        value ? `${value} ${unitOf(line)}` : '',
                                    );
                                },
                            },
                            ...(posted
                                ? [
                                      {
                                          id: 'moved',
                                          header: 'Bergerak sesudah mulai hitung',
                                          minWidth: 130,
                                          cell: ({ line }: { line: Line }) =>
                                              text(
                                                  storedOf(line)
                                                      ?.moved_after_count_started
                                                      ? 'Ya'
                                                      : 'Tidak',
                                              ),
                                      },
                                  ]
                                : []),
                            {
                                id: 'description',
                                header: 'Keterangan',
                                content: control,
                                minWidth: 160,
                                cell: ({ index, line }) =>
                                    editable ? (
                                        <FormControl
                                            error={error(
                                                field(index, 'description'),
                                            )}
                                        >
                                            <Input
                                                label="Keterangan"
                                                maxLength={200}
                                                data-error-field={field(
                                                    index,
                                                    'description',
                                                )}
                                                value={line.description}
                                                onChange={(event) =>
                                                    change(index, {
                                                        description:
                                                            event.target.value,
                                                    })
                                                }
                                            />
                                        </FormControl>
                                    ) : (
                                        text(line.description)
                                    ),
                            },
                        ]}
                    />
                </PageDialogBody>
                {confirmation}
            </form>
            {calculating && header.location && (
                <StockCountLinesDialog
                    location={header.location}
                    postingDate={header.posting_date}
                    onClose={() => setCalculating(false)}
                    onCalculated={(positions) => {
                        setCalculating(false);
                        appendPositions(positions);
                    }}
                />
            )}
            {posting && count && (
                <StockCountPostingDialog
                    count={count}
                    onClose={() => setPosting(false)}
                    onPosted={(next) => {
                        setPosting(false);
                        toast.success(`Opname ${next.number} diposting.`);
                        adopt(next);
                    }}
                />
            )}
        </>
    );
}
