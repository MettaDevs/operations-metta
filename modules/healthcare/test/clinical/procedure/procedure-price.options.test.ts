import { describe, expect, test } from 'bun:test';
import { legacyNewPrice } from '../../../src/clinical/procedure/procedure-price.options.ts';

// calculate_new_price form komponen sistem lama: Harga Awal + insentif (kecuali Include Insentif) + pajak titipan,
// pecahan biner peramban dan toFixed(2).
describe('legacy component new price', () => {
    test('adds the incentive and the tax deposit to Harga Awal', () => {
        expect(legacyNewPrice('10000', '10', '2.5', false)).toBe('11250.00');
    });

    test('leaves the incentive out when Include Insentif is ticked', () => {
        expect(legacyNewPrice('10000', '10', '2.5', true)).toBe('10250.00');
    });

    test('rounds like toFixed on the binary result, not half up on the decimal one', () => {
        // 333 + 333 × 2,5 / 100 = 341,325 sebagai desimal, tetapi 341,32499… sebagai pecahan biner.
        expect(legacyNewPrice('333', '0', '2.5', false)).toBe('341.32');
    });
});
