const decimalPattern = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export class Decimal {
    private constructor(
        readonly coefficient: bigint,
        readonly scale: number,
    ) {}

    static of(value: string | number): Decimal {
        const match = decimalPattern.exec(String(value).trim());
        if (!match?.[2]) {
            throw new Error('Invalid decimal value.');
        }
        const fraction = match[3] ?? '';
        const exponent = Number(match[4] ?? 0);
        let scale = fraction.length - exponent;
        let coefficient = BigInt(match[2] + fraction);
        if (scale < 0) {
            coefficient *= 10n ** BigInt(-scale);
            scale = 0;
        }
        if (match[1] === '-') coefficient = -coefficient;
        return new Decimal(coefficient, scale);
    }

    private at(scale: number): bigint {
        return this.coefficient * 10n ** BigInt(scale - this.scale);
    }

    plus(other: Decimal): Decimal {
        const scale = Math.max(this.scale, other.scale);
        return new Decimal(this.at(scale) + other.at(scale), scale);
    }

    minus(other: Decimal): Decimal {
        return this.plus(new Decimal(-other.coefficient, other.scale));
    }

    times(units: number): Decimal {
        if (!Number.isSafeInteger(units))
            throw new Error('Invalid unit count.');
        return new Decimal(this.coefficient * BigInt(units), this.scale);
    }

    compare(other: Decimal): number {
        const value = this.minus(other).coefficient;
        return value < 0n ? -1 : value > 0n ? 1 : 0;
    }

    rounded(scale: number): Decimal {
        if (scale >= this.scale) return new Decimal(this.at(scale), scale);
        const divisor = 10n ** BigInt(this.scale - scale);
        const absolute =
            this.coefficient < 0n ? -this.coefficient : this.coefficient;
        const rounded = (absolute + divisor / 2n) / divisor;
        return new Decimal(this.coefficient < 0n ? -rounded : rounded, scale);
    }

    fixed(scale: number): string {
        const value = this.rounded(scale).coefficient;
        const sign = value < 0n ? '-' : '';
        const text = String(value < 0n ? -value : value).padStart(
            scale + 1,
            '0',
        );
        return scale === 0
            ? sign + text
            : `${sign}${text.slice(0, -scale)}.${text.slice(-scale)}`;
    }

    normalized(): string {
        return this.fixed(this.scale)
            .replace(/(\.\d*?)0+$/, '$1')
            .replace(/\.$/, '');
    }

    split(units: number, precision: number): string[] {
        if (
            !Number.isSafeInteger(units) ||
            units < 1 ||
            this.coefficient < 0n
        ) {
            throw new Error('Invalid nonnegative allocation.');
        }
        const total = this.rounded(precision).coefficient;
        const count = BigInt(units);
        const base = total / count;
        const remainder = total % count;
        return Array.from({ length: units }, (_, index) =>
            new Decimal(
                base + (BigInt(index) < remainder ? 1n : 0n),
                precision,
            ).fixed(precision),
        );
    }
}

// Satu-satunya pembulatan uang dan harga di runtime ini: kasir, farmasi, tindakan, dan kelak finance memakainya dengan
// setelan keuangan legal entity (src/foundation/finance-setup/).

// Pembagian bilangan bulat, dibulatkan setengah menjauhi nol, sama dengan ROUND SQL Server dan Decimal.rounded.
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
    if (denominator <= 0n) throw new Error('Invalid rounding divisor.');
    const negative = numerator < 0n;
    const absolute = negative ? -numerator : numerator;
    const rounded = (absolute + denominator / 2n) / denominator;
    return negative ? -rounded : rounded;
}

export const roundingMethods = ['nearest', 'up', 'down'] as const;
export type RoundingMethod = (typeof roundingMethods)[number];

// Nilai dibulatkan ke kelipatan step menurut metode (Inv. Rounding Type BC: Nearest, Up, Down; Metode_Pembulatan sistem
// lama: 3 Ke Semua, 1 Ke Atas, 2 Ke Bawah). Step nol berarti tidak dibulatkan.
export function roundToMultiple(
    value: Decimal,
    step: Decimal,
    method: RoundingMethod,
): Decimal {
    if (step.compare(Decimal.of('0')) <= 0) return value;
    const scale = Math.max(value.scale, step.scale);
    const amount = BigInt(value.fixed(scale).replace('.', ''));
    const unit = BigInt(step.fixed(scale).replace('.', ''));
    const lower = (amount / unit) * unit - (amount % unit < 0n ? unit : 0n);
    const remainder = amount - lower;
    const rounded =
        remainder === 0n
            ? amount
            : method === 'up'
              ? lower + unit
              : method === 'down'
                ? lower
                : remainder * 2n >= unit
                  ? lower + unit
                  : lower;
    const digits = (rounded < 0n ? -rounded : rounded)
        .toString()
        .padStart(scale + 1, '0');
    return Decimal.of(
        `${rounded < 0n ? '-' : ''}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`,
    );
}

const decimalWords = ['tanpa', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam'];

// Akhir pesan isian angka yang mengikuti presisinya, misalnya "paling banyak dua angka di belakang koma". Satu kalimat
// untuk uang (presisi mata uang), jumlah barang (quantityScale), dan persen (percentScale).
export function decimalsHint(decimals: number): string {
    return decimals === 0
        ? 'tanpa angka di belakang koma'
        : `paling banyak ${decimalWords[decimals] ?? String(decimals)} angka di belakang koma`;
}

// Persen memakai satu skala tetap, bukan setelan (DecimalPlaces 0:5 BC): empat angka di belakang koma.
export const percentScale = 4;

// Isian persen 0 sampai `max` dengan paling banyak percentScale angka di belakang koma; null bila tidak memenuhi. Hasilnya
// teks desimal untuk kolom numeric(9,4).
export function percentInput(raw: unknown, max = '100'): string | null {
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    if (typeof raw === 'number' && !Number.isFinite(raw)) return null;
    let value: Decimal;
    try {
        value = Decimal.of(String(raw).trim().replace(',', '.'));
    } catch {
        return null;
    }
    if (value.rounded(percentScale).compare(value) !== 0) return null;
    if (value.compare(Decimal.of('0')) < 0) return null;
    if (value.compare(Decimal.of(max)) > 0) return null;
    return value.fixed(percentScale);
}

export const percentHint = (max = '100') =>
    `Isi persen 0 sampai ${max.replace('.', ',')}, ${decimalsHint(percentScale)}.`;
