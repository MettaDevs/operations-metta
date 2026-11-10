import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { z } from 'zod';
import { databaseSettingsSchema } from '../src/platform/config/index.ts';
import {
    environmentHost,
    findRoute,
    provisionEnvironment,
    provisionRequestSchema,
} from '../src/platform/environment/index.ts';
import {
    migrate,
    readMigrationSource,
} from '../src/platform/migration/index.ts';

// Menyiapkan laptop developer dalam satu perintah: memigrasi database runtime dev, lalu membuat setiap lingkungan
// tenant contoh dari dev/tenants.json, masing-masing dengan database sendiri, lewat fungsi yang sama dengan penyiapan
// di server. Aman diulang: lingkungan yang alamatnya sudah tercatat dilewati. Di server, tenant hanya lahir dari
// admin.erp.
const tenantsSchema = z.array(
    z.object({
        legal_name: z.string(),
        name: z.string(),
        slug: z.string(),
        admin: z.object({
            name: z.string(),
            email: z.string(),
            password: z.string().min(12),
        }),
        environments: z
            .array(
                z.object({
                    kind: z.enum(['production', 'sandbox', 'demo']),
                    name: z.string(),
                }),
            )
            .min(1),
    }),
);

const root = resolve(import.meta.dir, '..');
const tenants = tenantsSchema.parse(
    JSON.parse(readFileSync(join(root, 'dev', 'tenants.json'), 'utf8')),
);
const settings = databaseSettingsSchema.parse(process.env);
const baseDomain = (process.env.BASE_DOMAIN ?? '').trim().toLowerCase();
if (!baseDomain) {
    console.error(
        'Isi BASE_DOMAIN=localhost di .env: setiap lingkungan dibuka di alamatnya sendiri, misalnya klinik-contoh.localhost:8000.',
    );
    process.exit(1);
}
const port = process.env.PORT ?? '8000';
const source = readMigrationSource(root);

// Database runtime dev dibuat bila belum ada, supaya laptop baru cukup menjalankan satu perintah ini.
const maintenance = postgres({
    host: settings.DB_HOST,
    port: settings.DB_PORT,
    database: 'postgres',
    username: settings.DB_USERNAME,
    password: settings.DB_PASSWORD,
    max: 1,
    onnotice: () => {},
});
try {
    const [exists] =
        await maintenance`select 1 from pg_database where datname = ${settings.DB_DATABASE}`;
    if (!exists) {
        await maintenance.unsafe(
            `create database "${settings.DB_DATABASE.replaceAll('"', '""')}"`,
        );
        console.log(`database ${settings.DB_DATABASE} dibuat`);
    }
} finally {
    await maintenance.end();
}

const sql = postgres({
    host: settings.DB_HOST,
    port: settings.DB_PORT,
    database: settings.DB_DATABASE,
    username: settings.DB_USERNAME,
    password: settings.DB_PASSWORD,
    max: 1,
    onnotice: () => {},
});

try {
    await migrate(sql, source, { log: console.log });
    for (const tenant of tenants) {
        // Satu tenant, satu id di semua lingkungannya, sama dengan registri control plane.
        const ids = {
            client: Bun.randomUUIDv7(),
            tenant: Bun.randomUUIDv7(),
            admin: Bun.randomUUIDv7(),
        };
        const passwordHash = await Bun.password.hash(tenant.admin.password, {
            algorithm: 'bcrypt',
        });
        for (const environment of tenant.environments) {
            const url = `http://${environmentHost(tenant.slug, environment.kind, baseDomain)}:${port}`;
            const recorded = await findRoute(
                sql,
                tenant.slug,
                environment.kind,
            );
            if (recorded) {
                // Lingkungan tenant yang sama yang ditambahkan belakangan memakai id tenant yang sudah tercatat.
                ids.tenant = recorded.tenant_id;
                console.log(`${url}: sudah ada, dilewati`);
                continue;
            }
            await provisionEnvironment(
                settings,
                source,
                provisionRequestSchema.parse({
                    environment,
                    database:
                        `${settings.DB_DATABASE}_${tenant.slug}_${environment.kind}`
                            .replaceAll('-', '_')
                            .slice(0, 63),
                    client: {
                        id: ids.client,
                        legal_name: tenant.legal_name,
                        slug: tenant.slug,
                    },
                    tenant: {
                        id: ids.tenant,
                        name: tenant.name,
                        slug: tenant.slug,
                    },
                    admin: {
                        id: ids.admin,
                        name: tenant.admin.name,
                        email: tenant.admin.email,
                        password_hash: passwordHash,
                    },
                }),
            );
            console.log(`${url}: dibuat, login ${tenant.admin.email}`);
        }
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await sql.end();
}
