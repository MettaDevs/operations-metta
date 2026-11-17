import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

// Open dan Released di Purchase Header BC.
export const purchaseOrderStatuses = ['terbuka', 'dirilis'] as const;

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});
const amount = z.union([z.number(), z.string()]);

export const purchaseOrderLineInputSchema = z.object({
    id: z.string().nullable().optional(),
    item_id: z.string(),
    // Kosong berarti satuan beli barang.
    unit_id: z.string().nullable().optional(),
    quantity: amount,
    unit_cost: amount,
    discount_percent: amount.nullable().optional(),
    vat_percent: amount.nullable().optional(),
    // Kosong berarti tanggal diharapkan di kepala order.
    expected_receipt_date: z.string().nullable().optional(),
});

export const purchaseOrderInputSchema = z.object({
    vendor_id: z.string(),
    location_id: z.string(),
    order_date: z.string(),
    expected_receipt_date: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    prices_including_vat: z.boolean().optional(),
    lines: z.array(purchaseOrderLineInputSchema).max(500),
    version: z.number().optional(),
});

export const purchaseOrderLineRowSchema = z.object({
    id: z.string(),
    line_no: z.number(),
    item: reference.extend({ base_unit: z.string() }),
    unit: reference,
    quantity_per_unit: z.string(),
    quantity: z.string(),
    unit_cost: z.string(),
    discount_percent: z.string(),
    vat_percent: z.string(),
    amount: z.string(),
    expected_receipt_date: z.string().nullable(),
});

export const purchaseOrderRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    order_date: z.string(),
    expected_receipt_date: z.string().nullable(),
    status: z.enum(purchaseOrderStatuses),
    vendor: z.object({ id: z.string(), number: z.string(), name: z.string() }),
    location: reference,
    description: z.string().nullable(),
    prices_including_vat: z.boolean(),
    amount: z.string(),
    vat_amount: z.string(),
    released_at: z.string().nullable(),
    version: z.number(),
});

export const purchaseOrderListQuerySchema = listParametersSchema.extend({
    status: z.enum(purchaseOrderStatuses).optional(),
});
