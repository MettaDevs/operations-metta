import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryApi,
    inventoryDuties,
    json,
    refused,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Period = {
    id: string;
    ending_date: string;
    name: string;
    closed: boolean;
    closed_stamp: { at: string; user_name: string | null } | null;
    reopened_stamp: { at: string; user_name: string | null } | null;
    version: number;
};

const periodsApi = `${inventoryApi}/periods`;

// Periode persediaan (Inventory Period di BC): periode yang ditutup menolak posting dan pembatalan posting bertanggal di
// dalamnya, menutup dan membuka lagi berlaku berurutan, dan stok minus menahan penutupan. Kartu gudang dan periode
// diperiksa dengan SQL langsung, bukan lewat API yang sedang diuji.
describe.skipIf(!process.env.DB_HOST)('inventory periods', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let location: { id: string };
    let item: { id: string };

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Periode',
            inventoryDuties,
        );
        location = await business.location('GUDANG');
        item = await business.item('PRD-1');
    });

    const create = async (target: Business, endingDate: string) =>
        (
            await json<{ data: Period }>(
                await target.admin.post(periodsApi, {
                    ending_date: endingDate,
                }),
                201,
            )
        ).data;
    const act = (
        target: Business,
        period: Period,
        action: 'close' | 'reopen',
    ) =>
        target.admin.post(`${periodsApi}/${period.id}/${action}`, {
            version: period.version,
        });
    const acted = async (
        target: Business,
        period: Period,
        action: 'close' | 'reopen',
    ) =>
        (await json<{ data: Period }>(await act(target, period, action), 200))
            .data;
    const periods = async (target: Business) =>
        (
            await pool.unsafe<{ ending_date: string; closed: boolean }[]>(
                `select tanggal_akhir::text as ending_date, ditutup as closed from gd_m_periode_persediaan
                 where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null order by tanggal_akhir`,
                [target.tenantId, target.legalEntityId],
            )
        ).map((row) => [row.ending_date, row.closed]);
    const entries = async (sourceId: string) =>
        (
            await pool.unsafe<
                { date: string; quantity: string; reversal: boolean }[]
            >(
                `select tanggal_posting::text as date, trim_scale(jumlah)::text as quantity,
                        dibalik_dari is not null as reversal
                 from gd_tr_kartu_gudang where sumber_id = $1 order by id`,
                [sourceId],
            )
        ).map((row) => [row.date, Number(row.quantity), row.reversal]);
    const status = async (adjustmentId: string) =>
        (
            await pool.unsafe<{ status: string }[]>(
                'select status from gd_tr_penyesuaian where id = $1',
                [adjustmentId],
            )
        )[0]?.status;

    test('a closed period refuses postings dated up to its ending date and allows postings after it', async () => {
        const target = await createBusiness(
            pool,
            browser,
            'Klinik Uji Posting Tertutup',
            inventoryDuties,
        );
        const store = await target.location('GUDANG');
        const goods = await target.item('PRD-2');
        await target.posted(
            'masuk',
            store.id,
            [{ item_id: goods.id, quantity: 10, unit_cost: 100 }],
            '2026-10-05',
        );
        await acted(target, await create(target, '2026-10-31'), 'close');

        const inside = await target.draft(
            'keluar',
            store.id,
            [{ item_id: goods.id, quantity: 2 }],
            '2026-10-31',
        );
        expect(await refused(await target.post(inside))).toEqual({
            _form: [
                'Periode persediaan Oktober 2026 sudah ditutup, jadi stok bertanggal 31 Oktober 2026 tidak bisa diposting. Pakai tanggal sesudah 31 Oktober 2026, atau minta periode itu dibuka lagi.',
            ],
        });
        expect(await entries(inside.id)).toEqual([]);
        expect(await status(inside.id)).toBe('draf');

        const after = await target.posted(
            'keluar',
            store.id,
            [{ item_id: goods.id, quantity: 2 }],
            '2026-11-01',
        );
        expect(await entries(after.id)).toEqual([['2026-11-01', -2, false]]);
        expect(await target.stock(goods.id, store.id)).toEqual({ '-': 8 });
    });

    test('cancelling a posting inside a closed period is refused until the period is reopened', async () => {
        const posted = await business.posted(
            'masuk',
            location.id,
            [{ item_id: item.id, quantity: 5, unit_cost: 200 }],
            '2026-09-15',
        );
        const september = await acted(
            business,
            await create(business, '2026-09-30'),
            'close',
        );
        expect(await refused(await business.reverse(posted))).toEqual({
            _form: [
                'Periode persediaan September 2026 sudah ditutup, jadi posting bertanggal 15 September 2026 tidak bisa dibatalkan. Minta periode itu dibuka lagi bila pembatalannya memang perlu.',
            ],
        });
        expect(await entries(posted.id)).toEqual([['2026-09-15', 5, false]]);
        expect(await status(posted.id)).toBe('diposting');

        const reopened = await acted(business, september, 'reopen');
        expect(reopened.closed).toBe(false);
        expect(reopened.reopened_stamp?.user_name).toBe('Anggota uji');
        expect((await business.reverse(posted)).status).toBe(200);
        expect(await entries(posted.id)).toEqual([
            ['2026-09-15', 5, false],
            ['2026-09-15', -5, true],
        ]);
        expect(await status(posted.id)).toBe('dibatalkan');
    });

    test('closing also closes earlier periods, reopening also reopens later ones, and closed periods keep their place', async () => {
        const target = await createBusiness(
            pool,
            browser,
            'Klinik Uji Urutan Periode',
            inventoryDuties,
        );
        const september = await create(target, '2026-09-30');
        const october = await create(target, '2026-10-31');
        const november = await create(target, '2026-11-30');
        expect(september.name).toBe('September 2026');

        const closed = await acted(target, october, 'close');
        expect(closed.closed_stamp?.user_name).toBe('Anggota uji');
        expect(await periods(target)).toEqual([
            ['2026-09-30', true],
            ['2026-10-31', true],
            ['2026-11-30', false],
        ]);
        expect(
            await refused(
                await target.admin.post(periodsApi, {
                    ending_date: '2026-10-15',
                }),
            ),
        ).toEqual({
            ending_date: [
                'Persediaan sudah ditutup sampai 31 Oktober 2026. Pilih tanggal akhir sesudahnya.',
            ],
        });
        expect(
            Object.keys(
                await refused(
                    await target.admin.delete(`${periodsApi}/${closed.id}`, {
                        version: closed.version,
                    }),
                ),
            ),
        ).toEqual(['_form']);
        const septemberNow = (
            await json<{ data: Period[] }>(
                await target.admin.get(`${periodsApi}?q=September`),
                200,
            )
        ).data[0];
        if (!septemberNow) throw new Error('September is missing.');
        expect(
            Object.keys(
                await refused(
                    await target.admin.patch(
                        `${periodsApi}/${septemberNow.id}`,
                        {
                            ending_date: '2026-09-29',
                            version: septemberNow.version,
                        },
                    ),
                ),
            ),
        ).toEqual(['ending_date']);
        const renamed = (
            await json<{ data: Period }>(
                await target.admin.patch(`${periodsApi}/${septemberNow.id}`, {
                    ending_date: '2026-09-30',
                    name: 'Triwulan III',
                    version: septemberNow.version,
                }),
                200,
            )
        ).data;
        expect(renamed.name).toBe('Triwulan III');

        await acted(target, renamed, 'reopen');
        expect(await periods(target)).toEqual([
            ['2026-09-30', false],
            ['2026-10-31', false],
            ['2026-11-30', false],
        ]);
        expect(await refused(await act(target, november, 'reopen'))).toEqual({
            _form: ['Periode ini belum ditutup.'],
        });
    });

    test('negative stock up to the ending date keeps the period open', async () => {
        const target = await createBusiness(
            pool,
            browser,
            'Klinik Uji Stok Minus',
            inventoryDuties,
        );
        const store = await target.location('APOTEK');
        const goods = await target.item('MINUS-1', {
            refuse_negative_stock: false,
        });
        await target.posted(
            'keluar',
            store.id,
            [{ item_id: goods.id, quantity: 3 }],
            '2026-10-10',
        );
        const october = await create(target, '2026-10-31');
        expect(await refused(await act(target, october, 'close'))).toEqual({
            _form: [
                'Periode ini belum bisa ditutup karena masih ada stok minus sampai 31 Oktober 2026: MINUS-1 Barang MINUS-1 di Lokasi APOTEK (kurang 3). Terima atau sesuaikan stok barang itu lebih dulu.',
            ],
        });
        expect(await periods(target)).toEqual([['2026-10-31', false]]);

        await target.posted(
            'masuk',
            store.id,
            [{ item_id: goods.id, quantity: 3, unit_cost: 50 }],
            '2026-10-20',
        );
        expect((await act(target, october, 'close')).status).toBe(200);
        expect(await periods(target)).toEqual([['2026-10-31', true]]);
    });

    test('closing and reopening need their own permission, and the list says which actions the member may take', async () => {
        const viewer = await createMember(pool, business.tenantId, [
            'core.organization.manage',
            'core.inventory-period.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            viewer.membershipId,
        );
        const session = browser();
        await session.login(viewer.email, viewer.password);
        await json(
            await session.put('/api/v1/workspace-context', {
                membership_id: viewer.membershipId,
                legal_entity_id: business.legalEntityId,
            }),
            200,
        );
        const listed = await json<{
            data: Period[];
            can_manage: boolean;
            can_close: boolean;
            can_reopen: boolean;
        }>(await session.get(periodsApi), 200);
        expect([
            listed.can_manage,
            listed.can_close,
            listed.can_reopen,
        ]).toEqual([false, false, false]);
        const period = await create(business, '2027-01-31');
        expect(
            (
                await session.post(`${periodsApi}/${period.id}/close`, {
                    version: period.version,
                })
            ).status,
        ).toBe(403);
        expect(
            (await session.post(periodsApi, { ending_date: '2027-02-28' }))
                .status,
        ).toBe(403);
        expect(await periods(business)).toContainEqual(['2027-01-31', false]);
    });

    test('a closed period binds only its own legal entity', async () => {
        const target = await createBusiness(
            pool,
            browser,
            'Klinik Uji Dua Legal Entity',
            inventoryDuties,
        );
        await acted(target, await create(target, '2026-12-31'), 'close');
        const second = (
            await json<{ data: { id: string } }>(
                await target.admin.post('/api/v1/organizations', {
                    classification: 'legal_entity',
                    name: 'PT Klinik Uji Dua Legal Entity Kedua',
                    company_code: `P${Math.floor(Math.random() * 1e6)}`,
                    country_code: 'ID',
                }),
                201,
            )
        ).data.id;
        await json(
            await target.admin.put('/api/v1/workspace-context', {
                membership_id: target.member.membershipId,
                legal_entity_id: second,
            }),
            200,
        );
        expect(
            (
                await json<{ data: Period[] }>(
                    await target.admin.get(periodsApi),
                    200,
                )
            ).data,
        ).toEqual([]);
        const unit = (
            await json<{ data: { id: string } }>(
                await target.admin.post(`${inventoryApi}/units-of-measure`, {
                    code: 'TAB',
                    name: 'Tablet',
                }),
                201,
            )
        ).data;
        const store = await target.location('GUDANG');
        const goods = (
            await json<{ data: { id: string } }>(
                await target.admin.post(`${inventoryApi}/items`, {
                    code: 'LE-2',
                    name: 'Barang legal entity kedua',
                    base_unit_id: unit.id,
                }),
                201,
            )
        ).data;
        const reasons = (
            await json<{ data: { id: string; code: string }[] }>(
                await target.admin.get(`${inventoryApi}/reason-codes`),
                200,
            )
        ).data;
        const draft = (
            await json<{ data: { id: string; version: number } }>(
                await target.admin.post(`${inventoryApi}/adjustments`, {
                    direction: 'masuk',
                    location_id: store.id,
                    posting_date: '2026-12-15',
                    reason_id: reasons.find(
                        (reason) => reason.code === 'SALDO-AWAL',
                    )?.id,
                    lines: [{ item_id: goods.id, quantity: 4, unit_cost: 10 }],
                }),
                201,
            )
        ).data;
        expect((await target.post(draft)).status).toBe(200);
        expect(await entries(draft.id)).toEqual([['2026-12-15', 4, false]]);
        const otherTenant = await createBusiness(
            pool,
            browser,
            'Klinik Uji Tenant Lain',
            inventoryDuties,
        );
        const otherStore = await otherTenant.location('GUDANG');
        const otherGoods = await otherTenant.item('LAIN-1');
        expect(
            (
                await otherTenant.adjust(
                    'masuk',
                    otherStore.id,
                    [{ item_id: otherGoods.id, quantity: 1, unit_cost: 1 }],
                    '2026-12-15',
                )
            ).status,
        ).toBe(200);
    });
});
