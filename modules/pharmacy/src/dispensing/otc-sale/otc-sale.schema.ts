import { z } from 'zod';

const amount = z.union([z.string(), z.number()]);

// price_group_id yang tidak dikirim berarti kelompok harga bawaan lokasi; null berarti harga dasar. ktp_patient adalah
// Patient KTP pembeli untuk grading harga obat; buku alamat Core tidak menyimpan KTP, jadi diisi per penjualan.
// without_prescription adalah "Tanpa Resep" sistem lama: tanpa resep dokter tidak ada biaya resep. Bawaannya true.
// price_reason berlaku untuk setiap baris yang harga, diskon, atau biaya resepnya berbeda dengan hitungan sistem.
const saleBase = {
    location_id: z.string(),
    price_group_id: z.string().nullable().optional(),
    ktp_patient: z.boolean().optional(),
    without_prescription: z.boolean().optional(),
    price_reason: z.string().nullable().optional(),
};

// Harga satuan, % diskon, dan biaya resep yang diketik pemegang izin ubah harga. Kosong berarti hitungan sistem.
const lineOverride = {
    unit_price: amount.nullable().optional(),
    discount_percent: amount.nullable().optional(),
    fee_amount: amount.nullable().optional(),
};

export const otcSaleQuoteInputSchema = z.object({
    ...saleBase,
    lines: z
        .array(
            z.object({
                item_id: z.string(),
                unit_id: z.string(),
                quantity: amount,
                ...lineOverride,
            }),
        )
        .min(1)
        .max(200),
});

// Simpan dan bayar. expected_total adalah total yang dilihat petugas dari quote; payment diteruskan apa adanya ke kasir
// Core (Simpan pembayaran), yang memeriksanya. batch_id kosong berarti diambil menurut cara pengambilan lokasi.
export const otcSaleInputSchema = z.object({
    ...saleBase,
    buyer_party_id: z.string().nullable().optional(),
    buyer_name: z.string().nullable().optional(),
    lines: z
        .array(
            z.object({
                item_id: z.string(),
                unit_id: z.string(),
                quantity: amount,
                batch_id: z.string().nullable().optional(),
                ...lineOverride,
            }),
        )
        .min(1)
        .max(200),
    expected_total: amount,
    payment: z.unknown(),
});
