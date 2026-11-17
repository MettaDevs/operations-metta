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

// Permintaan pembelian, pola Requisition Worksheet BC: lokasi mengajukan, petugas pembelian mengisi vendor dan
// menyetujui, lalu Buat purchase order membuat satu order terbuka per vendor dan lokasi untuk baris yang disetujui.
// Order dan barisnya diperiksa dengan SQL langsung.
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
        // Harga penerimaan terakhir kasa menjadi harga order bila permintaan tidak membawa harga.
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
