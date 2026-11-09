import { z } from 'zod';
import { nullableText } from '../http/index.ts';
import { fieldErrors, laravelBody } from './organization.schema.ts';

// Aturan `date` Laravel untuk bentuk yang dikirim layar: tanggal, boleh diikuti jam. Disimpan sebagai timestamp.
function dateTime(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match =
        /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
            value,
        );
    if (!match) return null;
    const [, year, month, day, hour = '00', minute = '00', second = '00'] =
        match;
    const date = new Date(
        Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute),
            Number(second),
        ),
    );
    const normalized = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    return !Number.isNaN(date.valueOf()) &&
        date.toISOString().slice(0, 19).replace('T', ' ') === normalized
        ? normalized
        : null;
}

export function effectiveFromErrors(value: unknown): string[] {
    const required = fieldErrors('effective_from', value, [
        { kind: 'required' },
    ]);
    if (required.length) return required;
    return dateTime(value)
        ? []
        : ['The effective from field must be a valid date.'];
}

// HierarchyRequest CoreERP. Keunikan nama dan keberadaan kode tujuan diperiksa service, karena butuh database.
export const createHierarchySchema = laravelBody.transform((input) => {
    const name = input.name == null ? null : String(input.name).trim() || null;
    const codes = input.purpose_codes;
    const purposeErrors: Record<string, string[]> = {};
    if (
        codes === null ||
        codes === undefined ||
        (Array.isArray(codes) && !codes.length)
    )
        purposeErrors.purpose_codes = ['The purpose codes field is required.'];
    else if (!Array.isArray(codes))
        purposeErrors.purpose_codes = [
            'The purpose codes field must be an array.',
        ];
    else
        for (const [index, code] of codes.entries())
            purposeErrors[`purpose_codes.${index}`] = fieldErrors(
                `purpose_codes.${index}`,
                code,
                [{ kind: 'required' }, { kind: 'string' }],
            );
    return {
        name,
        purpose_codes: Array.isArray(codes)
            ? codes.map((code) => String(code))
            : [],
        root_organization_id:
            typeof input.root_organization_id === 'string'
                ? input.root_organization_id
                : '',
        effective_from: dateTime(input.effective_from) ?? '',
        errors: {
            name: fieldErrors('name', name, [
                { kind: 'required' },
                { kind: 'string' },
                { kind: 'max', length: 150 },
            ]),
            ...purposeErrors,
            root_organization_id: fieldErrors(
                'root_organization_id',
                input.root_organization_id,
                [{ kind: 'required' }, { kind: 'string' }],
            ),
            effective_from: effectiveFromErrors(input.effective_from),
        },
    };
});

export const placementSchema = laravelBody.transform((input) => ({
    organization_id:
        typeof input.organization_id === 'string' ? input.organization_id : '',
    parent_organization_id:
        typeof input.parent_organization_id === 'string'
            ? input.parent_organization_id
            : '',
    errors: {
        organization_id: fieldErrors('organization_id', input.organization_id, [
            { kind: 'required' },
            { kind: 'string' },
        ]),
        parent_organization_id: fieldErrors(
            'parent_organization_id',
            input.parent_organization_id,
            [{ kind: 'required' }, { kind: 'string' }],
        ),
    },
}));

export const draftSchema = laravelBody.transform((input) => ({
    effective_from: dateTime(input.effective_from) ?? '',
    errors: { effective_from: effectiveFromErrors(input.effective_from) },
}));

export const versionSchema = z.object({
    id: z.string(),
    hierarchy_id: z.string(),
    status: z.string(),
    tenant_id: z.string(),
});
export type HierarchyVersion = z.infer<typeof versionSchema>;

export const nodeSchema = z.object({
    id: z.string(),
    version_id: z.string(),
    organization_id: z.string(),
    parent_node_id: nullableText,
});

// OrganizationPageRecords::hierarchy CoreERP: hierarchy dengan tujuan dan versi terakhirnya, dengan kolom dan urutan
// relasi yang sama dengan Eloquent.
const purposeSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    pivot: z.object({ hierarchy_id: z.string(), purpose_id: z.string() }),
    allowed_organization_types: z.array(
        z.object({ purpose_id: z.string(), organization_type: z.string() }),
    ),
});
const graphNodeSchema = z.object({
    id: z.string(),
    version_id: z.string(),
    organization_id: z.string(),
    parent_node_id: nullableText,
    created_at: nullableText,
    updated_at: nullableText,
    organization: z.object({
        id: z.string(),
        name: z.string(),
        classification: z.string(),
        operating_unit: z
            .object({
                organization_id: z.string(),
                type: z.string(),
                number: nullableText,
            })
            .nullable(),
    }),
    parent_node: z
        .object({
            id: z.string(),
            organization_id: z.string(),
            organization: z.object({ id: z.string(), name: z.string() }),
        })
        .nullable(),
});
export const graphVersionSchema = z.object({
    id: z.string(),
    hierarchy_id: z.string(),
    version_number: z.number(),
    status: z.string(),
    effective_from: nullableText,
    published_at: nullableText,
    created_at: nullableText,
    updated_at: nullableText,
});
export const graphHierarchySchema = z.object({
    id: z.string(),
    tenant_id: z.string(),
    name: z.string(),
    status: z.string(),
    created_at: nullableText,
    updated_at: nullableText,
    created_by_user_id: nullableText,
    updated_by_user_id: nullableText,
    version: z.number(),
});
export { graphNodeSchema, purposeSchema };

// Satu baris daftar hierarchy di layar.
export const hierarchyListRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    version: z.number(),
});
