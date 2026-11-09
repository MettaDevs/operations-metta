import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { z } from 'zod';

type Migration = { name: string; sql: string; checksum: string };

const baseline = '0001_coreerp_baseline.sql';
const adoptFlag = '--adopt-coreerp';

const environment = z
    .object({
        DB_HOST: z.string().min(1),
        DB_PORT: z.coerce.number().int().positive(),
        DB_DATABASE: z.string().min(1),
        DB_USERNAME: z.string().min(1),
        DB_PASSWORD: z.string().min(1),
    })
    .parse(process.env);

const flags = process.argv.slice(2);
const unknownFlags = flags.filter((flag) => flag !== adoptFlag);
if (unknownFlags.length) {
    console.error(
        `Unknown argument ${unknownFlags.join(' ')}. The only option is ${adoptFlag}.`,
    );
    process.exit(1);
}
const adopt = flags.includes(adoptFlag);

const directory = resolve(import.meta.dir, '../database/migrations');
const migrations: Migration[] = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
        const bytes = readFileSync(join(directory, name));
        return {
            name,
            sql: bytes.toString('utf8'),
            checksum: createHash('sha256').update(bytes).digest('hex'),
        };
    });

const sql = postgres({
    host: environment.DB_HOST,
    port: environment.DB_PORT,
    database: environment.DB_DATABASE,
    username: environment.DB_USERNAME,
    password: environment.DB_PASSWORD,
    max: 1,
    onnotice: (notice) => console.log(notice.message),
});

function baselineTables(migration: Migration): string[] {
    return [...migration.sql.matchAll(/^CREATE TABLE public\.(\w+) \(/gm)]
        .map((match) => match[1])
        .filter((table) => table !== undefined);
}

async function missingTables(tables: string[]): Promise<string[]> {
    const present = await sql<{ relname: string }[]>`
        select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = any(${sql.array(tables)})`;
    const found = new Set(present.map((row) => row.relname));
    return tables.filter((table) => !found.has(table));
}

async function migrate(): Promise<void> {
    // Dua proses migrate yang berjalan bersamaan saling menunggu di kunci ini, bukan saling menabrak.
    await sql`select pg_advisory_lock(hashtext('schema_migrations'))`;
    // Selalu bersama schema-nya, karena berkas migration boleh mengosongkan search_path (0001 melakukannya).
    await sql`
        create table if not exists public.schema_migrations (
            name text primary key,
            checksum text not null,
            applied_at timestamptz not null default now()
        )`;
    const applied = new Map(
        (
            await sql<
                { name: string; checksum: string }[]
            >`select name, checksum from public.schema_migrations`
        ).map((row) => [row.name, row.checksum]),
    );

    const problems = [...applied].flatMap(([name, checksum]) => {
        const file = migrations.find((migration) => migration.name === name);
        if (!file) return [`${name} is recorded as applied but has no file.`];
        if (file.checksum !== checksum)
            return [
                `${name} changed after it was applied: recorded ${checksum}, file ${file.checksum}.`,
            ];
        return [];
    });
    if (problems.length) throw new Error(problems.join('\n'));

    if (adopt && !applied.has(baseline)) {
        const file = migrations.find(
            (migration) => migration.name === baseline,
        );
        if (!file) throw new Error(`${baseline} is missing from ${directory}.`);
        const tables = baselineTables(file);
        const missing = await missingTables(tables);
        if (missing.length)
            throw new Error(
                `${adoptFlag} needs a database restored from a CoreERP dump, but ${missing.length} of ${tables.length} baseline tables are missing, for example ${missing.slice(0, 5).join(', ')}.`,
            );
        await sql`insert into public.schema_migrations (name, checksum) values (${baseline}, ${file.checksum})`;
        applied.set(baseline, file.checksum);
        console.log(`adopted ${baseline} without running it`);
    }

    const pending = migrations.filter(
        (migration) => !applied.has(migration.name),
    );
    for (const migration of pending) {
        const started = performance.now();
        await sql.begin(async (transaction) => {
            // Setelan sesi dari berkas sebelumnya (misalnya search_path kosong dari pg_dump) tidak boleh terbawa.
            await transaction.unsafe('reset all');
            await transaction.unsafe(migration.sql);
            await transaction`insert into public.schema_migrations (name, checksum) values (${migration.name}, ${migration.checksum})`;
        });
        const seconds = (performance.now() - started) / 1000;
        console.log(`applied ${migration.name} in ${seconds.toFixed(1)} s`);
    }
    if (!pending.length) console.log('database is up to date');
}

try {
    await migrate();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await sql.end();
}
