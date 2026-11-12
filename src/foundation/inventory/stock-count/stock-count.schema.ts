import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

// Opname (Physical Inventory Order di BC): draf disusun dan dihitung, hitungan diselesaikan, lalu selisihnya diposting.
// Opname yang tidak jadi dibatalkan; opname yang sudah diposting dibatalkan postingnya.
export const stockCountStatuses = [
    'draf',
    'dihitung',
    'diposting',
    'dibatalkan',
] as const;

// Satu opname paling banyak sekian baris, termasuk hasil Hitung baris. Hitungan penuh yang lebih besar dipecah per
// kategori.
export const stockCountMaxLines = 1000;

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});
const amount = z.union([z.number(), z.string()]);
const batch = z
    .object({
        id: z.string(),
        batch_number: z.string(),
        expiry_date: z.string().nullable(),
    })
    .nullable();
const item = reference.extend({
    base_unit: z.string(),
    batch_required: z.boolean(),
    expiry_required: z.boolean(),
});

// Baris menunjuk batch yang sudah tercatat lewat batch_id, atau batch temuan lewat nomor dan kedaluwarsanya. Jumlah
// dihitung dalam satuan baris; kosong berarti belum dihitung.
export const stockCountLineInputSchema = z.object({
    id: z.string().nullable().optional(),
    item_id: z.string(),
    batch_id: z.string().nullable().optional(),
    batch_number: z.string().nullable().optional(),
    expiry_date: z.string().nullable().optional(),
    unit_id: z.string(),
    quantity_counted: amount.nullable().optional(),
    description: z.string().nullable().optional(),
});

export const stockCountInputSchema = z.object({
    location_id: z.string(),
    count_date: z.string(),
    posting_date: z.string(),
    description: z.string().nullable().optional(),
    lines: z.array(stockCountLineInputSchema).max(stockCountMaxLines),
    version: z.number().optional(),
});

// Saringan Hitung baris. Tanpa barang dan kategori berarti semua barang.
export const stockCountCalculationSchema = z.object({
    location_id: z.string(),
    posting_date: z.string(),
    item_ids: z.array(z.string()).max(100).optional(),
    category_id: z.string().nullable().optional(),
    only_in_stock: z.boolean().optional(),
});

export const stockCountPostingInputSchema = z.object({
    posting_date: z.string(),
    version: z.number().optional(),
});

export const stockCountRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    count_date: z.string(),
    posting_date: z.string(),
    status: z.enum(stockCountStatuses),
    location: reference,
    description: z.string().nullable(),
    line_count: z.number(),
    count_started_at: z.string().nullable(),
    counted_at: z.string().nullable(),
    posted_at: z.string().nullable(),
    cancelled_at: z.string().nullable(),
    version: z.number(),
});

// Jumlah tercatat, jumlah tercatat saat posting, dan jumlah dihitung dasar dalam satuan dasar; jumlah dihitung dalam
// satuan baris.
export const stockCountLineRowSchema = z.object({
    id: z.string(),
    line_no: z.number(),
    item,
    batch,
    batch_number: z.string().nullable(),
    expiry_date: z.string().nullable(),
    unit: reference,
    quantity_per_unit: z.string(),
    quantity_expected: z.string(),
    quantity_counted: z.string().nullable(),
    quantity_counted_base: z.string().nullable(),
    quantity_expected_at_posting: z.string().nullable(),
    moved_after_count_started: z.boolean().nullable(),
    description: z.string().nullable(),
});

// Satu posisi stok hasil Hitung baris: barang dan batch di lokasi itu, dalam satuan dasar.
export const stockCountPositionSchema = z.object({
    item: item.extend({ base_unit_id: z.string() }),
    batch,
    quantity: z.string(),
});

// Selisih yang akan diposting bila opname diposting sekarang, dalam satuan dasar. Harga satuan hanya untuk selisih
// lebih, yaitu harga stok temuan.
export const stockCountPreviewLineSchema = z.object({
    id: z.string(),
    quantity_expected: z.string(),
    quantity_counted: z.string(),
    difference: z.string(),
    unit_cost: z.string().nullable(),
    moved_after_count_started: z.boolean(),
});

export const stockCountListQuerySchema = listParametersSchema.extend({
    status: z.enum(stockCountStatuses).optional(),
});

export const stockCountPreviewQuerySchema = z.object({
    posting_date: z.string(),
});
