import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
    fromNumeric,
    quantityScale,
    toNumeric,
} from '../../../../src/foundation/inventory/index.ts';
import { receiptBasePrice } from '../../../../src/foundation/purchasing/receipt/receipt.posting.ts';
import fixture from './legacy-receipt-base-prices.json';

const decimal = z.string().regex(/^\d+(\.\d+)?$/);
const line = z.tuple([decimal, decimal, decimal, decimal, decimal]);
const fixtureSchema = z.object({
    case_columns: z.tuple([
        z.literal('unit_cost'),
        z.literal('vat_percent'),
        z.literal('conversion'),
        z.literal('discount_percent'),
        z.literal('legacy_base_price'),
    ]),
    sources: z.record(
        z.string(),
        z.object({
            cases: z.array(line),
            chains: z.array(
                z.object({
                    lines: z.array(line).min(2),
                    legacy_base_price: decimal,
                    our_base_price: decimal.optional(),
                    reason: z.string().optional(),
                }),
            ),
        }),
    ),
    reasons: z.record(z.string(), z.string()),
    expected_differences: z.array(
        z.object({
            source: z.string(),
            unit_cost: decimal,
            vat_percent: decimal,
            conversion: decimal,
            discount_percent: decimal,
            legacy_base_price: decimal,
            our_base_price: decimal,
            reason: z.string(),
        }),
    ),
});

const golden = fixtureSchema.parse(fixture);
// Harga_Jual sistem lama bertipe money, empat angka di belakang koma.
const legacyDecimals = 4;
const amount = (text: string) => fromNumeric(text, quantityScale);
const fixed = (value: bigint) => toNumeric(value, quantityScale);
const ours = ([unitCost, vatPercent, conversion]: z.infer<typeof line>) =>
    receiptBasePrice(
        amount(unitCost),
        amount(vatPercent),
        amount(conversion),
        legacyDecimals,
    );
const key = (source: string, [unitCost, vat, conversion, discount]: string[]) =>
    [source, unitCost, vat, conversion, discount].join('|');

// Golden test harga dasar penerimaan terhadap harga yang dicatat sistem lama per baris penerimaan
// (mBarang_ChangePrice.UpPrice). Fixture-nya keluaran legacy-receipt-base-prices.sql yang dijalankan read-only di Seroja
// dan Kuta 1; CI tidak punya SQL Server. Kasus yang berbeda tanpa tercatat di expected_differences, atau yang tercatat
// tetapi ternyata sama, membuat test gagal.
describe('legacy receipt base prices', () => {
    const differences = new Map(
        golden.expected_differences.map((entry) => [
            key(entry.source, [
                entry.unit_cost,
                entry.vat_percent,
                entry.conversion,
                entry.discount_percent,
            ]),
            entry,
        ]),
    );
    const cases = Object.entries(golden.sources).flatMap(([source, data]) =>
        data.cases.map((entry) => ({ source, entry })),
    );

    test.each(cases)('$source $entry', ({ source, entry }) => {
        const difference = differences.get(key(source, entry));
        const result = fixed(ours(entry));
        if (difference) {
            expect(difference.legacy_base_price).toBe(entry[4]);
            expect(golden.reasons[difference.reason]).toBeString();
            expect(result).not.toBe(fixed(amount(entry[4])));
            expect(result).toBe(fixed(amount(difference.our_base_price)));
        } else expect(result).toBe(fixed(amount(entry[4])));
    });

    test('every expected difference names a case of the fixture, once', () => {
        const known = new Set(
            cases.map(({ source, entry }) => key(source, entry)),
        );
        expect(
            [...differences.keys()].filter((entry) => !known.has(entry)),
        ).toEqual([]);
        expect(differences.size).toBe(golden.expected_differences.length);
    });

    test('the fixture holds cases with VAT, a unit content other than 1, and a discount the legacy price ignores', () => {
        const all = cases.map(({ entry }) => entry);
        expect(all.some(([, vat]) => amount(vat) > 0n)).toBe(true);
        expect(
            all.some(([, , conversion]) => amount(conversion) > amount('1')),
        ).toBe(true);
        expect(
            cases.some(
                ({ source, entry }) =>
                    amount(entry[3]) > 0n &&
                    !differences.has(key(source, entry)),
            ),
        ).toBe(true);
    });

    const chains = Object.entries(golden.sources).flatMap(([source, data]) =>
        data.chains.map((chain, index) => ({ source, index, chain })),
    );

    // Harga dasar sebelum dan sesudah setiap penerimaan: naik ke harga baris bila lebih tinggi, tidak pernah turun.
    test.each(chains)('$source chain $index', ({ chain }) => {
        let basePrice = 0n;
        for (const entry of chain.lines) {
            const offered = ours(entry);
            basePrice = offered > basePrice ? offered : basePrice;
        }
        if (chain.reason !== undefined) {
            expect(golden.reasons[chain.reason]).toBeString();
            expect(fixed(basePrice)).not.toBe(
                fixed(amount(chain.legacy_base_price)),
            );
            expect(fixed(basePrice)).toBe(
                fixed(amount(chain.our_base_price ?? '')),
            );
        } else
            expect(fixed(basePrice)).toBe(
                fixed(amount(chain.legacy_base_price)),
            );
    });

    test('a chain holds a later, lower receipt that leaves the base price where it was', () => {
        expect(
            chains.some(({ chain }) =>
                chain.lines.some(
                    (entry, index) =>
                        index > 0 &&
                        chain.lines
                            .slice(0, index)
                            .some((earlier) => ours(earlier) > ours(entry)),
                ),
            ),
        ).toBe(true);
    });
});
