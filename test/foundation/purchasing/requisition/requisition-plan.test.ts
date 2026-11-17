import { describe, expect, test } from 'bun:test';
import { reorderQuantity } from '../../../../src/foundation/purchasing/requisition/requisition-plan.ts';

const units = (value: number) => BigInt(value) * 10_000n;

// Rumus CalcOrderQty BC dengan angka yang dihitung tangan dari definisi Reorder Point, Reorder Quantity, dan Maximum
// Inventory, bukan dari kode yang diuji.
describe('reorder quantity', () => {
    const fixed = {
        policy: 'jumlah_tetap',
        reorderPoint: units(40),
        reorderQuantity: units(15),
    } as const;
    const maximum = {
        policy: 'maksimum',
        reorderPoint: units(10),
        maximumInventory: units(100),
    } as const;

    test('stock above the reorder point needs nothing', () => {
        expect(reorderQuantity(fixed, units(41))).toBeNull();
        expect(reorderQuantity(maximum, units(11))).toBeNull();
    });

    test('a fixed reorder quantity repeats until stock passes the reorder point', () => {
        expect(reorderQuantity(fixed, units(39))).toBe(units(15));
        expect(reorderQuantity(fixed, units(10))).toBe(units(45));
        expect(reorderQuantity(fixed, units(40))).toBe(units(15));
        expect(reorderQuantity(fixed, units(25))).toBe(units(30));
        expect(reorderQuantity(fixed, units(-5))).toBe(units(60));
    });

    test('a maximum quantity fills up to the maximum inventory', () => {
        expect(reorderQuantity(maximum, units(10))).toBe(units(90));
        expect(reorderQuantity(maximum, units(-3))).toBe(units(103));
    });
});
