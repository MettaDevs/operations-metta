import { z } from 'zod';
import { validation } from './errors.ts';

// Middleware TrimStrings dan ConvertEmptyStringsToNull Laravel berjalan sebelum setiap validasi CoreERP: teks
// dirapikan spasinya di ujung, lalu teks kosong menjadi null.
function laravelInput(value: unknown): unknown {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? null : trimmed;
    }
    if (Array.isArray(value)) return value.map(laravelInput);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                laravelInput(item),
            ]),
        );
    return value;
}

export type Rule =
    | { kind: 'required'; when?: boolean; message?: string }
    | { kind: 'prohibited'; when: boolean; message: string }
    | { kind: 'string' }
    | { kind: 'max'; length: number }
    | { kind: 'size'; length: number }
    | { kind: 'regex'; pattern: RegExp; message?: string }
    | { kind: 'in'; values: readonly string[]; message?: string };

// Pesan galat satu field dengan urutan dan bunyi validator Laravel. Aturan wajib dan larangan yang gagal
// menghentikan pemeriksaan field itu; aturan lain dilewati selama nilainya kosong.
export function fieldErrors(
    field: string,
    value: unknown,
    rules: Rule[],
): string[] {
    const attribute = field.replaceAll('_', ' ');
    const errors: string[] = [];
    const empty = value === null || value === undefined;
    for (const rule of rules) {
        switch (rule.kind) {
            case 'required':
                if ((rule.when ?? true) && empty)
                    return [
                        rule.message ?? `The ${attribute} field is required.`,
                    ];
                break;
            case 'prohibited':
                if (rule.when && !empty) return [rule.message];
                break;
            case 'string':
                if (!empty && typeof value !== 'string')
                    return [`The ${attribute} field must be a string.`];
                break;
            case 'max':
                if (
                    typeof value === 'string' &&
                    // Dihitung per code point, sama dengan mb_strlen Laravel.
                    // eslint-disable-next-line @typescript-eslint/no-misused-spread
                    [...value].length > rule.length
                )
                    errors.push(
                        `The ${attribute} field must not be greater than ${rule.length} characters.`,
                    );
                break;
            case 'size':
                if (
                    typeof value === 'string' &&
                    // Dihitung per code point, sama dengan mb_strlen Laravel.
                    // eslint-disable-next-line @typescript-eslint/no-misused-spread
                    [...value].length !== rule.length
                )
                    errors.push(
                        `The ${attribute} field must be ${rule.length} characters.`,
                    );
                break;
            case 'regex':
                if (typeof value === 'string' && !rule.pattern.test(value))
                    errors.push(
                        rule.message ??
                            `The ${attribute} field format is invalid.`,
                    );
                break;
            case 'in':
                if (
                    !empty &&
                    !(typeof value === 'string' && rule.values.includes(value))
                )
                    errors.push(
                        rule.message ?? `The selected ${attribute} is invalid.`,
                    );
                break;
            default: {
                const unknown: never = rule;
                throw new Error(`Unknown rule ${JSON.stringify(unknown)}`);
            }
        }
    }
    return errors;
}

export function failOn(errors: Record<string, string[]>): void {
    const failed = Object.fromEntries(
        Object.entries(errors).filter(([, messages]) => messages.length),
    );
    if (Object.keys(failed).length) validation(failed);
}

const record = z.record(z.string(), z.unknown());

// Kiriman yang bukan objek dibaca sebagai kiriman kosong, sama dengan request Laravel tanpa body.
export const laravelBody = z.unknown().transform((raw) => {
    const input = laravelInput(raw);
    const parsed = record.safeParse(input);
    return parsed.success && !Array.isArray(input) ? parsed.data : {};
});
