import { describe, expect, test } from 'bun:test';
import {
    baseQuantity,
    baseUnitCost,
} from '../../../../src/foundation/purchasing/receipt/receipt.posting.ts';

const scaled = (value: number) => BigInt(Math.round(value * 10_000));

// Jumlah dan harga dalam satuan dasar dari baris dalam satuan kemasan.
describe('receipt posting arithmetic', () => {
    test('base quantity is the line quantity times the unit content, refused when it needs a fifth decimal', () => {
        expect(baseQuantity(scaled(2), scaled(100))).toBe(scaled(200));
        expect(baseQuantity(scaled(1.5), scaled(2.5))).toBe(scaled(3.75));
        expect(baseQuantity(scaled(0.0001), scaled(2.5))).toBeNull();
        expect(baseQuantity(10n ** 17n, scaled(100))).toBeNull();
    });

    test('base unit cost is the line price after discount divided by the unit content, rounded half up to four decimals', () => {
        expect(baseUnitCost(scaled(150000), scaled(10), scaled(100))).toBe(
            scaled(1350),
        );
        expect(baseUnitCost(scaled(10000), 0n, scaled(3))).toBe(
            scaled(3333.3333),
        );
        expect(baseUnitCost(scaled(2), 0n, scaled(3))).toBe(scaled(0.6667));
        expect(baseUnitCost(scaled(350), scaled(56), scaled(1))).toBe(
            scaled(154),
        );
        expect(baseUnitCost(scaled(500), scaled(100), scaled(1))).toBe(0n);
    });
});
