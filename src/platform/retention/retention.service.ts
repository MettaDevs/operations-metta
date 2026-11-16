import type postgres from 'postgres';
import { z } from 'zod';

// Tabel yang boleh dihapus berdasarkan umur, padanan Reten. Pol. Allowed Tables di BC. Hanya log yang masuk ke sini;
// data bisnis tidak pernah dihapus fisik. Satu kebijakan setara satu baris filter Retention Policy Setup BC: baris tabel
// yang dipilih `rows`, masa simpan bawaan, dan masa simpan minimum yang tidak bisa diperpendek tenant.
type RetentionPolicy = {
    code: string;
    table: string;
    dateColumn: string;
    // Ekspresi SQL atas kolom tabel itu sendiri. Ditulis di sini, tidak pernah berasal dari input.
    rows: string;
    minimumDays: number;
    defaultDays: number;
};

// Change Log Entry di BC (RetenPolInstallBaseApp, AddChangeLogEntryToAllowedTables): entri protected disimpan satu
// tahun dengan filter terkunci, entri lain satu tahun sebagai bawaan yang boleh diubah. BC tidak menghapus apa pun
// yang umurnya kurang dari dua hari, jadi itu minimum entri yang tidak protected.
const retentionPolicies = [
    {
        code: 'change_log_protected',
        table: 'change_log_entries',
        dateColumn: 'changed_at',
        rows: 'protected',
        minimumDays: 365,
        defaultDays: 365,
    },
    {
        code: 'change_log_unprotected',
        table: 'change_log_entries',
        dateColumn: 'changed_at',
        rows: 'not protected',
        minimumDays: 2,
        defaultDays: 365,
    },
] as const satisfies readonly RetentionPolicy[];

export type RetentionResult = {
    tenant_id: string;
    policy_code: string;
    deleted: number;
    error: unknown;
};

const batchSize = 1000;
const dayMs = 24 * 60 * 60 * 1000;

const setupSchema = z.object({
    tenant_id: z.string(),
    policy_code: z.string(),
    retention_days: z.number().nullable(),
});

// Menghapus baris yang lewat masa simpan untuk setiap tenant di database ini. Setiap kebijakan selalu berjalan, seperti
// kebijakan retensi CoreERP yang punya bawaan; baris retention_policy_setups tenant hanya memilih masa simpannya, dan
// pilihan di bawah minimum dinaikkan ke minimum. Penghapusan berjalan per kelompok kecil, masing-masing transaksinya
// sendiri, sehingga kegagalan di tengah tidak membatalkan yang sudah terhapus dan putaran berikutnya melanjutkan sisanya.
// Hasil per tenant dicatat di retention_policy_log_entries bila ada baris terhapus atau penghapusan gagal.
export async function applyRetention(
    sql: postgres.Sql,
    now: Date = new Date(),
): Promise<RetentionResult[]> {
    const tenants = z
        .array(z.object({ id: z.string() }))
        .parse(await sql`select id from tenants order by id`);
    const setups = z
        .array(setupSchema)
        .parse(
            await sql`select tenant_id, policy_code, retention_days from retention_policy_setups`,
        );
    const results: RetentionResult[] = [];
    for (const tenant of tenants)
        for (const policy of retentionPolicies) {
            const chosen = setups.find(
                (setup) =>
                    setup.tenant_id === tenant.id &&
                    setup.policy_code === policy.code,
            )?.retention_days;
            const days = Math.max(
                policy.minimumDays,
                chosen ?? policy.defaultDays,
            );
            const cutoff = new Date(now.getTime() - days * dayMs).toISOString();
            let deleted = 0;
            let error: unknown = null;
            try {
                for (;;) {
                    const removed = await sql.unsafe(
                        `delete from ${policy.table} where id in (
                            select id from ${policy.table}
                            where tenant_id = $1 and ${policy.rows} and ${policy.dateColumn} < $2
                            limit ${batchSize})`,
                        [tenant.id, cutoff],
                    );
                    deleted += removed.count;
                    if (removed.count < batchSize) break;
                }
            } catch (caught) {
                error = caught;
            }
            if (deleted > 0 || error !== null)
                await sql.unsafe(
                    `insert into retention_policy_log_entries
                         (id, tenant_id, policy_code, deleted_count, cutoff_at, status, message, created_at, updated_at)
                     values ($1, $2, $3, $4, $5, $6, $7, now(), now())`,
                    [
                        Bun.randomUUIDv7(),
                        tenant.id,
                        policy.code,
                        deleted,
                        cutoff,
                        error === null ? 'success' : 'failed',
                        error === null
                            ? null
                            : 'Penghapusan gagal dan akan dicoba lagi pada putaran berikutnya.',
                    ],
                );
            results.push({
                tenant_id: tenant.id,
                policy_code: policy.code,
                deleted,
                error,
            });
        }
    return results;
}
