import { createHash } from 'node:crypto';
import postgres from 'postgres';
import type { DatabaseSettings } from '../../src/platform/config/index.ts';
import { sqlErrorCode } from '../../src/platform/database/index.ts';
import {
    migrate,
    type MigrationSource,
} from '../../src/platform/migration/index.ts';

// Satu template per proses test, dibangun saat pertama dibutuhkan.
let template: Promise<string> | undefined;

// Membuat database lingkungan sebagai salinan database template yang Core-nya sudah dimigrasi, sebelum test
// memanggil provisionEnvironment. Penyiapan lalu menemukan database itu sudah ada (jalur penyiapan yang diulang) dan
// migration Core sudah tercatat, sehingga tidak ada yang dijalankan lagi. Menyalin 86 MB lebih murah daripada
// menjalankan 0006_indonesia_regions.sql di setiap database. Jalur sungguhan, database kosong yang dimigrasi,
// tetap diuji provision.test.ts dan test migrate di worker.service.test.ts.
export async function createMigratedEnvironmentDatabase(
    settings: DatabaseSettings,
    source: MigrationSource,
    database: string,
): Promise<void> {
    template ??= buildTemplate(settings, source);
    const name = await template;
    await withConnection(settings, settings.DB_DATABASE, (sql) =>
        sql.unsafe(`create database "${database}" template "${name}"`),
    );
}

async function withConnection<T>(
    settings: DatabaseSettings,
    database: string,
    work: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
    const sql = postgres({
        host: settings.DB_HOST,
        port: settings.DB_PORT,
        database,
        username: settings.DB_USERNAME,
        password: settings.DB_PASSWORD,
        max: 1,
        onnotice: () => {},
    });
    try {
        return await work(sql);
    } finally {
        await sql.end();
    }
}

// Nama template memuat checksum migration Core, jadi migration yang berubah melahirkan template baru dan template lama
// tidak pernah dipakai. Template dibangun di nama sementara lalu diganti nama, supaya template yang setengah jadi tidak
// pernah terpakai, dan koneksinya ditutup lebih dulu karena CREATE DATABASE ... TEMPLATE menolak template yang
// sedang dibuka.
async function buildTemplate(
    settings: DatabaseSettings,
    source: MigrationSource,
): Promise<string> {
    const hash = createHash('sha256')
        .update(source.core.map((file) => file.checksum).join('\n'))
        .digest('hex')
        .slice(0, 12);
    const prefix = settings.DB_DATABASE.slice(0, 40);
    const template = `${prefix}_tpl_${hash}`;
    const [found] = await withConnection(
        settings,
        settings.DB_DATABASE,
        (sql) =>
            sql<{ count: number }[]>`
                select count(*)::int as count from pg_database where datname = ${template}`,
    );
    if (found?.count) return template;

    const building = `${prefix}_bld_${Bun.randomUUIDv7().slice(-8)}`;
    await withConnection(settings, settings.DB_DATABASE, (sql) =>
        sql.unsafe(`create database "${building}"`),
    );
    await withConnection(settings, building, (sql) =>
        migrate(sql, source, { modules: [] }),
    );
    await withConnection(settings, settings.DB_DATABASE, async (sql) => {
        try {
            await sql.unsafe(
                `alter database "${building}" rename to "${template}"`,
            );
        } catch (error) {
            // Proses test lain selesai membangun template yang sama lebih dulu.
            if (sqlErrorCode(error) !== '42P04') throw error;
            await sql.unsafe(`drop database "${building}"`);
        }
    });
    return template;
}
