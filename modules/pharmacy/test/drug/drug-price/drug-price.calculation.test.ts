import { describe, expect, test } from 'bun:test';
import {
    fromNumeric,
    quantityScale,
} from '../../../../../src/foundation/inventory/index.ts';
import {
    drugPrice,
    type PriceGrading,
} from '../../../src/drug/drug-price/drug-price.calculation.ts';

const amount = (text: string) => fromNumeric(text, quantityScale);

// Baris grading dengan nilai master sistem lama (Seroja dan Penta, KTP 1, TipePelayanan STANDARD). Kelompok harga dan
// kelompok grading memakai namanya sebagai id.
const row = (
    id: string,
    priceGroup: string,
    gradingGroup: string | null,
    markup: string,
    extra: {
        from?: string;
        to?: string;
        discount?: string;
        effectiveFrom?: string;
    } = {},
): PriceGrading => ({
    id,
    priceGroupId: priceGroup,
    gradingGroupId: gradingGroup,
    priceFrom: amount(extra.from ?? '1'),
    priceTo: amount(extra.to ?? '1000000000'),
    markupPercent: amount(markup),
    discountPercent: amount(extra.discount ?? '0'),
    effectiveFrom: extra.effectiveFrom ?? '2026-01-01',
});

const seroja = [
    row('local-injeksi', 'LOCAL', 'INJEKSI', '50', { to: '10000000' }),
    row('local-xx', 'LOCAL', 'XX', '30'),
    row('expart-xx', 'EXPART', 'XX', '60', { from: '1000', to: '10000000' }),
    row('foreign-xx', 'FOREIGN', 'XX', '80', { to: '100000000' }),
];
const penta = [
    ...['G1', 'G2', 'G3', 'G4', 'G5', 'G6'].map((group) =>
        row(`umum-${group}`, 'UMUM', group, '55.4', { from: '0' }),
    ),
    row('bpjs-g1', 'BPJS', 'G1', '22.1', { from: '0' }),
    row('bpjs-g4', 'BPJS', 'G4', '11', { from: '0' }),
    row('apotek-g3', 'APOTEK', 'G3', '38.75', { from: '0' }),
    row('tourist-g4', 'TOURIST INSURANCE', 'G4', '344', { from: '0' }),
];

const priced = (
    gradings: PriceGrading[],
    priceGroup: string | null,
    gradingGroup: string | null,
    base: string,
    options: { quantityPerUnit?: string; date?: string } = {},
) =>
    drugPrice(gradings, {
        basePrice: amount(base),
        priceGroupId: priceGroup,
        gradingGroupId: gradingGroup,
        date: options.date ?? '2026-11-13',
        quantityPerUnit: amount(options.quantityPerUnit ?? '1'),
    });

