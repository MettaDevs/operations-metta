import { quantityScale } from '@core/foundation/inventory/index.ts';

// Harga obat, makna GetHargaObatNew_WithStok sistem lama (Seroja, Penta, Kuta 1). Angka uang dan persen adalah bigint
// berskala empat angka di belakang koma, sama dengan kolom numeric(18,4) dan numeric(7,4); tanggal teks YYYY-MM-DD.

const one = 10n ** BigInt(quantityScale);
const hundredPercent = 100n * one;

// Satu baris grading harga obat (far_m_grading_harga). gradingGroupId kosong berarti semua barang ('ALL' sistem lama).
export type PriceGrading = {
    id: string;
    priceGroupId: string;
    gradingGroupId: string | null;
    priceFrom: bigint;
    priceTo: bigint;
    markupPercent: bigint;
    discountPercent: bigint;
    effectiveFrom: string;
};

// Banyak angka di belakang koma harga satuan obat, setelan farmasi per legal entity (far_m_parameter), padanan
// Unit-Amount Rounding Precision BC. Sistem lama: Kuta 1 dan Penta 0 (round(@HargaObat, 0)), Seroja 4 (money tanpa
// round).
export const unitPriceDecimalOptions = [0, 1, 2, 3, 4] as const;
export type UnitPriceDecimals = (typeof unitPriceDecimalOptions)[number];

// basePrice per satuan dasar barang; quantityPerUnit isi satuan baris dalam satuan dasar. priceGroupId kosong berarti
// pembeli tanpa kelompok harga.
export type DrugPriceInput = {
    basePrice: bigint;
    priceGroupId: string | null;
    gradingGroupId: string | null;
    date: string;
    quantityPerUnit: bigint;
    unitPriceDecimals: UnitPriceDecimals;
};

// unitPrice per satuan baris, sudah dibulatkan ke unitPriceDecimals. Diskon tidak mengurangi unitPrice; ia disimpan
// terpisah di baris.
export type DrugPrice = {
    gradingId: string | null;
    markupPercent: bigint;
    unitPrice: bigint;
    discountPercent: bigint;
};

// Urutan sistem lama: baris kelompok grading obat itu lebih dulu, lalu baris semua barang, lalu tidak ada (0 %). Baris
// cocok bila kelompok harganya kelompok pembeli, sudah berlaku pada tanggal itu, dan harga dasar ada di rentangnya
// (kedua batas termasuk); di antara yang cocok, berlaku_mulai terakhir. Layanan grading menolak rentang yang bertumpuk
// pada kunci yang sama, jadi pilihan itu tunggal.
export function applicableGrading(
    gradings: readonly PriceGrading[],
    input: Omit<DrugPriceInput, 'quantityPerUnit' | 'unitPriceDecimals'>,
): PriceGrading | null {
    const { priceGroupId, basePrice, date } = input;
    if (priceGroupId === null) return null;
    const latest = (gradingGroupId: string | null) => {
        let found: PriceGrading | null = null;
        for (const grading of gradings)
            if (
                grading.priceGroupId === priceGroupId &&
                grading.gradingGroupId === gradingGroupId &&
                grading.effectiveFrom <= date &&
                grading.priceFrom <= basePrice &&
                basePrice <= grading.priceTo &&
                (found === null || grading.effectiveFrom > found.effectiveFrom)
            )
                found = grading;
        return found;
    };
    return (
        (input.gradingGroupId === null ? null : latest(input.gradingGroupId)) ??
        latest(null)
    );
}

// Harga per satuan baris = harga dasar x (1 + % naik / 100) x isi satuan, dibulatkan ke unitPriceDecimals angka di
// belakang koma setengah menjauhi nol (round(money, 0) T-SQL untuk 0) sesudah dikali isi satuan, urutan
// ConvertAmountByUnitOfMeasure BC. Sistem lama membulatkan per satuan stok, tetapi tidak pernah menjual dalam satuan
// lain; strip berisi 10 di sini satu pembulatan, bukan sepuluh.
export function drugPrice(
    gradings: readonly PriceGrading[],
    input: DrugPriceInput,
): DrugPrice {
    const grading = applicableGrading(gradings, input);
    const markupPercent = grading?.markupPercent ?? 0n;
    const exact =
        input.basePrice *
        (hundredPercent + markupPercent) *
        input.quantityPerUnit;
    const step = 10n ** BigInt(quantityScale - input.unitPriceDecimals);
    const divisor = hundredPercent * one * step;
    return {
        gradingId: grading?.id ?? null,
        markupPercent,
        unitPrice: ((exact + divisor / 2n) / divisor) * step,
        discountPercent: grading?.discountPercent ?? 0n,
    };
}
