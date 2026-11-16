import { z } from 'zod';

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

// racik: biaya per racikan (BiayaRacikObat sistem lama). resep: biaya per baris obat bukan racikan (BiayaResepObat).
export const feeKindSchema = z.enum(['racik', 'resep']);
export type FeeKind = z.infer<typeof feeKindSchema>;

// Satu nilai biaya. location dan price_group kosong berarti berlaku untuk semua lokasi atau semua kelompok harga.
export const dispensingFeeRowSchema = z.object({
    id: z.string(),
    kind: feeKindSchema,
    location: reference.nullable(),
    price_group: reference.nullable(),
    amount: z.string(),
    version: z.number(),
});

export const dispensingFeeInputSchema = z.object({
    kind: z.string(),
    location_id: z.string().nullable().optional(),
    price_group_id: z.string().nullable().optional(),
    amount: z.union([z.string(), z.number()]),
    version: z.number().optional(),
});

// Biaya yang ditagih untuk satu penyerahan atau penjualan, dalam bentuk baris tagihan kasir: Qty 1, Nilai amount.
export const billedFeeSchema = z.object({
    id: z.string(),
    kind: feeKindSchema,
    setup_id: z.string(),
    name: z.string(),
    amount: z.string(),
});
export type BilledFee = z.infer<typeof billedFeeSchema>;