// Harga obat GetHargaObatNew_WithStok: % naik dari baris kelompok grading obat untuk kelompok harga pembeli dan rentang
// harga dasarnya, lalu baris semua barang, lalu 0 %; harga per satuan baris dibulatkan ke rupiah sesudah dikali isi
// satuan. Harapan dihitung tangan dari master sistem lama.
describe('drug price', () => {
    test.each([
        [
            'Seroja LOCAL XX 30 %',
            seroja,
            'LOCAL',
            'XX',
            '300',
            390n,
            'local-xx',
        ],
        [
            'Seroja LOCAL INJEKSI 50 %',
            seroja,
            'LOCAL',
            'INJEKSI',
            '2220',
            3330n,
            'local-injeksi',
        ],
        [
            'Seroja EXPART XX starts at 1.000, so a base of 500 finds no row',
            seroja,
            'EXPART',
            'XX',
            '500',
            500n,
            null,
        ],
        [
            'Seroja EXPART XX includes its lower bound',
            seroja,
            'EXPART',
            'XX',
            '1000',
            1600n,
            'expart-xx',
        ],
        [
            'Seroja EXPART XX includes its upper bound',
            seroja,
            'EXPART',
            'XX',
            '10000000',
            16000000n,
            'expart-xx',
        ],
        [
            'Seroja EXPART XX above its upper bound finds no row',
            seroja,
            'EXPART',
            'XX',
            '10000000.0001',
            10000000n,
            null,
        ],
        [
            'Seroja FOREIGN XX 80 %',
            seroja,
            'FOREIGN',
            'XX',
            '13500',
            24300n,
            'foreign-xx',
        ],
        [
            'Seroja IKS has no INJEKSI row and no all-items row',
            seroja,
            'IKS',
            'INJEKSI',
            '2220',
            2220n,
            null,
        ],
        [
            'Penta UMUM G3 55,4 %',
            penta,
            'UMUM',
            'G3',
            '1776000',
            2759904n,
            'umum-G3',
        ],
        [
            'Penta UMUM G6 55,4 %',
            penta,
            'UMUM',
            'G6',
            '20349',
            31622n,
            'umum-G6',
        ],
        ['Penta BPJS G4 11 %', penta, 'BPJS', 'G4', '28482', 31615n, 'bpjs-g4'],
        [
            'Penta BPJS G1 22,1 %',
            penta,
            'BPJS',
            'G1',
            '23330',
            28486n,
            'bpjs-g1',
        ],
        [
            'Penta APOTEK G3 38,75 %',
            penta,
            'APOTEK',
            'G3',
            '13963.04',
            19374n,
            'apotek-g3',
        ],
        [
            'Penta TOURIST INSURANCE G4 344 %',
            penta,
            'TOURIST INSURANCE',
            'G4',
            '125',
            555n,
            'tourist-g4',
        ],
    ] as const)(
        '%s',
        (_, gradings, priceGroup, gradingGroup, base, price, gradingId) => {
            expect(
                priced([...gradings], priceGroup, gradingGroup, base),
            ).toMatchObject({ unitPrice: price, gradingId });
        },
    );

    test('half a rupiah rounds away from zero, as T-SQL round(money, 0) does', () => {
        const kuta = [row('iks-xx', 'IKS', 'XX', '10')];
        expect(priced(kuta, 'IKS', 'XX', '495').unitPrice).toBe(545n);
        expect(priced(kuta, 'IKS', 'XX', '0.545').unitPrice).toBe(1n);
        expect(priced(kuta, 'IKS', 'XX', '0.4').unitPrice).toBe(0n);
    });

    test("the item's group row wins over the all-items row, and an item without a group or without a group row takes the all-items row", () => {
        const gradings = [
            row('umum-g1', 'UMUM', 'G1', '10'),
            row('umum-all', 'UMUM', null, '20'),
        ];
        expect(priced(gradings, 'UMUM', 'G1', '1000')).toMatchObject({
            unitPrice: 1100n,
            gradingId: 'umum-g1',
        });
        expect(priced(gradings, 'UMUM', 'G2', '1000')).toMatchObject({
            unitPrice: 1200n,
            gradingId: 'umum-all',
        });
        expect(priced(gradings, 'UMUM', null, '1000')).toMatchObject({
            unitPrice: 1200n,
            gradingId: 'umum-all',
        });
    });

    test('the latest effective row on the date wins, and a row effective later is ignored', () => {
        const gradings = [
            row('lama', 'UMUM', 'G1', '10', { effectiveFrom: '2026-01-01' }),
            row('baru', 'UMUM', 'G1', '15', { effectiveFrom: '2026-06-01' }),
            row('nanti', 'UMUM', 'G1', '50', { effectiveFrom: '2027-01-01' }),
        ];
        expect(priced(gradings, 'UMUM', 'G1', '1000')).toMatchObject({
            unitPrice: 1150n,
            gradingId: 'baru',
        });
        expect(
            priced(gradings, 'UMUM', 'G1', '1000', { date: '2026-03-01' }),
        ).toMatchObject({ unitPrice: 1100n, gradingId: 'lama' });
        expect(
            priced(gradings, 'UMUM', 'G1', '1000', { date: '2025-12-31' }),
        ).toMatchObject({ unitPrice: 1000n, gradingId: null });
    });

    test('a buyer without a price group pays the base price, and another price group never applies', () => {
        expect(priced(seroja, null, 'XX', '300')).toEqual({
            gradingId: null,
            markupPercent: 0n,
            unitPrice: 300n,
            discountPercent: 0n,
        });
        expect(priced(seroja, 'BPJS', 'XX', '300').unitPrice).toBe(300n);
    });

    test('a STRIP of 10 is rounded once after the unit content, not ten times the rounded tablet price', () => {
        const strip = priced(seroja, 'LOCAL', 'XX', '84.38', {
            quantityPerUnit: '10',
        });
        const tablet = priced(seroja, 'LOCAL', 'XX', '84.38');
        expect(strip.unitPrice).toBe(1097n);
        expect(tablet.unitPrice * 10n).toBe(1100n);
    });

    test('the discount is returned beside the price and does not lower it', () => {
        const gradings = [row('diskon', 'ASR', null, '10', { discount: '5' })];
        expect(priced(gradings, 'ASR', 'G1', '1000')).toEqual({
            gradingId: 'diskon',
            markupPercent: amount('10'),
            unitPrice: 1100n,
            discountPercent: amount('5'),
        });
    });
});
