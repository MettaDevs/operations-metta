import { z } from 'zod';
import { coded } from './errors.ts';

export const idSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i);
export const nullableText = z.string().nullable();
export const dateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
        const date = new Date(value + 'T00:00:00Z');
        return (
            !Number.isNaN(date.valueOf()) &&
            date.toISOString().slice(0, 10) === value
        );
    });

export function expectedVersion(request: Request, body: unknown): number {
    const header = request.headers.get('if-match');
    if (header !== null) {
        const match = /^\s*(?:W\/)?"(\d+)"\s*$/.exec(header);
        if (match?.[1]) return Number(match[1]);
    } else {
        const parsed = z
            .object({
                version: z.union([z.number().int(), z.string().regex(/^\d+$/)]),
            })
            .safeParse(body);
        if (parsed.success) return Number(parsed.data.version);
    }
    return coded(
        428,
        'version_required',
        'Versi data yang sedang diubah wajib dikirim: header If-Match berisi ETag, atau field version.',
    );
}

export function nowSql(): string {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export function nowIso(): string {
    return new Date().toISOString().slice(0, 19) + '+00:00';
}
