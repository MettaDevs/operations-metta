import { z } from 'zod';

export const trackingCodeRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    batch_required: z.boolean(),
    expiry_required: z.boolean(),
    strict_expiry: z.boolean(),
    version: z.number(),
});

export const trackingCodeInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    batch_required: z.boolean().optional(),
    expiry_required: z.boolean().optional(),
    strict_expiry: z.boolean().optional(),
    version: z.number().optional(),
});
