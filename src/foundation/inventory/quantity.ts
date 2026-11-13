import {
    Decimal,
    decimalsHint,
    divideRounded,
} from '../../platform/money/index.ts';

// Jumlah dalam satuan dasar dan harga satuan disimpan numeric(18,4), nilai numeric(19,4). Di kode ketiganya bigint
// berskala, supaya stok yang dikurangi dan dijumlahkan tidak pernah bergeser karena pecahan biner.
export const quantityScale = 4;

// Batas angka di belakang koma jumlah barang, satu konstanta sistem (QtyRndPrecision BC), untuk pesan isian jumlah.
export const quantityHint = decimalsHint(quantityScale);
// Skala kolom nilai. Nilai dibulatkan ke presisi jumlah mata uang tenant, paling banyak skala ini.
export const amountScale = 4;
const limit = 10n ** 18n;

const fixedPattern = /^(-?)(\d+)(?:\.(\d+))?$/;

// Teks numeric dari PostgreSQL ke bigint berskala; skala lebih dari yang diminta berarti kolomnya salah dibaca.
export function fromNumeric(text: string, scale: number): bigint {
    const match = fixedPattern.exec(text);
    const fraction = match?.[3] ?? '';
    if (!match?.[2] || fraction.length > scale)
        throw new Error(`Invalid numeric(${scale}) value.`);
    const value = BigInt(match[2] + fraction.padEnd(scale, '0'));
    return match[1] === '-' ? -value : value;
}

export function toNumeric(value: bigint, scale: number): string {
    const negative = value < 0n;
    const digits = String(negative ? -value : value).padStart(scale + 1, '0');
    const whole = digits.slice(0, -scale);
    return `${negative ? '-' : ''}${whole}.${digits.slice(-scale)}`;
}

export function display(value: bigint, scale: number): string {
    return toNumeric(value, scale)
        .replace(/(\.\d*?)0+$/, '$1')
        .replace(/\.$/, '');
}

// Isian angka dari pemanggil API. null bila bukan angka, punya lebih dari empat angka di belakang koma, atau di luar
// batas kolom numeric(18,4).
export function decimalInput(raw: unknown): bigint | null {
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    if (typeof raw === 'number' && !Number.isFinite(raw)) return null;
    let decimal: Decimal;
    try {
        decimal = Decimal.of(String(raw).trim().replace(',', '.'));
    } catch {
        return null;
    }
    const rounded = decimal.rounded(quantityScale);
    if (rounded.compare(decimal) !== 0) return null;
    const value = fromNumeric(rounded.fixed(quantityScale), quantityScale);
    return value <= -limit || value >= limit ? null : value;
}

// Isian harga satuan 0 atau lebih dengan paling banyak `decimals` angka di belakang koma (presisi harga satuan mata
// uang tenant, lihat unitAmountDecimals), berskala quantityScale. null bila tidak memenuhi.
export function unitCostInput(raw: unknown, decimals: number): bigint | null {
    const value = decimalInput(raw);
    if (value === null || value < 0n) return null;
    return value % 10n ** BigInt(quantityScale - decimals) === 0n
        ? value
        : null;
}

// Jumlah dalam satuan dasar: jumlah baris x isi satuannya. null bila hasilnya punya lebih dari empat angka di belakang
// koma atau melewati batas kolom kartu gudang, karena kartu gudang tidak membulatkan jumlah.
export function baseQuantity(
    quantity: bigint,
    conversion: bigint,
): bigint | null {
    const scale = 10n ** BigInt(quantityScale);
    const exact = quantity * conversion;
    if (exact % scale !== 0n) return null;
    const base = exact / scale;
    return base < limit ? base : null;
}

// Nilai jumlah × harga satuan berskala amountScale, dibulatkan sekali ke `amountDecimals` angka di belakang koma
// (presisi jumlah mata uang tenant, setengah menjauhi nol).
export function amountOf(
    parts: { quantity: bigint; unitCost: bigint }[],
    amountDecimals: number,
): bigint {
    const exact = parts.reduce(
        (sum, part) => sum + part.quantity * part.unitCost,
        0n,
    );
    const step = 10n ** BigInt(amountScale - amountDecimals);
    return (
        divideRounded(
            exact,
            10n ** BigInt(quantityScale * 2 - amountScale) * step,
        ) * step
    );
}
