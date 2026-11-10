import { afterAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../../../src/platform/config/index.ts';
import {
    type ControlPlaneClient,
    OperationLost,
    type StepReport,
} from '../../../src/platform/control-plane/index.ts';
import {
    provisionEnvironment,
    provisionRequestSchema,
    runOperation,
} from '../../../src/platform/environment/index.ts';
import {
    migrate,
    readMigrationSource,
} from '../../../src/platform/migration/index.ts';

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
});
