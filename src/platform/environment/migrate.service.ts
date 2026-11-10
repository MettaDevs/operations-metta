import { z } from 'zod';
import type { DatabaseSettings } from '../config/index.ts';
import { sqlErrorCode } from '../database/index.ts';
import { migrate, type MigrationSource } from '../migration/index.ts';
import { assertEnvironmentDatabase, connect } from './provision.service.ts';

export const migrateRequestSchema = z.strictObject({
    database: z
        .string()
        .regex(
            /^[a-z][a-z0-9_]{0,62}$/,
            'Nama database: huruf kecil, angka, dan garis bawah, diawali huruf, paling panjang 63.',
        ),
});
export type MigrateRequest = z.infer<typeof migrateRequestSchema>;

// Membawa database lingkungan yang sudah disiapkan ke skema kode ini: migration Core dan migration setiap module yang
// sudah tercatat terpasang di database itu. Module yang belum terpasang tidak ikut, karena memasangnya keputusan
// entitlement. Database yang belum pernah dimigrasi ditolak; ia harus disiapkan, bukan dimigrasi.
export async function migrateEnvironment(
    settings: DatabaseSettings,
    source: MigrationSource,
    request: MigrateRequest,
    onStep: (step: 'migrate') => Promise<void> = () => Promise.resolve(),
): Promise<void> {
    assertEnvironmentDatabase(settings, request.database);
    await onStep('migrate');
    const sql = connect(settings, request.database);
    try {
        let installed: string[];
        try {
            installed = (
                await sql<
                    { owner: string }[]
                >`select distinct owner from public.schema_migrations where owner <> 'core' order by owner`
            ).map((row) => row.owner);
        } catch (error) {
            const code = sqlErrorCode(error);
            if (code === '3D000' || code === '42P01')
                throw new Error(
                    `Database ${request.database} has not been provisioned; provision it before migrating.`,
                );
            throw error;
        }
        await migrate(sql, source, { modules: installed });
    } finally {
        await sql.end();
    }
}
