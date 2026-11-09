import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { z } from 'zod';
import { databaseSettingsSchema } from '../src/platform/config/index.ts';
import {
    provisionEnvironment,
    provisionRequestSchema,
} from '../src/platform/environment/index.ts';
import {
    migrate,
    readMigrationSource,
} from '../src/platform/migration/index.ts';

// Menyiapkan laptop developer dalam satu perintah: memigrasi database dev, lalu membuat tenant contoh dari
// dev/tenants.json lewat fungsi yang sama dengan penyiapan di server. Aman diulang: tenant yang slug-nya sudah ada
// dilewati. Di server, tenant hanya lahir dari admin.erp.
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
    }),
);

const root = resolve(import.meta.dir, '..');
const tenants = tenantsSchema.parse(
    JSON.parse(readFileSync(join(root, 'dev', 'tenants.json'), 'utf8')),
);
const settings = databaseSettingsSchema.parse(process.env);
const source = readMigrationSource(root);
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
    const existing = new Set(
        (
            await sql<
                { slug: string }[]
            >`select slug from tenants where slug = any(${sql.array(tenants.map((tenant) => tenant.slug))})`
        ).map((row) => row.slug),
    );
    for (const tenant of tenants) {
        if (existing.has(tenant.slug)) {
            console.log(`${tenant.slug}: sudah ada, dilewati`);
            continue;
        }
        await provisionEnvironment(
            settings,
            source,
            provisionRequestSchema.parse({
                database: null,
                client: {
                    id: Bun.randomUUIDv7(),
                    legal_name: tenant.legal_name,
                    slug: tenant.slug,
                },
                tenant: {
                    id: Bun.randomUUIDv7(),
                    name: tenant.name,
                    slug: tenant.slug,
                },
                admin: {
                    id: Bun.randomUUIDv7(),
                    name: tenant.admin.name,
                    email: tenant.admin.email,
                    password_hash: await Bun.password.hash(
                        tenant.admin.password,
                        { algorithm: 'bcrypt' },
                    ),
                },
            }),
        );
        console.log(`${tenant.slug}: dibuat, login ${tenant.admin.email}`);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await sql.end();
}
