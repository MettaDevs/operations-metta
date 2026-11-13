import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
    fromNumeric,
    quantityScale,
} from '../../../../../src/foundation/inventory/index.ts';
import {
    drugPrice,
    type PriceGrading,
} from '../../../src/drug/drug-price/drug-price.calculation.ts';
import fixture from './legacy-drug-prices.json';

const decimal = z.string().regex(/^\d+(\.\d+)?$/);
const caseKey = z.object({
    source: z.string(),
    grading_group: z.string(),
    base_price: decimal,
    price_group: z.string(),
});
const fixtureSchema = z.object({
    case_columns: z.tuple([
        z.literal('grading_group'),
        z.literal('base_price'),
        z.literal('price_group'),
        z.literal('legacy_price'),
        z.literal('legacy_discount'),
    ]),
    sources: z.record(
        z.string(),
        z.object({
            gradings: z.array(
                z.object({
                    price_group: z.string(),
                    grading_group: z.string().nullable(),
                    price_from: decimal,
                    price_to: decimal,
                    markup_percent: decimal,
                    discount_percent: decimal,
                }),
            ),
            cases: z.array(
                z.tuple([z.string(), decimal, z.string(), decimal, decimal]),
            ),
        }),
    ),
    reasons: z.record(z.string(), z.string()),
    expected_differences: z.array(
        caseKey.extend({
            legacy_price: decimal,
            our_price: decimal,
            reason: z.string(),
        }),
    ),
    unit_conversion: caseKey.extend({
        quantity_per_unit: decimal,
        our_price: decimal,
        legacy_style_price: decimal,
    }),
});

const golden = fixtureSchema.parse(fixture);
const amount = (text: string) => fromNumeric(text, quantityScale);
const key = (entry: z.infer<typeof caseKey>) =>
    [
        entry.source,
        entry.grading_group,
        entry.base_price,
        entry.price_group,
    ].join('|');

// Grading sumber itu dalam bentuk aturan harga; nama kelompok menjadi id-nya. Semua baris berlaku sejak awal tahun.
const gradingsOf = (source: string): PriceGrading[] =>
    (golden.sources[source]?.gradings ?? []).map((row, index) => ({
        id: `${source}-${String(index)}`,
        priceGroupId: row.price_group,
        gradingGroupId: row.grading_group,
        priceFrom: amount(row.price_from),
        priceTo: amount(row.price_to),
        markupPercent: amount(row.markup_percent),
        discountPercent: amount(row.discount_percent),
        effectiveFrom: '2026-01-01',
    }));

const ours = (
    entry: z.infer<typeof caseKey>,
    quantityPerUnit = '1',
): { price: string; discount: string } => {
    const price = drugPrice(gradingsOf(entry.source), {
        basePrice: amount(entry.base_price),
        priceGroupId: entry.price_group,
        gradingGroupId: entry.grading_group,
        date: '2026-11-13',
        quantityPerUnit: amount(quantityPerUnit),
    });
    return {
        price: String(price.unitPrice),
        discount: String(price.discountPercent / 10n ** BigInt(quantityScale)),
    };
};

// Golden test harga obat terhadap fungsi SQL sistem lama GetHargaObatNew_WithStok. Fixture-nya keluaran oracle
// legacy-drug-prices.sql yang dijalankan read-only di Kuta 1, Seroja, dan Penta; CI tidak punya SQL Server. Setiap kasus
// wajib sama dengan harga sistem lama, kecuali yang tercatat di expected_differences beserta harga kita dan alasannya.
// Kasus yang berbeda tanpa tercatat, atau yang tercatat tetapi ternyata sama, membuat test gagal.
describe('legacy drug prices', () => {
    const differences = new Map(
        golden.expected_differences.map((entry) => [key(entry), entry]),
    );
    const cases = Object.entries(golden.sources).flatMap(([source, data]) =>
        data.cases.map(
            ([grading_group, base_price, price_group, legacy, discount]) => ({
                source,
                grading_group,
                base_price,
                price_group,
                legacy,
                discount,
            }),
        ),
    );

    test.each(cases)(
        '$source $grading_group $base_price $price_group',
        (entry) => {
            const difference = differences.get(key(entry));
            const result = ours(entry);
            expect(result.discount).toBe(entry.discount);
            if (difference) {
                expect(difference.legacy_price).toBe(entry.legacy);
                expect(golden.reasons[difference.reason]).toBeString();
                expect(result.price).not.toBe(entry.legacy);
                expect(result.price).toBe(difference.our_price);
            } else expect(result.price).toBe(entry.legacy);
        },
    );

    test('every expected difference names a case of the fixture, once', () => {
        const known = new Set(cases.map(key));
        expect(
            golden.expected_differences.filter(
                (entry) => !known.has(key(entry)),
            ),
        ).toEqual([]);
        expect(differences.size).toBe(golden.expected_differences.length);
    });

    test('a non-base unit is rounded once after the unit content, unlike rounding the base unit price first', () => {
        const example = golden.unit_conversion;
        expect(ours(example, example.quantity_per_unit).price).toBe(
            example.our_price,
        );
        expect(
            String(
                BigInt(ours(example).price) * BigInt(example.quantity_per_unit),
            ),
        ).toBe(example.legacy_style_price);
        expect(example.our_price).not.toBe(example.legacy_style_price);
    });
});
