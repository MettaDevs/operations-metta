import { describe, expect, test } from 'bun:test';
import {
    amountOf,
    baseQuantity,
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

    test('values quantity times unit cost once, rounded half away from zero to the amount precision of the currency', () => {
        const parts = [
            { quantity: 40000n, unitCost: 15000000n },
            { quantity: 20000n, unitCost: 20005000n },
        ];
        // 4 x 1.500 + 2 x 2.000,5 = 10.001, berskala empat seperti kolom nilai.
        expect(amountOf(parts, 2)).toBe(100010000n);
        expect(amountOf(parts, 0)).toBe(100010000n);
        // 1 x 0,005 menjadi 0,01 dengan dua angka di belakang koma dan 0 untuk rupiah utuh.
        expect(amountOf([{ quantity: 10000n, unitCost: 50n }], 2)).toBe(100n);
        expect(amountOf([{ quantity: 10000n, unitCost: 50n }], 0)).toBe(0n);
        // 1 x 0,5 menjadi 1 rupiah, dan -1 bila keluar.
        expect(amountOf([{ quantity: 10000n, unitCost: 5000n }], 0)).toBe(
            10000n,
        );
        expect(amountOf([{ quantity: -10000n, unitCost: 5000n }], 0)).toBe(
            -10000n,
        );
    });

    test('base quantity is the line quantity times the unit content, refused when it needs a fifth decimal', () => {
        const scaled = (value: number) => BigInt(Math.round(value * 10_000));
        expect(baseQuantity(scaled(2), scaled(100))).toBe(scaled(200));
        expect(baseQuantity(scaled(1.5), scaled(2.5))).toBe(scaled(3.75));
        expect(baseQuantity(scaled(0.0001), scaled(2.5))).toBeNull();
        expect(baseQuantity(10n ** 17n, scaled(100))).toBeNull();
    });
});
