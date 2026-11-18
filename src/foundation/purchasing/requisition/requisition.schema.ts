import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

export const requisitionStatuses = ['terbuka', 'diproses'] as const;

const reference = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});
const amount = z.union([z.number(), z.string()]);

export const requisitionInputSchema = z.object({
    location_id: z.string(),
    item_id: z.string(),
    unit_id: z.string().nullable().optional(),
    quantity: amount,
    request_date: z.string().optional(),
    due_date: z.string(),
    description: z.string().nullable().optional(),
    vendor_id: z.string().nullable().optional(),
    unit_cost: amount.nullable().optional(),
    accepted: z.boolean().optional(),
    version: z.number().optional(),
});

export const carryOutInputSchema = z.object({ order_date: z.string() });

export const calculatePlanInputSchema = z.object({ due_date: z.string() });

export const requisitionRowSchema = z.object({
    id: z.string(),
    location: reference,
    item: reference.extend({ base_unit: z.string() }),
    unit: reference,
    quantity_per_unit: z.string(),
    quantity: z.string(),
    request_date: z.string(),
    due_date: z.string(),
    description: z.string().nullable(),
    requested_by: z.string().nullable(),
    vendor: z
        .object({ id: z.string(), number: z.string(), name: z.string() })
        .nullable(),
    unit_cost: z.string().nullable(),
    accepted: z.boolean(),
    suggested: z.boolean(),
    order: z.object({ id: z.string(), number: z.string() }).nullable(),
    transfer_from_location: reference.nullable(),
    transfer_order: z.object({ id: z.string(), number: z.string() }).nullable(),
    version: z.number(),
});

export const requisitionListQuerySchema = listParametersSchema.extend({
    status: z.enum(requisitionStatuses).optional(),
});
