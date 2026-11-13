import { expect, test } from 'bun:test';
import { paymentAmounts } from '../../../../src/foundation/billing/payment/payment.amounts.ts';
import { Decimal } from '../../../../src/platform/money/index.ts';
import {
    discountBase,
    discountLine,
    type DiscountCharge,
} from '../../../../src/foundation/billing/payment/payment.discount.ts';

const rupiah = (value: number) => BigInt(value) * 10000n;
const charges: DiscountCharge[] = [
    {
        procedureId: 'konsul',
        doctorId: 'dokter-a',
        quantity: '2',
        components: [
            { componentId: 'jasa-dokter', value: '17500' },
            { componentId: 'sarana', value: '5000' },
        ],
    },
    {
        procedureId: 'konsul',
        doctorId: 'dokter-b',
        quantity: '1',
        components: [{ componentId: 'jasa-dokter', value: '20000' }],
    },
];

test('the base of a discount follows its kind, as in the legacy discount tab', () => {
    const base = (
        kind: 'total' | 'komponen' | 'kelompok_jasa',
        doctorId: string | null,
    ) =>
        discountBase(kind, {
            invoiceValue: '675764',
            componentId: 'jasa-dokter',
            procedureId: 'konsul',
            doctorId,
            charges,
        })?.normalized() ?? null;
    expect(base('total', null)).toBe('675764');
    // Qty x nilai komponen, seperti SUM(QTY * Harga) GetDetailKomponenBiaya_ForDiskon_GABUNGAN.
    expect(base('komponen', 'dokter-a')).toBe('35000');
    expect(base('komponen', null)).toBe('55000');
    expect(base('kelompok_jasa', null)).toBeNull();
});

test('percent and amount compute each other, and a discount without a base takes only an amount', () => {
    expect(discountLine(Decimal.of('35000'), { percent: '5' }, 0)).toEqual({
        percent: '5',
        amount: '1750',
    });
    expect(discountLine(Decimal.of('675764'), { amount: '50000' }, 0)).toEqual({
        percent: '7.4',
        amount: '50000',
    });
    expect(discountLine(Decimal.of('3'), { percent: '12.5' }, 2)).toEqual({
        percent: '12.5',
        amount: '0.38',
    });
    expect(discountLine(null, { percent: '10' }, 0)).toBeNull();
    expect(discountLine(null, { amount: '20000' }, 0)).toEqual({
        percent: '0',
        amount: '20000',
    });
});

// Satu-satunya pembayaran berdiskon di Seroja: Nilai 675.764, tiga diskon 50.000 + 1.750 + 20.000, uang diterima
// 650.000, kembalian 45.986, dan tunai tersimpan 604.014 = Nilai - NilaiDiscount.
test('the discounted Seroja payment keeps its change and cash', () => {
    const amounts = paymentAmounts({
        value: rupiah(675764),
        discount: rupiah(50000 + 1750 + 20000),
        received: rupiah(650000),
        lines: [],
        amountDecimals: 0,
    });
    expect(amounts.subTotal).toBe(rupiah(604014));
    expect(amounts.change).toBe(rupiah(45986));
    expect(amounts.cash).toBe(rupiah(604014));
    expect(amounts.remainder).toBe(0n);
});
