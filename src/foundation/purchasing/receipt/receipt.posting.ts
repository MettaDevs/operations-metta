import { divideRounded } from '../../../platform/money/index.ts';
import {
    baseQuantity,
    fromNumeric,
    quantityScale,
    type InboundLine,
} from '../../inventory/index.ts';

const scale = 10n ** BigInt(quantityScale);
const hundredPercent = 100n * scale;

export const sourceType = 'penerimaan';

// Harga satuan baris x persen / 100 per satuan dasar, dibulatkan sekali ke `decimals` angka di belakang koma (presisi
// harga satuan mata uang tenant, setengah menjauhi nol).
function perBaseUnit(
    unitCost: bigint,
    percent: bigint,
    conversion: bigint,
    decimals: number,
): bigint {
    const step = 10n ** BigInt(quantityScale - decimals);
    return (
        divideRounded(
            unitCost * percent * scale,
            hundredPercent * conversion * step,
        ) * step
    );
}

// Harga per satuan dasar sesudah diskon baris dan tanpa PPN, seperti Unit Cost (LCY) di baris pembelian BC. Kartu gudang
// sistem lama juga tanpa PPN (Harga_Beli / Konversi).
export function baseUnitCost(
    unitCost: bigint,
    discountPercent: bigint,
    conversion: bigint,
    decimals: number,
): bigint {
    return perBaseUnit(
        unitCost,
        hundredPercent - discountPercent,
        conversion,
        decimals,
    );
}

// Harga dasar yang ditawarkan satu baris: (Harga_Beli + Harga_Beli x Rate_Pajak / 100) / Konversi di Goods_receipt.php,
// termasuk PPN dan sebelum diskon.
export function receiptBasePrice(
    unitCost: bigint,
    vatPercent: bigint,
    conversion: bigint,
    decimals: number,
): bigint {
    return perBaseUnit(
        unitCost,
        hundredPercent + vatPercent,
        conversion,
        decimals,
    );
}

export type StoredReceiptLine = {
    id: string;
    item_id: string;
    conversion: string;
    quantity: string;
    unit_cost: string;
    discount_percent: string;
    vat_percent: string;
    batch_number: string | null;
    expiry: string | null;
    funding_source_id: string | null;
    procurement_program_id: string | null;
    budget_year: number | null;
};

// Harga dasar yang ditawarkan setiap barang di penerimaan (Harga_Jual sistem lama). Barang di beberapa baris memakai
// harga tertinggi.
export function receiptBasePrices(
    lines: readonly StoredReceiptLine[],
    decimals: number,
): Map<string, bigint> {
    const prices = new Map<string, bigint>();
    for (const line of lines) {
        const price = receiptBasePrice(
            fromNumeric(line.unit_cost, quantityScale),
            fromNumeric(line.vat_percent, quantityScale),
            fromNumeric(line.conversion, quantityScale),
            decimals,
        );
        if (price > (prices.get(line.item_id) ?? -1n))
            prices.set(line.item_id, price);
    }
    return prices;
}

// Baris penerimaan yang tersimpan menjadi baris masuk mesin posting. Jumlahnya sudah diperiksa saat disimpan.
export function receiptItemLine(
    line: StoredReceiptLine,
    locationId: string,
    index: number,
    decimals: number,
): InboundLine {
    const conversion = fromNumeric(line.conversion, quantityScale);
    const quantity = baseQuantity(
        fromNumeric(line.quantity, quantityScale),
        conversion,
    );
    if (quantity === null)
        throw new Error(`Receipt line ${line.id} has no exact base quantity.`);
    return {
        kind: 'inbound',
        entryKind: 'penerimaan',
        key: `${sourceType}:${line.id}`,
        field: `lines.${index}`,
        sourceLineId: line.id,
        itemId: line.item_id,
        locationId,
        quantity,
        unitCost: baseUnitCost(
            fromNumeric(line.unit_cost, quantityScale),
            fromNumeric(line.discount_percent, quantityScale),
            conversion,
            decimals,
        ),
        batchNumber: line.batch_number,
        expiry: line.expiry,
        funding: {
            sourceId: line.funding_source_id,
            programId: line.procurement_program_id,
            budgetYear: line.budget_year,
        },
    };
}
