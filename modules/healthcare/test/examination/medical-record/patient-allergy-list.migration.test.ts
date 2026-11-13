import { afterAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../../../../../src/platform/config/index.ts';
import { sqlErrorCode } from '../../../../../src/platform/database/index.ts';
import {
    migrate,
    readMigrationSource,
    type MigrationSource,
} from '../../../../../src/platform/migration/index.ts';

// Alergi pasien lama menjadi daftar di database yang sudah berisi data: satu baris per pasien pecah menjadi baris
// makanan, udara, dan lainnya, alergi obat menjadi baris obat dengan id yang sama, dan Tidak ada pindah ke riwayat
// penyakit pemeriksaannya. Butuh PostgreSQL; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('patient allergy list migration', () => {
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
    const database = `${settings.DB_DATABASE.slice(0, 40)}_alergi_${Bun.randomUUIDv7().slice(-8)}`;
    afterAll(async () => {
        await runtime.unsafe(
            `drop database if exists "${database}" with (force)`,
        );
        await runtime.end();
    }, 120_000);

    const healthcare = source.modules.get('healthcare') ?? [];
    const beforeList: MigrationSource = {
        core: source.core,
        modules: new Map([
            [
                'healthcare',
                healthcare.slice(
                    0,
                    healthcare.findIndex((migration) =>
                        migration.name.endsWith('_patient_allergy_list.sql'),
                    ),
                ),
            ],
        ]),
    };

    const id = () => Bun.randomUUIDv7();
    const clinic = id();
    const patient = {
        listed: id(),
        none: id(),
        removed: id(),
        noneWithHistory: id(),
    };
    const exam = { listed: id(), none: id(), noneWithHistory: id() };
    const history = { listed: id(), noneWithHistory: id() };
    const drug = { live: id(), removed: id() };
    const drugAllergy = { live: id(), removed: id() };
    const user = { creator: id(), editor: id() };

    test('old allergy rows arrive as list rows and Tidak ada moves to the examination', async () => {
        await runtime.unsafe(`create database "${database}"`);
        const sql = connect(database);
        try {
            await migrate(sql, beforeList, { modules: ['healthcare'] });
            // Induk yang tidak dibaca pindahan ini (party, kunjungan, barang) dilewati dengan session_replication_role,
            // yang juga mematikan trigger audit.
            await sql.begin(async (tx) => {
                await tx.unsafe('set local session_replication_role = replica');
                await tx.unsafe(
                    `insert into tenants (id, client_id, name, slug, created_at, updated_at)
                     values ($1, $2, 'Klinik uji', $3, now(), now())`,
                    [clinic, id(), `uji-${clinic}`],
                );
                await tx.unsafe('select sim_isi_acuan_pemeriksaan($1)', [
                    clinic,
                ]);
                for (const [index, patientId] of Object.values(
                    patient,
                ).entries())
                    await tx.unsafe(
                        `insert into sim_m_pasien (id, tenant_id, party_id, legal_entity_id, org_unit_id, nrm,
                                                   creation_key)
                         values ($1, $2, $3, $3, $3, $4, $4)`,
                        [patientId, clinic, id(), `NRM-${index}`],
                    );
                for (const [examId, patientId] of [
                    [exam.listed, patient.listed],
                    [exam.none, patient.none],
                    [exam.noneWithHistory, patient.noneWithHistory],
                ] as const)
                    await tx.unsafe(
                        `insert into sim_tr_pemeriksaan (id, tenant_id, tujuan_id, registrasi_id, pasien_id)
                         values ($1, $2, $3, $3, $4)`,
                        [examId, clinic, id(), patientId],
                    );
                await tx.unsafe(
                    `insert into sim_tr_pemeriksaan_riwayat_penyakit (id, tenant_id, pemeriksaan_id, riwayat_sekarang)
                     values ($1, $3, $4, 'Demam'), ($2, $3, $5, 'Batuk')`,
                    [
                        history.listed,
                        history.noneWithHistory,
                        clinic,
                        exam.listed,
                        exam.noneWithHistory,
                    ],
                );
                await tx.unsafe(
                    `insert into sim_m_obat (id, tenant_id, legal_entity_id) values ($1, $3, $4), ($2, $3, $4)`,
                    [drug.live, drug.removed, clinic, id()],
                );
                const code = (jenis: string, kode: string) =>
                    `(select id from sim_m_alergi where tenant_id = $1 and jenis = '${jenis}' and kode = '${kode}')`;
                await tx.unsafe(
                    `insert into sim_m_pasien_alergi (id, tenant_id, pasien_id, tidak_ada, alergi_makanan_id,
                                                      alergi_udara_id, alergi_lainnya, pemeriksaan_id, created_at,
                                                      updated_at, deleted_at, created_by_user_id,
                                                      updated_by_user_id)
                     values (gen_random_uuid(), $1, $2, false, ${code('makanan', '01')}, ${code('udara', '00')},
                             ' Debu ', $6, '2026-11-01 08:00:00', '2026-11-02 09:00:00', null, $9, $10),
                            (gen_random_uuid(), $1, $3, true, ${code('makanan', '01')}, ${code('udara', '00')}, null,
                             $7, '2026-11-03 08:00:00', '2026-11-03 08:00:00', null, $9, $9),
                            (gen_random_uuid(), $1, $4, false, ${code('makanan', '00')}, ${code('udara', '02')}, '',
                             null, '2026-11-04 08:00:00', '2026-11-05 08:00:00', '2026-11-05 08:00:00', $9, $10),
                            (gen_random_uuid(), $1, $5, true, ${code('makanan', '00')}, ${code('udara', '00')}, null,
                             $8, '2026-11-06 08:00:00', '2026-11-06 08:00:00', null, $9, $9)`,
                    [
                        clinic,
                        patient.listed,
                        patient.none,
                        patient.removed,
                        patient.noneWithHistory,
                        exam.listed,
                        exam.none,
                        exam.noneWithHistory,
                        user.creator,
                        user.editor,
                    ],
                );
                await tx.unsafe(
                    `insert into sim_m_pasien_alergi_obat (id, tenant_id, pasien_id, obat_id, pemeriksaan_id,
                                                           created_at, updated_at, deleted_at, created_by_user_id,
                                                           updated_by_user_id, version)
                     values ($1, $3, $4, $5, $7, '2026-11-01 08:30:00', '2026-11-01 08:30:00', null, $8, $8, 1),
                            ($2, $3, $4, $6, $7, '2026-11-01 08:30:00', '2026-11-02 09:00:00',
                             '2026-11-02 09:00:00', $8, $9, 2)`,
                    [
                        drugAllergy.live,
                        drugAllergy.removed,
                        clinic,
                        patient.listed,
                        drug.live,
                        drug.removed,
                        exam.listed,
                        user.creator,
                        user.editor,
                    ],
                );
            });

            await migrate(sql, source, { modules: ['healthcare'] });

            const rows = await sql.unsafe<
                {
                    id: string;
                    pasien_id: string;
                    kategori: string;
                    alergen: string | null;
                    obat_id: string | null;
                    nama: string | null;
                    status: string;
                    pemeriksaan_id: string | null;
                    dicatat_pada: string;
                    dicatat_oleh: string | null;
                    deleted: boolean;
                }[]
            >(
                `select a.id, a.pasien_id, a.kategori, m.nama as alergen, a.obat_id, a.nama, a.status,
                        a.pemeriksaan_id, a.dicatat_pada::text, a.dicatat_oleh, a.deleted_at is not null as deleted
                 from sim_m_pasien_alergi a
                 left join sim_m_alergi m on m.id = a.alergi_id
                 where a.tenant_id = $1`,
                [clinic],
            );
            expect(
                rows
                    .map((row) => [
                        row.pasien_id,
                        row.kategori,
                        row.alergen ?? row.obat_id ?? row.nama,
                        row.status,
                        row.pemeriksaan_id,
                        row.dicatat_pada,
                        row.dicatat_oleh,
                        row.deleted,
                    ])
                    .sort(),
            ).toEqual(
                [
                    [
                        patient.listed,
                        'lainnya',
                        'Debu',
                        'aktif',
                        exam.listed,
                        '2026-11-02 09:00:00',
                        user.editor,
                        false,
                    ],
                    [
                        patient.listed,
                        'makanan',
                        'Seafood',
                        'aktif',
                        exam.listed,
                        '2026-11-02 09:00:00',
                        user.editor,
                        false,
                    ],
                    [
                        patient.listed,
                        'obat',
                        drug.live,
                        'aktif',
                        exam.listed,
                        '2026-11-01 08:30:00',
                        user.creator,
                        false,
                    ],
                    [
                        patient.listed,
                        'obat',
                        drug.removed,
                        'aktif',
                        exam.listed,
                        '2026-11-01 08:30:00',
                        user.creator,
                        true,
                    ],
                    [
                        patient.removed,
                        'udara',
                        'Udara Dingin',
                        'aktif',
                        null,
                        '2026-11-05 08:00:00',
                        user.editor,
                        true,
                    ],
                ].sort(),
            );
            expect(
                rows
                    .filter((row) => row.kategori === 'obat')
                    .map((row) => row.id)
                    .sort(),
            ).toEqual([drugAllergy.live, drugAllergy.removed].sort());

            const statements = await sql.unsafe<
                {
                    pemeriksaan_id: string;
                    alergi_tidak_ada: boolean;
                    riwayat_sekarang: string | null;
                }[]
            >(
                `select pemeriksaan_id, alergi_tidak_ada, riwayat_sekarang from sim_tr_pemeriksaan_riwayat_penyakit
                 where tenant_id = $1 and deleted_at is null`,
                [clinic],
            );
            expect(
                Object.fromEntries(
                    statements.map((row) => [
                        row.pemeriksaan_id,
                        [row.alergi_tidak_ada, row.riwayat_sekarang],
                    ]),
                ),
            ).toEqual({
                [exam.listed]: [false, 'Demam'],
                [exam.none]: [true, null],
                [exam.noneWithHistory]: [true, 'Batuk'],
            });
            expect([
                ...(await sql.unsafe<{ old: string | null }[]>(
                    `select to_regclass('public.sim_m_pasien_alergi_obat')::text as old`,
                )),
            ]).toEqual([{ old: null }]);

            // Bentuk alergen dijaga database: alergi lainnya wajib bernama, alergi makanan tidak membawa obat.
            const refusedShape = (values: string, parameters: string[]) =>
                sql
                    .unsafe(
                        `insert into sim_m_pasien_alergi (id, tenant_id, pasien_id, kategori, alergi_id, obat_id, nama,
                                                          dicatat_pada)
                         values ${values}`,
                        [id(), clinic, patient.removed, ...parameters],
                    )
                    .then(
                        () => null,
                        (error: unknown) => sqlErrorCode(error),
                    );
            expect(
                await refusedShape(
                    `($1, $2, $3, 'lainnya', null, null, null, now())`,
                    [],
                ),
            ).toBe('23514');
            expect(
                await refusedShape(
                    `($1, $2, $3, 'makanan', (select id from sim_m_alergi where tenant_id = $2 and jenis = 'makanan'
                                              and kode = '02'), $4, null, now())`,
                    [drug.live],
                ),
            ).toBe('23514');
        } finally {
            await sql.end();
        }
    }, 300_000);
});
