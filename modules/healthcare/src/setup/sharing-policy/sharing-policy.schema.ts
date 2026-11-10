import { z } from 'zod';
import { listParametersSchema } from '@core/platform/http/index.ts';

// Kebijakan berbagi pasien antar legal entity, pola cross-company data sharing F&O: legal entity yang dipilih saling
// melihat pasien, sejak tanggal berlaku dan selama kebijakan aktif.
export const sharingPolicyRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    is_active: z.boolean(),
    effective_from: z.string(),
    legal_entities: z.array(z.object({ id: z.string(), name: z.string() })),
    version: z.number(),
});

export const sharingPolicyListQuerySchema = listParametersSchema.extend({
    status: z.enum(['active', 'inactive']).optional(),
});

export const sharingPolicyInputSchema = z.object({
    name: z.string(),
    is_active: z.boolean().optional(),
    effective_from: z.string().nullable(),
    legal_entity_ids: z.array(z.string()),
    version: z.number().optional(),
});

// Legal entity tenant untuk pilihan kebijakan, beserta kebijakan aktif yang sudah ia ikuti.
export const sharingLegalEntitySchema = z.object({
    id: z.string(),
    name: z.string(),
    company_code: z.string().nullable(),
    policy_id: z.string().nullable(),
    policy_name: z.string().nullable(),
});
