import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

export const vendorLedgerEntrySchema = z.object({
    id: z.string(),
    kind: z.enum([
        'faktur',
        'pembatalan',
        'pembayaran',
        'pembatalan_pembayaran',
        'nota_kredit',
        'pembatalan_nota_kredit',
    ]),
    vendor: z.object({ id: z.string(), number: z.string(), name: z.string() }),
    invoice_id: z.string().nullable(),
    payment_id: z.string().nullable(),
    credit_memo_id: z.string().nullable(),
    document_number: z.string(),
    vendor_document_number: z.string().nullable(),
    posting_date: z.string(),
    due_date: z.string(),
    amount: z.string(),
    remaining: z.string(),
    payments: z.array(
        z.object({ id: z.string(), number: z.string(), amount: z.string() }),
    ),
    paid: z.string(),
    open: z.boolean(),
    // Entri nota kredit yang sedang mengurangi utang faktur, untuk Lepas dari faktur.
    applied_to_invoice: z.boolean(),
    // Hari lewat jatuh tempo per hari ini; 0 atau kurang berarti belum jatuh tempo.
    days_overdue: z.number(),
});

export const vendorLedgerQuerySchema = listParametersSchema.extend({
    vendor_id: z.string().optional(),
    // 1 berarti termasuk entri yang sudah ditutup.
    all: z.literal('1').optional(),
});
