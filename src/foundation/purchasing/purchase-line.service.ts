import { z } from 'zod';
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
import type { AmountDecimals } from '../currency/index.ts';
import {
    documentTotals,
    lineAmount,
    type PricedLine,
} from './purchase-line.amounts.ts';

const one = 10n ** BigInt(quantityScale);
const hundredPercent = 100n * one;

export const pricedLinesSchema = z.array(
    z.object({
        quantity: z.string(),
        unit_cost: z.string(),
        discount_percent: z.string(),
        vat_percent: z.string(),
    }),
);

export const pricedLinesSql = (
    table: string,
    documentColumn: string,
    header: string,
) => `coalesce((select json_agg(json_build_object(
                    'quantity', p.jumlah::text, 'unit_cost', p.harga_satuan::text,
                    'discount_percent', p.diskon_persen::text, 'vat_percent', p.tarif_ppn::text))
                from ${table} p
                where p.tenant_id = ${header}.tenant_id and p.${documentColumn} = ${header}.id
                  and p.deleted_at is null), '[]'::json)`;

export function withTotals<Row extends { priced_lines: PricedLine[] }>(
    { priced_lines, ...row }: Row,
    decimals: AmountDecimals,
) {
    const { subtotal, vat } = documentTotals(priced_lines, decimals);
    return {
        ...row,
        amount: subtotal.normalized(),
        vat_amount: vat.normalized(),
    };
}

export const withAmount = <Line extends PricedLine>(
    line: Line,
    decimals: AmountDecimals,
) => ({ ...line, amount: lineAmount(line, decimals).normalized() });

export function pricedDocument<Line extends PricedLine>(
    lines: Line[],
    decimals: AmountDecimals,
) {
    const { subtotal, vat } = documentTotals(lines, decimals);
    return {
        lines: lines.map((line) => withAmount(line, decimals)),
        subtotal: subtotal.normalized(),
        vat_amount: vat.normalized(),
        total: subtotal.plus(vat).normalized(),
    };
}

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
