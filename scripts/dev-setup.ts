import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { z } from 'zod';
import {
    databaseSettingsSchema,
    loadConfig,
} from '../src/platform/config/index.ts';
import {
    environmentHost,
    findRoute,
    installModule,
    provisionEnvironment,
    provisionRequestSchema,
} from '../src/platform/environment/index.ts';
import {
    migrate,
    readMigrationSource,
} from '../src/platform/migration/index.ts';
import { sampleSchema, seedSample } from './dev-sample.ts';

// Menyiapkan laptop developer dalam satu perintah: memigrasi database runtime dev, lalu membuat setiap lingkungan
// tenant contoh dari dev/tenants.json, masing-masing dengan database sendiri, lewat fungsi yang sama dengan penyiapan
// di server. Module yang dibeli tenant contoh (`modules`) dipasang lewat installModule: entitlement, migration module,
// catatan pemasangan, dan duty module untuk role pemilik. Data contoh (`sample`) diisi lewat API sebagai admin pertama
// (scripts/dev-sample.ts). Aman diulang: lingkungan yang alamatnya sudah tercatat tidak disiapkan ulang, module yang
// sudah terpasang dan lingkungan yang sudah berisi legal entity dilewati. Di server, tenant hanya lahir dari admin.erp.
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
        // Module yang berhak dipakai dan dipasang untuk tenant contoh, misalnya healthcare.
        modules: z.array(z.string()).default([]),
        sample: sampleSchema.optional(),
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
    onnotice: () => {
        // NOTICE PostgreSQL sengaja tidak dicetak.
    },
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
    onnotice: () => {
        // NOTICE PostgreSQL sengaja tidak dicetak.
    },
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
            const database =
                `${settings.DB_DATABASE}_${tenant.slug}_${environment.kind}`
                    .replaceAll('-', '_')
                    .slice(0, 63);
            if (recorded) {
                // Lingkungan tenant yang sama yang ditambahkan belakangan memakai id tenant yang sudah tercatat.
                ids.tenant = recorded.tenant_id;
                console.log(`${url}: sudah ada`);
            } else {
                await provisionEnvironment(
                    settings,
                    source,
                    provisionRequestSchema.parse({
                        environment,
                        database,
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
            const environmentDatabase = recorded
                ? recorded.database_name
                : database;
            for (const module of tenant.modules) {
                await installModule(settings, source, {
                    database: environmentDatabase,
                    tenant_id: ids.tenant,
                    module_id: module,
                });
                console.log(`${url}: module ${module} terpasang`);
            }
            if (tenant.sample) {
                const environmentSql = postgres({
                    host: settings.DB_HOST,
                    port: settings.DB_PORT,
                    database: environmentDatabase ?? settings.DB_DATABASE,
                    username: settings.DB_USERNAME,
                    password: settings.DB_PASSWORD,
                    max: 1,
                    onnotice: () => {
                        // NOTICE PostgreSQL sengaja tidak dicetak.
                    },
                });
                try {
                    const seeded = await seedSample(
                        loadConfig({
                            ...process.env,
                            SESSION_BACKEND: 'database',
                        }),
                        environmentSql,
                        {
                            host: environmentHost(
                                tenant.slug,
                                environment.kind,
                                baseDomain,
                            ),
                            tenantId: ids.tenant,
                            admin: {
                                email: tenant.admin.email,
                                password: tenant.admin.password,
                            },
                            sample: tenant.sample,
                        },
                    );
                    console.log(
                        seeded
                            ? `${url}: data contoh diisi, login petugas: ${tenant.sample.staff.map((person) => person.email).join(', ')}`
                            : `${url}: data contoh sudah ada, dilewati`,
                    );
                } finally {
                    await environmentSql.end();
                }
            }
        }
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await sql.end();
}
