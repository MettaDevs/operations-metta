import { afterAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    json,
    refused,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';

type Period = { id: string; version: number };

// Menutup periode sambil posting berjalan, lewat aplikasi sungguhan. Urutan antara keduanya dipaksa dengan kunci yang
// dipegang koneksi test, bukan dengan jeda, dan hasilnya diperiksa dengan SQL langsung ke periode dan kartu gudang.
describe.skipIf(!process.env.DB_HOST)('inventory period concurrency', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '12' });
    afterAll(close);

    async function setup(name: string) {
        const business = await createBusiness(pool, browser, name);
        const location = await business.location('APOTEK');
        const item = await business.item('RACE-1', {
            refuse_negative_stock: false,
        });
        const period = (
            await json<{ data: Period }>(
                await business.admin.post(`${inventoryApi}/periods`, {
                    ending_date: '2026-10-31',
                }),
                201,
            )
        ).data;
        const closing = () =>
            business.admin.post(`${inventoryApi}/periods/${period.id}/close`, {
                version: period.version,
            });
        const state = async () => {
            const [row] = await pool.unsafe<
                { closed: boolean; entries: number }[]
            >(
                `select p.ditutup as closed,
                        (select count(*)::int from gd_tr_kartu_gudang k
                         where k.tenant_id = p.tenant_id and k.tanggal_posting <= p.tanggal_akhir) as entries
                 from gd_m_periode_persediaan p where p.id = $1`,
                [period.id],
            );
            return row;
        };
        return { business, location, item, period, closing, state };
    }

    // Koneksi aplikasi yang tertahan oleh koneksi `pid`. Bila tidak pernah ada, perintah yang seharusnya menunggu
    // ternyata tidak menunggu.
    async function blockedBy(pid: number): Promise<number> {
        for (let attempt = 0; attempt < 200; attempt++) {
            const [row] = await pool.unsafe<{ pid: number }[]>(
                'select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid)) limit 1',
                [pid],
            );
            if (row) return row.pid;
            await Bun.sleep(25);
        }
        throw new Error(`Nothing ever waited behind connection ${pid}.`);
    }
    const pidOf = async (connection: { unsafe: typeof pool.unsafe }) => {
        const [row] = await connection.unsafe<{ pid: number }[]>(
            'select pg_backend_pid() as pid',
        );
        if (!row) throw new Error('No backend pid.');
        return row.pid;
    };

    test('closing waits for a posting already in flight, then sees its negative stock and stays open', async () => {
        const { business, location, item, closing, state } = await setup(
            'Klinik Uji Tutup Menunggu',
        );
        const draft = await business.draft(
            'keluar',
            location.id,
            [{ item_id: item.id, quantity: 3 }],
            '2026-10-10',
        );
        const holder = await pool.reserve();
        try {
            await holder.unsafe(
                'select pg_advisory_lock(hashtextextended($1, 0))',
                [
                    `gd_tr_kartu_gudang:${business.tenantId}:${item.id}:${location.id}`,
                ],
            );
            const posting = business.post(draft);
            const postingPid = await blockedBy(await pidOf(holder));
            const closed = closing();
            await blockedBy(postingPid);
            expect(await state()).toEqual({ closed: false, entries: 0 });
            await holder.unsafe(
                'select pg_advisory_unlock(hashtextextended($1, 0))',
                [
                    `gd_tr_kartu_gudang:${business.tenantId}:${item.id}:${location.id}`,
                ],
            );
            expect((await posting).status).toBe(200);
            expect(Object.keys(await refused(await closed))).toEqual(['_form']);
        } finally {
            await holder.unsafe('select pg_advisory_unlock_all()');
            holder.release();
        }
        expect(await state()).toEqual({ closed: false, entries: 1 });
        expect(await business.stock(item.id, location.id)).toEqual({ '-': -3 });
    }, 30_000);

    test('a posting that arrives while the period is being closed waits for the close and is then refused', async () => {
        const { business, location, item, period, closing, state } =
            await setup('Klinik Uji Posting Menunggu');
        const draft = await business.draft(
            'masuk',
            location.id,
            [{ item_id: item.id, quantity: 5, unit_cost: 100 }],
            '2026-10-10',
        );
        const holder = await pool.reserve();
        let posting: Promise<Response> | null = null;
        try {
            await holder.unsafe('begin');
            await holder.unsafe(
                'select 1 from gd_m_periode_persediaan where id = $1 for update',
                [period.id],
            );
            const closed = closing();
            const closingPid = await blockedBy(await pidOf(holder));
            posting = business.post(draft);
            await blockedBy(closingPid);
            await holder.unsafe('commit');
            expect((await closed).status).toBe(200);
        } finally {
            await holder.unsafe('rollback');
            holder.release();
        }
        expect(Object.keys(await refused(await posting))).toEqual(['_form']);
        expect(await state()).toEqual({ closed: true, entries: 0 });
    }, 30_000);
});
