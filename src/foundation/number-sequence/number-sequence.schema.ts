import { z } from 'zod';

// Scope sebuah number sequence, mengikuti Dynamics 365 F&O: Shared (tenant), Legal entity, Operating unit, dan
// Legal entity + Fiscal calendar period. Company di F&O adalah organisasi yang sama dengan legal entity, jadi tidak
// berdiri sendiri. Scope "Operating unit type" belum dipahami dan sengaja tidak ada.
export const scopeTypes = [
    'tenant',
    'legal_entity',
    'operating_unit',
    'legal_entity_fiscal_period',
] as const;
export type ScopeType = (typeof scopeTypes)[number];

export const resetPeriods = [
    'never',
    'calendar_year',
    'fiscal_year',
    'fiscal_period',
] as const;

export const sequenceStatuses = ['draft', 'active', 'stopped'] as const;

export const segmentSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('constant'), value: z.string() }),
    z.object({ type: z.literal('number'), length: z.number().int() }),
    z.object({
        type: z.literal('context'),
        value: z.string(),
        length: z.number().int(),
        name: z.string().optional(),
    }),
    z.object({ type: z.literal('year') }),
    z.object({ type: z.literal('scope') }),
    z.object({ type: z.literal('fiscal_year') }),
    z.object({
        type: z.literal('fiscal_period'),
        length: z.number().int().optional(),
    }),
]);
export type Segment = z.infer<typeof segmentSchema>;

export const sequenceSchema = z.object({
    id: z.string(),
    tenant_id: z.string(),
    reference_id: z.string(),
    scope_type: z.enum(scopeTypes),
    legal_entity_id: z.string().nullable(),
    operating_unit_id: z.string().nullable(),
    fiscal_period_id: z.string().nullable(),
    status: z.enum(sequenceStatuses),
    is_continuous: z.boolean(),
    allow_automatic: z.boolean(),
    allow_manual: z.boolean(),
    allow_lower_number: z.boolean(),
    allow_higher_number: z.boolean(),
    preallocation_enabled: z.boolean(),
    preallocation_quantity: z.number(),
    minimum_number: z.coerce.bigint(),
    maximum_number: z.coerce.bigint().nullable(),
    segments: z.array(segmentSchema),
    reset_period: z.enum(resetPeriods),
    version: z.number(),
});
export type Sequence = z.infer<typeof sequenceSchema>;

// Setelan yang tetap boleh diubah setelah sequence dibuat, sama dengan General dan Performance di F&O: Continuous,
// Manual, In use/Stopped, Smallest/Largest, Reset every, Allow user changes, dan Preallocation. Format hanya boleh
// diubah selama belum ada nomor yang terbit.
export const settingsSchema = z.object({
    status: z.enum(sequenceStatuses),
    is_continuous: z.boolean(),
    allow_automatic: z.boolean(),
    allow_manual: z.boolean(),
    allow_lower_number: z.boolean(),
    allow_higher_number: z.boolean(),
    reset_period: z.enum(resetPeriods),
    preallocation_enabled: z.boolean(),
    preallocation_quantity: z.number().int().min(1).max(1000),
    minimum_number: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    maximum_number: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .nullable(),
    segments: z.array(segmentSchema).min(1).max(10),
});
export type Settings = z.infer<typeof settingsSchema>;

// Scope dan nilainya hanya diisi saat membuat.
export const createSchema = settingsSchema.extend({
    reference_id: z.string(),
    scope_type: z.enum(scopeTypes),
    legal_entity_id: z.string().nullable().default(null),
    operating_unit_id: z.string().nullable().default(null),
    fiscal_period_id: z.string().nullable().default(null),
});
export type CreateInput = z.infer<typeof createSchema>;

export const updateSchema = settingsSchema.extend({
    version: z.number().int(),
    reference_id: z.string().optional(),
    scope_type: z.enum(scopeTypes).optional(),
    legal_entity_id: z.string().nullable().optional(),
    operating_unit_id: z.string().nullable().optional(),
    fiscal_period_id: z.string().nullable().optional(),
});
export type UpdateInput = z.infer<typeof updateSchema>;
