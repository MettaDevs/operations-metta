import { z } from 'zod';
import type { Workspace } from '../../platform/access/index.ts';
import { sqlErrorCode, type Database } from '../../platform/database/index.ts';
import { lookupId, validation } from '../../platform/http/index.ts';

export function activeLegalEntity(workspace: Workspace): string {
    const legalEntityId = workspace.legalEntityId;
    if (!legalEntityId)
        validation({
            legal_entity_id:
                'Pilih legal entity di tempat kerja sebelum melanjutkan.',
        });
    return legalEntityId;
}

export function violates(error: unknown, constraint: string): boolean {
    return (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes(constraint)
    );
}

// Isian yang tidak cocok dengan schema ditolak per field. Pesannya dicari dari nama field lengkap, lalu dari nama
// isiannya saja (misalnya `quantity` untuk `lines.2.quantity`).
export function parseInput<S extends z.ZodType>(
    schema: S,
    body: unknown,
    messages: Record<string, string>,
): z.output<S> {
    const result = schema.safeParse(body);
    if (result.success) return result.data;
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
        const path = issue.path.map(String);
        const field = path.join('.') || '_form';
        errors[field] ??=
            messages[field] ??
            messages[path.at(-1) ?? '_form'] ??
            'Isian ini tidak sah.';
    }
    return validation(errors);
}

// Kode pendek yang diketik pengguna, seperti field Code di BC: disimpan huruf besar tanpa spasi di ujungnya.
export function codeAndName(
    data: { code: string; name: string },
    errors: Record<string, string>,
    label: string,
    limits: { code: number; name: number },
) {
    const code = data.code.trim().toUpperCase();
    const name = data.name.trim();
    if (!code) errors.code = `Isi kode ${label}.`;
    else if (code.length > limits.code)
        errors.code = `Kode ${label} paling banyak ${limits.code} karakter.`;
    if (!name) errors.name = `Isi nama ${label}.`;
    else if (name.length > limits.name)
        errors.name = `Nama ${label} paling banyak ${limits.name} karakter.`;
    return { code, name };
}

export const codeAndNameMessages = (label: string) => ({
    code: `Isi kode ${label}.`,
    name: `Isi nama ${label}.`,
});

// Rujukan ke master lain harus baris aktif milik legal entity yang sama. Id yang bukan uuid dianggap tidak ditemukan.
export async function exists(
    db: Database,
    table: string,
    scope: { tenantId: string; legalEntityId: string },
    id: string,
): Promise<boolean> {
    if (!lookupId(id)) return false;
    return (
        (await db.one(
            z.object({ found: z.number() }),
            `select 1 as found from ${table}
             where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
            [scope.tenantId, scope.legalEntityId, id],
        )) !== undefined
    );
}

// Baris master yang dipakai baris lain tidak dihapus, supaya data yang merujuknya tidak kehilangan artinya.
export async function inUse(
    db: Database,
    checks: { sql: string; message: string }[],
    parameters: string[],
): Promise<void> {
    for (const check of checks)
        if (
            await db.one(z.object({ found: z.number() }), check.sql, parameters)
        )
            validation({ _form: check.message });
}
