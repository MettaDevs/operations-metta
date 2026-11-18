import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type postgres from 'postgres';
import { z } from 'zod';
import type { AmountDecimals } from '../../../src/foundation/currency/index.ts';
import {
    documentTotals,
    lineAmount,
    type PricedLine,
} from '../../../src/foundation/purchasing/purchase-line.amounts.ts';
import { loadConfig } from '../../../src/platform/config/index.ts';
import { createPool } from '../../../src/platform/database/index.ts';

const line = (
    quantity: string,
    unit_cost: string,
    discount_percent = '0',
    vat_percent = '0',
): PricedLine => ({ quantity, unit_cost, discount_percent, vat_percent });

const cases: Record<string, PricedLine[]> = {
    'half a unit': [line('1', '0.5')],
    'two and a half': [line('1', '2.5')],
    'half after discount': [line('1', '1', '50')],
    'just under half': [line('3', '0.1665')],
    'repeating third': [line('0.3333', '3')],
    'odd discount': [line('1', '100', '33.3333')],
    'full discount': [line('7', '12345.6789', '100', '11')],
    'four-decimal inputs': [line('1234.5678', '9999.9999', '12.3456', '11')],
    'largest stored values': [
        line('99999999999999.9999', '99999999999999.9999', '0.0001', '99.9999'),
    ],
    'vat summed before rounding': [
        line('1', '0.5', '0', '11'),
        line('1', '0.5', '0', '11'),
        line('1', '0.5', '0', '11'),
    ],
    'vat of one eighth': [line('1', '1', '0', '12.5')],
    'mixed vat rates': [
        line('10', '15000', '5', '11'),
        line('3', '2750.5', '0', '12'),
        line('0.25', '199.99', '10', '0'),
    ],
    'whole amount with trailing zeros': [line('2', '750', '0', '10')],
    'empty document': [],
};

const decimals: AmountDecimals[] = [0, 1, 2, 3, 4];

const removedLineAmountSql = `
    select coalesce(json_agg(trim_scale(t.amount)::text order by t.position), '[]'::json) as amounts,
           coalesce(trim_scale(sum(t.amount))::text, '0') as subtotal,
           coalesce(trim_scale(round(sum(t.amount * t.tarif_ppn / 100), $2::int))::text, '0') as vat
    from (select d.position,
                 round(d.jumlah * d.harga_satuan * (100 - d.diskon_persen) / 100, $2::int) as amount,
                 d.tarif_ppn
          from jsonb_to_recordset($1::text::jsonb)
               as d(position int, jumlah numeric(18,4), harga_satuan numeric(18,4),
                    diskon_persen numeric(7,4), tarif_ppn numeric(7,4))) t`;

const removedLineAmountSchema = z.object({
    amounts: z.array(z.string()),
    subtotal: z.string(),
    vat: z.string(),
});

function computed(lines: PricedLine[], scale: AmountDecimals) {
    const { subtotal, vat } = documentTotals(lines, scale);
    return {
        amounts: lines.map((entry) => lineAmount(entry, scale).normalized()),
        subtotal: subtotal.normalized(),
        vat: vat.normalized(),
    };
}

describe('purchase line amounts', () => {
    test('rounds each line half away from zero, then vat once per document', () => {
        expect(computed(cases['half a unit'] ?? [], 0).amounts).toEqual(['1']);
        expect(computed(cases['just under half'] ?? [], 0).amounts).toEqual([
            '0',
        ]);
        expect(computed(cases['vat summed before rounding'] ?? [], 0)).toEqual({
            amounts: ['1', '1', '1'],
            subtotal: '3',
            vat: '0',
        });
        expect(computed(cases['vat summed before rounding'] ?? [], 2)).toEqual({
            amounts: ['0.5', '0.5', '0.5'],
            subtotal: '1.5',
            vat: '0.17',
        });
    });

    test('reads unfinished input as zero instead of failing', () => {
        expect(lineAmount(line('', '1000'), 0).normalized()).toBe('0');
        expect(lineAmount(line('2', 'abc'), 0).normalized()).toBe('0');
        expect(
            documentTotals([line('2', '1000', '0', 'x')], 0).vat.normalized(),
        ).toBe('0');
    });
});

describe.skipIf(!process.env.DB_HOST)(
    'purchase line amounts against the former SQL',
    () => {
        let pool: postgres.Sql;

        beforeAll(() => {
            pool = createPool(
                loadConfig({
                    ...process.env,
                    APP_KEY: 'base64:' + Buffer.alloc(32, 7).toString('base64'),
                }),
            );
        });

        afterAll(async () => {
            await pool.end();
        });

        for (const [name, lines] of Object.entries(cases))
            for (const scale of decimals)
                test(`${name}, ${scale} decimals`, async () => {
                    const stored = lines.map((entry, position) => ({
                        position,
                        jumlah: entry.quantity,
                        harga_satuan: entry.unit_cost,
                        diskon_persen: entry.discount_percent,
                        tarif_ppn: entry.vat_percent,
                    }));
                    const [row] = await pool.unsafe(removedLineAmountSql, [
                        JSON.stringify(stored),
                        scale,
                    ]);
                    expect(computed(lines, scale)).toEqual(
                        removedLineAmountSchema.parse(row),
                    );
                });
    },
);
