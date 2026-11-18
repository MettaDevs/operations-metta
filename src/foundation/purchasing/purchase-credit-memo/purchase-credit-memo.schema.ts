import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

export const purchaseCreditMemoStatuses = [
    'draf',
    'diposting',
    'dibatalkan',
] as const;

// Baris retur (Get Return Shipment Lines) atau potongan harga atas baris faktur tanpa barang yang kembali.
export const purchaseCreditMemoLineKinds = ['retur', 'potongan'] as const;

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});
const amount = z.union([z.number(), z.string()]);

const priced = {
    id: z.string().nullable().optional(),
    quantity: amount,
    unit_cost: amount,
    discount_percent: amount.nullable().optional(),
    vat_percent: amount.nullable().optional(),
};

export const purchaseCreditMemoLineInputSchema = z.discriminatedUnion('kind', [
    z.object({
        ...priced,
        kind: z.literal('retur'),
        return_line_id: z.string(),
    }),
    z.object({
        ...priced,
        kind: z.literal('potongan'),
        invoice_line_id: z.string(),
        description: z.string(),
    }),
]);

export const purchaseCreditMemoInputSchema = z.object({
    vendor_id: z.string(),
    vendor_credit_memo_number: z.string(),
    document_date: z.string(),
    posting_date: z.string(),
    // Applies-to Doc. No.: entri faktur vendor yang sama yang dikurangi saat posting.
    applies_to_entry_id: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    lines: z.array(purchaseCreditMemoLineInputSchema).max(500),
    version: z.number().optional(),
});

const documentReference = z.object({ id: z.string(), number: z.string() });

export const purchaseCreditMemoLineRowSchema = z.object({
    id: z.string(),
    line_no: z.number(),
    kind: z.enum(purchaseCreditMemoLineKinds),
    description: z.string().nullable(),
    return_line_id: z.string().nullable(),
    return: documentReference.nullable(),
    invoice_line_id: z.string().nullable(),
    invoice: documentReference.nullable(),
    item: reference.nullable(),
    unit: reference.nullable(),
    quantity: z.string(),
    unit_cost: z.string(),
    discount_percent: z.string(),
    vat_percent: z.string(),
    amount: z.string(),
});

export const appliesToEntrySchema = z
    .object({
        id: z.string(),
        document_number: z.string(),
        vendor_invoice_number: z.string(),
        invoice_id: z.string(),
        // Kosong untuk nota yang kreditnya sudah dipakai pembayaran sebelum jumlah ini dicatat.
        amount: z.string().nullable(),
        unapplied_date: z.string().nullable(),
    })
    .nullable();

export const purchaseCreditMemoRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    status: z.enum(purchaseCreditMemoStatuses),
    vendor: z.object({ id: z.string(), number: z.string(), name: z.string() }),
    vendor_credit_memo_number: z.string(),
    document_date: z.string(),
    posting_date: z.string(),
    applies_to: appliesToEntrySchema,
    description: z.string().nullable(),
    amount: z.string(),
    vat_amount: z.string(),
    remaining: z.string().nullable(),
    posted_at: z.string().nullable(),
    reversed_at: z.string().nullable(),
    version: z.number(),
});

export const purchaseCreditMemoListQuerySchema = listParametersSchema.extend({
    status: z.enum(purchaseCreditMemoStatuses).optional(),
});

export const creditSourceQuerySchema = z.object({
    vendor_id: z.string(),
    credit_memo_id: z.string().optional(),
});

// Baris retur diposting yang belum selesai dikreditkan (Return Qty. Shipped Not Invd. <> 0), untuk Ambil baris retur.
export const returnLineChoiceSchema = z.object({
    return_line_id: z.string(),
    return: z.object({
        id: z.string(),
        number: z.string(),
        posting_date: z.string(),
    }),
    receipt: documentReference,
    item: reference,
    unit: reference,
    returned: z.string(),
    credited: z.string(),
    on_drafts: z.string(),
    open: z.string(),
    unit_cost: z.string(),
    discount_percent: z.string(),
    vat_percent: z.string(),
});

export const invoiceLineChoiceSchema = z.object({
    invoice_line_id: z.string(),
    invoice: z.object({
        id: z.string(),
        number: z.string(),
        vendor_invoice_number: z.string(),
        posting_date: z.string(),
    }),
    kind: z.enum(['barang', 'biaya']),
    description: z.string(),
    unit: reference.nullable(),
    quantity: z.string(),
    unit_cost: z.string(),
    discount_percent: z.string(),
    vat_percent: z.string(),
});

export const openInvoiceEntryChoiceSchema = z.object({
    entry_id: z.string(),
    invoice_id: z.string(),
    document_number: z.string(),
    vendor_invoice_number: z.string(),
    due_date: z.string(),
    remaining: z.string(),
});

export const creditMemoUnapplyInputSchema = z.object({
    posting_date: z.string(),
    version: z.number(),
});
