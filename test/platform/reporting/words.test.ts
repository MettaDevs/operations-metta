import { describe, expect, test } from 'bun:test';
import {
    amountWords,
    spellInteger,
} from '../../../src/platform/reporting/words.ts';

// Terbilang kuitansi: aturan bahasa Indonesia (se- untuk satu ratus, satu ribu, sepuluh, sebelas) dan bahasa Inggris
// untuk klinik yang melayani wisatawan.
describe('amount in words', () => {
    test.each([
        [0n, 'Nol'],
        [1n, 'Satu'],
        [10n, 'Sepuluh'],
        [11n, 'Sebelas'],
        [15n, 'Lima Belas'],
        [21n, 'Dua Puluh Satu'],
        [100n, 'Seratus'],
        [115n, 'Seratus Lima Belas'],
        [1_000n, 'Seribu'],
        [1_100n, 'Seribu Seratus'],
        [2_000n, 'Dua Ribu'],
        [11_000n, 'Sebelas Ribu'],
        [101_000n, 'Seratus Satu Ribu'],
        [1_000_000n, 'Satu Juta'],
        [1_001_000n, 'Satu Juta Seribu'],
        [70_000n, 'Tujuh Puluh Ribu'],
        [
            1_250_750n,
            'Satu Juta Dua Ratus Lima Puluh Ribu Tujuh Ratus Lima Puluh',
        ],
        [2_000_000_000n, 'Dua Miliar'],
    ])('id %p', (value, words) => {
        expect(spellInteger(value, 'id')).toBe(words);
    });

    test.each([
        [0n, 'Zero'],
        [13n, 'Thirteen'],
        [21n, 'Twenty-One'],
        [100n, 'One Hundred'],
        [1_000n, 'One Thousand'],
        [70_000n, 'Seventy Thousand'],
        [
            1_250_750n,
            'One Million Two Hundred Fifty Thousand Seven Hundred Fifty',
        ],
    ])('en %p', (value, words) => {
        expect(spellInteger(value, 'en')).toBe(words);
    });

    test('a non-zero fraction is spelled after Koma or Point, a zero fraction is not', () => {
        expect(amountWords('1250.50', 'id')).toBe(
            'Seribu Dua Ratus Lima Puluh Koma Lima Puluh',
        );
        expect(amountWords('1250.50', 'en')).toBe(
            'One Thousand Two Hundred Fifty Point Fifty',
        );
        expect(amountWords('70000.00', 'id')).toBe('Tujuh Puluh Ribu');
        expect(amountWords('-5000', 'id')).toBe('Minus Lima Ribu');
    });
});
