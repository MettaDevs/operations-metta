import { afterAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../../../src/platform/config/index.ts';
import {
    installModule,
    provisionEnvironment,
    provisionRequestSchema,
} from '../../../src/platform/environment/index.ts';
import { readMigrationSource } from '../../../src/platform/migration/index.ts';
import { operationsTestApp } from '../../support/operations-app.ts';

// Module yang dipasang setelah legal entity dibuat: sequence bawaan module itu (NRM per legal entity) tetap sampai ke
// legal entity yang sudah ada, lewat pembuat sequence bawaan yang sama dengan saat legal entity lahir.
describe.skipIf(!process.env.DB_HOST)('installModule', () => {
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
    const app = operationsTestApp();
    afterAll(async () => {
        await app.close();
        await runtime.end();
    });
    const password = 'kata-sandi-admin-pertama';

    test('existing legal entities get the module default number sequence, once, however often it is installed', async () => {
        const id = Bun.randomUUIDv7();
        const slug = `uji-${id.slice(-12)}`;
        const provision = provisionRequestSchema.parse({
            environment: { kind: 'production', name: 'Produksi' },
            database: null,
            client: { id: Bun.randomUUIDv7(), legal_name: 'PT Uji', slug },
            tenant: { id, name: 'Klinik Uji Pasang Module', slug },
            admin: {
                id: Bun.randomUUIDv7(),
                name: 'Admin Uji',
                email: `admin-${id}@example.com`,
                password_hash: await Bun.password.hash(password, {
                    algorithm: 'bcrypt',
                    cost: 4,
                }),
            },
        });
        await provisionEnvironment(settings, source, provision);
        const owner = app.browser();
        await owner.login(provision.admin.email, password);
        const companies: string[] = [];
        for (const code of ['UJA', 'UJB']) {
            const response = await owner.post('/api/v1/organizations', {
                classification: 'legal_entity',
                name: `PT Uji ${code}`,
                company_code: code,
                country_code: 'ID',
            });
            expect(response.status).toBe(201);
            const body: unknown = await response.json();
            companies.push((body as { data: { id: string } }).data.id);
        }
        const sequences = async () =>
            (
                await runtime.unsafe<{ legal_entity_id: string }[]>(
                    `select s.legal_entity_id from tenant_number_sequences s
                     join app_number_sequence_references r on r.id = s.reference_id
                     where s.tenant_id = $1 and r.code = 'healthcare.medical-record-number'
                       and s.scope_type = 'legal_entity' and s.status = 'active'
                     order by s.legal_entity_id`,
                    [id],
                )
            ).map((row) => row.legal_entity_id);
        // Module belum dipasang: legal entity lahir tanpa NRM.
        expect(await sequences()).toEqual([]);

        const install = {
            database: null,
            tenant_id: id,
            module_id: 'healthcare',
        };
        await installModule(settings, source, install);
        expect(await sequences()).toEqual([...companies].sort());
        await installModule(settings, source, install);
        expect(await sequences()).toEqual([...companies].sort());
    }, 60_000);
});
