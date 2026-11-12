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
import { Switch } from '@operations-metta/ui/switch';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
    api,
    ApiError,
    errorText,
    FormErrorHeader,
} from '../../../platform/shell/index.ts';
import { ItemCategoryLookup } from '../item-category/item-category-lookup.tsx';
import { ItemLookup } from '../item/item-lookup.tsx';
import type { Reference } from '../master-lookup.tsx';
import { label, type Position } from './stock-count-fields.tsx';

type Errors = Record<string, string[]>;

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
    const [category, setCategory] = useState<Reference | null>(null);
    const [items, setItems] = useState<
        { key: string; item: Reference | null }[]
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
                        <ItemCategoryLookup
                            label="Kategori"
                            field="category_id"
                            value={category}
                            onChange={(entry) =>
                                setCategory({
                                    id: entry.id,
                                    code: entry.code,
                                    name: entry.name,
                                })
                            }
                            error={errors.category_id?.join(' ')}
                            hint="Subkategorinya ikut dihitung."
                            portalContainer={contentRef}
                        />
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
                                cell: ({ row }) => {
                                    const at = chosen.indexOf(
                                        row.item?.id ?? '',
                                    );
                                    return (
                                        <ItemLookup
                                            label="Barang"
                                            field={`item_ids.${at}`}
                                            value={row.item}
                                            error={errors[
                                                `item_ids.${at}`
                                            ]?.join(' ')}
                                            portalContainer={contentRef}
                                            onChange={(item) =>
                                                setItems((current) =>
                                                    current.map((entry) =>
                                                        entry.key === row.key
                                                            ? {
                                                                  ...entry,
                                                                  item: {
                                                                      id: item.id,
                                                                      code: item.code,
                                                                      name: item.name,
                                                                  },
                                                              }
                                                            : entry,
                                                    ),
                                                )
                                            }
                                        />
                                    );
                                },
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
