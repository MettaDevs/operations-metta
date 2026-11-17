import { z } from 'zod';
import { listParametersSchema } from '../../../platform/http/index.ts';

export const warehouseEmployeeRowSchema = z.object({
    id: z.string(),
    location: z.object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        restricted_to_employees: z.boolean(),
    }),
    user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
    is_default: z.boolean(),
    version: z.number(),
});

export const warehouseEmployeeListQuerySchema = listParametersSchema.extend({
    location_id: z.string().optional(),
});

export const employeeUserRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
});

export const warehouseEmployeeInputSchema = z.object({
    location_id: z.string(),
    user_id: z.string(),
    is_default: z.boolean().optional(),
    version: z.number().optional(),
});
