import { afterAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../../../../../src/platform/config/index.ts';
import {
    migrate,
    readMigrationSource,
    type MigrationSource,
} from '../../../../../src/platform/migration/index.ts';

// Baris "Tidak Ada" daftar alergen milik tenant yang memasang module sebelum penanda ada ikut ditandai. Butuh
// PostgreSQL; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('allergy none flag migration', () => {
    if (!process.env.DB_HOST) return;
    const settings = databaseSettingsSchema.parse(process.env);
    const source = readMigrationSource(
        resolve(import.meta.dir, '../../../../..'),
    );
    const connect = (database: string) =>
        postgres({
            host: settings.DB_HOST,
            port: settings.DB_PORT,
            database,
            username: settings.DB_USERNAME,
            password: settings.DB_PASSWORD,
            max: 1,
            onnotice: () => {},
        });
    const runtime = connect(settings.DB_DATABASE);
    const database = `${settings.DB_DATABASE.slice(0, 40)}_tidak_ada_${Bun.randomUUIDv7().slice(-8)}`;
    afterAll(async () => {
        await runtime.unsafe(
            `drop database if exists "${database}" with (force)`,
        );
        await runtime.end();
    }, 120_000);

    const healthcare = source.modules.get('healthcare') ?? [];
    const beforeFlag: MigrationSource = {
        core: source.core,
        modules: new Map([
            [
                'healthcare',
                healthcare.slice(
                    0,
                    healthcare.findIndex((migration) =>
                        migration.name.endsWith('_allergy_none_flag.sql'),
                    ),
                ),
            ],
        ]),
    };

    test('the Tidak Ada row of each allergy kind is flagged, and no allergen is', async () => {
        await runtime.unsafe(`create database "${database}"`);
        const sql = connect(database);
        try {
            await migrate(sql, beforeFlag, { modules: ['healthcare'] });
            const tenant = Bun.randomUUIDv7();
            await sql.unsafe('select public.sim_isi_acuan_pemeriksaan($1)', [
                tenant,
            ]);

            await migrate(sql, source, { modules: ['healthcare'] });

            const rows = await sql.unsafe<
                { jenis: string; nama: string; tidak_ada: boolean }[]
            >(
                `select jenis, nama, tidak_ada from sim_m_alergi
                 where tenant_id = $1 order by jenis, urutan`,
                [tenant],
            );
            expect(
                rows
                    .filter((row) => row.tidak_ada)
                    .map((row) => [row.jenis, row.nama]),
            ).toEqual([
                ['makanan', 'Tidak Ada'],
                ['obat', 'Tidak Ada'],
                ['udara', 'Tidak Ada'],
            ]);
            expect(rows.filter((row) => !row.tidak_ada)).toHaveLength(15);
        } finally {
            await sql.end();
        }
    }, 120_000);
});
