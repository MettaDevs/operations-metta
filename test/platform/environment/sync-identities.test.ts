import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../../../src/platform/config/index.ts';
import type {
    ControlPlaneClient,
    StepReport,
} from '../../../src/platform/control-plane/index.ts';
import {
    provisionEnvironment,
    provisionRequestSchema,
    runOperation,
} from '../../../src/platform/environment/index.ts';
import { readMigrationSource } from '../../../src/platform/migration/index.ts';
import { createMigratedEnvironmentDatabase } from '../../support/environment-database.ts';

const issuer = 'https://sso.example.test';

describe.skipIf(!process.env.DB_HOST)('operasi sync_identities', () => {
    if (!process.env.DB_HOST) return;
    const settings = databaseSettingsSchema.parse(process.env);
    const source = readMigrationSource(resolve(import.meta.dir, '../../..'));
    const connection = (database: string) =>
        postgres({
            host: settings.DB_HOST,
            port: settings.DB_PORT,
            database,
            username: settings.DB_USERNAME,
            password: settings.DB_PASSWORD,
            max: 1,
            onnotice: () => {},
        });
    const runtime = connection(settings.DB_DATABASE);
    const suffix = Bun.randomUUIDv7().slice(-8);
    const database = `${settings.DB_DATABASE.slice(0, 40)}_sid_${suffix}`;
    let environment: postgres.Sql;
    let tenant: ReturnType<typeof provisionRequestSchema.parse>;

    beforeAll(async () => {
        const id = Bun.randomUUIDv7();
        tenant = provisionRequestSchema.parse({
            environment: { kind: 'production', name: 'Produksi' },
            database,
            client: {
                id: Bun.randomUUIDv7(),
                legal_name: 'PT Uji Identitas',
                slug: `identitas-${id.slice(-12)}`,
            },
            tenant: {
                id,
                name: 'Klinik Uji Identitas',
                slug: `identitas-${id.slice(-12)}`,
            },
            admin: {
                id: Bun.randomUUIDv7(),
                name: 'Admin Uji Identitas',
                email: `identitas-${id}@example.com`,
                password_hash: await Bun.password.hash('kata-sandi-identitas', {
                    algorithm: 'bcrypt',
                    cost: 4,
                }),
            },
        });
        await createMigratedEnvironmentDatabase(settings, source, database);
        await provisionEnvironment(settings, source, tenant);
        environment = connection(database);
    }, 120_000);
    afterAll(async () => {
        await environment.end();
        await runtime.unsafe(
            `drop database if exists "${database}" with (force)`,
        );
        await runtime.end();
    }, 120_000);

    function recorder() {
        const reports: StepReport[] = [];
        const client: ControlPlaneClient = {
            claim: () => Promise.resolve(null),
            reportHost: () => Promise.resolve({ matched: 0, unknown: 0 }),
            report: (_id, step) => {
                reports.push(step);
                return Promise.resolve();
            },
        };
        return { client, reports };
    }
    async function run(identities: unknown[]) {
        const { client, reports } = recorder();
        const outcome = await runOperation(settings, source, client, {
            id: Bun.randomUUIDv7(),
            operation: 'sync_identities',
            environment_id: Bun.randomUUIDv7(),
            parameters: { tenant_id: tenant.tenant.id, database, identities },
            lease_until: new Date().toISOString(),
        });
        return { outcome, reports };
    }
    const links = async (subject: string) => [
        ...(await environment.unsafe<{ user_id: string }[]>(
            'select user_id from external_identities where issuer = $1 and subject = $2 and deleted_at is null',
            [issuer, subject],
        )),
    ];

    test('menautkan admin pertama lewat user_id, satu langkah per identitas, dan aman diulang', async () => {
        const identity = {
            issuer,
            subject: `admin-${suffix}`,
            email: tenant.admin.email,
            name: tenant.admin.name,
            user_id: tenant.admin.id,
        };
        const first = await run([identity]);
        expect(first.outcome).toBe('succeeded');
        expect(first.reports).toEqual([
            { status: 'running', step: `identitas admin-${suffix}` },
            { status: 'succeeded', step: 'done' },
        ]);
        expect(await links(identity.subject)).toEqual([
            { user_id: tenant.admin.id },
        ]);

        const again = await run([identity]);
        expect(again.outcome).toBe('succeeded');
        expect(await links(identity.subject)).toHaveLength(1);
    });

    test('membuat pengguna tanpa kata sandi dengan keanggotaan aktif tanpa role bila user_id kosong', async () => {
        const email = `baru-${suffix}@example.com`;
        const identity = {
            issuer,
            subject: `baru-${suffix}`,
            email: email.toUpperCase(),
            name: 'Pengguna Baru',
            user_id: null,
        };
        expect((await run([identity])).outcome).toBe('succeeded');
        const [user] = await environment.unsafe<
            {
                id: string;
                name: string;
                password: string | null;
                memberships: number;
                roles: number;
            }[]
        >(
            `select u.id, u.name, u.password,
                (select count(*)::int from tenant_memberships m where m.user_id = u.id and m.tenant_id = $2 and m.status = 'active') as memberships,
                (select count(*)::int from role_assignments a join tenant_memberships m on m.id = a.membership_id where m.user_id = u.id) as roles
             from users u where u.email = $1`,
            [email, tenant.tenant.id],
        );
        expect(user?.name).toBe('Pengguna Baru');
        expect(user?.password).toBeNull();
        expect(user?.memberships).toBe(1);
        expect(user?.roles).toBe(0);
        expect(await links(identity.subject)).toEqual([{ user_id: user!.id }]);

        // Diulang: identitas sudah tertaut, jadi tidak ada pengguna kedua.
        expect((await run([identity])).outcome).toBe('succeeded');
        const [count] = await environment.unsafe<{ count: number }[]>(
            'select count(*)::int as count from users where email = $1',
            [email],
        );
        expect(count?.count).toBe(1);
    });

    test('email yang sudah dipakai pengguna lain menggagalkan operasi tanpa menautkan apa pun', async () => {
        const identity = {
            issuer,
            subject: `bentrok-${suffix}`,
            email: tenant.admin.email,
            name: 'Orang Lain',
            user_id: null,
        };
        const { outcome, reports } = await run([identity]);
        expect(outcome).toBe('failed');
        expect(reports.at(-1)?.status).toBe('failed');
        expect(reports.at(-1)?.failure_message).toContain(
            'sudah dipakai pengguna lain',
        );
        expect(await links(identity.subject)).toHaveLength(0);
    });

    test('pengguna yang sudah tertaut ke identitas lain di penerbit yang sama ditolak', async () => {
        const { outcome, reports } = await run([
            {
                issuer,
                subject: `kedua-${suffix}`,
                email: null,
                name: null,
                user_id: tenant.admin.id,
            },
        ]);
        expect(outcome).toBe('failed');
        expect(reports.at(-1)?.failure_message).toContain(
            'sudah tertaut ke identitas lain',
        );
        expect(await links(`kedua-${suffix}`)).toHaveLength(0);
    });

    test('user_id yang bukan anggota tenant dan parameter yang tidak sah ditolak', async () => {
        const stranger = await run([
            {
                issuer,
                subject: `asing-${suffix}`,
                email: null,
                name: null,
                user_id: Bun.randomUUIDv7(),
            },
        ]);
        expect(stranger.outcome).toBe('failed');
        expect(stranger.reports.at(-1)?.failure_message).toContain(
            'bukan anggota tenant ini',
        );
        const invalid = await run([{ issuer, subject: '' }]);
        expect(invalid.outcome).toBe('failed');
        expect(invalid.reports.at(-1)?.failure_message).toContain(
            'Parameter sync_identities tidak sah',
        );
    });
});
