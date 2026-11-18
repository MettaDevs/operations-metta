import { Decimal } from '../../platform/money/index.ts';
import type { AmountDecimals } from '../currency/index.ts';

// Satu-satunya rumus nilai baris pembelian, dipakai server (daftar, kartu, cetak, posting) dan layar (total sambil
// mengisi): Line Amount BC = jumlah × harga satuan × (100 − diskon %) / 100, dibulatkan ke presisi jumlah mata uang per
// baris; PPN dokumen = Σ nilai baris × tarif % / 100, dibulatkan sekali.

export type PricedLine = {
    quantity: string;
    unit_cost: string;
    discount_percent: string;
    vat_percent: string;
};

const zero = Decimal.of('0');
const hundred = Decimal.of('100');
const hundredth = Decimal.of('0.01');

// Isian kosong dibaca 0; teks yang bukan angka null.
export const decimalOf = (text: string) => {
    try {
        return Decimal.of(text.trim() || '0');
    } catch {
        return null;
    }
};

export function lineValue(
    line: Pick<PricedLine, 'quantity' | 'unit_cost' | 'discount_percent'>,
): Decimal {
    const quantity = decimalOf(line.quantity);
    const cost = decimalOf(line.unit_cost);
    const discount = decimalOf(line.discount_percent);
    return quantity && cost && discount
        ? quantity
              .multipliedBy(cost)
              .multipliedBy(hundred.minus(discount))
              .multipliedBy(hundredth)
        : zero;
}

export const lineAmount = (
    line: Pick<PricedLine, 'quantity' | 'unit_cost' | 'discount_percent'>,
    decimals: AmountDecimals,
) => lineValue(line).rounded(decimals);

export function documentTotals(
    lines: readonly PricedLine[],
    decimals: AmountDecimals,
) {
    let subtotal = zero;
    let vat = zero;
    for (const line of lines) {
        const amount = lineAmount(line, decimals);
        subtotal = subtotal.plus(amount);
        const percent = decimalOf(line.vat_percent);
        if (percent)
            vat = vat.plus(
                amount.multipliedBy(percent).multipliedBy(hundredth),
            );
    }
    return { subtotal, vat: vat.rounded(decimals) };
}
