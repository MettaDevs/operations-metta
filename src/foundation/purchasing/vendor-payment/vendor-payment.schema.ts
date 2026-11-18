import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';
import { bankAccountReferenceSchema } from '../../bank/index.ts';

export const vendorPaymentStatuses = [
    'draf',
    'diposting',
    'dibatalkan',
] as const;

const amount = z.union([z.number(), z.string()]);

export const vendorPaymentInputSchema = z.object({
    vendor_id: z.string(),
    posting_date: z.string(),
    payment_method_id: z.string(),
    bank_account_id: z.string().nullable().optional(),
    reference: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    lines: z
        .array(
            z.object({
                id: z.string().nullable().optional(),
                entry_id: z.string(),
                amount,
            }),
        )
        .max(500),
    version: z.number().optional(),
});

// cash: jenis bayar berperilaku tunai, yang uangnya tidak keluar dari rekening bank.
export const paymentMethodChoiceSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    cash: z.boolean(),
});

export const vendorPaymentRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    status: z.enum(vendorPaymentStatuses),
    vendor: z.object({ id: z.string(), number: z.string(), name: z.string() }),
    posting_date: z.string(),
    payment_method: paymentMethodChoiceSchema,
    bank_account: bankAccountReferenceSchema,
    // Teks bank pembayaran yang dicatat sebelum ada master rekening bank.
    bank: z.string().nullable(),
    reference: z.string().nullable(),
    description: z.string().nullable(),
    amount: z.string(),
    posted_at: z.string().nullable(),
    reversed_at: z.string().nullable(),
    version: z.number(),
});

export const vendorPaymentLineRowSchema = z.object({
    id: z.string(),
    line_no: z.number(),
    entry_id: z.string(),
    invoice_id: z.string(),
    document_number: z.string(),
    vendor_invoice_number: z.string(),
    entry_posting_date: z.string(),
    due_date: z.string(),
    entry_amount: z.string(),
    remaining: z.string(),
    amount: z.string(),
});

export const vendorPaymentListQuerySchema = listParametersSchema.extend({
    status: z.enum(vendorPaymentStatuses).optional(),
});

export const openEntriesQuerySchema = z.object({
    vendor_id: z.string(),
    payment_id: z.string().optional(),
});

// Apply Entries.
export const openEntryChoiceSchema = z.object({
    entry_id: z.string(),
    invoice_id: z.string(),
    document_number: z.string(),
    vendor_invoice_number: z.string(),
    posting_date: z.string(),
    due_date: z.string(),
    amount: z.string(),
    remaining: z.string(),
    on_drafts: z.string(),
    open: z.string(),
});
