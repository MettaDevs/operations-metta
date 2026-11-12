import { z } from 'zod';

export const codeListRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    version: z.number(),
});

export const codeListInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    version: z.number().optional(),
});
