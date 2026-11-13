import { afterAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../../../../../src/platform/config/index.ts';
import {
    migrate,
    readMigrationSource,
    type MigrationSource,
} from '../../../../../src/platform/migration/index.ts';

// Pindahan obat E3 menjadi barang Core di database yang sudah berisi data: migration Core menyalin obat dan satuan obat
// ke legal entity yang kunjungannya paling banyak dengan id yang sama, lalu migration module memasang FK perluasan dan
// membuang kolom kembar. Jalur database baru (migration Core sebelum tabel module ada) dibuktikan database test itu
// sendiri, yang dimigrasi dari kosong. Butuh PostgreSQL; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('drug items migration', () => {
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
    const database = `${settings.DB_DATABASE.slice(0, 40)}_obat_${Bun.randomUUIDv7().slice(-8)}`;
    afterAll(async () => {
        await runtime.unsafe(
            `drop database if exists "${database}" with (force)`,
        );
        await runtime.end();
    }, 120_000);

    // Semua migration sampai sebelum pindahan obat, untuk Core dan layanan kesehatan.
    const beforeDrugItems = (migrations: MigrationSource['core']) =>
        migrations.slice(
            0,
            migrations.findIndex((migration) =>
                migration.name.endsWith('_drug_items.sql'),
            ),
        );
    const healthcare = source.modules.get('healthcare') ?? [];
    const e3: MigrationSource = {
        core: beforeDrugItems(source.core),
        modules: new Map([['healthcare', beforeDrugItems(healthcare)]]),
    };

    const id = () => Bun.randomUUIDv7();
    const clinic = id();
    const empty = id();
    const firstEntity = id();
    const busyEntity = id();
    const unit = { tablet: id(), bottle: id(), bag: id(), lonely: id() };
    const coreBottle = id();
    const coreItem = id();
    const drug = {
        clashing: id(),
        uncoded: id(),
        coded: id(),
        long: id(),
        deleted: id(),
        resting: id(),
        lonely: id(),
    };

    test('an upgraded database ends with drugs as items under the same ids and intact foreign keys', async () => {
        await runtime.unsafe(`create database "${database}"`);
        const sql = connect(database);
        try {
            await migrate(sql, e3, { modules: ['healthcare'] });
            // Data E3 disisipkan langsung; induk yang tidak dibaca pindahan ini (pasien, resep) dilewati dengan
            // session_replication_role, yang juga mematikan trigger audit.
            await sql.begin(async (tx) => {
                await tx.unsafe('set local session_replication_role = replica');
                for (const tenant of [clinic, empty])
                    await tx.unsafe(
                        `insert into tenants (id, client_id, name, slug, created_at, updated_at)
                         values ($1, $2, 'Klinik uji', $3, now(), now())`,
                        [tenant, id(), `uji-${tenant}`],
                    );
                await tx.unsafe(
                    `insert into organizations (id, tenant_id, name, classification, created_at)
                     values ($1, $3, 'PT Pertama', 'legal_entity', now() - interval '2 day'),
                            ($2, $3, 'PT Ramai', 'legal_entity', now() - interval '1 day')`,
                    [firstEntity, busyEntity, clinic],
                );
                for (const visit of [1, 2])
                    await tx.unsafe(
                        `insert into sim_tr_registrasi (id, tenant_id, no_reg, creation_key, legal_entity_id,
                                                        operating_unit_id, pasien_id, tanggal, didaftarkan_pada,
                                                        tipe_pasien_id, status_kunjungan, jenis_kunjungan)
                         values ($1, $2, $3, $3, $4, $5, $5, current_date, now(), $5, 'sakit', 'baru')`,
                        [id(), clinic, `REG-${visit}`, busyEntity, id()],
                    );
                await tx.unsafe(
                    `insert into sim_m_satuan_obat (id, tenant_id, kode, nama)
                     values ($1, $5, 'TABLET', 'TAB'), ($2, $5, 'BOTOL', 'Botol obat'), ($3, $5, 'Bag', 'Kantong'),
                            ($4, $6, 'TABLET', 'TAB')`,
                    [
                        unit.tablet,
                        unit.bottle,
                        unit.bag,
                        unit.lonely,
                        clinic,
                        empty,
                    ],
                );
                await tx.unsafe(
                    `insert into gd_m_satuan (id, tenant_id, legal_entity_id, kode, nama)
                     values ($1, $2, $3, 'BOTOL', 'Botol persediaan')`,
                    [coreBottle, clinic, busyEntity],
                );
                await tx.unsafe(
                    `insert into gd_m_barang (id, tenant_id, legal_entity_id, kode, nama, satuan_dasar_id)
                     values ($1, $2, $3, 'PCT', 'Barang persediaan', $4)`,
                    [coreItem, clinic, busyEntity, coreBottle],
                );
                await tx.unsafe(
                    `insert into sim_m_obat (id, tenant_id, kode, nama, satuan_id, aktif, deleted_at)
                     values ($1, $8, 'pct', 'Parasetamol', $10, true, null),
                            ($2, $8, null, 'Obat batuk', $11, true, null),
                            ($3, $8, 'amx', 'Amoksisilin', $12, true, null),
                            ($4, $8, 'AMOXICILLIN-500-MG-KAPSUL', 'Amoksisilin panjang', $10, true, null),
                            ($5, $8, 'amx', 'Amoksisilin lama', $10, true, now()),
                            ($6, $8, 'ctm', 'CTM', $10, false, null),
                            ($7, $9, null, 'Obat tanpa legal entity', $13, true, null)`,
                    [
                        drug.clashing,
                        drug.uncoded,
                        drug.coded,
                        drug.long,
                        drug.deleted,
                        drug.resting,
                        drug.lonely,
                        clinic,
                        empty,
                        unit.tablet,
                        unit.bottle,
                        unit.bag,
                        unit.lonely,
                    ],
                );
                await tx.unsafe(
                    `insert into sim_tr_resep_detail (id, tenant_id, resep_id, urutan, obat_id, jumlah)
                     values ($1, $2, $3, 1, $4, 10)`,
                    [id(), clinic, id(), drug.clashing],
                );
                // Pasiennya ada, karena pindahan alergi pasien sesudahnya menyalin baris ini lewat foreign key yang aktif.
                const clinicPatient = id();
                const emptyPatient = id();
                await tx.unsafe(
                    `insert into sim_m_pasien (id, tenant_id, party_id, legal_entity_id, org_unit_id, nrm, creation_key)
                     values ($1, $3, $1, $1, $1, 'NRM-1', 'pasien-1'), ($2, $4, $2, $2, $2, 'NRM-2', 'pasien-2')`,
                    [clinicPatient, emptyPatient, clinic, empty],
                );
                await tx.unsafe(
                    `insert into sim_m_pasien_alergi_obat (id, tenant_id, pasien_id, obat_id)
                     values ($1, $2, $3, $4), ($5, $6, $7, $8)`,
                    [
                        id(),
                        clinic,
                        clinicPatient,
                        drug.coded,
                        id(),
                        empty,
                        emptyPatient,
                        drug.lonely,
                    ],
                );
            });

            await migrate(sql, source, { modules: ['healthcare'] });

            const items = await sql.unsafe<
                {
                    id: string;
                    legal_entity_id: string;
                    kode: string;
                    nama: string;
                    satuan_dasar_id: string;
                    deleted: boolean;
                }[]
            >(
                `select id, legal_entity_id, kode, nama, satuan_dasar_id, deleted_at is not null as deleted
                 from gd_m_barang where tenant_id = $1 and id <> $2`,
                [clinic, coreItem],
            );
            const generated = (drugId: string) =>
                `OBT-${drugId.replaceAll('-', '').slice(-12).toUpperCase()}`;
            expect(
                Object.fromEntries(
                    items.map((item) => [
                        item.id,
                        [
                            item.legal_entity_id,
                            item.kode,
                            item.nama,
                            item.satuan_dasar_id,
                            item.deleted,
                        ],
                    ]),
                ),
            ).toEqual({
                [drug.clashing]: [
                    busyEntity,
                    generated(drug.clashing),
                    'Parasetamol',
                    unit.tablet,
                    false,
                ],
                [drug.uncoded]: [
                    busyEntity,
                    generated(drug.uncoded),
                    'Obat batuk',
                    coreBottle,
                    false,
                ],
                [drug.coded]: [
                    busyEntity,
                    'AMX',
                    'Amoksisilin',
                    unit.bag,
                    false,
                ],
                [drug.long]: [
                    busyEntity,
                    generated(drug.long),
                    'Amoksisilin panjang',
                    unit.tablet,
                    false,
                ],
                [drug.deleted]: [
                    busyEntity,
                    'AMX',
                    'Amoksisilin lama',
                    unit.tablet,
                    true,
                ],
                [drug.resting]: [busyEntity, 'CTM', 'CTM', unit.tablet, false],
            });
            expect([
                ...(await sql.unsafe<
                    { id: string; kode: string; legal_entity_id: string }[]
                >(
                    `select id, kode, legal_entity_id from gd_m_satuan where tenant_id = $1 order by kode`,
                    [clinic],
                )),
            ]).toEqual([
                { id: unit.bag, kode: 'BAG', legal_entity_id: busyEntity },
                { id: coreBottle, kode: 'BOTOL', legal_entity_id: busyEntity },
                {
                    id: unit.tablet,
                    kode: 'TABLET',
                    legal_entity_id: busyEntity,
                },
            ]);

            const extensions = await sql.unsafe<
                {
                    id: string;
                    legal_entity_id: string | null;
                    boleh_diresepkan: boolean;
                    deleted: boolean;
                }[]
            >(
                `select id, legal_entity_id, boleh_diresepkan, deleted_at is not null as deleted
                 from sim_m_obat where id = any($1::uuid[])`,
                [Object.values(drug)],
            );
            expect(
                Object.fromEntries(
                    extensions.map((row) => [
                        row.id,
                        [
                            row.legal_entity_id,
                            row.boleh_diresepkan,
                            row.deleted,
                        ],
                    ]),
                ),
            ).toEqual({
                [drug.clashing]: [busyEntity, true, false],
                [drug.uncoded]: [busyEntity, true, false],
                [drug.coded]: [busyEntity, true, false],
                [drug.long]: [busyEntity, true, false],
                [drug.deleted]: [busyEntity, true, true],
                [drug.resting]: [busyEntity, false, false],
                [drug.lonely]: [null, true, true],
            });

            // Resep dan alergi tetap menunjuk sim_m_obat, yang id-nya kini id barang.
            expect([
                ...(await sql.unsafe<{ nama: string }[]>(
                    `select b.nama from sim_tr_resep_detail d join sim_m_obat o on o.id = d.obat_id
                     join gd_m_barang b on b.id = o.id where d.tenant_id = $1
                     union all
                     select b.nama from sim_m_pasien_alergi a join sim_m_obat o on o.id = a.obat_id
                     join gd_m_barang b on b.id = o.id where a.tenant_id = $1 and a.kategori = 'obat'`,
                    [clinic],
                )),
            ]).toEqual([{ nama: 'Parasetamol' }, { nama: 'Amoksisilin' }]);
            expect([
                ...(await sql.unsafe<{ unmatched: number }[]>(
                    `select count(*)::int as unmatched from sim_m_obat o
                     where o.legal_entity_id is not null
                       and not exists (select 1 from gd_m_barang b
                                       where b.tenant_id = o.tenant_id and b.legal_entity_id = o.legal_entity_id
                                         and b.id = o.id)`,
                )),
            ]).toEqual([{ unmatched: 0 }]);
            expect(await shape(sql)).toEqual(expectedShape);
        } finally {
            await sql.end();
        }
    }, 120_000);

    const expectedShape = {
        constraints: [
            'sim_m_obat_barang_check',
            'sim_m_obat_barang_foreign',
            'sim_m_obat_bentuk_sediaan_foreign',
            'sim_m_obat_pkey',
            'sim_m_obat_tenant_id_id_unique',
        ],
        columns: ['boleh_diresepkan', 'legal_entity_id'],
    };

    async function shape(sql: postgres.Sql) {
        const constraints = await sql.unsafe<{ name: string }[]>(
            `select conname as name from pg_constraint
             where conrelid = 'public.sim_m_obat'::regclass and convalidated order by conname`,
        );
        const columns = await sql.unsafe<{ name: string }[]>(
            `select column_name as name from information_schema.columns
             where table_schema = 'public' and table_name = 'sim_m_obat'
               and column_name in ('kode', 'nama', 'satuan_id', 'aktif', 'boleh_diresepkan', 'legal_entity_id')
             order by column_name`,
        );
        return {
            constraints: constraints.map((row) => row.name),
            columns: columns.map((row) => row.name),
        };
    }

    test('a database migrated from empty has the same drug shape', async () => {
        expect(await shape(runtime)).toEqual(expectedShape);
    });
});
