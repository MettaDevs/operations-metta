import { afterAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { databaseSettingsSchema } from '../../../../../src/platform/config/index.ts';

// Kode LOINC dan satuan UCUM tanda vital untuk SATUSEHAT Observation ada di komentar kolomnya (0048). Kolom angka di
// periksa fisik dianggap tanda vital, jadi kolom angka baru yang belum diberi kode, atau kolom yang diganti namanya,
// menggagalkan test ini. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('vital sign codes', () => {
    if (!process.env.DB_HOST) return;
    const settings = databaseSettingsSchema.parse(process.env);
    const sql = postgres({
        host: settings.DB_HOST,
        port: settings.DB_PORT,
        database: settings.DB_DATABASE,
        username: settings.DB_USERNAME,
        password: settings.DB_PASSWORD,
        max: 1,
    });
    afterAll(() => sql.end());

    const shape =
        /^SATUSEHAT Observation: LOINC (\d+-\d) [^;]+; (?:satuan UCUM ([^;\s]+)|tanpa satuan)/;

    test('every vital-sign column names its LOINC code and UCUM unit', async () => {
        const columns = await sql.unsafe<
            { name: string; comment: string | null }[]
        >(
            `select c.relname || '.' || a.attname as name, col_description(a.attrelid, a.attnum) as comment
             from pg_attribute a
             join pg_class c on c.oid = a.attrelid
             where c.relnamespace = 'public'::regnamespace
               and c.relname in ('sim_tr_pemeriksaan_fisik', 'sim_tr_registrasi')
               and a.attnum > 0 and not a.attisdropped
               and (col_description(a.attrelid, a.attnum) like 'SATUSEHAT Observation:%'
                    or (c.relname = 'sim_tr_pemeriksaan_fisik'
                        and a.atttypid in ('smallint'::regtype, 'numeric'::regtype)))`,
        );
        const codes = Object.fromEntries(
            columns.map(({ name, comment }) => {
                const match = shape.exec(comment ?? '');
                return [
                    name,
                    match
                        ? { loinc: match[1], ucum: match[2] ?? null }
                        : comment,
                ];
            }),
        );
        expect(codes).toEqual({
            'sim_tr_pemeriksaan_fisik.kesadaran': {
                loinc: '67775-7',
                ucum: null,
            },
            'sim_tr_pemeriksaan_fisik.sistole': {
                loinc: '8480-6',
                ucum: 'mm[Hg]',
            },
            'sim_tr_pemeriksaan_fisik.diastole': {
                loinc: '8462-4',
                ucum: 'mm[Hg]',
            },
            'sim_tr_pemeriksaan_fisik.tinggi_badan': {
                loinc: '8302-2',
                ucum: 'cm',
            },
            'sim_tr_pemeriksaan_fisik.berat_badan': {
                loinc: '29463-7',
                ucum: 'kg',
            },
            'sim_tr_pemeriksaan_fisik.lingkar_perut': {
                loinc: '8280-0',
                ucum: 'cm',
            },
            'sim_tr_pemeriksaan_fisik.detak_nadi': {
                loinc: '8867-4',
                ucum: '{beats}/min',
            },
            'sim_tr_pemeriksaan_fisik.nafas': { loinc: '9279-1', ucum: '/min' },
            'sim_tr_pemeriksaan_fisik.saturasi': {
                loinc: '59408-5',
                ucum: '%',
            },
            'sim_tr_pemeriksaan_fisik.suhu': { loinc: '8310-5', ucum: 'Cel' },
            'sim_tr_registrasi.tinggi_badan': { loinc: '8302-2', ucum: 'cm' },
            'sim_tr_registrasi.berat_badan': { loinc: '29463-7', ucum: 'kg' },
        });
    });
});
