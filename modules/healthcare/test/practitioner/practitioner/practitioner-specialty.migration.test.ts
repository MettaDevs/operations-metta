import { afterAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../../../../../src/platform/config/index.ts';
import {
    migrate,
    readMigrationSource,
    type MigrationSource,
} from '../../../../../src/platform/migration/index.ts';
import { sqlErrorCode } from '../../../../../src/platform/database/index.ts';

// Teks spesialisasi nakes lama menjadi master spesialis di database yang sudah berisi data: satu spesialis per tenant
// untuk nama yang sama tanpa membedakan huruf besar dan spasi tepi, lalu nakes ditautkan. Butuh PostgreSQL; dilewati
// bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)(
    'practitioner specialty migration',
    () => {
        if (!process.env.DB_HOST) return;
        const settings = databaseSettingsSchema.parse(process.env);
        const source = readMigrationSource(
            resolve(import.meta.dir, '../../../../..'),
        );
        const connect = (database: string) =>
            postgres({
                host: settings.DB_HOST,
                port: settings.DB_PORT,
                database,
                username: settings.DB_USERNAME,
                password: settings.DB_PASSWORD,
                max: 1,
                onnotice: () => {},
            });
        const runtime = connect(settings.DB_DATABASE);
        const database = `${settings.DB_DATABASE.slice(0, 40)}_spes_${Bun.randomUUIDv7().slice(-8)}`;
        afterAll(async () => {
            await runtime.unsafe(
                `drop database if exists "${database}" with (force)`,
            );
            await runtime.end();
        }, 120_000);

        const healthcare = source.modules.get('healthcare') ?? [];
        const beforeSpecialties: MigrationSource = {
            core: source.core,
            modules: new Map([
                [
                    'healthcare',
                    healthcare.slice(
                        0,
                        healthcare.findIndex((migration) =>
                            migration.name.endsWith(
                                '_tariff_dimension_masters.sql',
                            ),
                        ),
                    ),
                ],
            ]),
        };

        const id = () => Bun.randomUUIDv7();
        const clinic = id();
        const other = id();
        const nakes = {
            internist: id(),
            internistSpaced: id(),
            child: id(),
            blank: id(),
            none: id(),
            deleted: id(),
            otherChild: id(),
        };

        test('old specialization text becomes one specialty per tenant and name, linked to its live practitioners', async () => {
            await runtime.unsafe(`create database "${database}"`);
            const sql = connect(database);
            try {
                await migrate(sql, beforeSpecialties, {
                    modules: ['healthcare'],
                });
                // Party dan profesi tidak dibaca pemindahan ini, jadi foreign key dan trigger audit dimatikan.
                await sql.begin(async (tx) => {
                    await tx.unsafe(
                        'set local session_replication_role = replica',
                    );
                    for (const tenant of [clinic, other])
                        await tx.unsafe(
                            `insert into tenants (id, client_id, name, slug, created_at, updated_at)
                         values ($1, $2, 'Klinik uji', $3, now(), now())`,
                            [tenant, id(), `uji-${tenant}`],
                        );
                    const rows: [string, string, string | null, boolean][] = [
                        [nakes.internist, clinic, 'Penyakit Dalam', false],
                        [
                            nakes.internistSpaced,
                            clinic,
                            '  penyakit dalam ',
                            false,
                        ],
                        [nakes.child, clinic, 'Anak', false],
                        [nakes.blank, clinic, '   ', false],
                        [nakes.none, clinic, null, false],
                        [nakes.deleted, clinic, 'Kulit', true],
                        [nakes.otherChild, other, 'Anak', false],
                    ];
                    for (const [nakesId, tenant, text, deleted] of rows)
                        await tx.unsafe(
                            `insert into sim_m_nakes (id, tenant_id, party_id, profesi, profesi_id, spesialisasi,
                                                  deleted_at)
                         values ($1, $2, $3, 'dokter', $4, $5, case when $6 then now() end)`,
                            [nakesId, tenant, id(), id(), text, deleted],
                        );
                });
                await migrate(sql, source, { modules: ['healthcare'] });

                const specialties = await sql.unsafe<
                    { tenant_id: string; id: string; nama: string }[]
                >(
                    'select tenant_id, id, lower(nama) as nama from sim_m_spesialisasi order by tenant_id, nama',
                );
                const named = (tenant: string, name: string) => {
                    const found = specialties.find(
                        (row) => row.tenant_id === tenant && row.nama === name,
                    );
                    if (!found) throw new Error(`Spesialis ${name} tidak ada.`);
                    return found.id;
                };
                expect(
                    specialties.map((row) => [row.tenant_id, row.nama]).sort(),
                ).toEqual(
                    [
                        [clinic, 'anak'],
                        [clinic, 'penyakit dalam'],
                        [other, 'anak'],
                    ].sort(),
                );
                const linked = Object.fromEntries(
                    (
                        await sql.unsafe<
                            { id: string; spesialisasi_id: string | null }[]
                        >('select id, spesialisasi_id from sim_m_nakes')
                    ).map((row) => [row.id, row.spesialisasi_id]),
                );
                expect(linked).toEqual({
                    [nakes.internist]: named(clinic, 'penyakit dalam'),
                    [nakes.internistSpaced]: named(clinic, 'penyakit dalam'),
                    [nakes.child]: named(clinic, 'anak'),
                    [nakes.blank]: null,
                    [nakes.none]: null,
                    [nakes.deleted]: null,
                    [nakes.otherChild]: named(other, 'anak'),
                });

                // Sub spesialis milik spesialis lain ditolak database, bukan hanya service.
                const line = id();
                await sql.unsafe(
                    `insert into sim_m_sub_spesialisasi (id, tenant_id, spesialisasi_id, nama)
                 values ($1, $2, $3, 'Neonatologi')`,
                    [line, clinic, named(clinic, 'anak')],
                );
                const refused = await sql
                    .unsafe(
                        'update sim_m_nakes set sub_spesialisasi_id = $1 where id = $2',
                        [line, nakes.internist],
                    )
                    .then(
                        () => null,
                        (error: unknown) => sqlErrorCode(error),
                    );
                expect(refused).toBe('23503');
            } finally {
                await sql.end();
            }
        }, 300_000);
    },
);
