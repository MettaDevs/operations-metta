import { afterAll, describe, expect, test } from 'bun:test';
import { createBusiness } from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';

// Posting serentak lewat aplikasi sungguhan dengan pool koneksi yang cukup untuk benar-benar berebut. Hasilnya diperiksa
// dengan SQL langsung ke kartu gudang, bukan lewat API yang sedang diuji.
describe.skipIf(!process.env.DB_HOST)('item ledger concurrency', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '12' });
    afterAll(close);

    test('50 concurrent issues against 30 units in two batches post exactly 30 units and refuse the rest', async () => {
        const business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Rebutan',
        );
        const profile = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        const location = await business.location('APOTEK');
        const item = await business.item('REBUT-1', {
            tracking_code_id: profile.id,
        });
        await business.posted('masuk', location.id, [
            {
                item_id: item.id,
                quantity: 10,
                batch_number: 'a',
                expiry_date: '2027-01-31',
                unit_cost: 1000,
            },
            {
                item_id: item.id,
                quantity: 20,
                batch_number: 'b',
                expiry_date: '2027-06-30',
                unit_cost: 1100,
            },
        ]);
        const drafts = [];
        for (let index = 0; index < 50; index++)
            drafts.push(
                await business.draft('keluar', location.id, [
                    { item_id: item.id, quantity: 1 },
                ]),
            );

        const responses = await Promise.all(
            drafts.map((draft) => business.post(draft)),
        );
        const statuses = responses.map((response) => response.status);
        expect(statuses.filter((status) => status === 200)).toHaveLength(30);
        expect(statuses.filter((status) => status === 422)).toHaveLength(20);

        const [ledger] = await pool.unsafe<
            {
                issued: string;
                negative_open: number;
                quantity: string;
                open: string;
                applied: string;
                issue_rows: number;
                posted: number;
            }[]
        >(
            `with entries as (
                 select * from gd_tr_kartu_gudang where tenant_id = $1 and barang_id = $2 and lokasi_id = $3)
             select (select trim_scale(sum(jumlah))::text from entries where jumlah < 0) as issued,
                    (select count(*)::int from entries where sisa < 0) as negative_open,
                    (select trim_scale(sum(jumlah))::text from entries) as quantity,
                    (select trim_scale(coalesce(sum(sisa), 0))::text from entries where sisa <> 0) as open,
                    (select trim_scale(sum(a.jumlah))::text from gd_tr_kartu_gudang_aplikasi a
                     join entries k on k.id = a.entri_keluar_id) as applied,
                    (select count(*)::int from entries where jumlah < 0) as issue_rows,
                    (select count(*)::int from gd_tr_penyesuaian
                     where tenant_id = $1 and arah = 'keluar' and status = 'diposting') as posted`,
            [business.tenantId, item.id, location.id],
        );
        expect(ledger).toEqual({
            issued: '-30',
            negative_open: 0,
            quantity: '0',
            open: '0',
            applied: '30',
            issue_rows: 30,
            posted: 30,
        });
        expect(await business.stock(item.id, location.id)).toEqual({});
    }, 60_000);

    test('documents that touch the same items in opposite line order post concurrently without deadlock', async () => {
        const business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Urutan',
        );
        const location = await business.location('GUDANG');
        const first = await business.item('URUT-X');
        const second = await business.item('URUT-Y');
        await business.posted('masuk', location.id, [
            { item_id: first.id, quantity: 100, unit_cost: 500 },
            { item_id: second.id, quantity: 100, unit_cost: 700 },
        ]);
        const drafts = [];
        for (let index = 0; index < 20; index++) {
            const lines = [
                { item_id: first.id, quantity: 1 },
                { item_id: second.id, quantity: 1 },
            ];
            drafts.push(
                await business.draft(
                    'keluar',
                    location.id,
                    index % 2 ? lines.reverse() : lines,
                ),
            );
        }
        const responses = await Promise.all(
            drafts.map((draft) => business.post(draft)),
        );
        expect(responses.map((response) => response.status)).toEqual(
            Array<number>(20).fill(200),
        );
        expect(await business.stock(first.id, location.id)).toEqual({
            '-': 80,
        });
        expect(await business.stock(second.id, location.id)).toEqual({
            '-': 80,
        });
    }, 60_000);
});
