import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryDuties,
    json,
    refused,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Reference = { id: string; code: string; name: string };
type Requisition = {
    id: string;
    version: number;
    accepted: boolean;
    vendor: { id: string } | null;
    order: { id: string; number: string } | null;
};

const path = '/api/v1/purchasing/requisitions';

describe.skipIf(!process.env.DB_HOST)('purchase requisitions', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let requester: Browser;
    let warehouse: { id: string };
    let pharmacy: { id: string };
    let gauze: { id: string };
    let mask: { id: string };
    let first: { id: string };
    let second: { id: string };

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Permintaan',
            [
                ...inventoryDuties,
                'core.vendor.manage',
                'core.purchase-order.manage',
                'core.purchase-receipt.manage',
                'core.purchase-requisition.manage',
            ],
        );
        const created = async <T = Reference>(
            route: string,
            body: Record<string, unknown>,
        ) =>
            (
                await json<{ data: T }>(
                    await business.admin.post(route, body),
                    201,
                )
            ).data;
        warehouse = await business.location('GUDANG');
        pharmacy = await business.location('FARMASI');
        gauze = await business.item('KASA');
        mask = await business.item('MASKER');
        first = await created('/api/v1/purchasing/vendors', {
            name: 'PBF Pertama',
        });
        second = await created('/api/v1/purchasing/vendors', {
            name: 'PBF Kedua',
        });
        const receipt = await created<{ id: string; version: number }>(
            '/api/v1/purchasing/receipts',
            {
                vendor_id: first.id,
                location_id: warehouse.id,
                posting_date: '2026-11-01',
                lines: [{ item_id: gauze.id, quantity: 10, unit_cost: 750 }],
            },
        );
        await json(
            await business.admin.post(
                `/api/v1/purchasing/receipts/${receipt.id}/post`,
                { version: receipt.version },
            ),
            200,
        );
        const member = await createMember(pool, business.tenantId, [
            'core.purchase-requisition.request',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            member.membershipId,
        );
        requester = browser();
        await requester.login(member.email, member.password);
    });

    const ask = (who: Browser, body: Record<string, unknown>) =>
        who.post(path, {
            location_id: warehouse.id,
            item_id: gauze.id,
            quantity: 5,
            due_date: '2026-11-20',
            ...body,
        });
    const asked = async (body: Record<string, unknown> = {}) =>
        (await json<{ data: Requisition }>(await ask(requester, body), 201))
            .data;
    const approve = async (
        requisition: Requisition,
        body: Record<string, unknown>,
    ) =>
        (
            await json<{ data: Requisition }>(
                await business.admin.patch(`${path}/${requisition.id}`, {
                    location_id: warehouse.id,
                    item_id: gauze.id,
                    quantity: 5,
                    due_date: '2026-11-20',
                    accepted: true,
                    version: requisition.version,
                    ...body,
                }),
                200,
            )
        ).data;
    const carryOut = () =>
        business.admin.post(`${path}/carry-out`, { order_date: '2026-11-17' });

    test('a requester asks for items but cannot pick the vendor, the price, or approve', async () => {
        const errors = await refused(
            await ask(requester, {
                vendor_id: first.id,
                unit_cost: 100,
                accepted: true,
            }),
        );
        expect(Object.keys(errors).sort()).toEqual([
            'accepted',
            'unit_cost',
            'vendor_id',
        ]);
        const requisition = await asked({ description: 'Stok kasa menipis' });
        expect(requisition.accepted).toBe(false);
        expect(requisition.vendor).toBeNull();
    });

    test('nothing approved means no order', async () => {
        await pool.unsafe(
            `update bl_tr_permintaan set deleted_at = now() where tenant_id = $1`,
            [business.tenantId],
        );
        await asked();
        expect((await refused(await carryOut()))._form?.[0]).toContain(
            'Belum ada permintaan yang disetujui',
        );
    });

    test('an approved line without a vendor stops the run', async () => {
        await pool.unsafe(
            `update bl_tr_permintaan set deleted_at = now() where tenant_id = $1`,
            [business.tenantId],
        );
        await approve(await asked(), {});
        expect((await refused(await carryOut()))._form?.[0]).toContain(
            'belum punya vendor',
        );
    });

    test('approved lines become one open order per vendor and location, and unapproved lines wait', async () => {
        await pool.unsafe(
            `update bl_tr_permintaan set deleted_at = now() where tenant_id = $1`,
            [business.tenantId],
        );
        const a = await approve(await asked(), { vendor_id: first.id });
        const b = await approve(await asked({ item_id: mask.id }), {
            item_id: mask.id,
            vendor_id: first.id,
            unit_cost: 2000,
            due_date: '2026-11-18',
        });
        const c = await approve(await asked(), { vendor_id: second.id });
        const d = await approve(await asked({ location_id: pharmacy.id }), {
            location_id: pharmacy.id,
            vendor_id: first.id,
        });
        const waiting = await asked();

        const response = await json<{ data: { id: string; number: string }[] }>(
            await carryOut(),
            201,
        );
        expect(response.data).toHaveLength(3);
        const orders = await pool.unsafe<
            {
                vendor: string;
                location: string;
                status: string;
                expected: string;
                lines: string[];
            }[]
        >(
            `select p.name as vendor, l.kode as location, h.status, h.tanggal_diharapkan::text as expected,
                    array_agg(b.kode || ' ' || trim_scale(d.jumlah) || ' @' || trim_scale(d.harga_satuan)
                              order by d.urutan) as lines
             from bl_tr_order h
             join vendors v on v.id = h.vendor_id join parties p on p.id = v.party_id
             join gd_m_lokasi l on l.id = h.lokasi_id
             join bl_tr_order_detail d on d.order_id = h.id
             join gd_m_barang b on b.id = d.barang_id
             where h.tenant_id = $1
             group by p.name, l.kode, h.status, h.tanggal_diharapkan
             order by p.name, l.kode`,
            [business.tenantId],
        );
        expect([...orders]).toEqual([
            {
                vendor: 'PBF Kedua',
                location: 'GUDANG',
                status: 'terbuka',
                expected: '2026-11-20',
                lines: ['KASA 5 @750'],
            },
            {
                vendor: 'PBF Pertama',
                location: 'FARMASI',
                status: 'terbuka',
                expected: '2026-11-20',
                lines: ['KASA 5 @750'],
            },
            {
                vendor: 'PBF Pertama',
                location: 'GUDANG',
                status: 'terbuka',
                expected: '2026-11-18',
                lines: ['MASKER 5 @2000', 'KASA 5 @750'],
            },
        ]);

        const processed = await pool.unsafe<{ id: string; ordered: boolean }[]>(
            `select id, order_detail_id is not null as ordered from bl_tr_permintaan where id = any($1::uuid[])`,
            [[a.id, b.id, c.id, d.id, waiting.id]],
        );
        expect(
            Object.fromEntries(processed.map((row) => [row.id, row.ordered])),
        ).toEqual({
            [a.id]: true,
            [b.id]: true,
            [c.id]: true,
            [d.id]: true,
            [waiting.id]: false,
        });
        const shown = (
            await json<{ data: Requisition }>(
                await business.admin.get(`${path}/${a.id}`),
                200,
            )
        ).data;
        expect(shown.order?.number).toMatch(/^PO-/);
        const locked = await refused(
            await business.admin.patch(`${path}/${a.id}`, {
                location_id: warehouse.id,
                item_id: gauze.id,
                quantity: 9,
                due_date: '2026-11-20',
                version: shown.version,
            }),
        );
        expect(locked._form?.[0]).toContain('sudah menjadi purchase order');
    });

    test('a requester without the duty to process cannot create orders', async () => {
        expect(
            (
                await requester.post(`${path}/carry-out`, {
                    order_date: '2026-11-17',
                })
            ).status,
        ).toBe(403);
        expect((await requester.get(path)).status).toBe(200);
    });
});

