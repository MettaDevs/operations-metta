import {
    baseQuantity,
    fromNumeric,
    quantityScale,
    type InboundLine,
} from '../../inventory/index.ts';

const scale = 10n ** BigInt(quantityScale);
const hundredPercent = 100n * scale;

export const sourceType = 'penerimaan';

// Harga per satuan dasar sesudah diskon baris, dibulatkan sekali ke empat angka di belakang koma (setengah menjauhi
// nol), seperti Unit Cost (LCY) di baris pembelian BC.
export function baseUnitCost(
    unitCost: bigint,
    discountPercent: bigint,
    conversion: bigint,
): bigint {
    const numerator = unitCost * (hundredPercent - discountPercent) * scale;
    const denominator = hundredPercent * conversion;
    return (numerator + denominator / 2n) / denominator;
}

export type StoredReceiptLine = {
    id: string;
    item_id: string;
    conversion: string;
    quantity: string;
    unit_cost: string;
    discount_percent: string;
    batch_number: string | null;
    expiry: string | null;
    funding_source_id: string | null;
    procurement_program_id: string | null;
    budget_year: number | null;
};

// Harga beli per satuan dasar setiap barang di penerimaan, sebelum diskon, untuk harga dasar barang (Harga_Jual sistem
// lama, yang dihitung Goods_receipt.php sebelum diskon). Penerimaan belum mencatat tarif pajak, jadi "termasuk pajak"
// sistem lama sama dengan harga baris. Barang di beberapa baris memakai harga tertinggi.
export function receiptBasePrices(
    lines: readonly StoredReceiptLine[],
): Map<string, bigint> {
    const prices = new Map<string, bigint>();
    for (const line of lines) {
        const price = baseUnitCost(
            fromNumeric(line.unit_cost, quantityScale),
            0n,
            fromNumeric(line.conversion, quantityScale),
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
