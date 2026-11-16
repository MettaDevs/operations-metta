import { z } from 'zod';

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

// Satu lokasi stok yang boleh menjual obat bebas. price_group kosong berarti harga dasar.
export const otcSaleLocationRowSchema = z.object({
    id: z.string(),
    location: reference,
    price_group: reference.nullable(),
    version: z.number(),
});

export const otcSaleLocationInputSchema = z.object({
    location_id: z.string(),
    price_group_id: z.string().nullable().optional(),
    version: z.number().optional(),
});

export const priceGroupRowSchema = reference;
