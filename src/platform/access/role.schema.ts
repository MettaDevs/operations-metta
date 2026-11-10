import { z } from 'zod';
import { fieldErrors, failOn, laravelBody } from '../http/index.ts';

const codeList = z.array(z.string());

// RoleRequest CoreERP: nama wajib, sedikitnya satu duty, dan role turunan opsional. Keberadaan duty dan role turunan
// diperiksa service terhadap tenant, karena katalog yang sah berbeda per tenant.
export const roleInputSchema = z.object({
    name: z.string(),
    duty_codes: codeList,
    child_role_ids: codeList.optional(),
    version: z.union([z.number(), z.string()]).optional(),
});
export type RoleInput = {
    name: string;
    duty_codes: string[];
    child_role_ids: string[];
};

const stringArray = (
    value: unknown,
    field: string,
    // Pesan saat daftar wajib dikirim kosong; diisi null untuk daftar yang boleh kosong.
    emptyMessage: string | null,
): { items: string[]; errors: Record<string, string[]> } => {
    const required = emptyMessage !== null;
    if (value === null || value === undefined)
        return {
            items: [],
            errors: required
                ? {
                      [field]: [
                          `The ${field.replaceAll('_', ' ')} field is required.`,
                      ],
                  }
                : {},
        };
    if (!Array.isArray(value))
        return {
            items: [],
            errors: {
                [field]: [
                    `The ${field.replaceAll('_', ' ')} field must be an array.`,
                ],
            },
        };
    const errors: Record<string, string[]> = {};
    if (required && value.length === 0) errors[field] = [emptyMessage];
    value.forEach((item, index) => {
        if (typeof item !== 'string' || item === '')
            errors[`${field}.${index}`] = [
                `The ${field.replaceAll('_', ' ')}.${index} field is required.`,
            ];
    });
    return {
        items: value.filter((item): item is string => typeof item === 'string'),
        errors,
    };
};

export function parseRoleInput(body: unknown): RoleInput {
    const input = laravelBody.parse(body);
    const duties = stringArray(
        input.duty_codes,
        'duty_codes',
        'Pilih sedikitnya satu tanggung jawab untuk role ini.',
    );
    const children = stringArray(input.child_role_ids, 'child_role_ids', null);
    failOn({
        name: fieldErrors('name', input.name, [
            { kind: 'required', message: 'Isi nama role.' },
            { kind: 'string' },
            {
                kind: 'max',
                length: 100,
                message: 'Nama role paling banyak 100 karakter.',
            },
        ]),
        ...duties.errors,
        ...children.errors,
    });
    return {
        name: String(input.name),
        duty_codes: duties.items,
        child_role_ids: children.items,
    };
}
