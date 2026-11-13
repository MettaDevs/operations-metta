import { Decimal } from '../../platform/money/index.ts';

// Angka desimal dari isian layar (titik atau koma), dengan paling banyak `scale` angka di belakang koma, di antara
// `min` dan `max`. null bila bukan angka atau di luar batas. Hasilnya teks untuk kolom numeric.
export function decimalText(
    raw: unknown,
    scale: number,
    min: string,
    max: string,
): string | null {
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    if (typeof raw === 'number' && !Number.isFinite(raw)) return null;
    let value: Decimal;
    try {
        value = Decimal.of(String(raw).trim().replace(',', '.'));
    } catch {
        return null;
    }
    if (value.rounded(scale).compare(value) !== 0) return null;
    if (
        value.compare(Decimal.of(min)) < 0 ||
        value.compare(Decimal.of(max)) > 0
    )
        return null;
    return value.fixed(scale);
}
