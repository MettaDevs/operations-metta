import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../src/platform/config/index.ts';
import {
    migrate,
    readMigrationSource,
} from '../src/platform/migration/index.ts';

const usage =
    'Usage: bun scripts/migrate.ts [--adopt-coreerp] [--modules <module,...>]';

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