type Suggestion = {
    location: string;
    item: string;
    quantity: string;
    unit: string;
    vendor: string | null;
    saran: string | null;
};
type Counts = { created: number; updated: number; removed: number };
type Listed = Requisition & {
    suggested: boolean;
    item: Reference;
    unit: Reference;
    quantity: string;
    due_date: string;
};

describe.skipIf(!process.env.DB_HOST)('reorder suggestions', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let warehouse: { id: string };
    let pharmacy: { id: string };
    let gauze: { id: string };
    let mask: { id: string };
    let syringe: { id: string };
    let vendor: { id: string };

    const level = (
        item: { id: string },
        location: { id: string },
        body: Record<string, unknown>,
    ) =>
        business.admin.post('/api/v1/inventory/stockkeeping-units', {
            item_id: item.id,
            location_id: location.id,
            ...body,
        });
    const calculate = async (who: Browser = business.admin) =>
        (
            await json<{ data: Counts }>(
                await who.post(`${path}/calculate-plan`, {
                    due_date: '2026-11-25',
                }),
                200,
            )
        ).data;
    const open = async () => [
        ...(await pool.unsafe<Suggestion[]>(
            `select l.kode as location, b.kode as item, trim_scale(r.jumlah)::text as quantity, s.kode as unit,
                    p.name as vendor, r.saran
             from bl_tr_permintaan r
             join gd_m_lokasi l on l.id = r.lokasi_id
             join gd_m_barang b on b.id = r.barang_id
             join gd_m_satuan s on s.id = r.satuan_id
             left join vendors v on v.id = r.vendor_id left join parties p on p.id = v.party_id
             where r.tenant_id = $1 and r.deleted_at is null and r.order_detail_id is null
             order by l.kode, b.kode, r.saran nulls first`,
            [business.tenantId],
        )),
    ];

    beforeAll(async () => {
        business = await createBusiness(pool, browser, 'Klinik Uji Saran', [
            ...inventoryDuties,
            'core.vendor.manage',
            'core.purchase-order.manage',
            'core.purchase-receipt.manage',
            'core.purchase-requisition.manage',
        ]);
        const created = async <T = Reference>(
            route: string,
            body: Record<string, unknown>,
        ) =>
            (
                await json<{ data: T }>(
                    await business.admin.post(route, body),
                    201,
                )
            ).data;
        warehouse = await business.location('GUDANG');
        pharmacy = await business.location('FARMASI');
        gauze = await business.item('KASA');
        mask = await business.item('MASKER');
        vendor = await created('/api/v1/purchasing/vendors', {
            name: 'PBF Saran',
        });
        const box = await created('/api/v1/inventory/units-of-measure', {
            code: 'KTK',
            name: 'Kotak',
        });
        const plain = await business.item<Reference & { version: number }>(
            'SPUIT',
        );
        await created('/api/v1/inventory/item-units', {
            item_id: plain.id,
            unit_id: box.id,
            quantity_per_unit: 10,
        });
        syringe = (
            await json<{ data: Reference }>(
                await business.admin.patch(
                    `/api/v1/inventory/items/${plain.id}`,
                    {
                        code: 'SPUIT',
                        name: 'Barang SPUIT',
                        base_unit_id: business.uom.id,
                        purchase_unit_id: box.id,
                        version: plain.version,
                    },
                ),
                200,
            )
        ).data;
        const receipt = await created<{ id: string; version: number }>(
            '/api/v1/purchasing/receipts',
            {
                vendor_id: vendor.id,
                location_id: warehouse.id,
                posting_date: '2026-11-01',
                lines: [{ item_id: gauze.id, quantity: 10, unit_cost: 750 }],
            },
        );
        await json(
            await business.admin.post(
                `/api/v1/purchasing/receipts/${receipt.id}/post`,
                { version: receipt.version },
            ),
            200,
        );
        await created('/api/v1/purchasing/orders', {
            vendor_id: vendor.id,
            location_id: warehouse.id,
            order_date: '2026-11-10',
            lines: [{ item_id: mask.id, quantity: 5, unit_cost: 2000 }],
        });
        await json(
            await level(gauze, warehouse, {
                reordering_policy: 'jumlah_tetap',
                minimum_quantity: 40,
                reorder_quantity: 15,
            }),
            201,
        );
        await json(
            await level(mask, warehouse, {
                reordering_policy: 'maksimum',
                minimum_quantity: 10,
                maximum_quantity: 100,
            }),
            201,
        );
        await json(
            await level(syringe, warehouse, {
                reordering_policy: 'jumlah_tetap',
                minimum_quantity: 0,
                reorder_quantity: 30,
            }),
            201,
        );
        await json(
            await level(gauze, pharmacy, {
                minimum_quantity: 5,
                maximum_quantity: 50,
            }),
            201,
        );
    });

    test('a fixed quantity repeats past the reorder point, a maximum fills up, and open orders count as coming', async () => {
        expect(await calculate()).toEqual({
            created: 3,
            updated: 0,
            removed: 0,
        });
        expect(await open()).toEqual([
            {
                location: 'GUDANG',
                item: 'KASA',
                quantity: '45',
                unit: 'TAB',
                vendor: 'PBF Saran',
                saran: 'baru',
            },
            {
                location: 'GUDANG',
                item: 'MASKER',
                quantity: '95',
                unit: 'TAB',
                vendor: null,
                saran: 'baru',
            },
            {
                location: 'GUDANG',
                item: 'SPUIT',
                quantity: '3',
                unit: 'KTK',
                vendor: null,
                saran: 'baru',
            },
        ]);
    });

    test('a due date that is not a date is refused', async () => {
        expect(
            Object.keys(
                await refused(
                    await business.admin.post(`${path}/calculate-plan`, {
                        due_date: '25-11-2026',
                    }),
                ),
            ),
        ).toEqual(['due_date']);
    });

    test('running it again changes nothing, and a request already asked for is counted', async () => {
        expect(await calculate()).toEqual({
            created: 0,
            updated: 0,
            removed: 0,
        });
        await json(
            await business.admin.post(path, {
                location_id: warehouse.id,
                item_id: mask.id,
                quantity: 3,
                due_date: '2026-11-20',
            }),
            201,
        );
        expect(await calculate()).toEqual({
            created: 0,
            updated: 1,
            removed: 0,
        });
        expect(
            (await open())
                .filter((row) => row.item === 'MASKER')
                .map((row) => [row.quantity, row.saran]),
        ).toEqual([
            ['3', null],
            ['92', 'baru'],
        ]);
    });

    test('an approved suggestion is kept, counted, and carried out once', async () => {
        const listed = (
            await json<{ data: Listed[] }>(await business.admin.get(path), 200)
        ).data;
        const line = listed.find((row) => row.item.code === 'KASA');
        if (!line) throw new Error('No gauze suggestion.');
        expect(line.suggested).toBe(true);
        await json(
            await business.admin.patch(`${path}/${line.id}`, {
                location_id: warehouse.id,
                item_id: gauze.id,
                unit_id: line.unit.id,
                quantity: line.quantity,
                due_date: line.due_date,
                vendor_id: vendor.id,
                accepted: true,
                version: line.version,
            }),
            200,
        );
        expect(await calculate()).toEqual({
            created: 0,
            updated: 0,
            removed: 0,
        });
        expect(
            (await open())
                .filter((row) => row.item === 'KASA')
                .map((row) => [row.quantity, row.saran]),
        ).toEqual([['45', 'diubah']]);
        await json(
            await business.admin.post(`${path}/carry-out`, {
                order_date: '2026-11-17',
            }),
            201,
        );
        expect(await calculate()).toEqual({
            created: 0,
            updated: 0,
            removed: 0,
        });
        const ordered = await pool.unsafe<{ quantity: string }[]>(
            `select trim_scale(d.jumlah)::text as quantity from bl_tr_order_detail d
             join gd_m_barang b on b.id = d.barang_id
             where d.tenant_id = $1 and b.kode = 'KASA'`,
            [business.tenantId],
        );
        expect(ordered.map((row) => row.quantity)).toEqual(['45']);
    });

    test('a suggestion that is no longer needed is removed', async () => {
        const [stored] = (
            await json<{ data: { id: string; version: number }[] }>(
                await business.admin.get(
                    `/api/v1/inventory/stockkeeping-units?item_id=${syringe.id}`,
                ),
                200,
            )
        ).data;
        if (!stored) throw new Error('No syringe level.');
        await json(
            await business.admin.patch(
                `/api/v1/inventory/stockkeeping-units/${stored.id}`,
                {
                    item_id: syringe.id,
                    location_id: warehouse.id,
                    minimum_quantity: 0,
                    reordering_policy: null,
                    version: stored.version,
                },
            ),
            200,
        );
        expect(await calculate()).toEqual({
            created: 0,
            updated: 0,
            removed: 1,
        });
        expect((await open()).map((row) => row.item)).not.toContain('SPUIT');
    });

    test('a buyer only plans the locations open to them and needs the duty to process', async () => {
        const locations = (
            await json<{ data: (Reference & { version: number })[] }>(
                await business.admin.get('/api/v1/inventory/locations'),
                200,
            )
        ).data;
        const restricted = locations.find((row) => row.id === warehouse.id);
        if (!restricted) throw new Error('No warehouse.');
        await json(
            await business.admin.patch(
                `/api/v1/inventory/locations/${restricted.id}`,
                {
                    code: restricted.code,
                    name: restricted.name,
                    operating_unit_id: business.unitId,
                    restricted_to_employees: true,
                    version: restricted.version,
                },
            ),
            200,
        );
        await json(
            await level(mask, pharmacy, {
                reordering_policy: 'maksimum',
                minimum_quantity: 0,
                maximum_quantity: 8,
            }),
            201,
        );
        const before = await open();
        const buyer = await createMember(pool, business.tenantId, [
            'core.purchase-requisition.manage',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            buyer.membershipId,
        );
        const session = browser();
        await session.login(buyer.email, buyer.password);
        expect(await calculate(session)).toEqual({
            created: 1,
            updated: 0,
            removed: 0,
        });
        const after = await open();
        expect(after.filter((row) => row.location === 'GUDANG')).toEqual(
            before.filter((row) => row.location === 'GUDANG'),
        );
        expect(
            after
                .filter((row) => row.location === 'FARMASI')
                .map((row) => [row.item, row.quantity, row.saran]),
        ).toEqual([['MASKER', '8', 'baru']]);

        const requester = await createMember(pool, business.tenantId, [
            'core.purchase-requisition.request',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            requester.membershipId,
        );
        const asking = browser();
        await asking.login(requester.email, requester.password);
        expect(
            (
                await asking.post(`${path}/calculate-plan`, {
                    due_date: '2026-11-25',
                })
            ).status,
        ).toBe(403);
    });
});

describe.skipIf(!process.env.DB_HOST)(
    'reorder suggestions with transfers',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp();
        afterAll(close);

        const transfers = '/api/v1/inventory/transfer-orders';
        let business: Business;
        let warehouse: { id: string };
        let pharmacy: { id: string };
        let item: { id: string };
        let order: { id: string; version: number; lines: { id: string }[] };

        const calculate = async () =>
            (
                await json<{ data: Counts }>(
                    await business.admin.post(`${path}/calculate-plan`, {
                        due_date: '2026-11-25',
                    }),
                    200,
                )
            ).data;
        const suggested = async () => [
            ...(await pool.unsafe<{ location: string; quantity: string }[]>(
                `select l.kode as location, trim_scale(r.jumlah)::text as quantity
                 from bl_tr_permintaan r join gd_m_lokasi l on l.id = r.lokasi_id
                 where r.tenant_id = $1 and r.deleted_at is null and r.saran = 'baru'
                 order by l.kode`,
                [business.tenantId],
            )),
        ];
        const settle = async (response: Promise<Response>) => {
            order = (await json<{ data: typeof order }>(await response, 200))
                .data;
        };
        const act = (action: string, body: Record<string, unknown> = {}) =>
            settle(
                business.admin.post(`${transfers}/${order.id}/${action}`, {
                    version: order.version,
                    ...body,
                }),
            );

        beforeAll(async () => {
            business = await createBusiness(
                pool,
                browser,
                'Klinik Uji Saran Amprah',
                [
                    ...inventoryDuties,
                    'core.vendor.manage',
                    'core.purchase-receipt.manage',
                    'core.purchase-requisition.manage',
                    'core.inventory-transfer.manage',
                ],
            );
            warehouse = await business.location('GUDANG', {
                transfer_mode: 'kirim_terima',
            });
            pharmacy = await business.location('FARMASI');
            await business.location('TRANSIT', { is_transit: true });
            item = await business.item('OBAT');
            const vendor = (
                await json<{ data: Reference }>(
                    await business.admin.post('/api/v1/purchasing/vendors', {
                        name: 'PBF Saran Amprah',
                    }),
                    201,
                )
            ).data;
            const receipt = (
                await json<{ data: { id: string; version: number } }>(
                    await business.admin.post('/api/v1/purchasing/receipts', {
                        vendor_id: vendor.id,
                        location_id: warehouse.id,
                        posting_date: '2026-11-01',
                        lines: [
                            { item_id: item.id, quantity: 30, unit_cost: 500 },
                        ],
                    }),
                    201,
                )
            ).data;
            await json(
                await business.admin.post(
                    `/api/v1/purchasing/receipts/${receipt.id}/post`,
                    { version: receipt.version },
                ),
                200,
            );
            for (const [location, minimum, maximum] of [
                [warehouse, 20, 100],
                [pharmacy, 10, 40],
            ] as const)
                await json(
                    await business.admin.post(
                        '/api/v1/inventory/stockkeeping-units',
                        {
                            item_id: item.id,
                            location_id: location.id,
                            reordering_policy: 'maksimum',
                            minimum_quantity: minimum,
                            maximum_quantity: maximum,
                        },
                    ),
                    201,
                );
        });

        test('without an amprah the empty pharmacy is suggested and the stocked warehouse is not', async () => {
            expect(await calculate()).toEqual({
                created: 1,
                updated: 0,
                removed: 0,
            });
            expect(await suggested()).toEqual([
                { location: 'FARMASI', quantity: '40' },
            ]);
        });

        test('a draft amprah moves supply from the warehouse to the pharmacy', async () => {
            order = (
                await json<{ data: typeof order }>(
                    await business.admin.post(transfers, {
                        posting_date: '2026-11-10',
                        from_location_id: warehouse.id,
                        to_location_id: pharmacy.id,
                        lines: [
                            {
                                item_id: item.id,
                                unit_id: business.uom.id,
                                quantity: 12,
                            },
                        ],
                    }),
                    201,
                )
            ).data;
            expect(await calculate()).toEqual({
                created: 1,
                updated: 0,
                removed: 1,
            });
            expect(await suggested()).toEqual([
                { location: 'GUDANG', quantity: '82' },
            ]);
        });

        test('shipping part into transit and receiving it leaves the plan as it was', async () => {
            await act('submit');
            await settle(
                business.admin.patch(`${transfers}/${order.id}/quantities`, {
                    version: order.version,
                    lines: [{ id: order.lines[0]?.id, quantity_to_ship: 5 }],
                }),
            );
            await act('ship', { posting_date: '2026-11-11' });
            expect(await calculate()).toEqual({
                created: 0,
                updated: 0,
                removed: 0,
            });
            await act('receive', { posting_date: '2026-11-12' });
            expect(await calculate()).toEqual({
                created: 0,
                updated: 0,
                removed: 0,
            });
            expect(await suggested()).toEqual([
                { location: 'GUDANG', quantity: '82' },
            ]);
        });

        test('closing the amprah drops what was never shipped', async () => {
            await act('close');
            expect(await calculate()).toEqual({
                created: 1,
                updated: 0,
                removed: 1,
            });
            expect(await suggested()).toEqual([
                { location: 'FARMASI', quantity: '35' },
            ]);
        });
    },
);

