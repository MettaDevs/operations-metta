import { describe, expect, test } from 'bun:test';
import {
    baseUnitCost,
    receiptBasePrice,
} from '../../../../src/foundation/purchasing/receipt/receipt.posting.ts';

const scaled = (value: number) => BigInt(Math.round(value * 10_000));

// Harga dalam satuan dasar dari baris dalam satuan kemasan.
describe('receipt posting arithmetic', () => {
    test('base unit cost is the line price after discount divided by the unit content, rounded half up to the unit price precision', () => {
        expect(baseUnitCost(scaled(150000), scaled(10), scaled(100), 4)).toBe(
            scaled(1350),
        );
        expect(baseUnitCost(scaled(10000), 0n, scaled(3), 4)).toBe(
            scaled(3333.3333),
        );
        expect(baseUnitCost(scaled(2), 0n, scaled(3), 4)).toBe(scaled(0.6667));
        expect(baseUnitCost(scaled(350), scaled(56), scaled(1), 4)).toBe(
            scaled(154),
        );
        expect(baseUnitCost(scaled(500), scaled(100), scaled(1), 4)).toBe(0n);
    });

    test('the base price adds the line VAT before dividing by the unit content and ignores the discount, rounded to the unit price precision', () => {
        expect(
            receiptBasePrice(scaled(20833.33), scaled(11), scaled(1), 4),
        ).toBe(scaled(23124.9963));
        expect(
            receiptBasePrice(scaled(20833.33), scaled(11), scaled(1), 0),
        ).toBe(scaled(23125));
        expect(
            receiptBasePrice(scaled(680.66), scaled(11), scaled(50), 4),
        ).toBe(scaled(15.1107));
        expect(receiptBasePrice(scaled(161), 0n, scaled(1), 0)).toBe(
            scaled(161),
        );
    });

    test('a whole-rupiah tenant gets a whole-rupiah base unit cost', () => {
        expect(baseUnitCost(scaled(10000), 0n, scaled(3), 0)).toBe(
            scaled(3333),
        );
        expect(baseUnitCost(scaled(2), 0n, scaled(3), 0)).toBe(scaled(1));
        expect(baseUnitCost(scaled(15005), 0n, scaled(10), 2)).toBe(
            scaled(1500.5),
        );
    });
});
