import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

export const vendorStatuses = ['active', 'inactive'] as const;

// Vendor per legal entity. Nama vendor adalah nama party organisasinya di buku alamat.
export const vendorRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    name: z.string(),
    tax_number: z.string().nullable(),
    status: z.enum(vendorStatuses),
    version: z.number(),
});

export const vendorListQuerySchema = listParametersSchema.extend({
    status: z.enum(vendorStatuses).optional(),
});

export const vendorInputSchema = z.object({
    name: z.string(),
    tax_number: z.string().nullable().optional(),
    status: z.enum(vendorStatuses).optional(),
    version: z.number().optional(),
});
