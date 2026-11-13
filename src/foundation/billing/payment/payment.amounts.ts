import { divideRounded } from '../../../platform/money/index.ts';

// Rumus layar Pembayaran Kuta 1 (form/payment.php calculate_payment), dalam satuan terkecil berskala empat (skala kolom
// uang numeric(19,4)) supaya server dan layar menghitung angka yang sama tanpa pecahan biner. Dipakai server saat Simpan
// dan layar saat kasir mengisi. Biaya tambahan dibulatkan ke presisi jumlah mata uang.
//
//   TaxCC       = Σ jumlah kartu × biaya tambahan % / 100
//   SubTotal    = Nilai − Nilai Discount
//   GrandTotal  = SubTotal + TaxCC
//   Total       = Σ jumlah metode lain (kartu dihitung jumlahnya, tanpa biaya tambahan)
//   Pembayaran  = min(Total + uang diterima + TaxCC, GrandTotal)
//   Sisa        = GrandTotal − Pembayaran
//   Kembalian   = uang diterima − (GrandTotal − TaxCC − Total), hanya bila uang diterima > 0, hasil kurung > 0, dan
//                 uang diterima > hasil kurung; selain itu 0
//   Tunai       = uang diterima − Kembalian
//
// Sisa masuk jenis bayar penampung sisa (Pasien BON) bila dicentang. Seperti sistem lama, uang diterima tidak dikurangi
// bila metode lain sudah menutup tagihan, jadi tunai dan kartu bisa tersimpan melebihi Nilai (28 pembayaran Kuta).
//
// Tunai valuta (baris bertanda cash, jumlahnya sudah dalam mata uang lokal) dihitung bersama uang diterima, bukan
// bersama Total, karena kembaliannya selalu mata uang lokal (tender type Currency di Commerce F&O). Tanpa tunai valuta
// rumusnya sama persis dengan Kuta. Bila kembalian lebih besar dari uang diterima, Tunai negatif: uang lokal keluar
// dari laci sebagai kembalian tunai valuta.

export const moneyScale = 4;
const one = 10n ** BigInt(moneyScale);

export type PaymentLineInput = {
    // Jumlah dalam mata uang lokal.
    amount: bigint;
    // Persen biaya tambahan berskala empat: 2,5 % = 25000.
    surchargePercent: bigint;
    // Tunai valuta: ikut uang diterima untuk kembalian.
    cash?: boolean;
};

export type PaymentAmounts = {
    subTotal: bigint;
    surcharge: bigint;
    grandTotal: bigint;
    othersTotal: bigint;
    paid: bigint;
    remainder: bigint;
    change: bigint;
    cash: bigint;
    lineSurcharges: bigint[];
};

export function paymentAmounts(input: {
    value: bigint;
    discount: bigint;
    received: bigint;
    lines: PaymentLineInput[];
    amountDecimals: number;
}): PaymentAmounts {
    const step =
        10n ** BigInt(moneyScale - Math.min(input.amountDecimals, moneyScale));
    const lineSurcharges = input.lines.map(
        (line) =>
            divideRounded(
                line.amount * line.surchargePercent,
                100n * one * step,
            ) * step,
    );
    const surcharge = lineSurcharges.reduce((sum, value) => sum + value, 0n);
    const othersTotal = input.lines.reduce(
        (sum, line) => (line.cash ? sum : sum + line.amount),
        0n,
    );
    const tendered = input.lines.reduce(
        (sum, line) => (line.cash ? sum + line.amount : sum),
        input.received,
    );
    const subTotal = input.value - input.discount;
    const grandTotal = subTotal + surcharge;
    const due = grandTotal - surcharge - othersTotal;
    const change =
        tendered > 0n && due > 0n && tendered > due ? tendered - due : 0n;
    const sum = othersTotal + tendered + surcharge;
    const paid = sum < grandTotal ? sum : grandTotal;
    return {
        subTotal,
        surcharge,
        grandTotal,
        othersTotal,
        paid,
        remainder: grandTotal - paid,
        change,
        cash: input.received - change,
        lineSurcharges,
    };
}

// Teks desimal (`12500.5`) ke satuan terkecil berskala empat, dan sebaliknya tanpa nol di belakang koma.
export function toMinor(value: string): bigint {
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
    const minor =
        BigInt(whole || '0') * one +
        BigInt((fraction + '0000').slice(0, moneyScale));
    return negative ? -minor : minor;
}

export function fromMinor(minor: bigint): string {
    const negative = minor < 0n;
    const absolute = negative ? -minor : minor;
    const fraction = (absolute % one)
        .toString()
        .padStart(moneyScale, '0')
        .replace(/0+$/, '');
    return `${negative ? '-' : ''}${absolute / one}${fraction ? `.${fraction}` : ''}`;
}
