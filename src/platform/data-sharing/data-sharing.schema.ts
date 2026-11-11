import { z } from 'zod';
import { listParametersSchema } from '../http/index.ts';

// Kebijakan data sharing antar legal entity, pola cross-company data sharing F&O: legal entity yang dipilih
// saling melihat satu jenis data, sejak tanggal berlaku dan selama kebijakan aktif.
export const dataSharingPolicyRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    data_type: z.object({ code: z.string(), name: z.string() }),
    is_active: z.boolean(),
    effective_from: z.string(),
    legal_entities: z.array(z.object({ id: z.string(), name: z.string() })),
    version: z.number(),
});

export const dataSharingPolicyListQuerySchema = listParametersSchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
    data_type: z.string().optional(),
});

export const dataSharingPolicyInputSchema = z.object({
    name: z.string(),
    data_type_code: z.string(),
    is_active: z.boolean().optional(),
    effective_from: z.string().nullable(),
    legal_entity_ids: z.array(z.string()),
    version: z.number().optional(),
});

// Jenis data yang boleh di-share tenant ini: didaftarkan module pemiliknya, hanya bila module itu terpasang.
export const dataSharingTypeSchema = z.object({
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
});

// Legal entity tenant untuk pilihan kebijakan, beserta kebijakan aktif yang sudah ia ikuti untuk jenis data yang
// sedang dipilih.
export const dataSharingLegalEntitySchema = z.object({
    id: z.string(),
    name: z.string(),
    company_code: z.string().nullable(),
    policy_id: z.string().nullable(),
    policy_name: z.string().nullable(),
});
