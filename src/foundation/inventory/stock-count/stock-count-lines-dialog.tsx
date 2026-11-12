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
import { DocumentLines } from '@operations-metta/ui/document-lines';
import { Field, FieldLabel } from '@operations-metta/ui/field';
import { FormControl, FormGrid } from '@operations-metta/ui/form-control';
import { InlineLookup } from '@operations-metta/ui/inline-lookup';
import type { LookupLoader } from '@operations-metta/ui/inline-lookup';
import { Switch } from '@operations-metta/ui/switch';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
    type ApiBody,
} from '../../../platform/shell/index.ts';
import {
    ItemLookup,
    label,
    type ItemChoice,
    type Position,
} from './stock-count-fields.tsx';

type Category = ApiBody<'inventoryItemCategoryList'>['data'][number];
type Reference = { id: string; code: string; name: string };
type Errors = Record<string, string[]>;

const loadCategories: LookupLoader<Category> = async ({
    query,
    cursor,
    signal,
}) => {
    const { body } = await api.inventoryItemCategoryList(
        { query: { q: query, ...(cursor ? { cursor } : {}) } },
        { signal },
    );
    return { items: body.data, nextCursor: body.next_cursor };
};

let keys = 0;
const nextKey = () => `saringan-${++keys}`;

// Hitung baris (Calculate Lines di BC): mengambil stok lokasi per barang dan batch sampai tanggal posting, disaring
// barang, kategori beserta subkategorinya, dan ada tidaknya stok. Hasilnya ditambahkan ke baris opname yang sedang
// disusun; posisi yang sudah ada di opname tidak ditambahkan lagi.
export function StockCountLinesDialog({
    location,
    postingDate,
    onClose,
    onCalculated,
}: {
    location: Reference;
    postingDate: string;
    onClose: () => void;
    onCalculated: (positions: Position[]) => void;
}): ReactNode {
    const contentRef = useRef<HTMLDivElement>(null);
    const [category, setCategory] = useState<Category | null>(null);
    const [items, setItems] = useState<
        { key: string; item: ItemChoice | null }[]
    >([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [onlyInStock, setOnlyInStock] = useState(true);
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [message, setMessage] = useState<string | null>(null);
    const chosen = [
        ...new Set(items.flatMap((row) => (row.item ? [row.item.id] : []))),
    ];

    const calculate = async () => {
        setBusy(true);
        setErrors({});
        setMessage(null);
        try {
            const { body } = await api.inventoryStockCountCalculateLines({
                body: {
                    location_id: location.id,
                    posting_date: postingDate,
                    item_ids: chosen,
                    category_id: category?.id ?? null,
                    only_in_stock: onlyInStock,
                },
            });
            onCalculated(body.data);
        } catch (caught) {
            if (caught instanceof ApiError && caught.status === 422)
                setErrors(caught.errors);
            else setMessage(errorText(caught, 'Baris belum dihitung.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent
                ref={contentRef}
                size="wide"
                onEscapeKeyDown={(event) => {
                    if (
                        contentRef.current?.querySelector(
                            '[role="combobox"][aria-expanded="true"]',
                        )
                    )
                        event.preventDefault();
                }}
            >
                <DialogHeader>
                    <DialogTitle>Hitung baris</DialogTitle>
                    <DialogDescription>
                        Mengambil stok {label(location)} per barang dan batch
                        sebagai baris opname. Kosongkan barang dan kategori
                        untuk mengambil semua barang.
                    </DialogDescription>
                </DialogHeader>
                <FormErrorHeader
                    errors={errors}
                    message={message}
                    operation="Baris belum dihitung"
                />
                <DialogBody className="space-y-4">
                    <FormGrid>
                        <FormControl
                            error={errors.category_id?.join(' ')}
                            data-error-field="category_id"
                            hint="Subkategorinya ikut dihitung."
                        >
                            <InlineLookup<Category>
                                label="Kategori"
                                loadItems={loadCategories}
                                value={category}
                                displayValue={category ? label(category) : ''}
                                onValueChange={setCategory}
                                getItemValue={(entry) => entry.id}
                                getItemLabel={label}
                                placeholder="Cari kode atau nama kategori…"
                                emptyMessage="Kategori tidak ditemukan."
                                popupClassName="w-[30rem]"
                                showDetails={false}
                                portalContainer={contentRef}
                                columns={[
                                    {
                                        id: 'code',
                                        header: 'Kode',
                                        width: 110,
                                        cell: (entry) => entry.code,
                                    },
                                    {
                                        id: 'name',
                                        header: 'Nama',
                                        width: 200,
                                        cell: (entry) => entry.name,
                                    },
                                    {
                                        id: 'parent',
                                        header: 'Induk',
                                        width: 160,
                                        cell: (entry) =>
                                            entry.parent?.name ?? '',
                                    },
                                ]}
                            />
                        </FormControl>
                        <FormControl hint="Matikan untuk ikut mengambil barang yang tercatat kosong di lokasi ini, misalnya untuk mencatat barang temuan.">
                            <Field orientation="horizontal" className="w-auto">
                                <Switch
                                    id="stock-count-only-in-stock"
                                    checked={onlyInStock}
                                    onCheckedChange={setOnlyInStock}
                                />
                                <FieldLabel
                                    htmlFor="stock-count-only-in-stock"
                                    className="font-normal"
                                >
                                    Hanya barang yang ada stoknya
                                </FieldLabel>
                            </Field>
                        </FormControl>
                    </FormGrid>
                    <DocumentLines
                        title="Barang"
                        data={items.map((row, index) => ({ index, row }))}
                        getRowKey={(entry) => entry.row.key}
                        getRowLabel={(entry) =>
                            entry.row.item?.name ?? `Barang ${entry.index + 1}`
                        }
                        showRowNumbers
                        disabled={busy}
                        portalContainer={contentRef}
                        selection={{
                            selectedKeys: selected,
                            onSelectedKeysChange: (next) =>
                                setSelected(next.map(String)),
                        }}
                        onAddRow={() =>
                            setItems((current) => [
                                ...current,
                                { key: nextKey(), item: null },
                            ])
                        }
                        onDeleteRows={(removed) =>
                            setItems((current) =>
                                current.filter(
                                    (row) =>
                                        !removed.some(
                                            (entry) =>
                                                entry.row.key === row.key,
                                        ),
                                ),
                            )
                        }
                        emptyMessage="Semua barang. Pilih Tambah untuk menghitung barang tertentu saja."
                        columns={[
                            {
                                id: 'item_id',
                                header: 'Barang',
                                content: 'control',
                                minWidth: 260,
                                cell: ({ index, row }) => (
                                    <ItemLookup
                                        value={row.item}
                                        field={`item_ids.${index}`}
                                        error={errors[
                                            `item_ids.${chosen.indexOf(row.item?.id ?? '')}`
                                        ]?.join(' ')}
                                        portalContainer={contentRef}
                                        onPick={(item) =>
                                            setItems((current) =>
                                                current.map((entry) =>
                                                    entry.key === row.key
                                                        ? { ...entry, item }
                                                        : entry,
                                                ),
                                            )
                                        }
                                    />
                                ),
                            },
                        ]}
                    />
                </DialogBody>
                <DialogFooter>
                    <DialogAction
                        type="button"
                        disabled={busy}
                        onClick={() => void calculate()}
                    >
                        Hitung
                    </DialogAction>
                    <DialogCancel disabled={busy} />
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
