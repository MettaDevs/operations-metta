import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
    fromNumeric,
    quantityScale,
    toNumeric,
} from '../../../../../src/foundation/inventory/index.ts';
import { unitAmountDecimalOptions as unitPriceDecimalOptions } from '../../../../../src/foundation/currency/index.ts';
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
    ktp: z.boolean(),
});
const fixtureSchema = z.object({
    case_columns: z.tuple([
        z.literal('grading_group'),
        z.literal('base_price'),
        z.literal('price_group'),
        z.literal('ktp'),
        z.literal('legacy_price'),
        z.literal('legacy_discount'),
    ]),
    sources: z.record(
        z.string(),
        z.object({
            unit_price_decimals: z.literal(unitPriceDecimalOptions),
            gradings: z.array(
                z.object({
                    price_group: z.string(),
                    grading_group: z.string().nullable(),
                    ktp: z.boolean(),
                    price_from: decimal,
                    price_to: decimal,
                    markup_percent: decimal,
                    discount_percent: decimal,
                }),
            ),
            cases: z.array(
                z.tuple([
                    z.string(),
                    decimal,
                    z.string(),
                    z.boolean(),
                    decimal,
                    decimal,
                ]),
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
    seroja_unit_conversion: caseKey.extend({
        quantity_per_unit: decimal,
        our_price: decimal,
        legacy_style_price: decimal,
    }),
});

const golden = fixtureSchema.parse(fixture);
const amount = (text: string) => fromNumeric(text, quantityScale);
// Teks desimal dengan skala tetap, supaya 899.1 dan 899.10 sama dan 899 berbeda dari 899.1.
const fixed = (text: string) => toNumeric(amount(text), quantityScale);
const key = (entry: z.infer<typeof caseKey>) =>
    [
        entry.source,
        entry.grading_group,
        entry.base_price,
        entry.price_group,
        String(entry.ktp),
    ].join('|');

// Grading sumber itu dalam bentuk aturan harga; nama kelompok menjadi id-nya. Semua baris berlaku sejak awal tahun.
const gradingsOf = (source: string): PriceGrading[] =>
    (golden.sources[source]?.gradings ?? []).map((row, index) => ({
        id: `${source}-${String(index)}`,
        priceGroupId: row.price_group,
        gradingGroupId: row.grading_group,
        ktpPatient: row.ktp,
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
    const source = golden.sources[entry.source];
    if (!source) throw new Error(`Unknown source ${entry.source}.`);
    const price = drugPrice(gradingsOf(entry.source), {
        basePrice: amount(entry.base_price),
        priceGroupId: entry.price_group,
        gradingGroupId: entry.grading_group,
        ktpPatient: entry.ktp,
        date: '2026-11-13',
        quantityPerUnit: amount(quantityPerUnit),
        unitPriceDecimals: source.unit_price_decimals,
    });
    return {
        price: toNumeric(price.unitPrice, quantityScale),
        discount: String(price.discountPercent / 10n ** BigInt(quantityScale)),
    };
};

// Golden test harga obat terhadap fungsi SQL sistem lama GetHargaObatNew_WithStok. Fixture-nya keluaran oracle
// legacy-drug-prices.sql yang dijalankan read-only di Kuta 1, Seroja, dan Penta, dengan KTP 1 dan (Seroja, Penta) KTP 0;
// CI tidak punya SQL Server. Setiap kasus dihitung dengan KTP-nya dan setelan farmasi sumbernya (unit_price_decimals)
// dan wajib sama dengan harga sistem lama, kecuali yang tercatat di expected_differences beserta harga kita dan
// alasannya. Kasus yang berbeda tanpa tercatat, atau yang tercatat tetapi ternyata sama, membuat test gagal.
describe('legacy drug prices', () => {
    const differences = new Map(
        golden.expected_differences.map((entry) => [key(entry), entry]),
    );
    const cases = Object.entries(golden.sources).flatMap(([source, data]) =>
        data.cases.map(
            ([
                grading_group,
                base_price,
                price_group,
                ktp,
                legacy,
                discount,
            ]) => ({
                source,
                grading_group,
                base_price,
                price_group,
                ktp,
                legacy,
                discount,
            }),
        ),
    );

    test.each(cases)(
        '$source $grading_group $base_price $price_group KTP $ktp',
        (entry) => {
            const difference = differences.get(key(entry));
            const result = ours(entry);
            expect(result.discount).toBe(entry.discount);
            if (difference) {
                expect(difference.legacy_price).toBe(entry.legacy);
                expect(golden.reasons[difference.reason]).toBeString();
                expect(result.price).not.toBe(fixed(entry.legacy));
                expect(result.price).toBe(fixed(difference.our_price));
            } else expect(result.price).toBe(fixed(entry.legacy));
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

    test('the fixture has cases whose legacy price differs only by KTP, so a rule that ignores KTP fails', () => {
        const byKey = new Map(cases.map((entry) => [key(entry), entry.legacy]));
        const differing = cases.filter(
            (entry) =>
                !entry.ktp &&
                byKey.get(key({ ...entry, ktp: true })) !== entry.legacy,
        );
        expect(differing.length).toBeGreaterThan(0);
    });

    // Harga per satuan dasar dikali isi satuan, cara sistem lama bila ia menjual dalam satuan lain.
    const legacyStyle = (example: typeof golden.unit_conversion) =>
        toNumeric(
            (amount(ours(example).price) * amount(example.quantity_per_unit)) /
                10n ** BigInt(quantityScale),
            quantityScale,
        );

    test('a non-base unit is rounded once after the unit content, unlike rounding the base unit price first', () => {
        const example = golden.unit_conversion;
        expect(ours(example, example.quantity_per_unit).price).toBe(
            fixed(example.our_price),
        );
        expect(legacyStyle(example)).toBe(fixed(example.legacy_style_price));
        expect(example.our_price).not.toBe(example.legacy_style_price);
    });

    test("with Seroja's four decimals a STRIP of 10 is exactly ten times the tablet price", () => {
        const example = golden.seroja_unit_conversion;
        expect(ours(example, example.quantity_per_unit).price).toBe(
            fixed(example.our_price),
        );
        expect(legacyStyle(example)).toBe(fixed(example.legacy_style_price));
        expect(example.our_price).toBe(example.legacy_style_price);
    });
});
