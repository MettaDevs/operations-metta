import { z } from 'zod';

// Setelan kasir per legal entity (parameter_kasir). clerk_required: pembayaran ditolak sebelum kasir Clerk Start.
export const billingSetupRowSchema = z.object({
    clerk_required: z.boolean(),
    version: z.number(),
});

export const billingSetupInputSchema = billingSetupRowSchema;
