import { Decimal } from '../../../platform/money/index.ts';

// Total tagihan kunjungan, rumus server kasir Kuta 1 (general_payment_helper.php get_total_cost):
//   Nilai     = round( Σ (Qty × (Nilai − Nilai × Disc / 100) + HExt), 0 )
//   NilaiOrig = round( Σ (Qty × (HargaOrig − HargaOrig × Disc / 100) + HExt), 0 )
// dan per kelompok jasa dengan rumus yang sama. HExt ditambahkan per baris, tidak dikali Qty. Pembulatan setengah
// menjauhi nol ke rupiah, sama dengan ROUND SQL Server. Rumus Seroja (tanpa round, ditambah BiayaResep) tidak dipakai:
// rumus Kuta cocok dengan lebih banyak pembayaran di kedua sumber (spesifikasi kasir 2.4).

export type ChargeLine = {
    serviceGroupId: string | null;
    quantity: string;
    value: string;
    originalPrice: string;
    discountPercent: string;
    extra: string;
};

export type InvoiceTotals = {
    value: string;
    originalValue: string;
    // Nilai per kelompok jasa, kunci null untuk baris tanpa kelompok.
    groups: Map<string | null, string>;
};

// Perkalian tepat dua desimal: koefisien dikali, skala dijumlah. `divide100` menggeser dua angka lagi.
function multiply(a: Decimal, b: Decimal, divide100 = false): Decimal {
    const scale = a.scale + b.scale + (divide100 ? 2 : 0);
    const product = a.coefficient * b.coefficient;
    const negative = product < 0n;
    const digits = (negative ? -product : product)
        .toString()
        .padStart(scale + 1, '0');
    const text =
        scale === 0
            ? digits
            : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    return Decimal.of(`${negative ? '-' : ''}${text}`);
}

const hundred = Decimal.of('100');

// Qty × harga sesudah diskon persen, ditambah HExt baris itu.
function lineAmount(price: string, line: ChargeLine): Decimal {
    const net = multiply(
        Decimal.of(price),
        hundred.minus(Decimal.of(line.discountPercent)),
        true,
    );
    return multiply(net, Decimal.of(line.quantity)).plus(
        Decimal.of(line.extra),
    );
}

const rupiah = (value: Decimal) => value.rounded(0).fixed(0);

export function invoiceTotals(lines: ChargeLine[]): InvoiceTotals {
    const zero = Decimal.of('0');
    let value = zero;
    let originalValue = zero;
    const groups = new Map<string | null, Decimal>();
    for (const line of lines) {
        const amount = lineAmount(line.value, line);
        value = value.plus(amount);
        originalValue = originalValue.plus(
            lineAmount(line.originalPrice, line),
        );
        groups.set(
            line.serviceGroupId,
            (groups.get(line.serviceGroupId) ?? zero).plus(amount),
        );
    }
    return {
        value: rupiah(value),
        originalValue: rupiah(originalValue),
        groups: new Map(
            [...groups].map(([group, amount]) => [group, rupiah(amount)]),
        ),
    };
}
