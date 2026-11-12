import { describe, expect, test } from 'bun:test';
import {
    amountOf,
    decimalInput,
    display,
    fromNumeric,
    toNumeric,
} from '../../../src/foundation/inventory/quantity.ts';

// Jumlah dan harga persediaan sebagai bilangan berskala, supaya stok yang dikurangi tidak bergeser karena pecahan biner.
describe('inventory quantities', () => {
    test('reads and writes numeric text without losing digits', () => {
        expect(fromNumeric('30.0000', 4)).toBe(300000n);
        expect(fromNumeric('-0.5000', 4)).toBe(-5000n);
        expect(toNumeric(-5000n, 4)).toBe('-0.5000');
        expect(display(300000n, 4)).toBe('30');
        expect(display(25000n, 4)).toBe('2.5');
        expect(display(0n, 4)).toBe('0');
    });

    test('accepts at most four decimals from callers', () => {
        expect(decimalInput(2.5)).toBe(25000n);
        expect(decimalInput('0.1')).toBe(1000n);
        expect(decimalInput('1,25')).toBe(12500n);
        expect(decimalInput('1.00001')).toBeNull();
        expect(decimalInput('abc')).toBeNull();
        expect(decimalInput(Number.NaN)).toBeNull();
        expect(decimalInput('100000000000000')).toBeNull();
    });

    test('values quantity times unit cost once, rounded half away from zero to two decimals', () => {
        expect(
            amountOf([
                { quantity: 40000n, unitCost: 15000000n },
                { quantity: 20000n, unitCost: 20005000n },
            ]),
        ).toBe(1000100n);
        expect(amountOf([{ quantity: 10000n, unitCost: 50n }])).toBe(1n);
        expect(amountOf([{ quantity: -10000n, unitCost: 50n }])).toBe(-1n);
    });
});
