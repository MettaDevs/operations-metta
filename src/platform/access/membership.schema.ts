import { z } from 'zod';
import { failOn, laravelBody } from '../http/index.ts';

// Batas data satu penugasan untuk satu kebijakan data. Tanpa legal entity dan organisasi berarti seluruh organisasi,
// dan itu harus dinyatakan lewat `unrestricted` supaya tidak tertukar dengan isian yang belum lengkap.
export const policyScopeSchema = z.object({
    policy_code: z.string(),
    legal_entity_id: z.string().nullable().optional(),
    organization_id: z.string().nullable().optional(),
    hierarchy_id: z.string().nullable().optional(),
    include_descendants: z.boolean(),
    unrestricted: z.boolean().optional(),
});
export const membershipInputSchema = z.object({
    version: z.union([z.number(), z.string()]).optional(),
    assignments: z
        .array(
            z.object({
                role_id: z.string(),
                policy_scopes: z.array(policyScopeSchema).optional(),
            }),
        )
        .nullable()
        .optional(),
});
export type PolicyScopeInput = {
    policy_code: string;
    legal_entity_id: string | null;
    organization_id: string | null;
    hierarchy_id: string | null;
    include_descendants: boolean;
    unrestricted: boolean;
};
export type AssignmentInput = {
    role_id: string;
    policy_scopes: PolicyScopeInput[];
};

const text = (value: unknown) =>
    typeof value === 'string' && value !== '' ? value : null;

// MembershipRequest CoreERP: daftar penugasan lengkap yang menggantikan penugasan manual anggota itu.
export function parseMembershipInput(body: unknown): AssignmentInput[] {
    const input = laravelBody.parse(body);
    const errors: Record<string, string[]> = {};
    const raw = input.assignments;
    if (raw !== null && raw !== undefined && !Array.isArray(raw))
        failOn({ assignments: ['The assignments field must be an array.'] });
    const items: unknown[] = Array.isArray(raw) ? raw : [];
    const roleIds = items.map((item) =>
        item && typeof item === 'object'
            ? (item as Record<string, unknown>).role_id
            : undefined,
    );
    const assignments = items.map((item, index): AssignmentInput => {
        const record =
            item && typeof item === 'object'
                ? (item as Record<string, unknown>)
                : {};
        const roleId = record.role_id;
        if (typeof roleId !== 'string' || roleId === '')
            errors[`assignments.${index}.role_id`] = [
                `The assignments.${index}.role_id field is required.`,
            ];
        else if (roleIds.indexOf(roleId) !== index)
            errors[`assignments.${index}.role_id`] = [
                `The assignments.${index}.role_id field has a duplicate value.`,
            ];
        const scopes = record.policy_scopes;
        if (scopes !== null && scopes !== undefined && !Array.isArray(scopes))
            errors[`assignments.${index}.policy_scopes`] = [
                `The assignments.${index}.policy_scopes field must be an array.`,
            ];
        const list: unknown[] = Array.isArray(scopes) ? scopes : [];
        return {
            role_id: typeof roleId === 'string' ? roleId : '',
            policy_scopes: list.map((scope, position) => {
                const value =
                    scope && typeof scope === 'object'
                        ? (scope as Record<string, unknown>)
                        : {};
                const prefix = `assignments.${index}.policy_scopes.${position}`;
                const code = value.policy_code;
                if (typeof code !== 'string' || code === '')
                    errors[`${prefix}.policy_code`] = [
                        `The ${prefix}.policy_code field is required.`,
                    ];
                else if ([...code].length > 160)
                    errors[`${prefix}.policy_code`] = [
                        `The ${prefix}.policy_code field must not be greater than 160 characters.`,
                    ];
                if (typeof value.include_descendants !== 'boolean')
                    errors[`${prefix}.include_descendants`] = [
                        `The ${prefix}.include_descendants field is required.`,
                    ];
                return {
                    policy_code: typeof code === 'string' ? code : '',
                    legal_entity_id: text(value.legal_entity_id),
                    organization_id: text(value.organization_id),
                    hierarchy_id: text(value.hierarchy_id),
                    include_descendants: value.include_descendants === true,
                    unrestricted: value.unrestricted === true,
                };
            }),
        };
    });
    failOn(errors);
    return assignments;
}
