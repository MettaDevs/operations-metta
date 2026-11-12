import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

export const adjustmentDirections = ['masuk', 'keluar'] as const;
export const adjustmentStatuses = ['draf', 'diposting', 'dibatalkan'] as const;

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});
const amount = z.union([z.number(), z.string()]);

export const adjustmentLineInputSchema = z.object({
    id: z.string().nullable().optional(),
    item_id: z.string(),
    quantity: amount,
    batch_number: z.string().nullable().optional(),
    expiry_date: z.string().nullable().optional(),
    unit_cost: amount.nullable().optional(),
    batch_id: z.string().nullable().optional(),
});

export const adjustmentInputSchema = z.object({
    direction: z.enum(adjustmentDirections),
    location_id: z.string(),
    posting_date: z.string(),
    reason_id: z.string(),
    lines: z.array(adjustmentLineInputSchema).max(500),
    version: z.number().optional(),
});

export const adjustmentLineRowSchema = z.object({
    id: z.string(),
    line_no: z.number(),
    item: reference.extend({
        unit: z.string(),
        batch_required: z.boolean(),
        expiry_required: z.boolean(),
    }),
    quantity: z.string(),
    batch_number: z.string().nullable(),
    expiry_date: z.string().nullable(),
    unit_cost: z.string().nullable(),
    batch: z
        .object({
            id: z.string(),
            batch_number: z.string(),
            expiry_date: z.string().nullable(),
        })
        .nullable(),
});

export const adjustmentRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    direction: z.enum(adjustmentDirections),
    posting_date: z.string(),
    status: z.enum(adjustmentStatuses),
    location: reference,
    reason: reference,
    posted_at: z.string().nullable(),
    reversed_at: z.string().nullable(),
    version: z.number(),
});

export const adjustmentListQuerySchema = listParametersSchema.extend({
    status: z.enum(adjustmentStatuses).optional(),
    direction: z.enum(adjustmentDirections).optional(),
});

// Baris kartu gudang yang ditulis posting dokumen ini, termasuk baris pembalik bila postingnya dibatalkan. Stok keluar
// tanpa batch terpilih menunjukkan batch yang diambil sesuai cara pengambilan.
export const adjustmentEntryRowSchema = z.object({
    id: z.string(),
    item: reference.extend({ unit: z.string() }),
    batch: z
        .object({
            id: z.string(),
            batch_number: z.string(),
            expiry_date: z.string().nullable(),
        })
        .nullable(),
    quantity: z.string(),
    cost_amount: z.string(),
    reversed_entry_id: z.string().nullable(),
});
