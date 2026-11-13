import {
    fromNumeric,
    quantityScale,
    toNumeric,
} from '@core/foundation/inventory/index.ts';

export type LineUnit = { unitId: string; quantityPerUnit: bigint };

export const quantityOf = (text: string) => fromNumeric(text, quantityScale);

export const quantityText = (value: bigint) =>
    toNumeric(value, quantityScale).replace(/\.?0+$/, '');

export const exactBase = (
    quantity: bigint,
    unit: { quantityPerUnit: bigint },
) => quantity * unit.quantityPerUnit;

export function baseQuantityText(
    base: bigint,
    unit: { code: string; quantityPerUnit: bigint },
    baseCode: string,
): string {
    return base % unit.quantityPerUnit === 0n
        ? `${String(base / unit.quantityPerUnit)} ${unit.code}`
        : `${quantityText(base)} ${baseCode}`;
}
