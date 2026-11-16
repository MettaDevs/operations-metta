import { z } from 'zod';

const amount = z.union([z.string(), z.number()]);

// price_group_id yang tidak dikirim berarti kelompok harga bawaan lokasi; null berarti harga dasar. ktp_patient adalah
// Patient KTP pembeli untuk grading harga obat; buku alamat Core tidak menyimpan KTP, jadi diisi per penjualan.
const saleBase = {
    location_id: z.string(),
    price_group_id: z.string().nullable().optional(),
    ktp_patient: z.boolean().optional(),
};

export const otcSaleQuoteInputSchema = z.object({
    ...saleBase,
    lines: z
        .array(
            z.object({
                item_id: z.string(),
                unit_id: z.string(),
                quantity: amount,
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
            }),
        )
        .min(1)
        .max(200),
    expected_total: amount,
    payment: z.unknown(),
});
