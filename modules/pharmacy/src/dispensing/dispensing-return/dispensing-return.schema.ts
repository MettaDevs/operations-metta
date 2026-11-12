import { z } from 'zod';

// Retur satu penyerahan: alasan, lalu jumlah yang kembali per baris obat dan batch yang diserahkan. Baris berjumlah 0
// dilewati.
export const returnInputSchema = z.object({
    reason: z.string(),
    lines: z
        .array(
            z.object({
                dispensing_line_id: z.string(),
                batch_id: z.string().nullable(),
                quantity: z.union([z.string(), z.number()]),
            }),
        )
        .max(200),
});

export const returnReverseInputSchema = z.object({ version: z.number() });
