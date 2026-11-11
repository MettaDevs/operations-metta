import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { z } from 'zod';
import type { DatabaseSettings } from '../config/index.ts';
import { Database, databaseTypes } from '../database/index.ts';
import { migrate, type MigrationSource } from '../migration/index.ts';
import { replayOrganizationsCreated } from '../organization/index.ts';
import { assertEnvironmentDatabase, connect } from './provision.service.ts';

export const installModuleRequestSchema = z.strictObject({
    // null berarti database bersama (database runtime), dipisah tenant_id.
    database: z
        .string()
        .regex(
            /^[a-z][a-z0-9_]{0,62}$/,
            'Nama database: huruf kecil, angka, dan garis bawah, diawali huruf, paling panjang 63.',
        )
        .nullable(),
    tenant_id: z.uuid(),
    module_id: z.string().regex(/^[a-z][a-z0-9-]{0,99}$/),
});
export type InstallModuleRequest = z.infer<typeof installModuleRequestSchema>;

// Memasang satu module untuk satu tenant, dengan tiga keadaan yang tetap terpisah (AGENTS.md, Aturan module):
//
// 1. Migration module dijalankan di database lingkungan. Ia juga menulis katalog module (baris `apps`), yang dirujuk
//    entitlement.
// 2. Entitlement: tenant berhak memakai module itu (`tenant_app_entitlements` aktif).
// 3. Terpasang: baris `core_module_installations` berstatus installed, ditulis hanya setelah migration berhasil.
//
// Entitlement, pemasangan, duty, dan data bawaan per organisasi ditulis dalam satu transaksi. Data bawaan itu, misalnya
// number sequence NRM per legal entity, dibuat oleh yang didaftarkan lewat onOrganizationCreated (registerOrganizationDefaults), yang
// dijalankan ulang untuk setiap legal entity dan operating unit yang sudah ada sebelum module dipasang. Organisasi
// yang dibuat sesudahnya mendapatkannya saat lahir. Proses yang memanggil installModule wajib memanggil
// registerOrganizationDefaults (src/foundation/number-sequence/) supaya pendaftaran itu ada.
//
// Role pemilik tenant lalu mendapat semua duty module itu, sama dengan duty Core yang diberikan saat penyiapan.
// Aman diulang: entitlement aktif, migration yang sudah tercatat, catatan pemasangan, dan duty yang sudah ada dilewati.
// Pemanggilnya `bun run dev:setup` dan operasi sync_entitlements dari control plane (sync-entitlements.service.ts).
export async function installModule(
    settings: DatabaseSettings,
    source: MigrationSource,
    request: InstallModuleRequest,
): Promise<void> {
    if (!source.modules.has(request.module_id))
        throw new Error(`Module ${request.module_id} is not in this release.`);
    if (request.database !== null)
        assertEnvironmentDatabase(settings, request.database);
    const database = request.database ?? settings.DB_DATABASE;
    const sql = connect(settings, database);
    try {
        const installed = (
            await sql<
                { owner: string }[]
            >`select distinct owner from public.schema_migrations where owner <> 'core'`
        ).map((row) => row.owner);
        await migrate(sql, source, {
            modules: [...new Set([...installed, request.module_id])],
        });
        // Dibungkus Database, supaya pembuat data bawaan per organisasi memakai jalur yang sama dengan request.
        const business = postgres({
            host: settings.DB_HOST,
            port: settings.DB_PORT,
            database,
            username: settings.DB_USERNAME,
            password: settings.DB_PASSWORD,
            max: 1,
            onnotice: () => {
                // NOTICE PostgreSQL sengaja tidak dicetak.
            },
            types: databaseTypes,
        });
        const connection = await business.reserve();
        try {
            const db = new Database(connection, undefined, randomUUID());
            await db.transaction(async () => {
                await db.execute(
                    `insert into tenant_app_entitlements (tenant_id, app_id, status, starts_at, created_at, updated_at)
                     select $1::uuid, $2::varchar, 'active', now(), now(), now()
                     where not exists (select 1 from tenant_app_entitlements where tenant_id = $1::uuid and app_id = $2::varchar
                                       and status = 'active' and (ends_at is null or ends_at > current_timestamp))`,
                    [request.tenant_id, request.module_id],
                );
                await db.execute(
                    `insert into core_module_installations (tenant_id, module_id, version, status, installed_at, created_at, updated_at)
                     select $1::uuid, a.id, a.version, 'installed', now(), now(), now() from apps a
                     where a.id = $2::varchar and not exists (select 1 from core_module_installations i
                                                      where i.tenant_id = $1::uuid and i.module_id = $2::varchar and i.status = 'installed')`,
                    [request.tenant_id, request.module_id],
                );
                await db.execute(
                    `insert into security_role_duties (role_id, duty_code)
                     select r.id, d.code from roles r
                     join security_duties d on d.app_id = $2 and d.tenant_id is null and d.status = 'active'
                     where r.tenant_id = $1 and r.is_owner
                       and not exists (select 1 from security_role_duties x where x.role_id = r.id and x.duty_code = d.code)`,
                    [request.tenant_id, request.module_id],
                );
                await replayOrganizationsCreated(db, request.tenant_id);
            });
        } finally {
            connection.release();
            await business.end();
        }
    } finally {
        await sql.end();
    }
}
