import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

export const receiptStatuses = ['draf', 'diposting', 'dibatalkan'] as const;

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});
const amount = z.union([z.number(), z.string()]);

// Jumlah dan harga satuan dalam satuan baris (misalnya kotak); kartu gudang menerima jumlah dalam satuan dasar.
export const receiptLineInputSchema = z.object({
    id: z.string().nullable().optional(),
    item_id: z.string(),
    // Kosong berarti satuan beli barang.
    unit_id: z.string().nullable().optional(),
    quantity: amount,
    unit_cost: amount,
    discount_percent: amount.nullable().optional(),
    batch_number: z.string().nullable().optional(),
    expiry_date: z.string().nullable().optional(),
    funding_source_id: z.string().nullable().optional(),
    procurement_program_id: z.string().nullable().optional(),
    budget_year: z.number().nullable().optional(),
});

export const receiptInputSchema = z.object({
    vendor_id: z.string(),
    location_id: z.string(),
    posting_date: z.string(),
    vendor_document_number: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    lines: z.array(receiptLineInputSchema).max(500),
    version: z.number().optional(),
});

export const receiptLineRowSchema = z.object({
    id: z.string(),
    line_no: z.number(),
    item: reference.extend({
        base_unit: z.string(),
        batch_required: z.boolean(),
        expiry_required: z.boolean(),
    }),
    unit: reference,
    quantity_per_unit: z.string(),
    quantity: z.string(),
    unit_cost: z.string(),
    discount_percent: z.string(),
    amount: z.string(),
    batch_number: z.string().nullable(),
    expiry_date: z.string().nullable(),
    funding_source: reference.nullable(),
    procurement_program: reference.nullable(),
    budget_year: z.number().nullable(),
});

export const receiptRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    posting_date: z.string(),
    status: z.enum(receiptStatuses),
    vendor: z.object({ id: z.string(), number: z.string(), name: z.string() }),
    location: reference,
    vendor_document_number: z.string().nullable(),
    description: z.string().nullable(),
    amount: z.string(),
    posted_at: z.string().nullable(),
    reversed_at: z.string().nullable(),
    version: z.number(),
});

export const receiptListQuerySchema = listParametersSchema.extend({
    status: z.enum(receiptStatuses).optional(),
});
