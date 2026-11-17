import type { Workspace } from '@core/platform/access/index.ts';
import {
    fromNumeric,
    quantityScale,
    unitCostInput,
} from '@core/foundation/inventory/index.ts';
import { decimalsHint } from '@core/foundation/currency/index.ts';
import { percentHint, percentInput } from '@core/platform/money/index.ts';

// Harga obat, diskon, dan biaya racik atau resep yang diubah per baris (Harga Jual dan Diskon yang diketik apoteker di
// views/pharmacies/form.php sistem lama Seroja dan Adapotek). Hitungan sistem tetap disimpan di samping yang dipakai;
// yang berbeda dengan hitungan wajib beralasan. Satu aturan untuk penyiapan resep dan penjualan obat bebas. Semua nilai
// bigint berskala quantityScale, sama dengan harga yang dihitung priceDrugLines.

export const overridePermission = 'pharmacy.line-price.override';

export const canOverridePrice = (workspace: Workspace) =>
    workspace.permissions.has(overridePermission);

// Pengguna tanpa izin ditolak 403 sebelum isian harga dibaca, juga bila nilai yang dikirim sama dengan hitungan.
export const guardPriceOverride = (workspace: Workspace) =>
    workspace.guard('line-price', 'override');

export type LinePrice = { unitPrice: bigint; discountPercent: bigint };

export const samePrice = (a: LinePrice, b: LinePrice) =>
    a.unitPrice === b.unitPrice && a.discountPercent === b.discountPercent;

export const reasonMessage =
    'Isi alasan harga atau biaya diubah dari hitungan sistem.';
export const reasonLengthMessage = 'Alasan paling banyak 200 karakter.';

// Alasan yang sudah dirapikan, atau pesan kesalahannya. Kosong hanya boleh bila tidak ada yang berbeda dengan hitungan.
export function checkedReason(
    raw: string | null | undefined,
): { reason: string | null } | { error: string } {
    const reason = raw?.trim() || null;
    if (reason !== null && reason.length > 200)
        return { error: reasonLengthMessage };
    return { reason };
}

export function unitPriceInput(
    raw: unknown,
    decimals: number,
): bigint | { error: string } {
    return (
        unitCostInput(raw, decimals) ?? {
            error: `Isi harga satuan 0 atau lebih, ${decimalsHint(decimals)}.`,
        }
    );
}

export function discountInput(raw: unknown): bigint | { error: string } {
    const text = percentInput(raw);
    return text === null
        ? { error: percentHint() }
        : fromNumeric(text, quantityScale);
}

export function feeAmountInput(
    raw: unknown,
    decimals: number,
): bigint | { error: string } {
    return (
        unitCostInput(raw, decimals) ?? {
            error: `Isi nilai biaya 0 atau lebih, ${decimalsHint(decimals)}.`,
        }
    );
}
