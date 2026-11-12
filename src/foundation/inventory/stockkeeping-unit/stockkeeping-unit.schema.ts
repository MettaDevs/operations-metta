import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

// Stok minimum dan maksimum satu barang di satu lokasi (Stockkeeping Unit di BC). Kosong berarti tidak ditetapkan.
export const stockkeepingUnitRowSchema = z.object({
    id: z.string(),
    item_id: z.string(),
    location: reference,
    minimum_quantity: z.string().nullable(),
    maximum_quantity: z.string().nullable(),
    version: z.number(),
});

export const stockkeepingUnitListQuerySchema = listParametersSchema.extend({
    item_id: z.string(),
});

const quantity = z.union([z.number(), z.string()]).nullable().optional();

export const stockkeepingUnitInputSchema = z.object({
    item_id: z.string(),
    location_id: z.string(),
    minimum_quantity: quantity,
    maximum_quantity: quantity,
    version: z.number().optional(),
});
