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
    gatherHostReport,
    provisionEnvironment,
    readModuleCatalog,
    provisionRequestSchema,
    runOperation,
} from '../../../src/platform/environment/index.ts';
import {
    migrate,
    readMigrationSource,
} from '../../../src/platform/migration/index.ts';
import { createMigratedEnvironmentDatabase } from '../../support/environment-database.ts';

describe.skipIf(!process.env.DB_HOST)('worker menjalankan operasi', () => {
    if (!process.env.DB_HOST) return;
    const settings = databaseSettingsSchema.parse(process.env);
    const root = resolve(import.meta.dir, '../../..');
    const source = readMigrationSource(root);
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

    // Database lingkungan disalin dari template yang Core-nya sudah dimigrasi, kecuali test yang menguji jalur
    // migration-nya sendiri.
    async function parameters({ fromTemplate = true } = {}) {
        const id = Bun.randomUUIDv7();
        const database = `${settings.DB_DATABASE.slice(0, 40)}_wk_${id.slice(-8)}`;
        databases.push(database);
        if (fromTemplate)
            await createMigratedEnvironmentDatabase(settings, source, database);
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
            reportHost: () => Promise.resolve({ matched: 0, unknown: 0 }),
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
        const request = await parameters({ fromTemplate: false });
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
        const request = await parameters({ fromTemplate: false });
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

    test('laporan host memuat lingkungan yang alamatnya aktif, dengan skema, ukuran, dan sebab bila tidak sehat', async () => {
        const healthy = await parameters();
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('provision', healthy),
            ),
        ).toBe('succeeded');
        const expired = await parameters();
        expired.environment = { kind: 'demo', name: 'Demo' };
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('provision', expired),
            ),
        ).toBe('succeeded');
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('expire', {
                    tenant_slug: expired.tenant.slug,
                    database: expired.database,
                }),
            ),
        ).toBe('succeeded');
        const missingSlug = `lapor-${crypto.randomUUID().slice(-12)}`;
        await runtime.unsafe(
            "insert into environment_routes (tenant_slug, kind, tenant_id, name, database_name) values ($1, 'production', $2, 'Produksi', $3)",
            [
                missingSlug,
                Bun.randomUUIDv7(),
                `${settings.DB_DATABASE.slice(0, 40)}_hilang`,
            ],
        );

        const report = await gatherHostReport(
            settings,
            '0.3.0',
            readModuleCatalog(root, source),
        );
        expect(report.release).toBe('0.3.0');
        expect(report.modules).toContainEqual({
            id: 'healthcare',
            name: 'Layanan kesehatan',
            description: 'Pasien, cara bayar, dan pelayanan klinik.',
        });
        const bySlug = (slug: string) =>
            report.environments.find(
                (environment) => environment.tenant_slug === slug,
            );
        const latestCore = source.core.at(-1)!.name;
        expect(bySlug(healthy.tenant.slug)).toMatchObject({
            kind: 'production',
            database: healthy.database,
            healthy: true,
            problem: null,
            migrations: { core: latestCore },
        });
        expect(bySlug(healthy.tenant.slug)?.size_bytes).toBeGreaterThan(0);
        expect(bySlug(expired.tenant.slug)).toBeUndefined();
        expect(bySlug(missingSlug)).toMatchObject({
            healthy: false,
            size_bytes: null,
            migrations: {},
        });
        expect(bySlug(missingSlug)?.problem).toContain(
            'Database lingkungan tidak bisa dibaca',
        );
    }, 180_000);

    test('sync_entitlements memasang module, memberi tanggal berakhir, dan mencabut hak yang tidak lagi ada', async () => {
        const request = await parameters();
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('provision', request),
            ),
        ).toBe('succeeded');
        const environment = postgres({
            host: settings.DB_HOST,
            port: settings.DB_PORT,
            database: request.database,
            username: settings.DB_USERNAME,
            password: settings.DB_PASSWORD,
            max: 1,
            onnotice: () => {},
        });
        const entitlements = async () =>
            z
                .array(
                    z.object({
                        app_id: z.string(),
                        status: z.string(),
                        ends_at: z.string().nullable(),
                    }),
                )
                .parse(
                    await environment.unsafe(
                        `select app_id, status, to_char(ends_at, 'YYYY-MM-DD HH24:MI') as ends_at
                         from tenant_app_entitlements where tenant_id = $1 order by id`,
                        [request.tenant.id],
                    ),
                );
        const sync = (modules: unknown[]) =>
            runOperation(
                settings,
                source,
                recorder().client,
                claimed('sync_entitlements', {
                    tenant_id: request.tenant.id,
                    database: request.database,
                    modules,
                }),
            );
        try {
            const { client, reports } = recorder();
            expect(
                await runOperation(
                    settings,
                    source,
                    client,
                    claimed('sync_entitlements', {
                        tenant_id: request.tenant.id,
                        database: request.database,
                        modules: [{ module_id: 'healthcare', ends_on: null }],
                    }),
                ),
            ).toBe('succeeded');
            expect(reports.map((report) => report.step)).toEqual([
                'pasang healthcare',
                'cabut hak lain',
                'done',
            ]);
            const [installed] = await environment.unsafe(
                `select count(*)::int as count from core_module_installations
                 where tenant_id = $1 and module_id = 'healthcare' and status = 'installed'`,
                [request.tenant.id],
            );
            expect(installed?.count).toBe(1);
            expect(await entitlements()).toEqual([
                { app_id: 'healthcare', status: 'active', ends_at: null },
            ]);

            // Diulang dengan tanggal berakhir: tidak ada hak kedua, tanggalnya menjadi awal hari sesudahnya.
            expect(
                await sync([
                    { module_id: 'healthcare', ends_on: '2099-12-31' },
                ]),
            ).toBe('succeeded');
            expect(await entitlements()).toEqual([
                {
                    app_id: 'healthcare',
                    status: 'active',
                    ends_at: '2100-01-01 00:00',
                },
            ]);

            expect(await sync([])).toBe('succeeded');
            expect(await entitlements()).toEqual([
                {
                    app_id: 'healthcare',
                    status: 'revoked',
                    ends_at: '2100-01-01 00:00',
                },
            ]);
            // Diberikan lagi: baris yang sama aktif kembali, karena satu tenant punya satu baris per module.
            expect(
                await sync([{ module_id: 'healthcare', ends_on: null }]),
            ).toBe('succeeded');
            expect(await entitlements()).toEqual([
                { app_id: 'healthcare', status: 'active', ends_at: null },
            ]);
            // Hak yang tanggalnya sudah lewat tetap tercatat berakhir, tanpa bentrok dengan baris yang ada.
            expect(
                await sync([
                    { module_id: 'healthcare', ends_on: '2000-01-01' },
                ]),
            ).toBe('succeeded');
            expect(await entitlements()).toEqual([
                {
                    app_id: 'healthcare',
                    status: 'active',
                    ends_at: '2000-01-02 00:00',
                },
            ]);
            const [installations] = await environment.unsafe(
                `select count(*)::int as count from core_module_installations
                 where tenant_id = $1 and module_id = 'healthcare'`,
                [request.tenant.id],
            );
            expect(installations?.count).toBe(1);
        } finally {
            await environment.end();
        }
    }, 180_000);

    test('sync_entitlements menolak module yang tidak dibawa rilis ini tanpa mengubah apa pun', async () => {
        const request = await parameters();
        expect(
            await runOperation(
                settings,
                source,
                recorder().client,
                claimed('provision', request),
            ),
        ).toBe('succeeded');
        const { client, reports } = recorder();
        expect(
            await runOperation(
                settings,
                source,
                client,
                claimed('sync_entitlements', {
                    tenant_id: request.tenant.id,
                    database: request.database,
                    modules: [{ module_id: 'tidak-ada', ends_on: null }],
                }),
            ),
        ).toBe('failed');
        expect(reports.at(-1)?.failure_message).toContain('tidak-ada');
    }, 120_000);
});
