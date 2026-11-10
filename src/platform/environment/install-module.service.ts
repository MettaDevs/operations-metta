import { z } from 'zod';
import type { DatabaseSettings } from '../config/index.ts';
import { migrate, type MigrationSource } from '../migration/index.ts';
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
// Entitlement, pemasangan, dan duty ditulis dalam satu transaksi. Data per organisasi yang diisi migration module
// untuk tenant yang berhak (misalnya sequence NRM) tidak ikut untuk organisasi yang sudah ada sebelum pemasangan; di
// laptop module dipasang sebelum organisasi dibuat, dan organisasi baru mendapatkannya dari hook pembuatan organisasi.
//
// Role pemilik tenant lalu mendapat semua duty module itu, sama dengan duty Core yang diberikan saat penyiapan.
// Aman diulang: entitlement aktif, migration yang sudah tercatat, catatan pemasangan, dan duty yang sudah ada dilewati.
// Pemanggilnya sekarang `bun run dev:setup`; operasi control plane untuk memasang module belum ada.
export async function installModule(
    settings: DatabaseSettings,
    source: MigrationSource,
    request: InstallModuleRequest,
): Promise<void> {
    if (!source.modules.has(request.module_id))
        throw new Error(`Module ${request.module_id} is not in this release.`);
    if (request.database !== null)
        assertEnvironmentDatabase(settings, request.database);
    const sql = connect(settings, request.database ?? settings.DB_DATABASE);
    try {
        const installed = (
            await sql<
                { owner: string }[]
            >`select distinct owner from public.schema_migrations where owner <> 'core'`
        ).map((row) => row.owner);
        await migrate(sql, source, {
            modules: [...new Set([...installed, request.module_id])],
        });
        await sql.begin(async (transaction) => {
            await transaction.unsafe(
                `insert into tenant_app_entitlements (tenant_id, app_id, status, starts_at, created_at, updated_at)
                 select $1::uuid, $2::varchar, 'active', now(), now(), now()
                 where not exists (select 1 from tenant_app_entitlements where tenant_id = $1::uuid and app_id = $2::varchar
                                   and status = 'active' and (ends_at is null or ends_at > current_timestamp))`,
                [request.tenant_id, request.module_id],
            );
            await transaction.unsafe(
                `insert into core_module_installations (tenant_id, module_id, version, status, installed_at, created_at, updated_at)
                 select $1::uuid, a.id, a.version, 'installed', now(), now(), now() from apps a
                 where a.id = $2::varchar and not exists (select 1 from core_module_installations i
                                                  where i.tenant_id = $1::uuid and i.module_id = $2::varchar and i.status = 'installed')`,
                [request.tenant_id, request.module_id],
            );
            await transaction.unsafe(
                `insert into security_role_duties (role_id, duty_code)
                 select r.id, d.code from roles r
                 join security_duties d on d.app_id = $2 and d.tenant_id is null and d.status = 'active'
                 where r.tenant_id = $1 and r.is_owner
                   and not exists (select 1 from security_role_duties x where x.role_id = r.id and x.duty_code = d.code)`,
                [request.tenant_id, request.module_id],
            );
        });
    } finally {
        await sql.end();
    }
}
