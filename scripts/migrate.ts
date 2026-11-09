import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { z } from 'zod';

// Core dan setiap module mencatat migration-nya sendiri, karena module dipasang per lingkungan. owner bernilai core
// atau nama folder module.
type Migration = { owner: string; name: string; sql: string; checksum: string };
type Selection = { adopt: boolean; owners: Migration[][] };

const root = resolve(import.meta.dir, '..');
const usage =
    'Usage: bun scripts/migrate.ts [--adopt-coreerp] [--modules <module,...>]';

const environment = z
    .object({
        DB_HOST: z.string().min(1),
        DB_PORT: z.coerce.number().int().positive(),
        DB_DATABASE: z.string().min(1),
        DB_USERNAME: z.string().min(1),
        DB_PASSWORD: z.string().min(1),
    })
    .parse(process.env);

function readMigrations(owner: string, directory: string): Migration[] {
    return readdirSync(directory)
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .map((name) => {
            const bytes = readFileSync(join(directory, name));
            return {
                owner,
                name,
                sql: bytes.toString('utf8'),
                checksum: createHash('sha256').update(bytes).digest('hex'),
            };
        });
}

const key = (migration: { owner: string; name: string }) =>
    `${migration.owner}/${migration.name}`;

const core = readMigrations('core', join(root, 'database', 'migrations'));
const modules = new Map(
    readdirSync(join(root, 'modules'))
        .sort()
        .map((module) => ({
            module,
            directory: join(root, 'modules', module, 'database', 'migrations'),
        }))
        .filter(({ directory }) => existsSync(directory))
        .map(({ module, directory }) => [
            module,
            readMigrations(module, directory),
        ]),
);

// Tanpa --modules, Core dan semua module dimigrasi. --modules '' berarti Core saja.
function select(args: string[]): Selection {
    const { values } = parseArgs({
        args,
        options: {
            'adopt-coreerp': { type: 'boolean', default: false },
            modules: { type: 'string' },
        },
    });
    const chosen = new Set(
        values.modules === undefined
            ? modules.keys()
            : values.modules.split(',').filter((name) => name !== ''),
    );
    const unknown = [...chosen].filter((name) => !modules.has(name));
    if (unknown.length)
        throw new Error(
            `Unknown module ${unknown.join(', ')}. Modules with migrations: ${[...modules.keys()].join(', ') || 'none'}.`,
        );
    return {
        adopt: values['adopt-coreerp'],
        owners: [
            core,
            ...[...modules]
                .filter(([name]) => chosen.has(name))
                .map(([, migrations]) => migrations),
        ],
    };
}

let selection: Selection;
try {
    selection = select(process.argv.slice(2));
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage);
    process.exit(1);
}

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

async function migrate({ adopt, owners }: Selection): Promise<void> {
    // Dua proses migrate yang berjalan bersamaan saling menunggu di kunci ini, bukan saling menabrak.
    await sql`select pg_advisory_lock(hashtext('schema_migrations'))`;
    // Selalu bersama schema-nya, karena berkas migration boleh mengosongkan search_path (0001 melakukannya).
    await sql`
        create table if not exists public.schema_migrations (
            owner text not null,
            name text not null,
            checksum text not null,
            applied_at timestamptz not null default now(),
            primary key (owner, name)
        )`;
    // Tabel buatan migrate.ts sebelum module punya migration sendiri belum punya owner, dan semua barisnya milik Core.
    await sql`
        do $$ begin
            if not exists (select 1 from pg_attribute
                    where attrelid = 'public.schema_migrations'::regclass and attname = 'owner' and not attisdropped) then
                alter table public.schema_migrations add column owner text not null default 'core';
                alter table public.schema_migrations alter column owner drop default;
                alter table public.schema_migrations drop constraint schema_migrations_pkey, add primary key (owner, name);
            end if;
        end $$`;
    const applied = new Map(
        (
            await sql<
                { owner: string; name: string; checksum: string }[]
            >`select owner, name, checksum from public.schema_migrations`
        ).map((row) => [key(row), row.checksum]),
    );

    // Catatan module yang tidak dipilih pun harus cocok dengan berkas di repo.
    const files = new Map(
        [core, ...modules.values()].flat().map((file) => [key(file), file]),
    );
    const problems = [...applied].flatMap(([recorded, checksum]) => {
        const file = files.get(recorded);
        if (!file)
            return [`${recorded} is recorded as applied but has no file.`];
        if (file.checksum !== checksum)
            return [
                `${recorded} changed after it was applied: recorded ${checksum}, file ${file.checksum}.`,
            ];
        return [];
    });
    if (problems.length) throw new Error(problems.join('\n'));

    // Dump CoreERP sudah memuat migration pertama setiap pemilik, yaitu 0001 Core dan 0001 tiap module.
    if (adopt) {
        const baselines = owners.flatMap((migrations) =>
            migrations.slice(0, 1).filter((first) => !applied.has(key(first))),
        );
        for (const baseline of baselines) {
            const tables = baselineTables(baseline);
            const missing = await missingTables(tables);
            if (missing.length)
                throw new Error(
                    `--adopt-coreerp needs a database restored from a CoreERP dump, but ${missing.length} of ${tables.length} tables of ${key(baseline)} are missing, for example ${missing.slice(0, 5).join(', ')}.`,
                );
        }
        for (const baseline of baselines) {
            await sql`insert into public.schema_migrations (owner, name, checksum) values (${baseline.owner}, ${baseline.name}, ${baseline.checksum})`;
            applied.set(key(baseline), baseline.checksum);
            console.log(`adopted ${key(baseline)} without running it`);
        }
    }

    // Core lebih dulu, lalu module, karena migration module boleh bergantung pada Core dan tidak sebaliknya.
    const pending = owners
        .flat()
        .filter((migration) => !applied.has(key(migration)));
    for (const migration of pending) {
        const started = performance.now();
        await sql.begin(async (transaction) => {
            // Setelan sesi dari berkas sebelumnya (misalnya search_path kosong dari pg_dump) tidak boleh terbawa.
            await transaction.unsafe('reset all');
            await transaction.unsafe(migration.sql);
            await transaction`insert into public.schema_migrations (owner, name, checksum) values (${migration.owner}, ${migration.name}, ${migration.checksum})`;
        });
        const seconds = (performance.now() - started) / 1000;
        console.log(`applied ${key(migration)} in ${seconds.toFixed(1)} s`);
    }
    if (!pending.length) console.log('database is up to date');
}

try {
    await migrate(selection);
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await sql.end();
}
