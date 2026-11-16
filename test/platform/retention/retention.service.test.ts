import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { applyRetention } from '../../../src/platform/retention/index.ts';
import { operationsTestApp } from '../../support/operations-app.ts';
import { createTenant } from '../../support/tenant-fixtures.ts';

// Retensi log perubahan, padanan kebijakan retensi Change Log Entry BC: entri protected disimpan paling sedikit satu
// tahun, entri lain satu tahun kecuali tenant memilih lain. Butuh PostgreSQL yang sudah dimigrasi.
describe.skipIf(!process.env.DB_HOST)('change log retention', () => {
    if (!process.env.DB_HOST) return;
    const { pool, close } = operationsTestApp();
    afterAll(close);
    let kept: string;
    let shortened: string;

    // Entri sintetis berumur sekian hari. field_name menamainya, supaya hasilnya terbaca sebagai daftar.
    async function entry(
        tenantId: string,
        label: string,
        isProtected: boolean,
        ageDays: number,
    ) {
        await pool.unsafe(
            `insert into change_log_entries (tenant_id, changed_at, table_name, record_id, field_name, change_type, protected)
             values ($1, now() - make_interval(days => $2), 'retention_probe', $3, $3, 'insertion', $4)`,
            [tenantId, ageDays, label, isProtected],
        );
    }
    async function remaining(tenantId: string) {
        return (
            await pool.unsafe<{ field_name: string }[]>(
                "select field_name from change_log_entries where tenant_id = $1 and table_name = 'retention_probe' order by field_name",
                [tenantId],
            )
        ).map((row) => row.field_name);
    }
    async function logged(tenantId: string) {
        return [
            ...(await pool.unsafe<
                { policy_code: string; deleted_count: string; status: string }[]
            >(
                'select policy_code, deleted_count::text, status from retention_policy_log_entries where tenant_id = $1 order by policy_code',
                [tenantId],
            )),
        ];
    }

    beforeAll(async () => {
        kept = await createTenant(pool, 'Klinik Uji Retensi Bawaan');
        shortened = await createTenant(pool, 'Klinik Uji Retensi Pendek');
        for (const tenantId of [kept, shortened]) {
            await entry(tenantId, 'protected-200', true, 200);
            await entry(tenantId, 'protected-400', true, 400);
            await entry(tenantId, 'other-20', false, 20);
            await entry(tenantId, 'other-200', false, 200);
            await entry(tenantId, 'other-400', false, 400);
        }
        // Tenant kedua memendekkan keduanya menjadi 30 hari; entri protected tetap tertahan minimum satu tahun.
        for (const policy of ['change_log_protected', 'change_log_unprotected'])
            await pool.unsafe(
                `insert into retention_policy_setups (id, tenant_id, policy_code, enabled, retention_days, created_at, updated_at)
                 values ($1, $2, $3, true, 30, now(), now())`,
                [Bun.randomUUIDv7(), shortened, policy],
            );
    });

    test('without a setup, protected and other entries are kept one year, and the run is recorded once', async () => {
        await applyRetention(pool);
        expect(await remaining(kept)).toEqual([
            'other-20',
            'other-200',
            'protected-200',
        ]);
        expect(await logged(kept)).toEqual([
            {
                policy_code: 'change_log_protected',
                deleted_count: '1',
                status: 'success',
            },
            {
                policy_code: 'change_log_unprotected',
                deleted_count: '1',
                status: 'success',
            },
        ]);

        const again = await applyRetention(pool);
        expect(again.filter((result) => result.tenant_id === kept)).toEqual([
            {
                tenant_id: kept,
                policy_code: 'change_log_protected',
                deleted: 0,
                error: null,
            },
            {
                tenant_id: kept,
                policy_code: 'change_log_unprotected',
                deleted: 0,
                error: null,
            },
        ]);
        expect(await logged(kept)).toHaveLength(2);
    });

    test('a tenant shortens the period of other entries, but never below one year for protected entries', async () => {
        await applyRetention(pool);
        expect(await remaining(shortened)).toEqual([
            'other-20',
            'protected-200',
        ]);
        expect(await logged(shortened)).toEqual([
            {
                policy_code: 'change_log_protected',
                deleted_count: '1',
                status: 'success',
            },
            {
                policy_code: 'change_log_unprotected',
                deleted_count: '2',
                status: 'success',
            },
        ]);
    });
});
