import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';

// Log perubahan mengikuti BC: dokumen transaksi dan master tidak dicatat sampai tenant menyalakannya per tabel, sedangkan
// role, keanggotaan, dan setelan log perubahan selalu dicatat sebagai entri protected.
describe.skipIf(!process.env.DB_HOST)(
    'change log of inventory adjustments',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp();
        let business: Business;
        let location: { id: string };
        let item: { id: string };
        afterAll(close);

        beforeAll(async () => {
            business = await createBusiness(
                pool,
                browser,
                'Klinik Uji Log Perubahan',
            );
            location = await business.location('GUDANG');
            item = await business.item('LOG-1');
        });

        const entries = () =>
            pool.unsafe<
                {
                    table_name: string;
                    change_type: string;
                    protected: boolean;
                }[]
            >(
                `select distinct table_name, change_type, protected from change_log_entries
             where tenant_id = $1 order by table_name, change_type`,
                [business.tenantId],
            );

        test('posting an adjustment writes no change log until the tenant turns it on for a table', async () => {
            await business.posted('masuk', location.id, [
                { item_id: item.id, quantity: 5, unit_cost: 1000 },
            ]);
            // Yang tercatat hanya role dan keanggotaan petugas yang disiapkan fixture, semuanya protected.
            expect(
                (await entries()).filter((entry) => !entry.protected),
            ).toEqual([]);
            expect(
                (await entries()).map((entry) => entry.table_name),
            ).toContain('role_assignments');

            await pool.unsafe(
                `insert into change_log_setup_tables (id, tenant_id, table_name, log_insertion, log_modification, log_deletion,
                 created_at, updated_at)
             values ($1, $2, 'gd_tr_penyesuaian', 'all', 'none', 'none', now(), now())`,
                [Bun.randomUUIDv7(), business.tenantId],
            );
            const posted = await business.posted('masuk', location.id, [
                { item_id: item.id, quantity: 2, unit_cost: 1000 },
            ]);

            expect(
                (await entries()).filter((entry) => !entry.protected),
            ).toEqual([
                {
                    table_name: 'gd_tr_penyesuaian',
                    change_type: 'insertion',
                    protected: false,
                },
            ]);
            const [header] = await pool.unsafe<{ fields: number }[]>(
                "select count(*)::int as fields from change_log_entries where table_name = 'gd_tr_penyesuaian' and record_id = $1",
                [posted.id],
            );
            expect(header?.fields).toBeGreaterThan(0);
            expect(await entries()).toContainEqual({
                table_name: 'change_log_setup_tables',
                change_type: 'insertion',
                protected: true,
            });
        });
    },
);
