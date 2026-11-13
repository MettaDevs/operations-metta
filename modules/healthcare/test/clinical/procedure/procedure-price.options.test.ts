import { describe, expect, test } from 'bun:test';
import { legacyNewPrice } from '../../../src/clinical/procedure/procedure-price.options.ts';

// calculate_new_price form komponen sistem lama: Harga Awal + insentif (kecuali Include Insentif) + pajak titipan,
// dihitung desimal tepat lalu dibulatkan sekali ke presisi harga satuan mata uang tenant.
describe('legacy component new price', () => {
    test('adds the incentive and the tax deposit to Harga Awal', () => {
        expect(legacyNewPrice('10000', '10', '2.5', false, 2)).toBe('11250.00');
    });

    test('leaves the incentive out when Include Insentif is ticked', () => {
        expect(legacyNewPrice('10000', '10', '2.5', true, 2)).toBe('10250.00');
    });

    test('rounds the exact decimal result half away from zero, not the binary one', () => {
        // 333 + 333 × 2,5 / 100 = 341,325. Pecahan biner peramban menulisnya 341,32499…, jadi toFixed(2) sistem lama
        // memberi 341,32; desimal tepat memberi 341,33.
        expect(legacyNewPrice('333', '0', '2.5', false, 2)).toBe('341.33');
    });

    test('rounds to the unit price precision of the currency', () => {
        expect(legacyNewPrice('333', '0', '2.5', false, 0)).toBe('341');
        expect(legacyNewPrice('333', '0', '2.5', false, 4)).toBe('341.3250');
    });
});
