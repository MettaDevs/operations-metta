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

type Reference = { id: string; code: string; name: string };
type Posting = {
    id: string;
    kind: 'shipment' | 'receipt';
    number: string;
    status: string;
};
type Order = {
    id: string;
    number: string;
    status: string;
    version: number;
    transfer_mode: string;
    transit_location: Reference | null;
    lines: {
        id: string;
        quantity: string;
        quantity_shipped: string;
        quantity_received: string;
        quantity_in_transit: string;
        quantity_to_ship: string;
        quantity_to_receive: string;
        supplier_stock: string;
    }[];
    postings: Posting[];
};
type Line = Record<string, unknown>;

const path = `${inventoryApi}/transfer-orders`;
const shipmentsPath = `${inventoryApi}/transfer-shipments`;
const receiptsPath = `${inventoryApi}/transfer-receipts`;
const duties = [
    ...inventoryDuties,
    'core.vendor.manage',
    'core.purchase-receipt.manage',
    'core.inventory-transfer.manage',
];

// Amprah sebagai Transfer Order: kirim langsung atau lewat lokasi transit, kirim dan terima sebagian berkali-kali,
// tutup, batal posting, dan hak yang terpisah. Kartu gudang diperiksa dengan SQL langsung, bukan lewat API yang sedang
// diuji.
describe.skipIf(!process.env.DB_HOST)('transfer orders', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let box: Reference;
    let tracked: { id: string };
    let apbd: Reference;

    async function created<T = Reference>(
        target: Business,
        route: string,
        body: Record<string, unknown>,
    ) {
        return (
            await json<{ data: T }>(await target.admin.post(route, body), 201)
        ).data;
    }

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Amprah',
            duties,
        );
        box = await created(business, `${inventoryApi}/units-of-measure`, {
            code: 'BOX',
            name: 'Kotak',
        });
        tracked = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        apbd = await created(business, `${inventoryApi}/funding-sources`, {
            code: 'APBD',
            name: 'APBD',
        });
    });

    // Barang obat bersatuan dasar tablet dengan satuan kemasan kotak berisi 10.
    async function medicine(target: Business, code: string) {
        const item = await target.item(code, { tracking_code_id: tracked.id });
        await created(target, `${inventoryApi}/item-units`, {
            item_id: item.id,
            unit_id: box.id,
            quantity_per_unit: 10,
        });
        return item;
    }

    const vendors = new Map<string, string>();
    async function vendorOf(target: Business) {
        const known = vendors.get(target.tenantId);
        if (known) return known;
        const { id } = await created(target, '/api/v1/purchasing/vendors', {
            name: 'PBF Uji Amprah',
        });
        vendors.set(target.tenantId, id);
        return id;
    }

    // Stok masuk lewat penerimaan dari vendor, supaya sumber dana dan tahun anggaran ikut tercatat.
    async function received(
        target: Business,
        locationId: string,
        lines: Line[],
        postingDate = '2026-11-01',
    ) {
        const draft = await created<{ id: string; version: number }>(
            target,
            '/api/v1/purchasing/receipts',
            {
                vendor_id: await vendorOf(target),
                location_id: locationId,
                posting_date: postingDate,
                lines: lines.map((line) => ({
                    unit_id: target.uom.id,
                    unit_cost: 1000,
                    expiry_date: '2027-06-30',
                    budget_year: 2026,
                    ...line,
                })),
            },
        );
        await json(
            await target.admin.post(
                `/api/v1/purchasing/receipts/${draft.id}/post`,
                { version: draft.version },
            ),
            200,
        );
    }

    async function draft(
        target: Business,
        header: Line,
        lines: Line[],
    ): Promise<Order> {
        return created<Order>(target, path, {
            posting_date: '2026-11-10',
            ...header,
            lines,
        });
    }
    const act = async (
        target: Business,
        order: Order,
        action: string,
        body: Line = {},
    ) =>
        target.admin.post(`${path}/${order.id}/${action}`, {
            version: order.version,
            ...body,
        });
    const done = async (response: Response) =>
        (await json<{ data: Order }>(response, 200)).data;
    const submitted = async (target: Business, header: Line, lines: Line[]) =>
        done(await act(target, await draft(target, header, lines), 'submit'));
    const quantities = (target: Business, order: Order, lines: Line[]) =>
        target.admin.patch(`${path}/${order.id}/quantities`, {
            version: order.version,
            lines,
        });
    const ship = (target: Business, order: Order, date = '2026-11-11') =>
        act(target, order, 'ship', { posting_date: date });
    const receive = (target: Business, order: Order, date = '2026-11-12') =>
        act(target, order, 'receive', { posting_date: date });
    const postingsOf = (order: Order, kind: Posting['kind']) =>
        order.postings.filter((posting) => posting.kind === kind);

    async function ledger(sourceIds: string[]) {
        const rows = await pool.unsafe<
            {
                location: string;
                batch: string | null;
                expiry: string | null;
                quantity: string;
                open: string;
                unit_cost: string | null;
                amount: string;
                funding: string | null;
                year: number | null;
            }[]
        >(
            `select l.kode as location, t.no_batch as batch, k.kedaluwarsa::text as expiry,
                    trim_scale(k.jumlah)::text as quantity, trim_scale(k.sisa)::text as open,
                    trim_scale(k.harga_satuan)::text as unit_cost, trim_scale(k.nilai)::text as amount,
                    f.kode as funding, k.tahun_anggaran as year
             from gd_tr_kartu_gudang k
             join gd_m_lokasi l on l.id = k.lokasi_id
             left join gd_m_batch t on t.id = k.batch_id
             left join gd_m_sumber_dana f on f.id = k.sumber_dana_id
             where k.sumber_id = any($1::uuid[])
             order by k.jumlah, l.kode, f.kode nulls first`,
            [sourceIds],
        );
        return [...rows];
    }

    async function lineTotals(orderId: string) {
        const rows = await pool.unsafe<
            {
                requested: string;
                shipped: string;
                received: string;
            }[]
        >(
            `select trim_scale(jumlah_diminta)::text as requested, trim_scale(jumlah_dikirim)::text as shipped,
                    trim_scale(jumlah_diterima)::text as received
             from gd_tr_amprahan_detail where amprahan_id = $1 and deleted_at is null order by urutan`,
            [orderId],
        );
        return [...rows];
    }

    test('a direct transfer in boxes moves base stock with its batch, expiry, funding, and cost in one posting, then closes itself', async () => {
        const warehouse = await business.location('LGS-GDG');
        const pharmacy = await business.location('LGS-FAR');
        const item = await medicine(business, 'LGS-1');
        await received(business, warehouse.id, [
            {
                item_id: item.id,
                quantity: 50,
                batch_number: 'L-1',
                funding_source_id: apbd.id,
            },
        ]);
        const order = await submitted(
            business,
            { from_location_id: warehouse.id, to_location_id: pharmacy.id },
            [{ item_id: item.id, unit_id: box.id, quantity: 3 }],
        );
        expect(order.number).toMatch(/^AMP-\d{8}$/);
        expect(order.transfer_mode).toBe('langsung');
        expect(order.lines[0]?.quantity_to_ship).toBe('3');
        expect(order.lines[0]?.supplier_stock).toBe('50');

        const shipped = await done(await ship(business, order));
        expect(shipped.status).toBe('selesai');
        expect(await lineTotals(order.id)).toEqual([
            { requested: '3', shipped: '3', received: '3' },
        ]);
        const [shipment] = postingsOf(shipped, 'shipment');
        expect(shipment?.number).toMatch(/^MUT-\d{8}$/);
        if (!shipment) throw new Error('No shipment.');
        expect(await ledger([shipment.id])).toEqual([
            {
                location: 'LGS-GDG',
                batch: 'L-1',
                expiry: '2027-06-30',
                quantity: '-30',
                open: '0',
                unit_cost: null,
                amount: '-30000',
                funding: 'APBD',
                year: 2026,
            },
            {
                location: 'LGS-FAR',
                batch: 'L-1',
                expiry: '2027-06-30',
                quantity: '30',
                open: '30',
                unit_cost: '1000',
                amount: '30000',
                funding: 'APBD',
                year: 2026,
            },
        ]);
        const posted = await json<{
            data: {
                transfer_mode: string;
                lines: {
                    quantity: string;
                    quantity_per_unit: string;
                    batch: { batch_number: string } | null;
                    funding_source: Reference | null;
                }[];
            };
        }>(await business.admin.get(`${shipmentsPath}/${shipment.id}`), 200);
        expect(posted.data.transfer_mode).toBe('langsung');
        expect(
            posted.data.lines.map((line) => [
                line.quantity,
                line.quantity_per_unit,
                line.batch?.batch_number,
                line.funding_source?.code,
            ]),
        ).toEqual([['30', '10', 'L-1', 'APBD']]);
    });

    test('shipping twice in part, then closing, keeps the unshipped quantity on record', async () => {
        const warehouse = await business.location('PARSIAL-GDG');
        const pharmacy = await business.location('PARSIAL-FAR');
        const item = await medicine(business, 'PARSIAL-1');
        await received(business, warehouse.id, [
            { item_id: item.id, quantity: 100, batch_number: 'P-1' },
        ]);
        let order = await submitted(
            business,
            { from_location_id: warehouse.id, to_location_id: pharmacy.id },
            [{ item_id: item.id, unit_id: box.id, quantity: 10 }],
        );
        const line = () => order.lines[0]?.id;
        order = await done(
            await quantities(business, order, [
                { id: line(), quantity_to_ship: 4 },
            ]),
        );
        order = await done(await ship(business, order));
        expect(order.status).toBe('diajukan');
        expect(order.lines[0]?.quantity_to_ship).toBe('6');
        order = await done(
            await quantities(business, order, [
                { id: line(), quantity_to_ship: 3 },
            ]),
        );
        order = await done(await ship(business, order, '2026-11-13'));
        expect(postingsOf(order, 'shipment')).toHaveLength(2);
        order = await done(await act(business, order, 'close'));
        expect(order.status).toBe('selesai');
        expect(await lineTotals(order.id)).toEqual([
            { requested: '10', shipped: '7', received: '7' },
        ]);
        expect(await business.stock(item.id, pharmacy.id)).toEqual({
            'P-1': 70,
        });
        expect(await business.stock(item.id, warehouse.id)).toEqual({
            'P-1': 30,
        });
    });

    test('a quantity to ship above what is left, or to receive above what is in transit, is refused', async () => {
        const warehouse = await business.location('LEBIH-GDG');
        const pharmacy = await business.location('LEBIH-FAR');
        const item = await medicine(business, 'LEBIH-1');
        await received(business, warehouse.id, [
            { item_id: item.id, quantity: 100, batch_number: 'X-1' },
        ]);
        const order = await submitted(
            business,
            { from_location_id: warehouse.id, to_location_id: pharmacy.id },
            [{ item_id: item.id, unit_id: box.id, quantity: 2 }],
        );
        const errors = await refused(
            await quantities(business, order, [
                {
                    id: order.lines[0]?.id,
                    quantity_to_ship: 3,
                    quantity_to_receive: 1,
                },
            ]),
        );
        expect(Object.keys(errors).sort()).toEqual([
            'lines.0.quantity_to_receive',
            'lines.0.quantity_to_ship',
        ]);
        expect(await lineTotals(order.id)).toEqual([
            { requested: '2', shipped: '0', received: '0' },
        ]);
    });

    test('simultaneous ship postings of one amprah version post once, and a retry writes nothing', async () => {
        const warehouse = await business.location('SERENTAK-GDG');
        const pharmacy = await business.location('SERENTAK-FAR');
        const item = await medicine(business, 'SERENTAK-1');
        await received(business, warehouse.id, [
            { item_id: item.id, quantity: 100, batch_number: 'S-1' },
        ]);
        let order = await submitted(
            business,
            { from_location_id: warehouse.id, to_location_id: pharmacy.id },
            [{ item_id: item.id, unit_id: box.id, quantity: 8 }],
        );
        order = await done(
            await quantities(business, order, [
                { id: order.lines[0]?.id, quantity_to_ship: 4 },
            ]),
        );
        const responses = await Promise.all(
            Array.from({ length: 6 }, () => ship(business, order)),
        );
        expect(responses.map((response) => response.status)).toEqual([
            200, 200, 200, 200, 200, 200,
        ]);
        expect((await ship(business, order)).status).toBe(200);
        const [counts] = await pool.unsafe<
            { shipments: number; entries: number }[]
        >(
            `select (select count(*)::int from gd_tr_mutasi where amprahan_id = $1) as shipments,
                    (select count(*)::int from gd_tr_kartu_gudang k
                     join gd_tr_mutasi m on m.id = k.sumber_id where m.amprahan_id = $1) as entries`,
            [order.id],
        );
        expect(counts).toEqual({ shipments: 1, entries: 2 });
        expect(await lineTotals(order.id)).toEqual([
            { requested: '8', shipped: '4', received: '4' },
        ]);
        expect(await business.stock(item.id, pharmacy.id)).toEqual({
            'S-1': 40,
        });
    });

    test('a direct shipment whose stock was already used at the requester cannot be reversed; an untouched one can, and reopens the amprah', async () => {
        const warehouse = await business.location('BATAL-GDG');
        const pharmacy = await business.location('BATAL-FAR');
        const item = await medicine(business, 'BATAL-1');
        await received(business, warehouse.id, [
            { item_id: item.id, quantity: 100, batch_number: 'B-1' },
        ]);
        const used = await done(
            await ship(
                business,
                await submitted(
                    business,
                    {
                        from_location_id: warehouse.id,
                        to_location_id: pharmacy.id,
                    },
                    [{ item_id: item.id, unit_id: box.id, quantity: 2 }],
                ),
            ),
        );
        await business.posted('keluar', pharmacy.id, [
            { item_id: item.id, quantity: 5 },
        ]);
        const usedShipment = postingsOf(used, 'shipment')[0];
        if (!usedShipment) throw new Error('No shipment.');
        const reverseOf = async (id: string) => {
            const shown = await json<{ data: { version: number } }>(
                await business.admin.get(`${shipmentsPath}/${id}`),
                200,
            );
            return business.admin.post(`${shipmentsPath}/${id}/reverse`, {
                version: shown.data.version,
            });
        };
        expect(
            (await refused(await reverseOf(usedShipment.id)))._form?.[0],
        ).toContain('sudah dipakai');
        expect(await lineTotals(used.id)).toEqual([
            { requested: '2', shipped: '2', received: '2' },
        ]);
        expect(await ledger([usedShipment.id])).toHaveLength(2);

        const untouched = await done(
            await ship(
                business,
                await submitted(
                    business,
                    {
                        from_location_id: warehouse.id,
                        to_location_id: pharmacy.id,
                    },
                    [{ item_id: item.id, unit_id: box.id, quantity: 1 }],
                ),
            ),
        );
        expect(untouched.status).toBe('selesai');
        const shipment = postingsOf(untouched, 'shipment')[0];
        if (!shipment) throw new Error('No shipment.');
        expect((await reverseOf(shipment.id)).status).toBe(200);
        expect(await lineTotals(untouched.id)).toEqual([
            { requested: '1', shipped: '0', received: '0' },
        ]);
        const reopened = await json<{ data: Order }>(
            await business.admin.get(`${path}/${untouched.id}`),
            200,
        );
        expect(reopened.data.status).toBe('diajukan');
        expect(reopened.data.lines[0]?.quantity_to_ship).toBe('1');
        expect(await business.stock(item.id, warehouse.id)).toEqual({
            'B-1': 80,
        });
    });

    test('an amprah cannot be cancelled once something was shipped, and a draft is the only thing that can be deleted', async () => {
        const warehouse = await business.location('TOLAK-GDG');
        const pharmacy = await business.location('TOLAK-FAR');
        const item = await medicine(business, 'TOLAK-1');
        await received(business, warehouse.id, [
            { item_id: item.id, quantity: 100, batch_number: 'T-1' },
        ]);
        let order = await submitted(
            business,
            { from_location_id: warehouse.id, to_location_id: pharmacy.id },
            [{ item_id: item.id, unit_id: box.id, quantity: 5 }],
        );
        expect(
            (
                await business.admin.delete(`${path}/${order.id}`, {
                    version: order.version,
                })
            ).status,
        ).toBe(422);
        order = await done(
            await quantities(business, order, [
                { id: order.lines[0]?.id, quantity_to_ship: 1 },
            ]),
        );
        order = await done(await ship(business, order));
        expect(
            Object.keys(await refused(await act(business, order, 'cancel'))),
        ).toEqual(['_form']);
        const empty = await submitted(
            business,
            { from_location_id: warehouse.id, to_location_id: pharmacy.id },
            [{ item_id: item.id, unit_id: box.id, quantity: 5 }],
        );
        expect((await done(await act(business, empty, 'cancel'))).status).toBe(
            'dibatalkan',
        );
    });

    describe('through a transit location', () => {
        let twoStep: Business;
        let warehouse: { id: string };
        let pharmacy: { id: string };
        let post: { id: string };
        let transit: { id: string };
        let packaging: Reference;

        beforeAll(async () => {
            twoStep = await createBusiness(
                pool,
                browser,
                'Klinik Uji Amprah Transit',
                duties,
            );
            warehouse = await twoStep.location('GUDANG', {
                transfer_mode: 'kirim_terima',
            });
            pharmacy = await twoStep.location('FARMASI');
            post = await twoStep.location('POSYANDU');
            transit = await twoStep.location('TRANSIT', { is_transit: true });
            packaging = await created(
                twoStep,
                `${inventoryApi}/units-of-measure`,
                { code: 'BOX', name: 'Kotak' },
            );
        });

        async function twoStepMedicine(code: string) {
            const item = await twoStep.item(code);
            await created(twoStep, `${inventoryApi}/item-units`, {
                item_id: item.id,
                unit_id: packaging.id,
                quantity_per_unit: 10,
            });
            return item;
        }

        test('ship puts stock in transit, and receiving takes exactly that amprah’s goods even when another amprah’s goods of the same batch wait in the same transit', async () => {
            const item = await twoStepMedicine('DUA-1');
            const apbd2 = await created(
                twoStep,
                `${inventoryApi}/funding-sources`,
                {
                    code: 'APBD',
                    name: 'APBD',
                },
            );
            const blud2 = await created(
                twoStep,
                `${inventoryApi}/funding-sources`,
                {
                    code: 'BLUD',
                    name: 'BLUD',
                },
            );
            await received(twoStep, warehouse.id, [
                {
                    item_id: item.id,
                    quantity: 20,
                    batch_number: 'D-1',
                    funding_source_id: apbd2.id,
                },
            ]);
            await received(
                twoStep,
                warehouse.id,
                [
                    {
                        item_id: item.id,
                        quantity: 30,
                        batch_number: 'D-1',
                        unit_cost: 2000,
                        funding_source_id: blud2.id,
                    },
                ],
                '2026-11-02',
            );
            const other = await submitted(
                twoStep,
                { from_location_id: warehouse.id, to_location_id: post.id },
                [{ item_id: item.id, unit_id: packaging.id, quantity: 2 }],
            );
            expect(other.transit_location?.id).toBe(transit.id);
            const otherShipped = await done(
                await ship(twoStep, other, '2026-11-03'),
            );
            expect(otherShipped.status).toBe('diajukan');

            let order = await submitted(
                twoStep,
                { from_location_id: warehouse.id, to_location_id: pharmacy.id },
                [{ item_id: item.id, unit_id: packaging.id, quantity: 3 }],
            );
            order = await done(await ship(twoStep, order, '2026-11-04'));
            expect(order.lines[0]?.quantity_in_transit).toBe('3');
            expect(order.lines[0]?.quantity_to_receive).toBe('3');
            expect(await twoStep.stock(item.id, transit.id)).toEqual({
                'D-1': 50,
            });
            expect(await twoStep.stock(item.id, pharmacy.id)).toEqual({});

            order = await done(
                await quantities(twoStep, order, [
                    { id: order.lines[0]?.id, quantity_to_receive: 2 },
                ]),
            );
            order = await done(await receive(twoStep, order, '2026-11-05'));
            const [receipt] = postingsOf(order, 'receipt');
            expect(receipt?.number).toMatch(/^TRM-\d{8}$/);
            if (!receipt) throw new Error('No receipt.');
            expect(
                (await ledger([receipt.id])).map((row) => [
                    row.location,
                    row.quantity,
                    row.funding,
                    row.unit_cost,
                ]),
            ).toEqual([
                ['TRANSIT', '-20', 'BLUD', null],
                ['FARMASI', '20', 'BLUD', '2000'],
            ]);
            const waiting = await pool.unsafe<
                { order: string; funding: string; open: string }[]
            >(
                `select a.nomor as order, f.kode as funding, trim_scale(sum(k.sisa))::text as open
                 from gd_tr_kartu_gudang k
                 join gd_tr_amprahan_detail d on d.id = k.sumber_baris_id
                 join gd_tr_amprahan a on a.id = d.amprahan_id
                 join gd_m_sumber_dana f on f.id = k.sumber_dana_id
                 where k.lokasi_id = $1 and k.sisa > 0
                 group by a.nomor, f.kode order by f.kode`,
                [transit.id],
            );
            expect([...waiting]).toEqual([
                { order: other.number, funding: 'APBD', open: '20' },
                { order: order.number, funding: 'BLUD', open: '10' },
            ]);

            expect(
                Object.keys(await refused(await act(twoStep, order, 'close'))),
            ).toEqual(['_form']);
            const errors = await refused(
                await quantities(twoStep, order, [
                    { id: order.lines[0]?.id, quantity_to_receive: 2 },
                ]),
            );
            expect(Object.keys(errors)).toEqual([
                'lines.0.quantity_to_receive',
            ]);

            order = await done(await receive(twoStep, order, '2026-11-06'));
            expect(order.status).toBe('selesai');
            expect(await twoStep.stock(item.id, pharmacy.id)).toEqual({
                'D-1': 30,
            });
            expect(await twoStep.stock(item.id, transit.id)).toEqual({
                'D-1': 20,
            });
        });

        test('a shipment partly received cannot be reversed, and a reversed receipt puts the goods back in transit for the next receipt', async () => {
            const item = await twoStepMedicine('DUA-2');
            await received(twoStep, warehouse.id, [
                { item_id: item.id, quantity: 40, batch_number: 'E-1' },
            ]);
            let order = await submitted(
                twoStep,
                { from_location_id: warehouse.id, to_location_id: pharmacy.id },
                [{ item_id: item.id, unit_id: packaging.id, quantity: 4 }],
            );
            order = await done(await ship(twoStep, order));
            order = await done(
                await quantities(twoStep, order, [
                    { id: order.lines[0]?.id, quantity_to_receive: 1 },
                ]),
            );
            order = await done(await receive(twoStep, order));
            const [shipment] = postingsOf(order, 'shipment');
            const [receipt] = postingsOf(order, 'receipt');
            if (!shipment || !receipt) throw new Error('No postings.');
            const version = async (route: string, id: string) =>
                (
                    await json<{ data: { version: number } }>(
                        await twoStep.admin.get(`${route}/${id}`),
                        200,
                    )
                ).data.version;
            const errors = await refused(
                await twoStep.admin.post(
                    `${shipmentsPath}/${shipment.id}/reverse`,
                    {
                        version: await version(shipmentsPath, shipment.id),
                    },
                ),
            );
            expect(errors._form?.[0]).toContain('sudah diterima');
            expect(await ledger([shipment.id])).toHaveLength(2);

            expect(
                (
                    await twoStep.admin.post(
                        `${receiptsPath}/${receipt.id}/reverse`,
                        {
                            version: await version(receiptsPath, receipt.id),
                        },
                    )
                ).status,
            ).toBe(200);
            expect(await lineTotals(order.id)).toEqual([
                { requested: '4', shipped: '4', received: '0' },
            ]);
            expect(await twoStep.stock(item.id, pharmacy.id)).toEqual({});
            order = (
                await json<{ data: Order }>(
                    await twoStep.admin.get(`${path}/${order.id}`),
                    200,
                )
            ).data;
            expect(order.lines[0]?.quantity_to_receive).toBe('4');
            order = await done(await receive(twoStep, order));
            expect(order.status).toBe('selesai');
            expect(await twoStep.stock(item.id, pharmacy.id)).toEqual({
                'E-1': 40,
            });
            expect(await twoStep.stock(item.id, transit.id)).toEqual({});
        });
    });

    test('locations and items of another legal entity are refused, and malformed ids are refused field by field', async () => {
        const other = await createBusiness(
            pool,
            browser,
            'Klinik Uji Amprah Lintas',
            duties,
        );
        const foreign = {
            from: await other.location('GUDANG'),
            to: await other.location('FARMASI'),
            item: await other.item('LINTAS-1'),
        };
        const secondEntity = (
            await created<{ id: string }>(other, '/api/v1/organizations', {
                classification: 'legal_entity',
                name: 'PT Klinik Uji Amprah Kedua',
                company_code: `A${Math.floor(Math.random() * 1e6)}`,
                country_code: 'ID',
            })
        ).id;
        await json(
            await other.admin.put('/api/v1/workspace-context', {
                membership_id: other.member.membershipId,
                legal_entity_id: secondEntity,
            }),
            200,
        );
        const errors = await refused(
            await other.admin.post(path, {
                from_location_id: foreign.from.id,
                to_location_id: foreign.to.id,
                posting_date: '2026-11-10',
                lines: [
                    {
                        item_id: foreign.item.id,
                        unit_id: other.uom.id,
                        quantity: 1,
                    },
                ],
            }),
        );
        expect(Object.keys(errors).sort()).toEqual([
            'from_location_id',
            'lines.0.item_id',
            'lines.0.unit_id',
            'to_location_id',
        ]);
        const [count] = await pool.unsafe<{ orders: number }[]>(
            'select count(*)::int as orders from gd_tr_amprahan where tenant_id = $1',
            [other.tenantId],
        );
        expect(count?.orders).toBe(0);
        const malformed = await refused(
            await business.admin.post(path, {
                from_location_id: 'bukan-uuid',
                to_location_id: '1',
                transit_location_id: 'x',
                posting_date: '10-11-2026',
                lines: [{ item_id: 'x', unit_id: '', quantity: 'satu' }],
            }),
        );
        expect(Object.keys(malformed).sort()).toEqual([
            'from_location_id',
            'lines.0.item_id',
            'lines.0.quantity',
            'lines.0.unit_id',
            'posting_date',
            'to_location_id',
            'transit_location_id',
        ]);
        expect((await business.admin.get(`${path}/bukan-uuid`)).status).toBe(
            404,
        );
        expect(
            (await business.admin.get(`${path}/${Bun.randomUUIDv7()}`)).status,
        ).toBe(404);
        expect(
            (
                await business.admin.post(`${path}/bukan-uuid/ship`, {
                    version: 1,
                    posting_date: '2026-11-11',
                })
            ).status,
        ).toBe(404);
        expect(
            (
                await business.admin.post(
                    `${shipmentsPath}/${Bun.randomUUIDv7()}/reverse`,
                    {
                        version: 1,
                    },
                )
            ).status,
        ).toBe(404);
    });

    test('requesting, shipping, and receiving are separate rights', async () => {
        const warehouse = await business.location('HAK-GDG');
        const pharmacy = await business.location('HAK-FAR');
        const item = await medicine(business, 'HAK-1');
        await received(business, warehouse.id, [
            { item_id: item.id, quantity: 100, batch_number: 'H-1' },
        ]);
        const member = async (duty: string) => {
            const account = await createMember(pool, business.tenantId, [duty]);
            await grantAllOrganizations(
                pool,
                business.tenantId,
                account.membershipId,
            );
            const session = browser();
            await session.login(account.email, account.password);
            return session;
        };
        const requester = await member('core.inventory-transfer.request');
        const shipper = await member('core.inventory-transfer.ship');
        const reader = await member('core.inventory-transfer.inquire');
        const body = {
            from_location_id: warehouse.id,
            to_location_id: pharmacy.id,
            posting_date: '2026-11-10',
            lines: [{ item_id: item.id, unit_id: box.id, quantity: 1 }],
        };
        expect((await shipper.post(path, body)).status).toBe(403);
        expect((await reader.post(path, body)).status).toBe(403);
        const order = (
            await json<{ data: Order }>(await requester.post(path, body), 201)
        ).data;
        const ready = (
            await json<{ data: Order }>(
                await requester.post(`${path}/${order.id}/submit`, {
                    version: order.version,
                }),
                200,
            )
        ).data;
        expect(
            (
                await requester.post(`${path}/${ready.id}/ship`, {
                    version: ready.version,
                    posting_date: '2026-11-11',
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await requester.patch(`${path}/${ready.id}/quantities`, {
                    version: ready.version,
                    lines: [{ id: ready.lines[0]?.id, quantity_to_ship: 1 }],
                })
            ).status,
        ).toBe(403);
        expect((await reader.get(`${path}/${ready.id}`)).status).toBe(200);
        const shipped = await json<{ data: Order }>(
            await shipper.post(`${path}/${ready.id}/ship`, {
                version: ready.version,
                posting_date: '2026-11-11',
            }),
            200,
        );
        expect(shipped.data.status).toBe('selesai');
        const [shipment] = postingsOf(shipped.data, 'shipment');
        if (!shipment) throw new Error('No shipment.');
        expect(
            (
                await shipper.post(`${shipmentsPath}/${shipment.id}/reverse`, {
                    version: 1,
                })
            ).status,
        ).toBe(403);
    });

    test('a shipment dated in a closed inventory period is refused at posting and at reversal until the period is reopened', async () => {
        const warehouse = await business.location('PERIODE-GDG');
        const pharmacy = await business.location('PERIODE-FAR');
        const item = await business.item('PERIODE-1');
        await business.posted(
            'masuk',
            warehouse.id,
            [{ item_id: item.id, quantity: 10, unit_cost: 100 }],
            '2026-08-01',
        );
        const order = () =>
            submitted(
                business,
                {
                    from_location_id: warehouse.id,
                    to_location_id: pharmacy.id,
                    posting_date: '2026-08-05',
                },
                [{ item_id: item.id, unit_id: business.uom.id, quantity: 2 }],
            );
        const shipment = postingsOf(
            await done(await ship(business, await order(), '2026-08-10')),
            'shipment',
        )[0];
        if (!shipment) throw new Error('No shipment.');
        const period = await business.closedPeriod('2026-08-31');
        expect(
            (await refused(await ship(business, await order(), '2026-08-20')))
                ._form?.[0],
        ).toContain(
            'Periode persediaan Agustus 2026 sudah ditutup, jadi stok bertanggal 20 Agustus 2026 tidak bisa diposting.',
        );
        const reverse = async () => {
            const shown = await json<{ data: { version: number } }>(
                await business.admin.get(`${shipmentsPath}/${shipment.id}`),
                200,
            );
            return business.admin.post(
                `${shipmentsPath}/${shipment.id}/reverse`,
                { version: shown.data.version },
            );
        };
        expect((await refused(await reverse()))._form?.[0]).toContain(
            'posting bertanggal 10 Agustus 2026 tidak bisa dibatalkan.',
        );
        expect(await business.stock(item.id, pharmacy.id)).toEqual({ '-': 2 });
        expect((await business.reopenPeriod(period)).status).toBe(200);
        expect((await reverse()).status).toBe(200);
        expect(await business.stock(item.id, pharmacy.id)).toEqual({});
        expect(await business.stock(item.id, warehouse.id)).toEqual({
            '-': 10,
        });
    });
});
