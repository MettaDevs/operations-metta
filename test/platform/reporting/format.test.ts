import { describe, expect, test } from 'bun:test';
import {
    formatDecimal,
    templateView,
    type Locale,
} from '../../../src/platform/reporting/format.ts';
import { field } from '../../../src/platform/reporting/index.ts';

const fields = {
    number: field.text('Nomor'),
    paid: field.flag('Lunas'),
    total: field.money('Total', { words: true }),
    price: field.unitAmount('Harga satuan'),
    quantity: field.quantity('Jumlah'),
    born: field.date('Tanggal lahir'),
    at: field.datetime('Waktu'),
    lines: field.lines('Baris', {
        name: field.text('Nama'),
        amount: field.money('Nilai'),
    }),
};

const values = {
    number: 'KSR-1',
    paid: true,
    total: '1250000.505',
    price: '1234.5678',
    quantity: '2.5000',
    born: '1990-01-31',
    // 16.30 UTC tanggal 16 adalah tanggal 17 di Bali (UTC+8), dan tetap tanggal 16 di Jakarta (UTC+7, 23.30).
    at: '2026-11-16T16:30:00.000000Z',
    lines: [{ name: 'Obat', amount: '27500' }],
};

const bali: Locale = {
    language: 'id',
    timeZone: 'Asia/Makassar',
    amountDecimals: 2,
    unitAmountDecimals: 3,
};

describe('template values', () => {
    test('money follows the currency precision and the layout language, and money with words gets a spelled sibling', () => {
        const id = templateView(fields, values, bali);
        expect(id.total).toBe('1.250.000,51');
        expect(id.total_words).toBe(
            'Satu Juta Dua Ratus Lima Puluh Ribu Koma Lima Puluh Satu',
        );
        expect(id.price).toBe('1.234,568');
        expect(id.quantity).toBe('2,5');
        const en = templateView(fields, values, {
            ...bali,
            language: 'en',
            amountDecimals: 0,
        });
        expect(en.total).toBe('1,250,001');
        expect(en.total_words).toBe(
            'One Million Two Hundred Fifty Thousand One',
        );
    });

    test('an instant is shown in the legal entity time zone with its zone label, a date is never shifted', () => {
        const inBali = templateView(fields, values, bali);
        expect(inBali.at).toBe('17 November 2026 00.30 WITA');
        expect(inBali.at_date).toBe('17 November 2026');
        expect(inBali.at_time).toBe('00.30 WITA');
        expect(inBali.born).toBe('31 Januari 1990');
        const inJakarta = templateView(fields, values, {
            ...bali,
            timeZone: 'Asia/Jakarta',
        });
        expect(inJakarta.at).toBe('16 November 2026 23.30 WIB');
        expect(inJakarta.born).toBe('31 Januari 1990');
        const english = templateView(fields, values, {
            ...bali,
            language: 'en',
        });
        expect(english.at).toBe('17 November 2026 00:30 WITA');
        expect(english.born).toBe('31 January 1990');
    });

    test('lines are formatted with the same rules as the header', () => {
        expect(templateView(fields, values, bali).lines).toEqual([
            { name: 'Obat', amount: '27.500,00' },
        ]);
    });

    test('a value that does not match its field fails the print instead of printing blank', () => {
        expect(() =>
            templateView(fields, { ...values, total: 12500 }, bali),
        ).toThrow('total harus teks desimal');
        expect(() =>
            templateView(
                fields,
                { ...values, lines: [{ name: 'Obat', amount: 'banyak' }] },
                bali,
            ),
        ).toThrow('lines[0].amount harus teks desimal');
        expect(() =>
            templateView(fields, { ...values, paid: 'ya' }, bali),
        ).toThrow('paid harus true atau false');
    });

    test('grouping keeps large integers exact', () => {
        expect(formatDecimal('123456789012345678.25', 'id')).toBe(
            '123.456.789.012.345.678,25',
        );
        expect(formatDecimal('-0.00', 'en')).toBe('0.00');
    });
});
