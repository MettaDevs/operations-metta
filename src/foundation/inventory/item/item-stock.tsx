import { Button } from '@operations-metta/ui/button';
import { displayDate } from '@operations-metta/ui/date-picker';
import { IncrementalListStatus } from '@operations-metta/ui/incremental-list-status';
import { useIncrementalList } from '@operations-metta/ui/use-incremental-list';
import type { ListLoader } from '@operations-metta/ui/use-incremental-list';
import { Link } from '@tanstack/react-router';
import { ScrollText } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, type ApiBody } from '../../../platform/shell/index.ts';
import { displayNumber } from '@operations-metta/ui/display-number';
import type { Reference } from '../master-lookup.tsx';
import type { Item } from './item-lookup.tsx';

type StockRow = ApiBody<'inventoryStock'>['data'][number];

// Bagian "Stok per lokasi" di FactBox kartu barang. Baris dikelompokkan per lokasi tanpa bergantung pada urutan
// jawaban server, lalu ditampilkan menurut kode lokasi dan kedaluwarsa terdekat; batch tanpa kedaluwarsa di akhir.
const expiryOf = (row: StockRow) => row.batch?.expiry_date ?? '9999-12-31';

function byLocation(rows: StockRow[]) {
    const groups = new Map<string, { location: Reference; rows: StockRow[] }>();
    for (const row of rows) {
        const group = groups.get(row.location.id);
        if (group) group.rows.push(row);
        else
            groups.set(row.location.id, {
                location: row.location,
                rows: [row],
            });
    }
    return [...groups.values()]
        .sort((left, right) =>
            left.location.code.localeCompare(right.location.code),
        )
        .map((group) => ({
            ...group,
            rows: group.rows.sort((left, right) =>
                expiryOf(left).localeCompare(expiryOf(right)),
            ),
        }));
}

const batchText = (batch: StockRow['batch']) =>
    batch
        ? [
              batch.batch_number,
              batch.expiry_date
                  ? `kedaluwarsa ${displayDate(batch.expiry_date)}`
                  : null,
          ]
              .filter(Boolean)
              .join(' · ')
        : 'Tanpa batch';

export function ItemStock({
    item,
    canLeave,
}: {
    item: Item | null;
    // Tautan kartu stok meninggalkan kartu barang, jadi hanya ditawarkan selama tidak ada isian yang belum disimpan.
    canLeave: boolean;
}): ReactNode {
    const itemId = item?.id;
    // Izin stok terpisah dari izin barang; tanpa izin itu, mencoba lagi tidak akan pernah berhasil.
    const [denied, setDenied] = useState(false);
    const loader = useCallback<ListLoader<StockRow>>(
        async ({ cursor, signal }) => {
            if (!itemId) return { items: [], nextCursor: null };
            try {
                const { body } = await api.inventoryStock(
                    {
                        query: {
                            item_id: itemId,
                            ...(cursor ? { cursor } : {}),
                        },
                    },
                    { signal },
                );
                return { items: body.data, nextCursor: body.next_cursor };
            } catch (caught) {
                if (!(caught instanceof ApiError) || caught.status !== 403)
                    throw caught;
                setDenied(true);
                return { items: [], nextCursor: null };
            }
        },
        [itemId],
    );
    const list = useIncrementalList({
        loadItems: loader,
        active: itemId !== undefined,
        getKey: (row) => row.id,
    });

    return (
        <section className="space-y-3">
            <h3 className="font-medium">Stok per lokasi</h3>
            {!item ? (
                <p className="text-sm text-muted-foreground">
                    Stok tampil di sini setelah barang disimpan dan ada stok
                    yang diposting.
                </p>
            ) : denied ? (
                <p className="text-sm text-muted-foreground">
                    Anda tidak punya akses untuk melihat stok barang.
                </p>
            ) : (
                <>
                    <dl className="flex justify-between gap-3 text-sm">
                        <dt>Total semua lokasi</dt>
                        <dd className="font-medium tabular-nums">
                            {displayNumber(item.inventory)}{' '}
                            {item.base_unit.code}
                        </dd>
                    </dl>
                    {byLocation(list.items).map((group) => (
                        <div
                            key={group.location.id}
                            className="space-y-1 border-t pt-2"
                        >
                            <p className="text-sm font-medium">
                                {group.location.code} · {group.location.name}
                            </p>
                            <dl className="space-y-1 text-sm">
                                {group.rows.map((row) => (
                                    <div
                                        key={row.id}
                                        className="flex justify-between gap-3"
                                    >
                                        <dt className="min-w-0 break-words text-muted-foreground">
                                            {batchText(row.batch)}
                                        </dt>
                                        <dd className="shrink-0 tabular-nums">
                                            {displayNumber(row.quantity)}{' '}
                                            {row.item.unit}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    ))}
                    <IncrementalListStatus
                        state={list}
                        endMessage={
                            list.items.length
                                ? undefined
                                : 'Belum ada stok di lokasi mana pun.'
                        }
                    />
                    {canLeave && (
                        <Button variant="ghost" size="command" asChild>
                            <Link
                                to="/sysadmin/inventory/item-ledger-entries"
                                search={{ item: item.id }}
                            >
                                <ScrollText aria-hidden="true" />
                                Kartu stok
                            </Link>
                        </Button>
                    )}
                </>
            )}
        </section>
    );
}
