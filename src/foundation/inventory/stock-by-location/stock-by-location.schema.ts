import { z } from 'zod';

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

// Saringan kedaluwarsa memakai tanggal per (as_of): expired berarti kedaluwarsa sebelum tanggal itu, expiring berarti
// kedaluwarsa dari tanggal itu sampai `days` hari sesudahnya. Baris tanpa tanggal kedaluwarsa tidak ikut keduanya.
export const expiryFilters = ['expiring', 'expired'] as const;

export const stockByLocationQuerySchema = z.object({
    as_of: z.string(),
    location_id: z.string().optional(),
    category_id: z.string().optional(),
    item_id: z.string().optional(),
    expiry: z.enum(expiryFilters).optional(),
    days: z.string().optional(),
});

// Stok per tanggal, satu kelompok per barang dengan totalnya, lalu baris per lokasi dan batch. Jumlah dalam satuan
// dasar; nilai adalah harga pokok stok itu.
export const stockByLocationLineSchema = z.object({
    location: reference,
    batch: z
        .object({
            id: z.string(),
            batch_number: z.string(),
            expiry_date: z.string().nullable(),
        })
        .nullable(),
    quantity: z.string(),
    value: z.string(),
});

export const stockByLocationSchema = z.object({
    items: z.array(
        z.object({
            item: reference.extend({ unit: z.string() }),
            quantity: z.string(),
            value: z.string(),
            lines: z.array(stockByLocationLineSchema),
        }),
    ),
});
