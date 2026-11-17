import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';
import { paymentTermsReferenceSchema } from '../payment-terms/payment-terms.schema.ts';

export const purchaseInvoiceStatuses = [
    'draf',
    'diposting',
    'dibatalkan',
] as const;

// Item dan G/L Account di Purchase Line BC: barang dari baris penerimaan, atau biaya lain seperti ongkos angkut.
export const purchaseInvoiceLineKinds = ['barang', 'biaya'] as const;

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});
const amount = z.union([z.number(), z.string()]);

const priced = {
    id: z.string().nullable().optional(),
    unit_cost: amount,
    discount_percent: amount.nullable().optional(),
    vat_percent: amount.nullable().optional(),
};

export const purchaseInvoiceLineInputSchema = z.discriminatedUnion('kind', [
    z.object({
        ...priced,
        kind: z.literal('barang'),
        receipt_line_id: z.string(),
        // Dalam satuan baris penerimaan.
        quantity: amount,
    }),
    z.object({
        ...priced,
        kind: z.literal('biaya'),
        description: z.string(),
    }),
]);

export const purchaseInvoiceInputSchema = z.object({
    vendor_id: z.string(),
    vendor_invoice_number: z.string(),
    document_date: z.string(),
    posting_date: z.string(),
    // Tidak dikirim berarti termin bawaan vendor saat faktur dibuat, atau termin yang sudah ada saat faktur diubah.
    payment_terms_id: z.string().nullable().optional(),
    // Kosong berarti dihitung dari tanggal faktur vendor dan termin.
    due_date: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    lines: z.array(purchaseInvoiceLineInputSchema).max(500),
    version: z.number().optional(),
});

export const purchaseInvoiceLineRowSchema = z.object({
    id: z.string(),
    line_no: z.number(),
    kind: z.enum(purchaseInvoiceLineKinds),
    description: z.string().nullable(),
    receipt_line_id: z.string().nullable(),
    receipt: z.object({ id: z.string(), number: z.string() }).nullable(),
    item: reference.nullable(),
    unit: reference.nullable(),
    quantity: z.string(),
    unit_cost: z.string(),
    discount_percent: z.string(),
    vat_percent: z.string(),
    amount: z.string(),
    // Nilai jumlah yang sama dengan harga, diskon, dan PPN penerimaan, untuk menunjukkan selisih harga faktur.
    receipt_unit_cost: z.string().nullable(),
    receipt_discount_percent: z.string().nullable(),
    receipt_vat_percent: z.string().nullable(),
    receipt_amount: z.string().nullable(),
    // Diterima dan sudah difakturkan di baris penerimaan (Quantity, Quantity Invoiced).
    received: z.string().nullable(),
    invoiced: z.string().nullable(),
});

export const purchaseInvoiceRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    status: z.enum(purchaseInvoiceStatuses),
    vendor: z.object({ id: z.string(), number: z.string(), name: z.string() }),
    vendor_invoice_number: z.string(),
    document_date: z.string(),
    posting_date: z.string(),
    due_date: z.string(),
    payment_terms: paymentTermsReferenceSchema,
    description: z.string().nullable(),
    amount: z.string(),
    vat_amount: z.string(),
    posted_at: z.string().nullable(),
    reversed_at: z.string().nullable(),
    version: z.number(),
});

export const purchaseInvoiceListQuerySchema = listParametersSchema.extend({
    status: z.enum(purchaseInvoiceStatuses).optional(),
});

export const receiptLinesQuerySchema = z.object({
    vendor_id: z.string(),
    // Faktur yang sedang diubah: barisnya sendiri tidak mengurangi sisa.
    invoice_id: z.string().optional(),
});

// Baris penerimaan yang diposting dan belum selesai difakturkan (Qty. Rcd. Not Invoiced <> 0), untuk Ambil baris
// penerimaan.
export const receiptLineChoiceSchema = z.object({
    receipt_line_id: z.string(),
    receipt: z.object({
        id: z.string(),
        number: z.string(),
        posting_date: z.string(),
        vendor_document_number: z.string().nullable(),
    }),
    location: reference,
    item: reference,
    unit: reference,
    received: z.string(),
    invoiced: z.string(),
    on_drafts: z.string(),
    open: z.string(),
    unit_cost: z.string(),
    discount_percent: z.string(),
    vat_percent: z.string(),
});
