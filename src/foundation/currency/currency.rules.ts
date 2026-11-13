import { Decimal } from '../../platform/money/index.ts';

export { decimalsHint } from '../../platform/money/index.ts';

// Batas presisi mata uang, sama dengan constraint currency_precisions: jumlah 0 sampai 4, harga satuan 0 sampai 6
// angka di belakang koma (Amount dan Unit-Amount Decimal Places BC).
export const amountDecimalOptions = [0, 1, 2, 3, 4] as const;
export const unitAmountDecimalOptions = [0, 1, 2, 3, 4, 5, 6] as const;

// Isian uang dari layar (titik desimal atau koma) dengan paling banyak `decimals` angka di belakang koma, 0 atau lebih
// dan di bawah `limit`. null bila tidak memenuhi. Hasilnya teks desimal dengan `decimals` angka di belakang koma.
export function amountInput(
    raw: unknown,
    decimals: number,
    limit = '1000000000000000',
): string | null {
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    if (typeof raw === 'number' && !Number.isFinite(raw)) return null;
    let value: Decimal;
    try {
        value = Decimal.of(String(raw).trim().replace(',', '.'));
    } catch {
        return null;
    }
    if (value.rounded(decimals).compare(value) !== 0) return null;
    if (value.compare(Decimal.of('0')) < 0) return null;
    if (value.compare(Decimal.of(limit)) >= 0) return null;
    return value.fixed(decimals);
}
