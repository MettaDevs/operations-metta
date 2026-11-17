import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

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
    bank: z.string().nullable().optional(),
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

export const paymentMethodChoiceSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

export const vendorPaymentRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    status: z.enum(vendorPaymentStatuses),
    vendor: z.object({ id: z.string(), number: z.string(), name: z.string() }),
    posting_date: z.string(),
    payment_method: paymentMethodChoiceSchema,
    bank: z.string().nullable(),
    reference: z.string().nullable(),
    description: z.string().nullable(),
    amount: z.string(),
    posted_at: z.string().nullable(),
    reversed_at: z.string().nullable(),
    version: z.number(),
});

// Entri faktur yang dibayar baris ini, dengan sisanya sekarang. Sesudah posting, sisa itu sudah dikurangi baris ini.
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
    // Pembayaran yang sedang diubah: barisnya sendiri tidak mengurangi sisa.
    payment_id: z.string().optional(),
});

// Entri faktur yang masih terbuka untuk Ambil utang terbuka (Apply Entries). on_drafts = jumlah di draf pembayaran lain;
// open = sisa dikurangi on_drafts, bawaan jumlah baris yang diambil.
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
