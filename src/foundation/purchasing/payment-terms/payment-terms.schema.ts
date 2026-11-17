import { z } from 'zod';

// Payment Terms di BC: kode, keterangan, dan jumlah hari dari tanggal faktur vendor sampai jatuh tempo.
export const paymentTermsRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    due_days: z.number(),
    version: z.number(),
});

export const paymentTermsInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    due_days: z.union([z.number(), z.string()]),
    version: z.number().optional(),
});

export const paymentTermsReferenceSchema = z
    .object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        due_days: z.number(),
    })
    .nullable();
