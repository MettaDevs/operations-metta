import type { ApiBody } from '../../../platform/shell/index.ts';
import type { Item } from '../item/item-lookup.tsx';
import { quantityScale } from '../quantity.ts';

// Bagian layar opname yang dipakai kartu, dialog Hitung baris, dan konfirmasi Post.

export type Position =
    ApiBody<'inventoryStockCountCalculateLines'>['data'][number];
export type ItemChoice = {
    id: string;
    code: string;
    name: string;
    base_unit: string;
    base_unit_id: string;
    batch_required: boolean;
    expiry_required: boolean;
};

export const itemChoice = (item: Item): ItemChoice => ({
    id: item.id,
    code: item.code,
    name: item.name,
    base_unit: item.base_unit.code,
    base_unit_id: item.base_unit.id,
    batch_required: item.batch_required,
    expiry_required: item.expiry_required,
});

export const label = (entry: { code: string; name: string }) =>
    `${entry.code} · ${entry.name}`;

// Jumlah dari API berupa teks desimal berskala jumlah barang, sama dengan kartu gudang. Selisih dihitung dengan bigint
// berskala, supaya tidak bergeser seperti bila diubah ke Number.
const scale = quantityScale;
const factor = 10n ** BigInt(scale);

export function scaled(text: string): bigint {
    const negative = text.startsWith('-');
    const [whole = '0', fraction = ''] = (
        negative ? text.slice(1) : text
    ).split('.');
    const value = BigInt(whole) * factor + BigInt(fraction.padEnd(scale, '0'));
    return negative ? -value : value;
}

export function unscaled(value: bigint): string {
    const negative = value < 0n;
    const magnitude = negative ? -value : value;
    const fraction = String(magnitude % factor)
        .padStart(scale, '0')
        .replace(/0+$/, '');
    return `${negative ? '-' : ''}${magnitude / factor}${fraction ? `.${fraction}` : ''}`;
}

// Hitungan dalam satuan baris dikali isinya, menjadi satuan dasar.
export const inBase = (counted: string, perUnit: string) =>
    (scaled(counted) * scaled(perUnit)) / factor;
