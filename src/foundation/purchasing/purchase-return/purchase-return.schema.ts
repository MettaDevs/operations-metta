import { z } from 'zod';

export const purchaseReturnStatuses = ['diposting', 'dibatalkan'] as const;

// Retur satu penerimaan: tanggal, alasan, lalu jumlah yang dikembalikan per baris penerimaan dalam satuan yang dipilih
// (kosong berarti satuan baris penerimaan). Baris berjumlah 0 dilewati.
export const purchaseReturnInputSchema = z.object({
    posting_date: z.string(),
    reason: z.string(),
    lines: z
        .array(
            z.object({
                receipt_line_id: z.string(),
                quantity: z.union([z.string(), z.number()]),
                unit_id: z.string().nullable().optional(),
            }),
        )
        .max(500),
});

export const purchaseReturnReverseInputSchema = z.object({
    version: z.number(),
});
