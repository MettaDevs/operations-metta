import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';
import { paymentTermsReferenceSchema } from '../payment-terms/payment-terms.schema.ts';

export const vendorStatuses = ['active', 'inactive'] as const;

// Vendor per legal entity. Nama vendor adalah nama party organisasinya di buku alamat.
export const vendorRowSchema = z.object({
    id: z.string(),
    number: z.string(),
    name: z.string(),
    tax_number: z.string().nullable(),
    status: z.enum(vendorStatuses),
    // Payment Terms Code di kartu vendor BC, disalin ke purchase order dan faktur baru.
    payment_terms: paymentTermsReferenceSchema,
    version: z.number(),
});

export const vendorListQuerySchema = listParametersSchema.extend({
    status: z.enum(vendorStatuses).optional(),
});

export const vendorInputSchema = z.object({
    name: z.string(),
    tax_number: z.string().nullable().optional(),
    status: z.enum(vendorStatuses).optional(),
    payment_terms_id: z.string().nullable().optional(),
    version: z.number().optional(),
});
