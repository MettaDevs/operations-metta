import {
    fromNumeric,
    quantityScale,
    toNumeric,
} from '@core/foundation/inventory/index.ts';

// Satuan baris resep, penyerahan, atau retur: jumlah baris ditulis dalam satuan ini, dan quantityPerUnit adalah isinya
// dalam satuan dasar yang disalin saat baris ditulis (konversi). Angka berskala empat desimal seperti numeric(18,4).
export type LineUnit = { unitId: string; quantityPerUnit: bigint };

export const quantityOf = (text: string) => fromNumeric(text, quantityScale);

export const quantityText = (value: bigint) =>
    toNumeric(value, quantityScale).replace(/\.?0+$/, '');

// Jumlah baris dalam satuan dasar tanpa pembulatan, berskala delapan desimal, untuk membandingkan jumlah yang ditulis
// dalam satuan berbeda: 2 STRIP isi 10 sama dengan 20 TAB.
export const exactBase = (
    quantity: bigint,
    unit: { quantityPerUnit: bigint },
) => quantity * unit.quantityPerUnit;

// Jumlah dalam satuan dasar, ditulis dalam satuan baris bila habis dibagi isinya menjadi bilangan bulat (20 pada baris
// STRIP isi 10 menjadi "2 STRIP"), kalau tidak dalam satuan dasar ("15 TAB").
export function baseQuantityText(
    base: bigint,
    unit: { code: string; quantityPerUnit: bigint },
    baseCode: string,
): string {
    return base % unit.quantityPerUnit === 0n
        ? `${String(base / unit.quantityPerUnit)} ${unit.code}`
        : `${quantityText(base)} ${baseCode}`;
}
