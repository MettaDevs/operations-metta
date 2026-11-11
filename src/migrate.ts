// Proses migrate: membawa database runtime ke skema kode ini. `bun run migrate` di laptop dan CI, `bun dist/migrate.js`
// dari image di host runtime sebelum proses HTTP dan worker versi baru dinyalakan. Berkas migration dibaca dari folder
// induk berkas ini, yang di repo adalah akar repo dan di image adalah /app.
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { databaseSettingsSchema } from './platform/config/index.ts';
import { migrate, readMigrationSource } from './platform/migration/index.ts';

const usage =
    'Usage: bun src/migrate.ts (di image: bun dist/migrate.js) [--adopt-coreerp] [--modules <module,...>]';

let options: { adoptCoreErp: boolean; modules: string[] | undefined };
try {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            'adopt-coreerp': { type: 'boolean', default: false },
            modules: { type: 'string' },
        },
    });
    options = {
        adoptCoreErp: values['adopt-coreerp'],
        modules: values.modules?.split(',').filter((name) => name !== ''),
    };
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage);
    process.exit(1);
}

const settings = databaseSettingsSchema.parse(process.env);
const sql = postgres({
    host: settings.DB_HOST,
    port: settings.DB_PORT,
    database: settings.DB_DATABASE,
    username: settings.DB_USERNAME,
    password: settings.DB_PASSWORD,
    max: 1,
    onnotice: (notice) => console.log(notice.message),
});

try {
    await migrate(sql, readMigrationSource(resolve(import.meta.dir, '..')), {
        ...options,
        log: console.log,
    });
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await sql.end();
}
