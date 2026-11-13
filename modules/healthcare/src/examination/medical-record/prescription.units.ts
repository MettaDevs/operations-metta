import {
    fromNumeric,
    quantityScale,
    toNumeric,
} from '@core/foundation/inventory/index.ts';

// Satuan baris resep: jumlah baris ditulis dalam satuan ini, dan quantityPerUnit adalah isinya dalam satuan dasar yang
// disalin saat baris disimpan (konversi). Angka berskala empat desimal seperti kolom numeric(18,4).
export type LineUnit = { code: string; quantityPerUnit: bigint };

export const quantityOf = (text: string) => fromNumeric(text, quantityScale);

export const numberText = (value: bigint) =>
    toNumeric(value, quantityScale).replace(/\.?0+$/, '');

export const quantityText = (value: bigint, code: string) =>
    `${numberText(value)} ${code}`;

// Jumlah dalam satuan dasar, ditulis dalam satuan baris bila habis dibagi isinya menjadi bilangan bulat (20 TAB pada
// baris STRIP isi 10 menjadi "2 STRIP"), kalau tidak dalam satuan dasar ("15 TAB").
export function baseQuantityText(
    base: bigint,
    unit: LineUnit,
    baseCode: string,
): string {
    return base % unit.quantityPerUnit === 0n
        ? `${String(base / unit.quantityPerUnit)} ${unit.code}`
        : quantityText(base, baseCode);
}
