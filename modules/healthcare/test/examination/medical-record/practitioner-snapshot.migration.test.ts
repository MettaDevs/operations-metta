import { afterAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../../../../../src/platform/config/index.ts';
import {
    migrate,
    readMigrationSource,
    type MigrationSource,
} from '../../../../../src/platform/migration/index.ts';

// Nakes pelaku yang sudah tercatat sebagai pengguna diisi dari tautan akun ke nakes hari ini: pengukur tanda vital,
// pencatat alergi, dan apoteker serta asisten penyerahan dari event dispensed di outbox_events. Akun tanpa tautan, atau
// dengan dua nakes aktif, tidak mendapat nakes. Butuh PostgreSQL; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('practitioner snapshot migration', () => {
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
    const database = `${settings.DB_DATABASE.slice(0, 40)}_nakes_${Bun.randomUUIDv7().slice(-8)}`;
    afterAll(async () => {
        await runtime.unsafe(
            `drop database if exists "${database}" with (force)`,
        );
        await runtime.end();
    }, 120_000);

    const healthcare = source.modules.get('healthcare') ?? [];
    const before: MigrationSource = {
        core: source.core,
        modules: new Map([
            [
                'healthcare',
                healthcare.slice(
                    0,
                    healthcare.findIndex((migration) =>
                        migration.name.endsWith('_practitioner_snapshot.sql'),
                    ),
                ),
            ],
        ]),
    };

    const id = () => Bun.randomUUIDv7();
    const clinic = id();
    const user = { nurse: id(), pharmacist: id(), twice: id(), none: id() };
    const nakes = { nurse: id(), pharmacist: id(), first: id(), second: id() };
    const exam = id();
    const vitals = { nurse: id(), twice: id(), none: id() };
    const allergy = { nurse: id(), none: id() };
    const prescription = { handed: id(), waiting: id() };

    test('actors recorded as accounts get the practitioner linked to that account today', async () => {
        await runtime.unsafe(`create database "${database}"`);
        const sql = connect(database);
        try {
            await migrate(sql, before, { modules: ['healthcare'] });
            // Induk yang tidak dibaca pengisian ini (party, profesi, pemeriksaan) dilewati dengan
            // session_replication_role, yang juga mematikan trigger audit.
            await sql.begin(async (tx) => {
                await tx.unsafe('set local session_replication_role = replica');
                await tx.unsafe(
                    `insert into tenants (id, client_id, name, slug, created_at, updated_at)
                     values ($1, $2, 'Klinik uji', $3, now(), now())`,
                    [clinic, id(), `uji-${clinic}`],
                );
                for (const [practitioner, account, active] of [
                    [nakes.nurse, user.nurse, true],
                    [nakes.pharmacist, user.pharmacist, true],
                    [nakes.first, user.twice, true],
                    [nakes.second, user.twice, true],
                ] as const)
                    await tx.unsafe(
                        `insert into sim_m_nakes (id, tenant_id, party_id, profesi, profesi_id, user_id, aktif)
                         values ($1, $2, $3, 'perawat', $4, $5, $6)`,
                        [practitioner, clinic, id(), id(), account, active],
                    );
                for (const [row, account] of [
                    [vitals.nurse, user.nurse],
                    [vitals.twice, user.twice],
                    [vitals.none, user.none],
                ] as const)
                    await tx.unsafe(
                        `insert into sim_tr_pemeriksaan_fisik (id, tenant_id, pemeriksaan_id, diukur_pada, diukur_oleh)
                         values ($1, $2, $3, now(), $4)`,
                        [row, clinic, id(), account],
                    );
                for (const [row, account] of [
                    [allergy.nurse, user.nurse],
                    [allergy.none, user.none],
                ] as const)
                    await tx.unsafe(
                        `insert into sim_m_pasien_alergi (id, tenant_id, pasien_id, kategori, nama, dicatat_pada,
                                                          dicatat_oleh)
                         values ($1, $2, $3, 'lainnya', 'Plester', now(), $4)`,
                        [row, clinic, id(), account],
                    );
                for (const [row, handed] of [
                    [prescription.handed, true],
                    [prescription.waiting, false],
                ] as const)
                    await tx.unsafe(
                        `insert into sim_tr_resep (id, tenant_id, pemeriksaan_id, status, nomor, diserahkan_pada)
                         values ($1, $2, $3, 'dikirim', $4, case when $5 then now() end)`,
                        [row, clinic, exam, `R-${row.slice(-6)}`, handed],
                    );
                await tx.unsafe(
                    `insert into outbox_events (id, tenant_id, type, payload, occurred_at)
                     values ($1, $2, 'pharmacy.prescription.dispensed.v1', $3::text::json, now())`,
                    [
                        id(),
                        clinic,
                        JSON.stringify({
                            prescription_id: prescription.handed,
                            pharmacist: {
                                id: user.pharmacist,
                                name: 'Apoteker',
                            },
                            assistant: { id: user.none, name: 'Asisten' },
                        }),
                    ],
                );
            });

            await migrate(sql, source, { modules: ['healthcare'] });

            const measured = await sql.unsafe<
                { id: string; nakes: string | null }[]
            >(
                'select id, diukur_oleh_nakes_id as nakes from sim_tr_pemeriksaan_fisik order by id',
            );
            expect(
                Object.fromEntries(measured.map((row) => [row.id, row.nakes])),
            ).toEqual({
                [vitals.nurse]: nakes.nurse,
                [vitals.twice]: null,
                [vitals.none]: null,
            });
            const recorded = await sql.unsafe<
                { id: string; nakes: string | null }[]
            >(
                'select id, dicatat_oleh_nakes_id as nakes from sim_m_pasien_alergi order by id',
            );
            expect(
                Object.fromEntries(recorded.map((row) => [row.id, row.nakes])),
            ).toEqual({
                [allergy.nurse]: nakes.nurse,
                [allergy.none]: null,
            });
            const dispensed = await sql.unsafe<
                {
                    id: string;
                    pharmacist: string | null;
                    assistant: string | null;
                }[]
            >(
                `select id, apoteker_nakes_id as pharmacist, asisten_apoteker_nakes_id as assistant
                 from sim_tr_resep order by id`,
            );
            expect(
                Object.fromEntries(
                    dispensed.map(({ id: row, ...people }) => [row, people]),
                ),
            ).toEqual({
                [prescription.handed]: {
                    pharmacist: nakes.pharmacist,
                    assistant: null,
                },
                [prescription.waiting]: { pharmacist: null, assistant: null },
            });
        } finally {
            await sql.end();
        }
    }, 120_000);
});
