import {
    fromNumeric,
    quantityScale,
    toNumeric,
} from '@core/foundation/inventory/index.ts';

export type LineUnit = { code: string; quantityPerUnit: bigint };

export const quantityOf = (text: string) => fromNumeric(text, quantityScale);

export const numberText = (value: bigint) =>
    toNumeric(value, quantityScale).replace(/\.?0+$/, '');

export const quantityText = (value: bigint, code: string) =>
    `${numberText(value)} ${code}`;

export function baseQuantityText(
    base: bigint,
    unit: LineUnit,
    baseCode: string,
): string {
    return base % unit.quantityPerUnit === 0n
        ? `${String(base / unit.quantityPerUnit)} ${unit.code}`
        : quantityText(base, baseCode);
}
