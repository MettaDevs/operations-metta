import { expect, test } from 'bun:test';
import { paymentAmounts } from '../../../../src/foundation/billing/payment/payment.amounts.ts';

const rupiah = (value: number) => BigInt(value) * 10000n;

// Golden dari pembayaran Kuta 1 yang tersimpan (SIMtrKasir dan SIMtrKasirDetail, hanya angka): uang diterima, kembalian,
// dan nilai per jenis bayar dihitung ulang dengan rumus layar Pembayaran.
const cases = [
    // Nilai, uang diterima, kartu, Pasien BON, lalu yang tersimpan: kembalian, tunai, kartu, sisa ke Pasien BON.
    {
        value: 55000,
        received: 120000,
        card: 0,
        bon: false,
        change: 65000,
        cash: 55000,
        remainder: 0,
    },
    {
        value: 50000,
        received: 100000,
        card: 0,
        bon: false,
        change: 50000,
        cash: 50000,
        remainder: 0,
    },
    {
        value: 70000,
        received: 0,
        card: 70000,
        bon: false,
        change: 0,
        cash: 0,
        remainder: 0,
    },
    {
        value: 810000,
        received: 0,
        card: 665000,
        bon: true,
        change: 0,
        cash: 0,
        remainder: 145000,
    },
    // Tunai dan kartu masing-masing 30.000 untuk Nilai 30.000: sistem lama menyimpan keduanya (lebih bayar).
    {
        value: 30000,
        received: 30000,
        card: 30000,
        bon: false,
        change: 0,
        cash: 30000,
        remainder: 0,
    },
] as const;

test('change, cash, card, and the patient debt match the legacy Kuta payments', () => {
    for (const legacy of cases) {
        const amounts = paymentAmounts({
            value: rupiah(legacy.value),
            discount: 0n,
            received: rupiah(legacy.received),
            lines: legacy.card
                ? [{ amount: rupiah(legacy.card), surchargePercent: 0n }]
                : [],
            amountDecimals: 0,
        });
        expect({
            value: legacy.value,
            change: amounts.change,
            cash: amounts.cash,
            remainder: amounts.remainder,
        }).toEqual({
            value: legacy.value,
            change: rupiah(legacy.change),
            cash: rupiah(legacy.cash),
            remainder: rupiah(legacy.remainder),
        });
    }
});

test('a card surcharge is added on top of the bill and not counted toward the card amount', () => {
    const amounts = paymentAmounts({
        value: rupiah(100000),
        discount: 0n,
        received: 0n,
        lines: [{ amount: rupiah(100000), surchargePercent: 25000n }],
        amountDecimals: 0,
    });
    expect([amounts.surcharge, amounts.grandTotal, amounts.remainder]).toEqual([
        rupiah(2500),
        rupiah(102500),
        0n,
    ]);
});

test('foreign cash counts with the cash received, so its change comes back from the local drawer', () => {
    // Tagihan 200.000; tunai valuta senilai 200.694 dan tanpa uang lokal: kembalian 694 keluar dari laci lokal.
    const foreignOnly = paymentAmounts({
        value: rupiah(200000),
        discount: 0n,
        received: 0n,
        lines: [{ amount: rupiah(200694), surchargePercent: 0n, cash: true }],
        amountDecimals: 0,
    });
    expect([
        foreignOnly.change,
        foreignOnly.cash,
        foreignOnly.paid,
        foreignOnly.remainder,
    ]).toEqual([rupiah(694), -rupiah(694), rupiah(200000), 0n]);
    // Tunai valuta 150.000 dan uang lokal 100.000 untuk tagihan 200.000: kembalian 50.000, tunai lokal bersih 50.000.
    const mixed = paymentAmounts({
        value: rupiah(200000),
        discount: 0n,
        received: rupiah(100000),
        lines: [{ amount: rupiah(150000), surchargePercent: 0n, cash: true }],
        amountDecimals: 0,
    });
    expect([mixed.change, mixed.cash, mixed.remainder]).toEqual([
        rupiah(50000),
        rupiah(50000),
        0n,
    ]);
});
