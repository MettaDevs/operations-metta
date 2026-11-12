import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';
import { pickingMethods, transferModes } from '../item-ledger/stock-policy.ts';

// Cara pengambilan yang kosong mengikuti operating unit lalu legal entity; cara mutasi yang kosong mengikuti legal entity.
export const locationRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    operating_unit: z.object({ id: z.string(), name: z.string() }),
    is_transit: z.boolean(),
    picking_method: z.enum(pickingMethods).nullable(),
    transfer_mode: z.enum(transferModes).nullable(),
    version: z.number(),
});

export const locationListQuerySchema = listParametersSchema.extend({
    operating_unit_id: z.string().optional(),
    transit: z.enum(['true', 'false']).optional(),
});

export const operatingUnitRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    number: z.string().nullable(),
});

export const locationInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    operating_unit_id: z.string(),
    is_transit: z.boolean().optional(),
    picking_method: z.enum(pickingMethods).nullable().optional(),
    transfer_mode: z.enum(transferModes).nullable().optional(),
    version: z.number().optional(),
});
