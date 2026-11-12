import {
    fromNumeric,
    quantityScale,
    type InboundLine,
} from '../../inventory/index.ts';

const scale = 10n ** BigInt(quantityScale);
const hundredPercent = 100n * scale;
// Batas numeric(18,4) kartu gudang, dalam nilai berskala.
const limit = 10n ** 18n;

export const sourceType = 'penerimaan';

// Jumlah dalam satuan dasar: jumlah baris x isi satuannya. null bila hasilnya punya lebih dari empat angka di belakang
// koma atau melewati batas kolom kartu gudang, karena kartu gudang tidak membulatkan jumlah.
export function baseQuantity(
    quantity: bigint,
    conversion: bigint,
): bigint | null {
    const exact = quantity * conversion;
    if (exact % scale !== 0n) return null;
    const base = exact / scale;
    return base < limit ? base : null;
}

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
