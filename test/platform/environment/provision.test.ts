import { afterAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../../../src/platform/config/index.ts';
import {
    provisionEnvironment,
    provisionRequestSchema,
} from '../../../src/platform/environment/index.ts';
import { readMigrationSource } from '../../../src/platform/migration/index.ts';
import { operationsTestApp } from '../../support/operations-app.ts';

describe.skipIf(!process.env.DB_HOST)('provisionEnvironment', () => {
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
    const password = 'kata-sandi-admin-pertama';
    const passwordHash = Bun.password.hash(password, {
        algorithm: 'bcrypt',
        cost: 4,
    });
    // Database lingkungan memakai nama database test sebagai awalan, supaya ikut aturan nama di server lab.
    const ownDatabase = `${settings.DB_DATABASE.slice(0, 40)}_env_${Bun.randomUUIDv7().slice(-8)}`;
    // DROP DATABASE menunggu checkpoint, yang di disk lambat lebih lama dari batas bawaan hook.
    afterAll(async () => {
        await runtime.unsafe(
            `drop database if exists "${ownDatabase}" with (force)`,
        );
        await runtime.end();
    }, 60_000);

    async function request(database: string | null) {
        const id = Bun.randomUUIDv7();
        const slug = `uji-${id.slice(-12)}`;
        return provisionRequestSchema.parse({
            environment: { kind: 'production', name: 'Produksi' },
            database,
            client: {
                id: Bun.randomUUIDv7(),
                legal_name: 'PT Uji Penyiapan',
                slug,
            },
            tenant: { id, name: 'Klinik Uji Penyiapan', slug },
            admin: {
                id: Bun.randomUUIDv7(),
                name: 'Admin Uji Penyiapan',
                email: `Admin-${id}@Example.com`,
                password_hash: await passwordHash,
            },
        });
    }

    const shared = operationsTestApp();
    afterAll(shared.close);

    // Admin pertama login lalu membuat perusahaan pertama, pekerjaan yang dibutuhkan duty Core.
    async function createLegalEntity(
        app: ReturnType<typeof operationsTestApp>,
        email: string,
    ) {
        const owner = app.browser();
        await owner.login(email, password);
        const response = await owner.post('/api/v1/organizations', {
            classification: 'legal_entity',
            name: 'PT Uji Penyiapan',
            company_code: 'UJI1',
            country_code: 'ID',
        });
        return response.status;
    }

    test('admin pertama di database bersama login dan memegang semua duty Core', async () => {
        const provision = await request(null);
        expect(await provisionEnvironment(settings, source, provision)).toEqual(
            { created: true },
        );
        expect(await createLegalEntity(shared, provision.admin.email)).toBe(
            201,
        );
        const [role] = await runtime.unsafe(
            "select r.name, r.is_owner, (select count(*)::int from security_role_duties d where d.role_id = r.id) as duties, (select count(*)::int from security_duties s where s.app_id = 'core' and s.tenant_id is null and s.status = 'active') as core_duties from roles r where r.tenant_id = $1",
            [provision.tenant.id],
        );
        expect(role).toMatchObject({ name: 'Pemilik', is_owner: true });
        expect(role?.duties).toBe(role?.core_duties);
        expect(role?.duties).toBeGreaterThan(0);
    });

    test('mengulang penyiapan tidak menulis apa pun lagi', async () => {
        const provision = await request(null);
        await provisionEnvironment(settings, source, provision);
        expect(await provisionEnvironment(settings, source, provision)).toEqual(
            { created: false },
        );
        const [counts] = await runtime.unsafe(
            'select (select count(*)::int from tenant_memberships where tenant_id = $1) as memberships, (select count(*)::int from roles where tenant_id = $1) as roles',
            [provision.tenant.id],
        );
        expect({ ...counts }).toEqual({ memberships: 1, roles: 1 });
    });

    test(
        'database sendiri dibuat, hanya Core yang dimigrasi, dan admin login di sana',
        async () => {
            const provision = await request(ownDatabase);
            expect(
                await provisionEnvironment(settings, source, provision),
            ).toEqual({ created: true });
            expect(
                await provisionEnvironment(settings, source, provision),
            ).toEqual({ created: false });
            const environment = postgres({
                host: settings.DB_HOST,
                port: settings.DB_PORT,
                database: ownDatabase,
                username: settings.DB_USERNAME,
                password: settings.DB_PASSWORD,
                max: 1,
                onnotice: () => {},
            });
            try {
                const owners = await environment.unsafe(
                    'select distinct owner from schema_migrations order by owner',
                );
                expect(owners.map((row) => row.owner)).toEqual(['core']);
                const [tenant] = await environment.unsafe(
                    'select slug from tenants where id = $1',
                    [provision.tenant.id],
                );
                expect(tenant?.slug).toBe(provision.tenant.slug);
            } finally {
                await environment.end();
            }
            const [shared] = await runtime.unsafe(
                'select count(*)::int as count from tenants where id = $1',
                [provision.tenant.id],
            );
            expect(shared?.count).toBe(0);
            const [route] = await runtime.unsafe(
                'select tenant_id, kind, database_name from environment_routes where tenant_slug = $1',
                [provision.tenant.slug],
            );
            expect({ ...route }).toEqual({
                tenant_id: provision.tenant.id,
                kind: 'production',
                database_name: ownDatabase,
            });
            const own = operationsTestApp({ DB_DATABASE: ownDatabase });
            try {
                expect(
                    await createLegalEntity(own, provision.admin.email),
                ).toBe(201);
            } finally {
                await own.close();
            }
        },
        { timeout: 120_000 },
    );

    test('menolak database runtime dan nama yang bukan identifier aman', async () => {
        const provision = await request(settings.DB_DATABASE);
        await expect(
            provisionEnvironment(settings, source, provision),
        ).rejects.toThrow('runtime or a system database');
        const [tenant] = await runtime.unsafe(
            'select count(*)::int as count from tenants where id = $1',
            [provision.tenant.id],
        );
        expect(tenant?.count).toBe(0);
        expect(
            provisionRequestSchema.safeParse({
                ...provision,
                database: 'x"; drop database postgres; --',
            }).success,
        ).toBe(false);
    });

    test('slug milik tenant lain ditolak', async () => {
        const first = await request(null);
        await provisionEnvironment(settings, source, first);
        const second = await request(null);
        await expect(
            provisionEnvironment(settings, source, {
                ...second,
                tenant: { ...second.tenant, slug: first.tenant.slug },
            }),
        ).rejects.toThrow('already belongs to another tenant');
    });
});