describe.skipIf(!process.env.DB_HOST)(
    'reorder suggestions in whole purchase units',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp();
        afterAll(close);

        let business: Business;
        let warehouse: { id: string };
        let pharmacy: { id: string };
        let item: { id: string };

        const calculate = async () =>
            (
                await json<{ data: Counts }>(
                    await business.admin.post(`${path}/calculate-plan`, {
                        due_date: '2026-11-25',
                    }),
                    200,
                )
            ).data;
        const suggested = async () =>
            (
                await pool.unsafe<
                    { location: string; quantity: string; unit: string }[]
                >(
                    `select l.kode as location, trim_scale(r.jumlah)::text as quantity, s.kode as unit
                     from bl_tr_permintaan r
                     join gd_m_lokasi l on l.id = r.lokasi_id
                     join gd_m_satuan s on s.id = r.satuan_id
                     where r.tenant_id = $1 and r.deleted_at is null and r.saran = 'baru'
                     order by l.kode`,
                    [business.tenantId],
                )
            ).map((row) => [row.location, row.quantity, row.unit]);

        beforeAll(async () => {
            business = await createBusiness(
                pool,
                browser,
                'Klinik Uji Saran Satuan',
                [
                    ...inventoryDuties,
                    'core.purchase-requisition.manage',
                    'core.inventory-transfer.manage',
                ],
            );
            warehouse = await business.location('GUDANG');
            pharmacy = await business.location('FARMASI');
            const plain = await business.item<Reference & { version: number }>(
                'PCT-500',
            );
            await business.posted('masuk', warehouse.id, [
                { item_id: plain.id, quantity: 340, unit_cost: 500 },
            ]);
            const box = (
                await json<{ data: Reference }>(
                    await business.admin.post(
                        '/api/v1/inventory/units-of-measure',
                        { code: 'BOX', name: 'Box' },
                    ),
                    201,
                )
            ).data;
            await json(
                await business.admin.post('/api/v1/inventory/item-units', {
                    item_id: plain.id,
                    unit_id: box.id,
                    quantity_per_unit: 100,
                }),
                201,
            );
            item = (
                await json<{ data: Reference }>(
                    await business.admin.patch(
                        `/api/v1/inventory/items/${plain.id}`,
                        {
                            code: plain.code,
                            name: plain.name,
                            base_unit_id: business.uom.id,
                            purchase_unit_id: box.id,
                            version: plain.version,
                        },
                    ),
                    200,
                )
            ).data;
            for (const [location, body] of [
                [
                    warehouse,
                    {
                        reordering_policy: 'maksimum',
                        minimum_quantity: 400,
                        maximum_quantity: 1000,
                    },
                ],
                [
                    pharmacy,
                    {
                        reordering_policy: 'jumlah_tetap',
                        minimum_quantity: 100,
                        reorder_quantity: 150,
                    },
                ],
            ] as const)
                await json(
                    await business.admin.post(
                        '/api/v1/inventory/stockkeeping-units',
                        { item_id: item.id, location_id: location.id, ...body },
                    ),
                    201,
                );
        });

        test('a quantity that does not fill whole boxes is suggested in tablets', async () => {
            expect(await calculate()).toEqual({
                created: 2,
                updated: 0,
                removed: 0,
            });
            expect(await suggested()).toEqual([
                ['FARMASI', '150', 'TAB'],
                ['GUDANG', '660', 'TAB'],
            ]);
        });

        test('an amprah that leaves whole boxes to order turns the suggestion into boxes', async () => {
            await json(
                await business.admin.post('/api/v1/inventory/transfer-orders', {
                    posting_date: '2026-11-10',
                    from_location_id: warehouse.id,
                    to_location_id: pharmacy.id,
                    lines: [
                        {
                            item_id: item.id,
                            unit_id: business.uom.id,
                            quantity: 40,
                        },
                    ],
                }),
                201,
            );
            expect(await calculate()).toEqual({
                created: 0,
                updated: 2,
                removed: 0,
            });
            expect(await suggested()).toEqual([
                ['FARMASI', '150', 'TAB'],
                ['GUDANG', '7', 'BOX'],
            ]);
        });
    },
);
