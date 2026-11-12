import { describe, expect, test } from 'bun:test';
import {
    displayNumber,
    parseDisplayNumber,
} from '../../src/components/display-number.ts';

// Angka di layar ditulis cara Indonesia, sedangkan API memakai titik desimal.
describe('numbers on screen', () => {
    test('shows API decimals with Indonesian grouping and a decimal comma', () => {
        expect(displayNumber('12500')).toBe('12.500');
        expect(displayNumber('1.5')).toBe('1,5');
        expect(displayNumber('1234567.8901')).toBe('1.234.567,8901');
        expect(displayNumber('-2500.25')).toBe('-2.500,25');
        expect(displayNumber('0')).toBe('0');
        expect(displayNumber('123456789012345678')).toBe(
            '123.456.789.012.345.678',
        );
    });

    test('reads typed Indonesian numbers back into API decimals', () => {
        expect(parseDisplayNumber('12.500')).toBe('12500');
        expect(parseDisplayNumber('12500')).toBe('12500');
        expect(parseDisplayNumber('1,5')).toBe('1.5');
        expect(parseDisplayNumber(' 1.234.567,89 ')).toBe('1234567.89');
        expect(parseDisplayNumber('1,50')).toBe('1.5');
        expect(parseDisplayNumber('007')).toBe('7');
        expect(parseDisplayNumber('0,25')).toBe('0.25');
        expect(parseDisplayNumber('-2.500')).toBe('-2500');
        expect(parseDisplayNumber('-0')).toBe('0');
    });

    test('refuses text whose dot could be an English decimal point', () => {
        for (const text of [
            '1.5',
            '12.50',
            '12.5000',
            '0.500',
            '1.234.56',
            '1,234.5',
            '12,500,000',
            '1.000.',
            ',5',
            '',
            '12 500',
            'abc',
        ])
            expect(parseDisplayNumber(text)).toBeNull();
    });

    test('every number the screen shows reads back to the same API value', () => {
        for (const value of ['12500', '1.5', '1234567.8901', '-2500.25', '0'])
            expect(parseDisplayNumber(displayNumber(value))).toBe(value);
    });
});
