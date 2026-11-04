import { describe, expect, test } from 'bun:test';
import { Decimal } from '../src/money.ts';

describe('currency amounts', () => {
    test('rounds the extended line once and allocates the first-unit remainder', () => {
        const value = Decimal.of('333333.333').times(3).rounded(2);
        const tax = Decimal.of('33333.333').times(3).rounded(2);
        expect(value.fixed(2)).toBe('1000000.00');
        expect(value.split(3, 2)).toEqual([
            '333333.34',
            '333333.33',
            '333333.33',
        ]);
        expect(tax.split(3, 2)).toEqual(['33333.34', '33333.33', '33333.33']);
        expect(value.plus(tax).fixed(2)).toBe('1100000.00');
    });

    test('preserves amounts above binary-float precision and negative HALF_UP ties', () => {
        expect(Decimal.of('9007199254740991.005').fixed(2)).toBe(
            '9007199254740991.01',
        );
        expect(Decimal.of('-0.005').fixed(2)).toBe('-0.01');
        expect(Decimal.of('1e-3').fixed(6)).toBe('0.001000');
    });

    test('allocation conserves each exact rounded total', () => {
        for (const input of ['0', '0.01', '1.005', '999999999999.995']) {
            for (const units of [1, 2, 3, 499]) {
                const total = Decimal.of(input).rounded(2);
                const actual = total
                    .split(units, 2)
                    .reduce(
                        (sum, value) => sum.plus(Decimal.of(value)),
                        Decimal.of('0'),
                    );
                expect(actual.fixed(2)).toBe(total.fixed(2));
            }
        }
    });
});
