import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

export const vendorLedgerEntrySchema = z.object({
    id: z.string(),
    kind: z.enum([
        'faktur',
        'pembatalan',
        'pembayaran',
        'pembatalan_pembayaran',
    ]),
    vendor: z.object({ id: z.string(), number: z.string(), name: z.string() }),
    // Entri faktur dan pembatalannya merujuk faktur; entri pembayaran dan pembatalannya merujuk pembayaran.
    invoice_id: z.string().nullable(),
    payment_id: z.string().nullable(),
    document_number: z.string(),
    vendor_invoice_number: z.string().nullable(),
    posting_date: z.string(),
    due_date: z.string(),
    amount: z.string(),
    remaining: z.string(),
    // Pembayaran diposting yang membayar entri faktur ini, dari yang paling awal; kosong untuk entri lain.
    payments: z.array(
        z.object({ id: z.string(), number: z.string(), amount: z.string() }),
    ),
    paid: z.string(),
    open: z.boolean(),
    // Hari lewat jatuh tempo per hari ini; 0 atau kurang berarti belum jatuh tempo.
    days_overdue: z.number(),
});

export const vendorLedgerQuerySchema = listParametersSchema.extend({
    vendor_id: z.string().optional(),
    // 1 berarti termasuk entri yang sudah ditutup.
    all: z.literal('1').optional(),
});
