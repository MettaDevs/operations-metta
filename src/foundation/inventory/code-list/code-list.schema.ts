import { z } from 'zod';

// consumption hanya ada pada alasan penyesuaian: stok yang keluar dengan alasan itu dicatat sebagai pemakaian.
export const codeListRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    consumption: z.boolean().optional(),
    version: z.number(),
});

export const codeListInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    consumption: z.boolean().optional(),
    version: z.number().optional(),
});
