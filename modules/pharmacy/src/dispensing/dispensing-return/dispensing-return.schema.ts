import { z } from 'zod';

// Retur satu penyerahan: alasan, lalu jumlah yang kembali per baris obat dan batch yang diserahkan, dalam satuan yang
// dipilih (kosong berarti satuan saat diserahkan). Baris berjumlah 0 dilewati.
export const returnInputSchema = z.object({
    reason: z.string(),
    lines: z
        .array(
            z.object({
                dispensing_line_id: z.string(),
                batch_id: z.string().nullable(),
                quantity: z.union([z.string(), z.number()]),
                unit_id: z.string().nullable().optional(),
            }),
        )
        .max(200),
});

export const returnReverseInputSchema = z.object({ version: z.number() });
