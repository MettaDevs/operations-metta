import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

// Satuan barang (Item Units of Measure di BC): satuan dasar dengan isi 1, lalu satuan kemasan. `id` adalah id satuan,
// unik di dalam satu barang; `entry_id` adalah baris satuan kemasan dan kosong untuk satuan dasar.
export const itemUnitRowSchema = z.object({
    id: z.string(),
    entry_id: z.string().nullable(),
    item_id: z.string(),
    code: z.string(),
    name: z.string(),
    quantity_per_unit: z.string(),
    is_base: z.boolean(),
    version: z.number(),
});

export const itemUnitListQuerySchema = listParametersSchema.extend({
    item_id: z.string(),
});

export const itemUnitInputSchema = z.object({
    item_id: z.string(),
    unit_id: z.string(),
    quantity_per_unit: z.union([z.number(), z.string()]),
    version: z.number().optional(),
});
