import { afterAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { z } from 'zod';
import { databaseSettingsSchema } from '../../../src/platform/config/index.ts';
import {
    type ControlPlaneClient,
    OperationLost,
    type StepReport,
} from '../../../src/platform/control-plane/index.ts';
import {
    findRoute,
    provisionEnvironment,
    provisionRequestSchema,
    runOperation,
} from '../../../src/platform/environment/index.ts';
import {
    migrate,
    readMigrationSource,
} from '../../../src/platform/migration/index.ts';
import {
    createModule,
    createReference,
    createSequence,
} from '../../support/number-sequence-fixtures.ts';

describe.skipIf(!process.env.DB_HOST)('worker menjalankan operasi', () => {
    if (!process.env.DB_HOST) return;
    const settings = databaseSettingsSchema.parse(process.env);
    const source = readMigrationSource(resolve(import.meta.dir, '../../..'));
    const runtime = postgres({
        host: settings.DB_HOST,
        port: settings.DB_PORT,
        database: settings.DB_DATABASE,
        username: settings.DB_USERNAME,
        password: settings.DB_PASSWORD,
        max: 1,
        onnotice: () => {},
    });
    const databases: string[] = [];
    afterAll(async () => {
        for (const database of databases)
            await runtime.unsafe(
                `drop database if exists "${database}" with (force)`,
            );
        await runtime.end();
    }, 120_000);

    async function parameters() {
        const id = Bun.randomUUIDv7();
        const database = `${settings.DB_DATABASE.slice(0, 40)}_wk_${id.slice(-8)}`;
        databases.push(database);
        return {
            environment: { kind: 'production', name: 'Produksi' },
            database,
            client: {
                id: Bun.randomUUIDv7(),
                legal_name: 'PT Uji Worker',
                slug: `worker-${id.slice(-12)}`,
            },
            tenant: {
                id,
                name: 'Klinik Uji Worker',
                slug: `worker-${id.slice(-12)}`,
            },
            admin: {
                id: Bun.randomUUIDv7(),
                name: 'Admin Uji Worker',
                email: `worker-${id}@example.com`,
                password_hash: await Bun.password.hash('kata-sandi-worker', {
                    algorithm: 'bcrypt',
                    cost: 4,
                }),
            },
        };
    }
    // Control plane tiruan yang mencatat laporan; loseAt membuatnya menjawab 409 di langkah itu.
    function recorder(loseAt?: string) {
        const reports: StepReport[] = [];
        const client: ControlPlaneClient = {
            claim: () => Promise.resolve(null),
            report: (_id, step) => {
                if (step.step === loseAt)
                    return Promise.reject(new OperationLost('diambil alih'));
                reports.push(step);
                return Promise.resolve();
            },
        };
        return { client, reports };
    }
    const claimed = (operation: string, value: unknown) => ({
        id: Bun.randomUUIDv7(),
        operation,
        environment_id: Bun.randomUUIDv7(),
        parameters: value,
        lease_until: new Date().toISOString(),
    });

    test('penyiapan melapor setiap langkah sebelum menjalankannya, lalu menutup sukses', async () => {
        const request = await parameters();
        const { client, reports } = recorder();
        expect(
            await runOperation(
                settings,
                source,
                client,
                claimed('provision', request),
            ),
        ).toBe('succeeded');
        expect(reports).toEqual([
            { status: 'running', step: 'create-database' },
            { status: 'running', step: 'migrate' },
            { status: 'running', step: 'bootstrap-tenant' },
            { status: 'running', step: 'record-route' },
            { status: 'succeeded', step: 'done' },
        ]);
        const [route] = await runtime.unsafe(
            'select database_name from environment_routes where tenant_slug = $1',
            [request.tenant.slug],
        );
        expect(route?.database_name).toBe(request.database);
    }, 120_000);

    test('operasi yang hilang di tengah jalan berhenti di antara langkah tanpa menutupnya', async () => {
        const request = await parameters();
        const { client, reports } = recorder('migrate');
        expect(
            await runOperation(
                settings,
                source,
                client,
                claimed('provision', request),
            ),
        ).toBe('lost');
        expect(reports).toEqual([
            { status: 'running', step: 'create-database' },
        ]);
        const [route] = await runtime.unsafe(
            'select count(*)::int as count from environment_routes where tenant_slug = $1',
            [request.tenant.slug],
        );
        expect(route?.count).toBe(0);
    });

    test('parameter yang tidak sah dan operasi yang tidak dikenal ditutup gagal dengan sebabnya', async () => {
        const invalid = recorder();
        expect(
            await runOperation(
                settings,
                source,
                invalid.client,
                claimed('provision', { database: 'x' }),
            ),
        ).toBe('failed');
        expect(invalid.reports).toEqual([
            {
                status: 'failed',
                step: 'failed',
                failure_message: expect.stringContaining(
                    'Parameter penyiapan tidak sah',
                ),
            },
        ]);
        const unknown = recorder();
        expect(
            await runOperation(
                settings,
                source,
                unknown.client,
                claimed('purge', {}),
            ),
        ).toBe('failed');
        expect(unknown.reports[0]?.failure_message).toContain('purge');
    });

    test('migrate memasang migration Core yang tertinggal dan migration module yang sudah terpasang saja', async () => {
        const request = await parameters();
        const asset = source.modules.get('asset-management') ?? [];
        expect(asset.length).toBeGreaterThan(1);
        // Lingkungan yang disiapkan versi kode sebelumnya: migration Core terakhir belum ada.
        const older = { core: source.core.slice(0, -1), modules: new Map() };
        await provisionEnvironment(
            settings,
            older,
            provisionRequestSchema.parse(request),
        );
        const environment = postgres({
            host: settings.DB_HOST,
            port: settings.DB_PORT,
            database: request.database,
            username: settings.DB_USERNAME,
            password: settings.DB_PASSWORD,
            max: 1,
            onnotice: () => {},
        });
        const applied = async () =>
            (
                await environment.unsafe<{ key: string }[]>(
                    "select owner || '/' || name as key from schema_migrations order by owner, name",
                )
            ).map((row) => row.key);
        try {
            const last = `core/${source.core.at(-1)!.name}`;
            expect(await applied()).not.toContain(last);

            const first = recorder();
            expect(
                await runOperation(
                    settings,
                    source,
                    first.client,
                    claimed('migrate', { database: request.database }),
                ),
            ).toBe('succeeded');
            expect(first.reports).toEqual([
                { status: 'running', step: 'migrate' },
                { status: 'succeeded', step: 'done' },
            ]);
            expect(await applied()).toContain(last);
            expect(
                (await applied()).filter((key) => !key.startsWith('core/')),
            ).toEqual([]);

            // Module yang terpasang di versi sebelumnya ikut dibawa ke migration terakhirnya.
            await migrate(environment, {
                core: source.core,
                modules: new Map([['asset-management', asset.slice(0, -1)]]),
            });
            const second = recorder();
            expect(
                await runOperation(
                    settings,
                    source,
                    second.client,
                    claimed('migrate', { database: request.database }),
                ),
            ).toBe('succeeded');
            expect(
                (await applied()).filter((key) =>
                    key.startsWith('asset-management/'),
                ),
            ).toEqual(asset.map((file) => `asset-management/${file.name}`));
        } finally {
            await environment.end();
        }
    }, 180_000);

    test('migrate menolak database yang belum disiapkan dan parameter yang tidak sah', async () => {
        const missing = recorder();
        expect(
            await runOperation(
                settings,
                source,
                missing.client,
                claimed('migrate', {
                    database: `${settings.DB_DATABASE.slice(0, 40)}_none_${crypto.randomUUID().slice(-6)}`,
                }),
            ),
        ).toBe('failed');
        expect(missing.reports.at(-1)?.failure_message).toContain(
            'has not been provisioned',
        );
        const runtimeDatabase = recorder();
        expect(
            await runOperation(
                settings,
                source,
                runtimeDatabase.client,
                claimed('migrate', { database: settings.DB_DATABASE }),
            ),
        ).toBe('failed');
        const extra = recorder();
        expect(
            await runOperation(
                settings,
                source,
                extra.client,
                claimed('migrate', { database: 'env_x', admin: {} }),
            ),
        ).toBe('failed');
        expect(extra.reports).toEqual([
            {
                status: 'failed',
                step: 'failed',
                failure_message: expect.stringContaining(
                    'Parameter migrate tidak sah',
                ),
            },
        ]);
    });

    test('convert memindah alamat demo ke alamat produksi yang menunjuk database yang sama, dan aman diulang', async () => {
        const demo = await parameters();
        demo.environment = { kind: 'demo', name: 'Demo' };
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('provision', demo),
            ),
        ).toBe('succeeded');
        const routes = async (slug: string) =>
            (
                await runtime.unsafe<
                    { kind: string; name: string; database_name: string }[]
                >(
                    'select kind, name, database_name from environment_routes where tenant_slug = $1 order by kind',
                    [slug],
                )
            ).map((row) => ({ ...row }));
        const convert = {
            tenant_slug: demo.tenant.slug,
            database: demo.database,
            name: 'Produksi',
        };
        const first = recorder();
        expect(
            await runOperation(
                settings,
                source,
                first.client,
                claimed('convert', convert),
            ),
        ).toBe('succeeded');
        expect(first.reports).toEqual([
            { status: 'running', step: 'move-route' },
            { status: 'succeeded', step: 'done' },
        ]);
        expect(await routes(demo.tenant.slug)).toEqual([
            {
                kind: 'production',
                name: 'Produksi',
                database_name: demo.database,
            },
        ]);
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('convert', convert),
            ),
        ).toBe('succeeded');
        expect(await routes(demo.tenant.slug)).toHaveLength(1);
    }, 120_000);

    test('convert tidak menimpa alamat produksi milik database lain dan menolak parameter yang tidak sah', async () => {
        const slug = `convert-${crypto.randomUUID().slice(-12)}`;
        await runtime.unsafe(
            "insert into environment_routes (tenant_slug, kind, tenant_id, name, database_name) values ($1, 'demo', $2, 'Demo', 'env_demo_a'), ($1, 'production', $2, 'Produksi', 'env_production_b')",
            [slug, Bun.randomUUIDv7()],
        );
        const taken = recorder();
        expect(
            await runOperation(
                settings,
                source,
                taken.client,
                claimed('convert', {
                    tenant_slug: slug,
                    database: 'env_demo_a',
                    name: 'Produksi',
                }),
            ),
        ).toBe('failed');
        expect(taken.reports.at(-1)?.failure_message).toContain(
            'already points to another environment',
        );
        const kinds = await runtime.unsafe<{ database_name: string }[]>(
            "select database_name from environment_routes where tenant_slug = $1 and kind = 'production'",
            [slug],
        );
        expect(kinds.map((row) => row.database_name)).toEqual([
            'env_production_b',
        ]);

        const missing = recorder();
        expect(
            await runOperation(
                settings,
                source,
                missing.client,
                claimed('convert', {
                    tenant_slug: `missing-${crypto.randomUUID().slice(-8)}`,
                    database: null,
                    name: 'Produksi',
                }),
            ),
        ).toBe('failed');
        expect(missing.reports.at(-1)?.failure_message).toContain(
            'is not recorded',
        );

        const invalid = recorder();
        expect(
            await runOperation(
                settings,
                source,
                invalid.client,
                claimed('convert', { tenant_slug: 'admin', database: null }),
            ),
        ).toBe('failed');
        expect(invalid.reports.at(-1)?.failure_message).toContain(
            'Parameter convert tidak sah',
        );
    });

    test('expire menonaktifkan alamat demo tanpa menyentuh databasenya, dan aman diulang', async () => {
        const demo = await parameters();
        demo.environment = { kind: 'demo', name: 'Demo' };
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('provision', demo),
            ),
        ).toBe('succeeded');
        expect(
            await findRoute(runtime, demo.tenant.slug, 'demo'),
        ).not.toBeNull();
        const expire = {
            tenant_slug: demo.tenant.slug,
            database: demo.database,
        };
        const first = recorder();
        expect(
            await runOperation(
                settings,
                source,
                first.client,
                claimed('expire', expire),
            ),
        ).toBe('succeeded');
        expect(first.reports).toEqual([
            { status: 'running', step: 'disable-route' },
            { status: 'succeeded', step: 'done' },
        ]);
        expect(await findRoute(runtime, demo.tenant.slug, 'demo')).toBeNull();
        const [kept] = await runtime.unsafe(
            "select count(*)::int as routes, (select count(*)::int from pg_database where datname = $2) as databases from environment_routes where tenant_slug = $1 and kind = 'demo' and disabled_at is not null",
            [demo.tenant.slug, demo.database],
        );
        expect(kept?.routes).toBe(1);
        expect(kept?.databases).toBe(1);
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('expire', expire),
            ),
        ).toBe('succeeded');
    }, 120_000);

    test('expire tidak menonaktifkan alamat demo milik database lain dan menolak parameter yang tidak sah', async () => {
        const slug = `expire-${crypto.randomUUID().slice(-12)}`;
        await runtime.unsafe(
            "insert into environment_routes (tenant_slug, kind, tenant_id, name, database_name) values ($1, 'demo', $2, 'Demo', 'env_demo_lain')",
            [slug, Bun.randomUUIDv7()],
        );
        const other = recorder();
        expect(
            await runOperation(
                settings,
                source,
                other.client,
                claimed('expire', {
                    tenant_slug: slug,
                    database: 'env_demo_ini',
                }),
            ),
        ).toBe('failed');
        expect(other.reports.at(-1)?.failure_message).toContain(
            'points to database env_demo_lain',
        );
        expect(await findRoute(runtime, slug, 'demo')).not.toBeNull();

        const missing = recorder();
        expect(
            await runOperation(
                settings,
                source,
                missing.client,
                claimed('expire', {
                    tenant_slug: `missing-${crypto.randomUUID().slice(-8)}`,
                    database: null,
                }),
            ),
        ).toBe('succeeded');

        const invalid = recorder();
        expect(
            await runOperation(
                settings,
                source,
                invalid.client,
                claimed('expire', { tenant_slug: slug }),
            ),
        ).toBe('failed');
        expect(invalid.reports.at(-1)?.failure_message).toContain(
            'Parameter expire tidak sah',
        );
    });

    test('restore menyalakan lagi alamat yang dinonaktifkan expire, dan aman diulang', async () => {
        const demo = await parameters();
        demo.environment = { kind: 'demo', name: 'Demo' };
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('provision', demo),
            ),
        ).toBe('succeeded');
        const target = {
            tenant_slug: demo.tenant.slug,
            database: demo.database,
        };
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('expire', target),
            ),
        ).toBe('succeeded');
        expect(await findRoute(runtime, demo.tenant.slug, 'demo')).toBeNull();
        const first = recorder();
        expect(
            await runOperation(
                settings,
                source,
                first.client,
                claimed('restore', { ...target, kind: 'demo' }),
            ),
        ).toBe('succeeded');
        expect(first.reports).toEqual([
            { status: 'running', step: 'enable-route' },
            { status: 'succeeded', step: 'done' },
        ]);
        expect(
            (await findRoute(runtime, demo.tenant.slug, 'demo'))?.database_name,
        ).toBe(demo.database);
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('restore', { ...target, kind: 'demo' }),
            ),
        ).toBe('succeeded');
    }, 120_000);

    test('restore menolak alamat yang tidak tercatat atau menunjuk database lain', async () => {
        const slug = `restore-${crypto.randomUUID().slice(-12)}`;
        await runtime.unsafe(
            "insert into environment_routes (tenant_slug, kind, tenant_id, name, database_name, disabled_at) values ($1, 'demo', $2, 'Demo', 'env_demo_lain', now())",
            [slug, Bun.randomUUIDv7()],
        );
        const other = recorder();
        expect(
            await runOperation(
                settings,
                source,
                other.client,
                claimed('restore', {
                    tenant_slug: slug,
                    kind: 'demo',
                    database: 'env_demo_ini',
                }),
            ),
        ).toBe('failed');
        expect(other.reports.at(-1)?.failure_message).toContain(
            'points to database env_demo_lain',
        );
        expect(await findRoute(runtime, slug, 'demo')).toBeNull();
        const missing = recorder();
        expect(
            await runOperation(
                settings,
                source,
                missing.client,
                claimed('restore', {
                    tenant_slug: `missing-${crypto.randomUUID().slice(-8)}`,
                    kind: 'production',
                    database: null,
                }),
            ),
        ).toBe('failed');
        expect(missing.reports.at(-1)?.failure_message).toContain(
            'is not recorded',
        );
    });

    test('purge membuang database demo yang alamatnya sudah nonaktif, dan aman diulang', async () => {
        const demo = await parameters();
        demo.environment = { kind: 'demo', name: 'Demo' };
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('provision', demo),
            ),
        ).toBe('succeeded');
        const target = {
            tenant_slug: demo.tenant.slug,
            database: demo.database,
        };
        const purge = { ...target, kind: 'demo' };
        const exists = async () =>
            (
                await runtime.unsafe<{ count: number }[]>(
                    'select count(*)::int as count from pg_database where datname = $1',
                    [demo.database],
                )
            )[0]?.count;

        // Alamatnya masih aktif: tidak dibuang.
        const active = recorder();
        expect(
            await runOperation(
                settings,
                source,
                active.client,
                claimed('purge', purge),
            ),
        ).toBe('failed');
        expect(active.reports.at(-1)?.failure_message).toContain(
            'is still active',
        );
        expect(await exists()).toBe(1);

        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('expire', target),
            ),
        ).toBe('succeeded');
        const first = recorder();
        expect(
            await runOperation(
                settings,
                source,
                first.client,
                claimed('purge', purge),
            ),
        ).toBe('succeeded');
        expect(first.reports).toEqual([
            { status: 'running', step: 'check-route' },
            { status: 'running', step: 'drop-database' },
            { status: 'succeeded', step: 'done' },
        ]);
        expect(await exists()).toBe(0);
        const [tombstone] = await runtime.unsafe(
            "select count(*)::int as count from environment_routes where tenant_slug = $1 and kind = 'demo' and disabled_at is not null",
            [demo.tenant.slug],
        );
        expect(tombstone?.count).toBe(1);
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('purge', purge),
            ),
        ).toBe('succeeded');
    }, 120_000);

    test('purge menolak produksi, database runtime, dan database yang ditunjuk alamat aktif lain', async () => {
        const production = recorder();
        expect(
            await runOperation(
                settings,
                source,
                production.client,
                claimed('purge', {
                    tenant_slug: `purge-${crypto.randomUUID().slice(-8)}`,
                    kind: 'production',
                    database: 'env_apa_saja',
                }),
            ),
        ).toBe('failed');
        expect(production.reports.at(-1)?.failure_message).toContain(
            'Parameter purge tidak sah',
        );

        const runtimeDatabase = recorder();
        expect(
            await runOperation(
                settings,
                source,
                runtimeDatabase.client,
                claimed('purge', {
                    tenant_slug: `purge-${crypto.randomUUID().slice(-8)}`,
                    kind: 'demo',
                    database: settings.DB_DATABASE,
                }),
            ),
        ).toBe('failed');
        expect(runtimeDatabase.reports.at(-1)?.failure_message).toContain(
            'runtime or a system database',
        );

        const slug = `purge-${crypto.randomUUID().slice(-12)}`;
        await runtime.unsafe(
            "insert into environment_routes (tenant_slug, kind, tenant_id, name, database_name) values ($1, 'production', $2, 'Produksi', 'env_dipakai_produksi')",
            [slug, Bun.randomUUIDv7()],
        );
        const shared = recorder();
        expect(
            await runOperation(
                settings,
                source,
                shared.client,
                claimed('purge', {
                    tenant_slug: `other-${crypto.randomUUID().slice(-8)}`,
                    kind: 'demo',
                    database: 'env_dipakai_produksi',
                }),
            ),
        ).toBe('failed');
        expect(shared.reports.at(-1)?.failure_message).toContain(
            `Address ${slug} (production) is still active`,
        );
    });

    test('copy menyalin produksi menjadi sandbox yang terlucuti, tanpa menyentuh produksi, dan aman diulang', async () => {
        const production = await parameters();
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('provision', production),
            ),
        ).toBe('succeeded');
        const connectTo = (database: string) =>
            postgres({
                host: settings.DB_HOST,
                port: settings.DB_PORT,
                database,
                username: settings.DB_USERNAME,
                password: settings.DB_PASSWORD,
                max: 1,
                onnotice: () => {},
            });
        const sourceDb = connectTo(production.database);
        const sandboxDatabase = `${settings.DB_DATABASE.slice(0, 40)}_sb_${crypto.randomUUID().slice(-8)}`;
        databases.push(sandboxDatabase);
        const leftovers = async (sql: postgres.Sql) =>
            z
                .object({
                    events: z.number(),
                    exports: z.number(),
                    reservations: z.number(),
                    pool: z.number(),
                    jobs: z.number(),
                    credentials: z.number(),
                    sessions: z.number(),
                    cache: z.number(),
                    users: z.number(),
                })
                .parse(
                    (
                        await sql.unsafe(
                            `select
                                (select count(*)::int from outbox_events where published_at is null) as events,
                                (select count(*)::int from report_exports where status = 'queued') as exports,
                                (select count(*)::int from number_sequence_reservations where status = 'reserved') as reservations,
                                (select count(*)::int from number_sequence_continuous_pool where status = 'reserved') as pool,
                                (select count(*)::int from jobs) as jobs,
                                (select count(*)::int from app_service_credentials) as credentials,
                                (select count(*)::int from sessions) as sessions,
                                (select count(*)::int from cache) as cache,
                                (select count(*)::int from users) as users`,
                        )
                    )[0],
                );
        try {
            // Efek keluar yang menunggu di produksi, dengan app dan number sequence yang sah supaya kunci asingnya utuh.
            const tenant = production.tenant.id;
            const app = await createModule(sourceDb);
            const reference = await createReference(sourceDb, app, 'Uji');
            const sequence = await createSequence(
                sourceDb,
                tenant,
                reference.id,
                {},
            );
            await sourceDb.begin(async (transaction) => {
                const reservation = Bun.randomUUIDv7();
                await transaction.unsafe(
                    `insert into outbox_events (id, tenant_id, type, payload, occurred_at)
                     values ($1, $2, 'uji.event.v1', '{}', now())`,
                    [Bun.randomUUIDv7(), tenant],
                );
                await transaction.unsafe(
                    `insert into report_exports (id, tenant_id, membership_id, user_id, app_id, report_code, report_name,
                        layout_ref, layout_name, format, parameters, status)
                     values ($1, $2, $3, $4, 'core', 'uji', 'Uji', 'uji', 'Uji', 'pdf', '{}', 'queued')`,
                    [
                        Bun.randomUUIDv7(),
                        tenant,
                        Bun.randomUUIDv7(),
                        production.admin.id,
                    ],
                );
                await transaction.unsafe(
                    `insert into number_sequence_reservations (id, sequence_id, app_id, scope_key, numeric_value,
                        formatted_value, idempotency_key, status, expires_at)
                     values ($1, $2, $4, 'uji', 7, 'UJI-7', $3, 'reserved', now() + interval '15 minutes')`,
                    [reservation, sequence, `uji-${reservation}`, app],
                );
                await transaction.unsafe(
                    `insert into number_sequence_continuous_pool (sequence_id, scope_key, numeric_value, status,
                        reservation_id)
                     values ($1, 'uji', 7, 'reserved', $2)`,
                    [sequence, reservation],
                );
                await transaction.unsafe(
                    "insert into jobs (queue, payload, attempts, available_at, created_at) values ('default', '{}', 0, 0, 0)",
                );
                await transaction.unsafe(
                    "insert into app_service_credentials (id, app_id, name) values ($1, $2, 'token produksi')",
                    [Bun.randomUUIDv7(), app],
                );
                await transaction.unsafe(
                    "insert into sessions (id, payload, last_activity) values ($1, '{}', 0)",
                    [crypto.randomUUID()],
                );
                await transaction.unsafe(
                    "insert into cache (key, value, expiration) values ($1, 'x', 0)",
                    [crypto.randomUUID()],
                );
            });
            const before = await leftovers(sourceDb);
            const copy = {
                tenant_id: production.tenant.id,
                tenant_slug: production.tenant.slug,
                name: 'Sandbox',
                source_database: production.database,
                database: sandboxDatabase,
            };
            const first = recorder();
            const outcome = await runOperation(
                settings,
                source,
                first.client,
                claimed('copy', copy),
            );
            // Pesan kegagalan ikut dibandingkan supaya sebabnya terbaca bila copy gagal.
            expect({
                outcome,
                failure: first.reports.at(-1)?.failure_message,
            }).toEqual({ outcome: 'succeeded', failure: undefined });
            expect(first.reports.map((report) => report.step)).toEqual([
                'create-database',
                'copy',
                'disarm',
                'migrate',
                'check-health',
                'record-route',
                'done',
            ]);
            const sandboxDb = connectTo(sandboxDatabase);
            try {
                expect(await leftovers(sandboxDb)).toEqual({
                    events: 0,
                    exports: 0,
                    reservations: 0,
                    pool: 0,
                    jobs: 0,
                    credentials: 0,
                    sessions: 0,
                    cache: 0,
                    users: before.users,
                });
            } finally {
                await sandboxDb.end();
            }
            expect(await leftovers(sourceDb)).toEqual(before);
            expect(
                (await findRoute(runtime, production.tenant.slug, 'sandbox'))
                    ?.database_name,
            ).toBe(sandboxDatabase);

            const again = recorder();
            expect(
                await runOperation(
                    settings,
                    source,
                    again.client,
                    claimed('copy', copy),
                ),
            ).toBe('succeeded');
            expect(again.reports.map((report) => report.step)).not.toContain(
                'copy',
            );
        } finally {
            await sourceDb.end();
        }

        const same = recorder();
        expect(
            await runOperation(
                settings,
                source,
                same.client,
                claimed('copy', {
                    tenant_id: production.tenant.id,
                    tenant_slug: production.tenant.slug,
                    name: 'Sandbox',
                    source_database: production.database,
                    database: production.database,
                }),
            ),
        ).toBe('failed');
        expect(same.reports.at(-1)?.failure_message).toContain(
            'Parameter copy tidak sah',
        );
    }, 240_000);
});
