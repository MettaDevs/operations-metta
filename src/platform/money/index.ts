const decimalPattern = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export class Decimal {
    private constructor(
        readonly coefficient: bigint,
        readonly scale: number,
    ) {}

    static of(value: string | number): Decimal {
        const match = decimalPattern.exec(String(value).trim());
        if (!match || !match[2]) {
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
