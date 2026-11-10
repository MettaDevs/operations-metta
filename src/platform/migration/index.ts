import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type postgres from 'postgres';

// Core dan setiap module mencatat migration-nya sendiri, karena module dipasang per lingkungan. owner bernilai core
// atau nama folder module.
export type Migration = {
    owner: string;
    name: string;
    sql: string;
    checksum: string;
};
export type MigrationSource = {
    core: Migration[];
    modules: Map<string, Migration[]>;
};
export type MigrateOptions = {
    // Tanpa daftar, Core dan semua module dimigrasi. Daftar kosong berarti Core saja.
    modules?: string[];
    // Dump CoreERP sudah memuat migration pertama setiap pemilik, yaitu 0001 Core dan 0001 tiap module.
    adoptCoreErp?: boolean;
    log?: (line: string) => void;
};

function readOwner(owner: string, directory: string): Migration[] {
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

export function readMigrationSource(root: string): MigrationSource {
    return {
        core: readOwner('core', join(root, 'database', 'migrations')),
        modules: new Map(
            readdirSync(join(root, 'modules'))
                .sort()
                .map((module) => ({
                    module,
                    directory: join(
                        root,
                        'modules',
                        module,
                        'database',
                        'migrations',
                    ),
                }))
                .filter(({ directory }) => existsSync(directory))
                .map(({ module, directory }) => [
                    module,
                    readOwner(module, directory),
                ]),
        ),
    };
}

const key = (migration: { owner: string; name: string }) =>
    `${migration.owner}/${migration.name}`;

function baselineTables(migration: Migration): string[] {
    return [...migration.sql.matchAll(/^CREATE TABLE public\.(\w+) \(/gm)]
        .map((match) => match[1])
        .filter((table) => table !== undefined);
}

export async function migrate(
    sql: postgres.Sql,
    source: MigrationSource,
    {
        modules,
        adoptCoreErp = false,
        log = () => {
            // Tanpa `log`, kemajuan migration tidak dicetak.
        },
    }: MigrateOptions = {},
): Promise<void> {
    // Kunci advisory berlaku per sesi, jadi kunci dan seluruh migration harus berjalan di satu koneksi yang sama.
    if (sql.options.max !== 1)
        throw new Error('migrate needs a client with exactly one connection.');
    const chosen = new Set(modules ?? source.modules.keys());
    const unknown = [...chosen].filter((name) => !source.modules.has(name));
    if (unknown.length)
        throw new Error(
            `Unknown module ${unknown.join(', ')}. Modules with migrations: ${[...source.modules.keys()].join(', ') || 'none'}.`,
        );
    const owners = [
        source.core,
        ...[...source.modules]
            .filter(([name]) => chosen.has(name))
            .map(([, migrations]) => migrations),
    ];

    // Dua proses migrate yang berjalan bersamaan saling menunggu di kunci ini, bukan saling menabrak.
    await sql`select pg_advisory_lock(hashtext('schema_migrations'))`;
    try {
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
            [source.core, ...source.modules.values()]
                .flat()
                .map((file) => [key(file), file]),
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

        if (adoptCoreErp) {
            const baselines = owners.flatMap((migrations) =>
                migrations
                    .slice(0, 1)
                    .filter((first) => !applied.has(key(first))),
            );
            for (const baseline of baselines) {
                const tables = baselineTables(baseline);
                const present = await sql<{ relname: string }[]>`
                    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = any(${sql.array(tables)})`;
                const found = new Set(present.map((row) => row.relname));
                const missing = tables.filter((table) => !found.has(table));
                if (missing.length)
                    throw new Error(
                        `--adopt-coreerp needs a database restored from a CoreERP dump, but ${missing.length} of ${tables.length} tables of ${key(baseline)} are missing, for example ${missing.slice(0, 5).join(', ')}.`,
                    );
            }
            for (const baseline of baselines) {
                await sql`insert into public.schema_migrations (owner, name, checksum) values (${baseline.owner}, ${baseline.name}, ${baseline.checksum})`;
                applied.set(key(baseline), baseline.checksum);
                log(`adopted ${key(baseline)} without running it`);
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
            log(`applied ${key(migration)} in ${seconds.toFixed(1)} s`);
        }
        if (!pending.length) log('database is up to date');
    } finally {
        await sql`select pg_advisory_unlock(hashtext('schema_migrations'))`;
    }
}
