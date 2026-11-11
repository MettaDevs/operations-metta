import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { DatabaseSettings } from '../config/index.ts';
import type { MigrationSource } from '../migration/index.ts';
import { installModule } from './install-module.service.ts';
import { assertEnvironmentDatabase, connect } from './provision.service.ts';

const moduleIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);

export const syncEntitlementsRequestSchema = z.strictObject({
    tenant_id: z.uuid(),
    // null berarti database bersama (database runtime), dipisah tenant_id.
    database: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,62}$/)
        .nullable(),
    // Seluruh hak module tenant yang masih hidup menurut control plane. Yang tidak ada di sini dicabut.
    modules: z.array(
        z.strictObject({
            module_id: moduleIdSchema,
            // Hari terakhir module boleh dipakai; null berarti tanpa batas.
            ends_on: z.iso.date().nullable(),
        }),
    ),
});
export type SyncEntitlementsRequest = z.infer<
    typeof syncEntitlementsRequestSchema
>;

// Menyamakan hak module tenant di database lingkungan dengan daftar dari control plane. Module yang belum terpasang
// dipasang lewat installModule (migration, catatan pemasangan, duty role pemilik, data bawaan organisasi). Tanggal
// berakhir menjadi awal hari sesudah ends_on, karena Shell menganggap hak berlaku selama ends_at > waktu sekarang.
// Hak module yang tidak ada di daftar dicabut (status revoked); tabel dan isinya tidak disentuh, jadi hak yang
// diberikan lagi menampilkan data lamanya. Aman diulang.
export async function syncEntitlements(
    settings: DatabaseSettings,
    source: MigrationSource,
    request: SyncEntitlementsRequest,
    step: (name: string) => Promise<unknown>,
): Promise<void> {
    if (request.database !== null)
        assertEnvironmentDatabase(settings, request.database);
    const unknown = request.modules
        .map((module) => module.module_id)
        .filter((id) => !source.modules.has(id));
    if (unknown.length)
        throw new Error(
            `Module ${unknown.join(', ')} tidak dibawa rilis host ini, jadi tidak bisa dipasang.`,
        );
    const sql = connect(settings, request.database ?? settings.DB_DATABASE);
    const setEndsAt = (moduleId: string, endsOn: string | null) =>
        sql`update tenant_app_entitlements
            set ends_at = ${endsOn}::date + 1, updated_at = now() at time zone 'utc'
            where tenant_id = ${request.tenant_id} and app_id = ${moduleId} and status = 'active'`;
    try {
        for (const module of request.modules) {
            await step(`pasang ${module.module_id}`.slice(0, 60));
            // Sebelum dipasang juga: hak aktif yang tanggalnya sudah lewat tetapi diperpanjang control plane tidak
            // boleh membuat installModule menulis hak aktif kedua.
            await setEndsAt(module.module_id, module.ends_on);
            await installModule(settings, source, {
                database: request.database,
                tenant_id: request.tenant_id,
                module_id: module.module_id,
            });
            await setEndsAt(module.module_id, module.ends_on);
        }
        await step('cabut hak lain');
        const kept = request.modules.map((module) => module.module_id);
        await sql`update tenant_app_entitlements
            set status = 'revoked', updated_at = now() at time zone 'utc'
            where tenant_id = ${request.tenant_id} and status = 'active'
              and app_id in ${sql([...source.modules.keys()])}
              ${kept.length ? sql`and app_id not in ${sql(kept)}` : sql``}`;
    } finally {
        await sql.end();
    }
}

const moduleManifestSchema = z.strictObject({
    name: z.string().min(1).max(150),
    description: z.string().max(1000).nullable().default(null),
});

export type CatalogModule = {
    id: string;
    name: string;
    description: string | null;
};

// Module yang boleh dijual dari image ini: setiap modules/<id>/module.json yang module-nya punya migration. Dilaporkan ke
// control plane sebagai katalog module.
export function readModuleCatalog(
    root: string,
    source: MigrationSource,
): CatalogModule[] {
    return [...source.modules.keys()]
        .filter((id) => existsSync(join(root, 'modules', id, 'module.json')))
        .map((id) => ({
            id: moduleIdSchema.parse(id),
            ...moduleManifestSchema.parse(
                JSON.parse(
                    readFileSync(
                        join(root, 'modules', id, 'module.json'),
                        'utf8',
                    ),
                ),
            ),
        }));
}
