import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../../../src/platform/config/index.ts';
import {
    provisionEnvironment,
    provisionRequestSchema,
} from '../../../src/platform/environment/index.ts';
import { readMigrationSource } from '../../../src/platform/migration/index.ts';
import { operationsTestApp } from '../../support/operations-app.ts';

const base = 'uji.test';
const password = 'kata-sandi-admin-alamat';

describe.skipIf(!process.env.DB_HOST)('alamat menentukan lingkungan', () => {
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
    const suffix = Bun.randomUUIDv7().slice(-8);
    const databases = ['a', 'b'].map(
        (name) => `${settings.DB_DATABASE.slice(0, 40)}_rt_${name}_${suffix}`,
    );
    const app = operationsTestApp({ BASE_DOMAIN: base });

    type Provisioned = Awaited<ReturnType<typeof provision>>;
    async function provision(
        database: string | null,
        kind: 'production' | 'demo' = 'production',
    ) {
        const id = Bun.randomUUIDv7();
        const request = provisionRequestSchema.parse({
            environment: { kind, name: `Lingkungan ${kind}` },
            database,
            client: {
                id: Bun.randomUUIDv7(),
                legal_name: 'PT Uji Alamat',
                slug: `alamat-${id.slice(-12)}`,
            },
            tenant: {
                id,
                name: 'Klinik Uji Alamat',
                slug: `alamat-${id.slice(-12)}`,
            },
            admin: {
                id: Bun.randomUUIDv7(),
                name: 'Admin Uji Alamat',
                email: `alamat-${id}@example.com`,
                password_hash: await Bun.password.hash(password, {
                    algorithm: 'bcrypt',
                    cost: 4,
                }),
            },
        });
        await provisionEnvironment(settings, source, request);
        return request;
    }
    const host = (tenant: Provisioned) =>
        tenant.environment.kind === 'production'
            ? `${tenant.tenant.slug}.${base}`
            : `${tenant.tenant.slug}.${tenant.environment.kind}.${base}`;

    let first: Provisioned;
    let second: Provisioned;
    beforeAll(async () => {
        first = await provision(databases[0]!);
        second = await provision(databases[1]!);
    }, 120_000);
    afterAll(async () => {
        await app.close();
        for (const database of databases)
            await runtime.unsafe(
                `drop database if exists "${database}" with (force)`,
            );
        await runtime.end();
    }, 120_000);

    test('admin login di alamatnya dan bekerja di database lingkungannya', async () => {
        const browser = app.browser(host(first));
        await browser.login(first.admin.email, password);
        const shell = await browser.get('/api/v1/shell');
        expect(shell.status).toBe(200);
        const body = (await shell.json()) as {
            auth: { membership: { tenant_id: string } };
            environment: { kind: string; name: string };
        };
        expect(body.auth.membership.tenant_id).toBe(first.tenant.id);
        expect(body.environment).toEqual({
            kind: 'production',
            name: 'Lingkungan production',
        });
    });

    test('cookie sesi berawalan __Host-, Secure, tanpa Domain', async () => {
        const response = await app
            .browser(host(first))
            .request('POST', '/login', {
                body: { email: first.admin.email, password },
                headers: { 'sec-fetch-site': 'same-origin' },
            });
        expect(response.status).toBe(200);
        const session = response.headers
            .getSetCookie()
            .find((cookie) => cookie.startsWith('__Host-session='));
        expect(session).toBeDefined();
        expect(session).toContain('; Secure');
        expect(session).toContain('; Path=/');
        expect(session?.toLowerCase()).not.toContain('domain=');
    });

    test('cookie satu lingkungan tidak berlaku di alamat lingkungan lain', async () => {
        const browser = app.browser(host(first));
        await browser.login(first.admin.email, password);
        const replayed = await browser.request('GET', '/api/v1/shell', {
            host: host(second),
        });
        expect(replayed.status).toBe(401);
        const elsewhere = app.browser(host(second));
        const login = await elsewhere.request('POST', '/login', {
            body: { email: first.admin.email, password },
            headers: { 'sec-fetch-site': 'same-origin' },
        });
        expect(login.status).toBe(422);
    });

    test('alamat tanpa lingkungan tercatat dan alamat di luar domain dasar dijawab 404', async () => {
        for (const unknown of [
            `tidak-ada-${suffix}.${base}`,
            `${first.tenant.slug}.demo.${base}`,
            `admin.${base}`,
            'localhost',
        ]) {
            const response = await app.browser(unknown).get('/api/v1/shell');
            expect(response.status).toBe(404);
        }
    });

    test('di database bersama, anggota dua tenant hanya bekerja di tenant pemilik alamat', async () => {
        const clinic = await provision(null);
        const other = await provision(null);
        await runtime.unsafe(
            "insert into tenant_memberships (id, tenant_id, user_id, status, created_at, updated_at) values ($1, $2, $3, 'active', now(), now())",
            [Bun.randomUUIDv7(), other.tenant.id, clinic.admin.id],
        );
        for (const [tenant, expected] of [
            [clinic, clinic.tenant.id],
            [other, other.tenant.id],
        ] as const) {
            const browser = app.browser(host(tenant));
            await browser.login(clinic.admin.email, password);
            const body = (await (
                await browser.get('/api/v1/shell')
            ).json()) as {
                auth: { membership: { tenant_id: string } };
                memberships: { tenant_id: string }[];
            };
            expect(body.auth.membership.tenant_id).toBe(expected);
        }
    });
});
