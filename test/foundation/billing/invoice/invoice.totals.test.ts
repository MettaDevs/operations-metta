import { expect, test } from 'bun:test';
import { invoiceTotals } from '../../../../src/foundation/billing/invoice/invoice.totals.ts';
import fixture from './legacy-invoice-totals.json';

const lines = (rows: string[][]) =>
    rows.map(([, group, quantity, value, discount, extra, original]) => ({
        serviceGroupId: group ?? null,
        quantity: quantity ?? '0',
        value: value ?? '0',
        discountPercent: discount ?? '0',
        extra: extra ?? '0',
        originalPrice: original ?? '0',
    }));

const nonZero = (
    groups: Iterable<[string | null, string]>,
): Record<string, string> =>
    Object.fromEntries(
        [...groups].filter(([, value]) => value !== '0'),
    ) as Record<string, string>;

// Golden dari pembayaran Kuta 1 yang tersimpan: Nilai SIMtrKasir dan nilai per kelompok jasa
// (SIMtrKasirDetailGroupJasa) dihitung ulang dari baris GetDetailRincianBiaya. Kelompok bernilai nol tidak dibandingkan:
// sistem lama kadang tidak menulis kelompok obat bernilai 0, bergantung kapan obat direalisasi.
test('the invoice value and the value per service group match the legacy Kuta payments', () => {
    for (const legacy of fixture.cases) {
        const totals = invoiceTotals(lines(legacy.lines));
        expect({ case: legacy.case, value: totals.value }).toEqual({
            case: legacy.case,
            value: legacy.value,
        });
        expect({ case: legacy.case, groups: nonZero(totals.groups) }).toEqual({
            case: legacy.case,
            groups: nonZero(Object.entries(legacy.groups)),
        });
    }
});

// NilaiOrig lama sama dengan Nilai di setiap kasus, juga saat baris obat Kuta (bernilai 0 karena IncludeJasa) membawa
// HargaOrig hari ini. Jadi NilaiOrig hanya dibandingkan untuk kasus tanpa baris obat.
test('the original value matches the legacy payments without drug lines', () => {
    const compared = fixture.cases.filter((legacy) =>
        legacy.lines.every(([group]) => group !== 'OBAT'),
    );
    expect(compared.length).toBeGreaterThan(5);
    for (const legacy of compared)
        expect({
            case: legacy.case,
            value: invoiceTotals(lines(legacy.lines)).originalValue,
        }).toEqual({ case: legacy.case, value: legacy.original_value });
});

test('a discount percent and a per-line extra round half away from zero to the rupiah', () => {
    expect(
        invoiceTotals([
            {
                serviceGroupId: 'A',
                quantity: '3',
                value: '10001',
                discountPercent: '12.5',
                extra: '0.25',
                originalPrice: '10001',
            },
        ]).value,
    ).toBe('26253');
});
