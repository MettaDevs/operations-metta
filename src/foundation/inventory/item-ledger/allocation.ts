import type { PickingMethod } from './stock-policy.ts';

// Baris kartu gudang yang masih terbuka: stok yang tersisa pada baris masuk, atau kekurangan yang belum mendapat stok
// pada baris keluar yang minus. `open` selalu positif.
export type OpenEntry = {
    id: string;
    batchId: string | null;
    expiry: string | null;
    open: bigint;
    unitCost: bigint;
};

export type Slice = { entry: OpenEntry; quantity: bigint };

// Baris terbuka yang boleh diambil satu baris keluar, dan urutannya. Batch yang dipilih membatasi ke batch itu, di
// metode mana pun; metode pilih manual tanpa batch hanya mengambil stok tanpa batch.
export type Candidates = {
    batch: { kind: 'any' } | { kind: 'exactly'; batchId: string | null };
    order: 'expiry' | 'posting';
};

export function candidates(
    picking: PickingMethod,
    chosenBatchId: string | null,
): Candidates {
    if (chosenBatchId !== null)
        return {
            batch: { kind: 'exactly', batchId: chosenBatchId },
            order: 'posting',
        };
    switch (picking) {
        case 'fefo':
            return { batch: { kind: 'any' }, order: 'expiry' };
        case 'fifo':
            return { batch: { kind: 'any' }, order: 'posting' };
        case 'manual':
            return {
                batch: { kind: 'exactly', batchId: null },
                order: 'posting',
            };
        default: {
            const unknown: never = picking;
            throw new Error(`Unknown picking method: ${String(unknown)}`);
        }
    }
}

export function allocate(
    entries: OpenEntry[],
    requested: bigint,
): { slices: Slice[]; shortfall: bigint } {
    const slices: Slice[] = [];
    let left = requested;
    for (const entry of entries) {
        if (left <= 0n) break;
        const quantity = entry.open < left ? entry.open : left;
        if (quantity <= 0n) continue;
        slices.push({ entry, quantity });
        left -= quantity;
    }
    return { slices, shortfall: left };
}
