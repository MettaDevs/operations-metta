import { describe, expect, test } from 'bun:test';
import {
    allocate,
    candidates,
    noFunding,
} from '../../../../src/foundation/inventory/item-ledger/allocation.ts';
import {
    resolveStockPolicy,
    type PolicySettings,
} from '../../../../src/foundation/inventory/item-ledger/stock-policy.ts';

const settings = (
    overrides: {
        unit?: PolicySettings['operatingUnit']['picking'];
        location?: PolicySettings['location']['picking'];
        locationTransfer?: PolicySettings['location']['transferMode'];
        itemNegative?: boolean | null;
        tracking?: PolicySettings['item']['tracking'];
    } = {},
): PolicySettings => ({
    legalEntity: {
        picking: 'fefo',
        refuseNegative: true,
        transferMode: 'langsung',
    },
    operatingUnit: { picking: overrides.unit ?? null },
    location: {
        picking: overrides.location ?? null,
        transferMode: overrides.locationTransfer ?? null,
    },
    item: {
        refuseNegative: overrides.itemNegative ?? null,
        tracking: overrides.tracking ?? null,
    },
});

// Setelan stok yang berlaku untuk satu barang di satu lokasi, dihitung tanpa database.
describe('stock policy', () => {
    test('picking follows the location, then the operating unit, then the legal entity', () => {
        expect(resolveStockPolicy(settings(), 'outbound').picking).toBe('fefo');
        expect(
            resolveStockPolicy(settings({ unit: 'fifo' }), 'outbound').picking,
        ).toBe('fifo');
        expect(
            resolveStockPolicy(
                settings({ unit: 'manual', location: 'fifo' }),
                'outbound',
            ).picking,
        ).toBe('fifo');
    });

    test('the item overrides negative stock for issues, and a transfer always refuses it', () => {
        expect(resolveStockPolicy(settings(), 'outbound').refuseNegative).toBe(
            true,
        );
        expect(
            resolveStockPolicy(settings({ itemNegative: false }), 'outbound')
                .refuseNegative,
        ).toBe(false);
        const lenient = settings({ itemNegative: false });
        lenient.legalEntity.refuseNegative = false;
        expect(resolveStockPolicy(lenient, 'transfer').refuseNegative).toBe(
            true,
        );
    });

    test('tracking comes from the item profile, and an item without one requires nothing', () => {
        const profile = {
            batchRequired: true,
            expiryRequired: true,
            strictExpiry: true,
        };
        expect(
            resolveStockPolicy(settings({ tracking: profile }), 'inbound')
                .tracking,
        ).toEqual(profile);
        expect(resolveStockPolicy(settings(), 'inbound').tracking).toEqual({
            batchRequired: false,
            expiryRequired: false,
            strictExpiry: false,
        });
    });

    test('the transfer mode follows the location, then the legal entity', () => {
        expect(resolveStockPolicy(settings(), 'transfer').transferMode).toBe(
            'langsung',
        );
        expect(
            resolveStockPolicy(
                settings({ locationTransfer: 'kirim_terima' }),
                'transfer',
            ).transferMode,
        ).toBe('kirim_terima');
    });
});

describe('allocation', () => {
    const entry = (id: string, open: bigint) => ({
        id,
        batchId: id,
        expiry: null,
        open,
        unitCost: 0n,
        funding: noFunding,
    });

    test('takes open entries in the given order and reports what is left over', () => {
        const { slices, shortfall } = allocate(
            [entry('a', 3n), entry('b', 5n)],
            6n,
        );
        expect(slices.map((slice) => [slice.entry.id, slice.quantity])).toEqual(
            [
                ['a', 3n],
                ['b', 3n],
            ],
        );
        expect(shortfall).toBe(0n);
        expect(allocate([entry('a', 2n)], 5n).shortfall).toBe(3n);
    });

    test('a chosen batch narrows any method to that batch, and manual without one means unbatched stock', () => {
        expect(candidates('fefo', null)).toEqual({
            batch: { kind: 'any' },
            order: 'expiry',
        });
        expect(candidates('fifo', null)).toEqual({
            batch: { kind: 'any' },
            order: 'posting',
        });
        expect(candidates('fefo', 'b1')).toEqual({
            batch: { kind: 'exactly', batchId: 'b1' },
            order: 'posting',
        });
        expect(candidates('manual', null)).toEqual({
            batch: { kind: 'exactly', batchId: null },
            order: 'posting',
        });
    });
});
