import type { Database } from '../../platform/database/index.ts';
import {
    decimalsHint,
    percentHint,
    percentInput,
} from '../../platform/money/index.ts';
import {
    baseQuantity,
    decimalInput,
    defaultUnit,
    exists,
    fromNumeric,
    quantityHint,
    quantityScale,
    unitConversion,
    unitCostInput,
} from '../inventory/index.ts';

const one = 10n ** BigInt(quantityScale);
const hundredPercent = 100n * one;

export const lineAmountSql = (alias: string, amountDecimals: number) =>
    `round(${alias}.jumlah * ${alias}.harga_satuan * (100 - ${alias}.diskon_persen) / 100, ${amountDecimals})`;

export type PriceLineInput = {
    item_id: string;
    unit_id?: string | null;
    quantity: number | string;
    unit_cost: number | string;
    discount_percent?: number | string | null;
    vat_percent?: number | string | null;
};

export type PriceLine = {
    itemId: string;
    unitId: string;
    conversion: bigint;
    quantity: bigint;
    unitCost: bigint;
    discountPercent: bigint;
    vatPercent: bigint;
};

export async function checkPriceLine(
    db: Database,
    scope: { tenantId: string; legalEntityId: string },
    line: PriceLineInput,
    unitCostDecimals: number,
    fail: (field: string, message: string) => void,
): Promise<PriceLine> {
    if (!(await exists(db, 'gd_m_barang', scope, line.item_id)))
        fail('item_id', 'Pilih barang dari daftar.');
    const unit = line.unit_id
        ? {
              unitId: line.unit_id,
              conversion: await unitConversion(
                  db,
                  scope,
                  line.item_id,
                  line.unit_id,
              ),
          }
        : await defaultUnit(db, scope, line.item_id, 'purchase');
    const conversion = unit?.conversion ?? null;
    if (conversion === null)
        fail('unit_id', 'Pilih satuan barang ini dari daftar.');
    const quantity = decimalInput(line.quantity);
    if (quantity === null || quantity <= 0n)
        fail('quantity', `Isi jumlah lebih dari 0, ${quantityHint}.`);
    else if (conversion !== null && baseQuantity(quantity, conversion) === null)
        fail(
            'quantity',
            `Jumlah ini dalam satuan dasar harus ${quantityHint} dan tidak terlalu besar. Ubah jumlah atau satuannya.`,
        );
    const unitCost = unitCostInput(line.unit_cost, unitCostDecimals);
    if (unitCost === null)
        fail(
            'unit_cost',
            `Isi harga satuan 0 atau lebih, ${decimalsHint(unitCostDecimals)}.`,
        );
    const discount =
        line.discount_percent === null ||
        line.discount_percent === undefined ||
        line.discount_percent === ''
            ? 0n
            : decimalInput(line.discount_percent);
    if (discount === null || discount < 0n || discount > hundredPercent)
        fail('discount_percent', 'Isi diskon 0 sampai 100 persen.');
    const vat = percentInput(line.vat_percent || 0);
    if (vat === null) fail('vat_percent', percentHint());
    return {
        itemId: line.item_id,
        unitId: unit?.unitId ?? '',
        conversion: conversion ?? one,
        quantity: quantity ?? 0n,
        unitCost: unitCost ?? 0n,
        discountPercent: discount ?? 0n,
        vatPercent: vat === null ? 0n : fromNumeric(vat, quantityScale),
    };
}
