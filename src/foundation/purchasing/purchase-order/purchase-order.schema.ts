import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';
import { paymentTermsReferenceSchema } from '../payment-terms/payment-terms.schema.ts';

export const purchaseOrderStatuses = ['terbuka', 'dirilis', 'selesai'] as const;

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});
const amount = z.union([z.number(), z.string()]);

export const purchaseOrderLineInputSchema = z.object({
    id: z.string().nullable().optional(),
    item_id: z.string(),
    unit_id: z.string().nullable().optional(),
    quantity: amount,
    unit_cost: amount,
    discount_percent: amount.nullable().optional(),
    vat_percent: amount.nullable().optional(),
    expected_receipt_date: z.string().nullable().optional(),
});

export const purchaseOrderInputSchema = z.object({
    vendor_id: z.string(),
    location_id: z.string(),
    order_date: z.string(),
    expected_receipt_date: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    prices_including_vat: z.boolean().optional(),
    // Tidak dikirim berarti termin bawaan vendor saat order dibuat, atau termin yang sudah ada saat order diubah.
    payment_terms_id: z.string().nullable().optional(),
    lines: z.array(purchaseOrderLineInputSchema).max(500),
    version: z.number().optional(),
});

export const purchaseOrderLineRowSchema = z.object({
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
    vat_percent: z.string(),
    amount: z.string(),
    expected_receipt_date: z.string().nullable(),
    quantity_received: z.string(),
    quantity_invoiced: z.string(),
    outstanding_quantity: z.string(),
});

// Post Receive, Invoice, atau Receive and Invoice dari purchase order BC (PostingSelectionManagement).
export const purchaseOrderPostModes = [
    'receive',
    'invoice',
    'receive_and_invoice',
] as const;

// Qty. to Receive, Qty. to Invoice, dan Item Tracking Lines satu lot per baris, dikirim saat posting.
export const purchaseOrderPostInputSchema = z.object({
    mode: z.enum(purchaseOrderPostModes),
    posting_date: z.string(),
    vendor_invoice_number: z.string().nullable().optional(),
    lines: z
        .array(
            z.object({
                id: z.string(),
                quantity_to_receive: amount.nullable().optional(),
                quantity_to_invoice: amount.nullable().optional(),
                batch_number: z.string().nullable().optional(),
                expiry_date: z.string().nullable().optional(),
            }),
        )
        .max(500),
    version: z.number(),
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
    payment_terms: paymentTermsReferenceSchema,
    amount: z.string(),
    vat_amount: z.string(),
    released_at: z.string().nullable(),
    version: z.number(),
});

export const purchaseOrderListQuerySchema = listParametersSchema.extend({
    status: z.enum(purchaseOrderStatuses).optional(),
});
