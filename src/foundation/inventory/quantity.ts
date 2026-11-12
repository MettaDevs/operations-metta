import { Decimal } from '../../platform/money/index.ts';

// Jumlah dalam satuan dasar dan harga satuan disimpan numeric(18,4), nilai numeric(18,2). Di kode ketiganya bigint
// berskala, supaya stok yang dikurangi dan dijumlahkan tidak pernah bergeser karena pecahan biner.
export const quantityScale = 4;
export const amountScale = 2;
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

// Nilai jumlah × harga satuan, dibulatkan sekali ke dua angka di belakang koma (setengah menjauhi nol).
export function amountOf(parts: { quantity: bigint; unitCost: bigint }[]) {
    const exact = parts.reduce(
        (sum, part) => sum + part.quantity * part.unitCost,
        0n,
    );
    const divisor = 10n ** BigInt(quantityScale * 2 - amountScale);
    const magnitude = exact < 0n ? -exact : exact;
    const rounded = (magnitude + divisor / 2n) / divisor;
    return exact < 0n ? -rounded : rounded;
}
