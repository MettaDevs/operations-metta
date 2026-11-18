import { z } from 'zod';

// Bank Account BC. currency_code null berarti mata uang lokal, seperti Currency Code kosong di BC.
export const bankAccountRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    bank_name: z.string(),
    account_number: z.string(),
    currency_code: z.string().nullable(),
    blocked: z.boolean(),
    version: z.number(),
});

export const bankAccountInputSchema = z.object({
    code: z.string(),
    name: z.string(),
    bank_name: z.string(),
    account_number: z.string(),
    currency_code: z.string().nullable().optional(),
    blocked: z.boolean().optional(),
    version: z.number().optional(),
});

export const bankAccountReferenceSchema = z
    .object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        bank_name: z.string(),
        account_number: z.string(),
    })
    .nullable();
