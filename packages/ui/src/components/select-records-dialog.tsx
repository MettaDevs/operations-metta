import * as React from 'react';
import { DataTable } from './data-table';
import type { DataTableColumn } from './data-table';
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
} from './dialog';
import { Input } from './input';
import { useIncrementalList } from './use-incremental-list';
import type { LookupLoader } from './use-inline-lookup-data';

/**
 * Sumber "Tambah banyak" pada baris dokumen, padanan aksi Select items di subform Business Central: daftar master
 * dibuka, beberapa record dicentang, lalu setiap record menjadi satu baris baru. Seperti BC, halaman hanya mengisi
 * record dan nilai bawaannya (satuan, harga); jumlah dibiarkan kosong untuk diisi per baris.
 */
export type SelectRecords<T> = {
    /** Kata benda di layar, huruf kecil, misalnya "barang" atau "tindakan". */
    noun: string;
    loadItems: LookupLoader<T>;
    columns: DataTableColumn<T>[];
    getItemValue: (item: T) => string;
    getItemLabel: (item: T) => string;
    /** Record yang dipilih, urut sesuai urutan dicentang. */
    onAdd: (items: T[]) => void;
    /** Kolom baris dokumen yang difokuskan pada baris baru pertama, biasanya jumlah. Tanpa kolom, fokus kembali ke Tambah banyak. */
    focusColumnId?: string;
};

type SelectRecordsDialogProps<T> = Omit<
    SelectRecords<T>,
    'onAdd' | 'focusColumnId'
> & {
    /** Pemanggil yang menerima record juga menentukan fokus berikutnya. */
    onConfirm: (items: T[]) => void;
    onClose: () => void;
};

const rowSelector = 'tbody [data-row-key]';

export function SelectRecordsDialog<T>({
    noun,
    loadItems,
    columns,
    getItemValue,
    getItemLabel,
    onConfirm,
    onClose,
}: SelectRecordsDialogProps<T>) {
    const [search, setSearch] = React.useState('');
    // Urutan Map adalah urutan dicentang. Record yang tersembunyi karena pencarian berganti tetap terpilih.
    const [chosen, setChosen] = React.useState<ReadonlyMap<string, T>>(
        () => new Map(),
    );
    const [activeKey, setActiveKey] = React.useState<string>();
    const searchRef = React.useRef<HTMLInputElement>(null);
    const tableRef = React.useRef<HTMLDivElement>(null);
    const confirmed = React.useRef(false);
    // Dialog Radix mengembalikan fokus hanya ke DialogTrigger, dan pemilih ini dibuka tanpa trigger.
    const [opener] = React.useState(() =>
        document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
    );
    const list = useIncrementalList({
        loadItems,
        query: search,
        getKey: getItemValue,
    });
    const itemOf = (key: string) =>
        chosen.get(key) ??
        list.items.find((item) => getItemValue(item) === key);

    const toggle = (item: T) => {
        const key = getItemValue(item);
        setActiveKey(key);
        setChosen((current) => {
            const next = new Map(current);

            if (next.has(key)) {
                next.delete(key);
            } else {
                next.set(key, item);
            }

            return next;
        });
    };
    const changeKeys = (keys: React.Key[]) => {
        const wanted = new Set(keys.map(String));
        setChosen((current) => {
            const next = new Map(
                [...current].filter(([key]) => wanted.has(key)),
            );
            list.items.forEach((item) => {
                const key = getItemValue(item);

                if (wanted.has(key) && !next.has(key)) {
                    next.set(key, item);
                }
            });

            return next;
        });
    };
    // Tanpa centang, Enter pada baris menambah baris itu saja, sama dengan OK di daftar BC yang memakai baris aktif.
    const confirm = (current?: T) => {
        const items =
            chosen.size > 0 ? [...chosen.values()] : current ? [current] : [];

        if (items.length > 0) {
            confirmed.current = true;
            onConfirm(items);
        }
    };
    const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const target = event.target;

        if (!(target instanceof HTMLElement)) {
            return;
        }

        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            confirm();

            return;
        }

        const row = target.matches(rowSelector) ? target : null;

        if (row && event.key === 'Enter' && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            confirm(itemOf(row.dataset.rowKey ?? ''));

            return;
        }

        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }

        const rows = [
            ...(tableRef.current?.querySelectorAll<HTMLElement>(rowSelector) ??
                []),
        ];
        const index = row
            ? rows.indexOf(row)
            : target === searchRef.current && event.key === 'ArrowDown'
              ? -1
              : null;

        if (index === null) {
            return;
        }

        event.preventDefault();
        const next = rows[event.key === 'ArrowDown' ? index + 1 : index - 1];

        if (next) {
            next.focus();
        } else if (event.key === 'ArrowUp') {
            searchRef.current?.focus();
        }
    };

    // Dialog, bukan PageDialog: pemilih dibuka dari kartu dan juga dari dialog ringkas seperti Hitung baris, dan PageDialog
    // tergambar di bawah dialog ringkas.
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) {
                    onClose();
                }
            }}
        >
            <DialogContent
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    searchRef.current?.focus();
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault();

                    if (!confirmed.current) {
                        opener?.focus();
                    }
                }}
            >
                <DialogHeader>
                    <DialogTitle>{`Pilih ${noun}`}</DialogTitle>
                    <DialogDescription>
                        {`Centang beberapa ${noun}, lalu pilih Tambah. Setiap ${noun} menjadi satu baris baru.`}
                    </DialogDescription>
                </DialogHeader>
                <DialogBody className="flex min-h-0 flex-col">
                    <div
                        className="flex min-h-0 flex-1 flex-col gap-4"
                        onKeyDownCapture={keyboard}
                    >
                        <Input
                            ref={searchRef}
                            label={`Cari ${noun}`}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                        <div ref={tableRef} className="flex min-h-0 flex-1">
                            <DataTable
                                columns={columns.map((column) => ({
                                    ...column,
                                    sortValue: undefined,
                                }))}
                                data={list.items}
                                getRowKey={getItemValue}
                                getRowLabel={getItemLabel}
                                selection={{
                                    selectedKeys: [...chosen.keys()],
                                    onSelectedKeysChange: changeKeys,
                                }}
                                rowActivation="single-click"
                                onRowClick={toggle}
                                activeRowKey={activeKey}
                                incremental={list}
                                scrollMode="viewport"
                                emptyMessage={`${noun[0]?.toUpperCase() ?? ''}${noun.slice(1)} tidak ditemukan.`}
                            />
                        </div>
                    </div>
                </DialogBody>
                <DialogFooter>
                    <p
                        role="status"
                        className="me-auto text-sm text-muted-foreground"
                    >
                        {chosen.size > 0
                            ? `${chosen.size} ${noun} dipilih`
                            : `Belum ada ${noun} yang dipilih`}
                    </p>
                    <DialogAction
                        disabled={chosen.size === 0}
                        onClick={() => confirm()}
                    >
                        {chosen.size > 0
                            ? `Tambah ${chosen.size} ${noun}`
                            : 'Tambah'}
                    </DialogAction>
                    <DialogCancel />
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
