import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type postgres from 'postgres';
import { loadConfig } from '@core/platform/config/index.ts';
import { createPool } from '@core/platform/database/index.ts';

// Nomor aset dan nomor penerimaan sekarang bisa datang dari beberapa sequence untuk satu reference: satu per
// perusahaan atau per unit. Sequence per perusahaan boleh menghasilkan nomor terformat yang sama di dua perusahaan
// (F&O: SO-0029 di setiap company), jadi indeks unik dokumen wajib menyertakan perusahaan. Kembaran di dalam satu
// perusahaan ditolak pengaturan nomor dan, bila tetap terjadi, ditolak indeks ini. Butuh PostgreSQL yang sudah
// dimigrasi.
describe.skipIf(!process.env.DB_HOST)('asset number uniqueness', () => {
    let pool: postgres.Sql;

    beforeAll(() => {
        pool = createPool(
            loadConfig({
                ...process.env,
                APP_KEY: 'base64:' + Buffer.alloc(32, 7).toString('base64'),
            }),
        );
    });
    afterAll(async () => {
        await pool.end();
    });

    test.each([
        ['aset_tr_aset', 'aset_tr_aset_kode_unique'],
        ['aset_tr_penerimaan_aset', 'aset_tr_penerimaan_kode_unique'],
    ])(
        '%s keeps numbers unique per company among active rows',
        async (table, index) => {
            const [row] = await pool.unsafe<{ definition: string }[]>(
                'select indexdef as definition from pg_indexes where tablename=$1 and indexname=$2',
                [table, index],
            );
            expect(row?.definition).toContain('UNIQUE');
            expect(row?.definition).toContain(
                '(tenant_id, legal_entity_id, kode)',
            );
            expect(row?.definition).toContain('WHERE (deleted_at IS NULL)');
        },
    );
});
