import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    postItemLines,
    quantityScale,
} from '../../../../src/foundation/inventory/index.ts';
import { lplpoTable } from '../../../../src/foundation/inventory/lplpo/lplpo-table.ts';
import { reportCsv } from '../../../../src/foundation/inventory/report-table.ts';
import { Database } from '../../../../src/platform/database/index.ts';
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
type Line = Record<string, unknown>;
type Order = {
    id: string;
    version: number;
    status: string;
    lines: { id: string }[];
    postings: { id: string; kind: 'shipment' | 'receipt' }[];
};
type Row = {
    item: Reference & { unit: string };
    category: Reference | null;
    opening: string;
    receipts: string;
    receipts_by_funding: Record<string, string>;
    receipts_without_funding: string;
    available: string;
    usage: string;
    adjustment: string;
    closing: string;
    optimum: string | null;
    requested: string;
    suggested: string | null;
};
type Lplpo = { funding_sources: Reference[]; rows: Row[] };

const duties = [
    ...inventoryDuties,
    'core.vendor.manage',
    'core.purchase-receipt.manage',
    'core.inventory-transfer.manage',
    'core.inventory-count.manage',
    'core.inventory-report.inquire',
];
const orders = `${inventoryApi}/transfer-orders`;
const from = '2026-10-01';
const to = '2026-10-31';

// LPLPO dari kartu gudang: setiap jenis gerak (penerimaan dan pembatalannya, amprah langsung dan lewat transit beserta
// batal kirim, penyesuaian pemusnahan dan saldo awal yang dibatalkan, pemakaian unit, opname, penyerahan) masuk ke
// kolomnya, sisa stok sama dengan jumlah kartu gudang dari SQL langsung, kolom sumber dana mengikuti master, posting
// bertanggal mundur masuk periodenya, dan data legal entity lain tidak pernah ikut.
describe.skipIf(!process.env.DB_HOST)('LPLPO', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let apbd: Reference;
    let program: Reference;
    let medicine: Reference;
    let tuberculosis: Reference;
    let warehouse: { id: string };
    let pharmacy: { id: string };
    let transitWarehouse: { id: string };
    let transit: { id: string };
    let subUnit: { id: string };
    let otherUnitId: string;
    let drug: { id: string };
    let consumable: { id: string };
    let syrup: { id: string };

    async function created<T = Reference>(path: string, body: Line) {
        return (
            await json<{ data: T }>(await business.admin.post(path, body), 201)
        ).data;
    }

    const vendor = { id: '' };
    async function received(locationId: string, lines: Line[], date: string) {
        const draft = await created<{ id: string; version: number }>(
            '/api/v1/purchasing/receipts',
            {
                vendor_id: vendor.id,
                location_id: locationId,
                posting_date: date,
                lines: lines.map((line) => ({
                    unit_id: business.uom.id,
                    unit_cost: 1000,
                    expiry_date: '2027-06-30',
                    budget_year: 2026,
                    ...line,
                })),
            },
        );
        return (
            await json<{ data: { id: string; version: number } }>(
                await business.admin.post(
                    `/api/v1/purchasing/receipts/${draft.id}/post`,
                    { version: draft.version },
                ),
                200,
            )
        ).data;
    }

    async function order(
        fromLocation: string,
        toLocation: string,
        lines: Line[],
        date: string,
        submit = true,
    ) {
        const draft = await created<Order>(orders, {
            from_location_id: fromLocation,
            to_location_id: toLocation,
            posting_date: date,
            lines: lines.map((line) => ({ unit_id: business.uom.id, ...line })),
        });
        return submit ? act(draft, 'submit') : draft;
    }
    async function act(target: Order, action: string, body: Line = {}) {
        return (
            await json<{ data: Order }>(
                await business.admin.post(`${orders}/${target.id}/${action}`, {
                    version: target.version,
                    ...body,
                }),
                200,
            )
        ).data;
    }
    const current = async (target: { id: string }) =>
        (
            await json<{ data: Order }>(
                await business.admin.get(`${orders}/${target.id}`),
                200,
            )
        ).data;

    async function adjusted(
        direction: 'masuk' | 'keluar',
        reasonCode: string,
        lines: Line[],
        date: string,
    ) {
        const draft = await created<{ id: string; version: number }>(
            `${inventoryApi}/adjustments`,
            {
                direction,
                location_id: warehouse.id,
                posting_date: date,
                reason_id: business.reason(reasonCode),
                lines,
            },
        );
        return (
            await json<{ data: { id: string; version: number } }>(
                await business.post(draft),
                200,
            )
        ).data;
    }

    async function dispensed(itemId: string, quantity: number, date: string) {
        const connection = await pool.reserve();
        try {
            const db = new Database(connection, undefined, 'uji');
            await db.transaction(() =>
                postItemLines(
                    db,
                    {
                        tenantId: business.tenantId,
                        legalEntityId: business.legalEntityId,
                        userId: null,
                        postingDate: date,
                        source: {
                            type: 'uji-penyerahan',
                            id: Bun.randomUUIDv7(),
                            number: null,
                        },
                    },
                    [
                        {
                            kind: 'outbound',
                            entryKind: 'penyerahan',
                            key: `uji-penyerahan:${Bun.randomUUIDv7()}`,
                            field: 'lines.0',
                            sourceLineId: null,
                            itemId,
                            quantity:
                                BigInt(quantity) * 10n ** BigInt(quantityScale),
                            locationId: warehouse.id,
                            batchId: null,
                        },
                    ],
                ),
            );
        } finally {
            connection.release();
        }
    }

    const batch = async (itemId: string, number: string) => {
        const [found] = await pool.unsafe<{ id: string }[]>(
            'select id from gd_m_batch where barang_id = $1 and no_batch = $2',
            [itemId, number],
        );
        if (!found) throw new Error(`Batch ${number} was not recorded.`);
        return found.id;
    };

    const lplpo = async (target: Business, query: Record<string, string>) =>
        json<Lplpo>(
            await target.admin.get(
                `${inventoryApi}/reports/lplpo?${new URLSearchParams({ from, to, ...query })}`,
            ),
            200,
        );
    const rowOf = (report: Lplpo, item: { id: string }) => {
        const found = report.rows.find((row) => row.item.id === item.id);
        if (!found) throw new Error(`Item ${item.id} is not in the report.`);
        return found;
    };
    // Kolom laporan dengan sumber dana ditulis lewat kodenya, supaya harapan test terbaca.
    const columns = (report: Lplpo, item: { id: string }) => {
        const row = rowOf(report, item);
        return {
            opening: row.opening,
            receipts: row.receipts,
            funding: Object.fromEntries(
                report.funding_sources.map((source) => [
                    source.code,
                    row.receipts_by_funding[source.id],
                ]),
            ),
            without_funding: row.receipts_without_funding,
            available: row.available,
            usage: row.usage,
            adjustment: row.adjustment,
            closing: row.closing,
            optimum: row.optimum,
            requested: row.requested,
            suggested: row.suggested,
        };
    };

    // Saldo dari SQL langsung atas kartu gudang, tanpa pemetaan kolom laporan.
    async function ledgerBalance(
        itemId: string,
        locationIds: string[],
        until: string,
        before = false,
    ) {
        const [row] = await pool.unsafe<{ balance: string }[]>(
            `select trim_scale(coalesce(sum(jumlah), 0))::text as balance from gd_tr_kartu_gudang
             where barang_id = $1 and lokasi_id = any($2::uuid[])
               and (case when $4 then tanggal_posting < $3::date else tanggal_posting <= $3::date end)`,
            [itemId, locationIds, until, before],
        );
        return row?.balance;
    }

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji LPLPO',
            duties,
        );
        vendor.id = (
            await created('/api/v1/purchasing/vendors', {
                name: 'PBF Uji LPLPO',
            })
        ).id;
        apbd = await created(`${inventoryApi}/funding-sources`, {
            code: 'APBD',
            name: 'APBD Kabupaten',
        });
        program = await created(`${inventoryApi}/funding-sources`, {
            code: 'PROG',
            name: 'Program',
        });
        const tracked = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        medicine = await created(`${inventoryApi}/item-categories`, {
            code: 'OBAT',
            name: 'Obat',
        });
        const programMedicine = await created(
            `${inventoryApi}/item-categories`,
            {
                code: 'OBAT-PROG',
                name: 'Obat program',
                parent_id: medicine.id,
            },
        );
        tuberculosis = await created(`${inventoryApi}/item-categories`, {
            code: 'OBAT-TB',
            name: 'Obat TB',
            parent_id: programMedicine.id,
        });
        const supplies = await created(`${inventoryApi}/item-categories`, {
            code: 'BMHP',
            name: 'Bahan medis habis pakai',
        });
        drug = await business.item('LPL-A', {
            tracking_code_id: tracked.id,
            category_id: tuberculosis.id,
        });
        syrup = await business.item('LPL-C', {
            tracking_code_id: tracked.id,
            category_id: medicine.id,
        });
        consumable = await business.item('LPL-B', { category_id: supplies.id });

        warehouse = await business.location('LPL-GDG');
        pharmacy = await business.location('LPL-FAR');
        transitWarehouse = await business.location('LPL-GD2', {
            transfer_mode: 'kirim_terima',
        });
        transit = await business.location('LPL-TRN', { is_transit: true });
        otherUnitId = await business.operatingUnit('Pustu Uji LPLPO');
        subUnit = await business.location('LPL-PST', {
            operating_unit_id: otherUnitId,
        });

        await created(`${inventoryApi}/stockkeeping-units`, {
            item_id: drug.id,
            location_id: warehouse.id,
            minimum_quantity: 20,
            maximum_quantity: 200,
        });
        await created(`${inventoryApi}/stockkeeping-units`, {
            item_id: drug.id,
            location_id: pharmacy.id,
            maximum_quantity: '50',
        });
        await created(`${inventoryApi}/stockkeeping-units`, {
            item_id: consumable.id,
            location_id: warehouse.id,
            maximum_quantity: 40,
        });

        await received(
            warehouse.id,
            [
                {
                    item_id: drug.id,
                    quantity: 100,
                    batch_number: 'A1',
                    funding_source_id: apbd.id,
                },
            ],
            '2026-09-20',
        );
        await received(
            warehouse.id,
            [
                {
                    item_id: drug.id,
                    quantity: 50,
                    batch_number: 'A2',
                    funding_source_id: program.id,
                },
            ],
            '2026-10-03',
        );
        await received(
            warehouse.id,
            [{ item_id: drug.id, quantity: 20, batch_number: 'A3' }],
            '2026-10-04',
        );
        const cancelled = await received(
            warehouse.id,
            [
                {
                    item_id: drug.id,
                    quantity: 7,
                    batch_number: 'A4',
                    funding_source_id: apbd.id,
                },
            ],
            '2026-10-05',
        );
        await json(
            await business.admin.post(
                `/api/v1/purchasing/receipts/${cancelled.id}/reverse`,
                { version: cancelled.version },
            ),
            200,
        );

        const toPharmacy = await order(
            warehouse.id,
            pharmacy.id,
            [{ item_id: drug.id, quantity: 30 }],
            '2026-10-06',
        );
        await act(toPharmacy, 'ship', { posting_date: '2026-10-07' });

        const toSubUnit = await order(
            warehouse.id,
            subUnit.id,
            [{ item_id: drug.id, quantity: 10 }],
            '2026-10-08',
        );
        const shipped = await act(toSubUnit, 'ship', {
            posting_date: '2026-10-08',
        });
        const [shipment] = shipped.postings.filter(
            (posting) => posting.kind === 'shipment',
        );
        if (!shipment) throw new Error('No shipment.');
        const shown = await json<{ data: { version: number } }>(
            await business.admin.get(
                `${inventoryApi}/transfer-shipments/${shipment.id}`,
            ),
            200,
        );
        await json(
            await business.admin.post(
                `${inventoryApi}/transfer-shipments/${shipment.id}/reverse`,
                { version: shown.data.version },
            ),
            200,
        );
        await act(await current(toSubUnit), 'ship', {
            posting_date: '2026-10-09',
        });

        await adjusted(
            'keluar',
            'PEMUSNAHAN',
            [{ item_id: drug.id, quantity: 5 }],
            '2026-10-10',
        );
        await adjusted(
            'keluar',
            'PEMAKAIAN',
            [{ item_id: drug.id, quantity: 8 }],
            '2026-10-11',
        );
        const opening = await adjusted(
            'masuk',
            'SALDO-AWAL',
            [
                {
                    item_id: drug.id,
                    quantity: 3,
                    batch_number: 'A5',
                    expiry_date: '2027-06-30',
                    unit_cost: 1000,
                },
            ],
            '2026-10-12',
        );
        await json(await business.reverse(opening), 200);

        const count = await created<{ id: string; version: number }>(
            `${inventoryApi}/stock-counts`,
            {
                location_id: warehouse.id,
                count_date: '2026-10-15',
                posting_date: '2026-10-15',
                lines: [
                    {
                        item_id: drug.id,
                        batch_id: await batch(drug.id, 'A3'),
                        unit_id: business.uom.id,
                        quantity_counted: 18,
                    },
                ],
            },
        );
        const finished = (
            await json<{ data: { id: string; version: number } }>(
                await business.admin.post(
                    `${inventoryApi}/stock-counts/${count.id}/finish`,
                    {
                        version: count.version,
                    },
                ),
                200,
            )
        ).data;
        await json(
            await business.admin.post(
                `${inventoryApi}/stock-counts/${finished.id}/post`,
                {
                    version: finished.version,
                    posting_date: '2026-10-15',
                },
            ),
            200,
        );

        await dispensed(drug.id, 4, '2026-10-16');

        await order(
            subUnit.id,
            warehouse.id,
            [{ item_id: drug.id, quantity: 15 }],
            '2026-10-25',
        );
        await order(
            subUnit.id,
            warehouse.id,
            [{ item_id: drug.id, quantity: 99 }],
            '2026-10-26',
            false,
        );
        await act(
            await order(
                subUnit.id,
                warehouse.id,
                [{ item_id: drug.id, quantity: 77 }],
                '2026-10-27',
            ),
            'cancel',
        );
        await order(
            subUnit.id,
            warehouse.id,
            [{ item_id: drug.id, quantity: 11 }],
            '2026-11-02',
        );

        await received(
            transitWarehouse.id,
            [
                {
                    item_id: syrup.id,
                    quantity: 20,
                    batch_number: 'C1',
                    funding_source_id: apbd.id,
                },
            ],
            '2026-09-15',
        );
        const viaTransit = await act(
            await order(
                transitWarehouse.id,
                pharmacy.id,
                [{ item_id: syrup.id, quantity: 6 }],
                '2026-10-20',
            ),
            'ship',
            { posting_date: '2026-10-21' },
        );
        const partly = (
            await json<{ data: Order }>(
                await business.admin.patch(
                    `${orders}/${viaTransit.id}/quantities`,
                    {
                        version: viaTransit.version,
                        lines: [
                            {
                                id: viaTransit.lines[0]?.id,
                                quantity_to_receive: 4,
                            },
                        ],
                    },
                ),
                200,
            )
        ).data;
        await act(partly, 'receive', { posting_date: '2026-10-22' });

        // Diposting paling akhir, tetapi bertanggal September dan Oktober: harus masuk stok awal dan periode itu.
        await received(
            warehouse.id,
            [
                {
                    item_id: drug.id,
                    quantity: 5,
                    batch_number: 'A6',
                    funding_source_id: apbd.id,
                },
            ],
            '2026-09-25',
        );
        await received(
            warehouse.id,
            [
                {
                    item_id: drug.id,
                    quantity: 12,
                    batch_number: 'A7',
                    funding_source_id: apbd.id,
                },
            ],
            '2026-10-20',
        );
        await received(
            warehouse.id,
            [
                {
                    item_id: drug.id,
                    quantity: 1000,
                    batch_number: 'A8',
                    funding_source_id: apbd.id,
                },
            ],
            '2026-11-02',
        );
    });

    test('a warehouse row adds every kind of movement to its own column, and the closing stock is the item ledger at the end of the period', async () => {
        const report = await lplpo(business, { location_id: warehouse.id });
        expect(columns(report, drug)).toEqual({
            opening: '105',
            receipts: '82',
            funding: { APBD: '12', PROG: '50' },
            without_funding: '20',
            available: '187',
            usage: '52',
            adjustment: '-7',
            closing: '128',
            optimum: '200',
            requested: '15',
            suggested: '72',
        });
        expect(await ledgerBalance(drug.id, [warehouse.id], from, true)).toBe(
            '105',
        );
        expect(await ledgerBalance(drug.id, [warehouse.id], to)).toBe('128');
        const kinds = await pool.unsafe<{ kind: string; quantity: string }[]>(
            `select jenis as kind, trim_scale(sum(jumlah))::text as quantity from gd_tr_kartu_gudang
             where barang_id = $1 and lokasi_id = $2 and tanggal_posting between $3::date and $4::date
             group by jenis order by jenis`,
            [drug.id, warehouse.id, from, to],
        );
        expect([...kinds]).toEqual([
            { kind: 'pemakaian', quantity: '-8' },
            { kind: 'penerimaan', quantity: '82' },
            { kind: 'penyerahan', quantity: '-4' },
            { kind: 'penyesuaian_kurang', quantity: '-7' },
            { kind: 'penyesuaian_tambah', quantity: '0' },
            { kind: 'transfer', quantity: '-40' },
        ]);
    });

    test('a location that only receives by amprah splits its receipts by the funding the stock came with', async () => {
        const report = await lplpo(business, { location_id: pharmacy.id });
        expect(columns(report, drug)).toEqual({
            opening: '0',
            receipts: '30',
            funding: { APBD: '30', PROG: '0' },
            without_funding: '0',
            available: '30',
            usage: '0',
            adjustment: '0',
            closing: '30',
            optimum: '50',
            requested: '30',
            suggested: '20',
        });
        expect(columns(report, syrup)).toMatchObject({
            receipts: '4',
            funding: { APBD: '4', PROG: '0' },
            closing: '4',
            optimum: null,
            requested: '6',
            suggested: null,
        });
        const sender = await lplpo(business, {
            location_id: transitWarehouse.id,
        });
        expect(columns(sender, syrup)).toMatchObject({
            opening: '20',
            usage: '6',
            closing: '14',
        });
    });

    test('a whole operating unit leaves out moves between its own locations, keeps goods in its transit, and counts requests to outside suppliers only', async () => {
        const report = await lplpo(business, {
            operating_unit_id: business.unitId,
        });
        expect(columns(report, drug)).toEqual({
            opening: '105',
            receipts: '82',
            funding: { APBD: '12', PROG: '50' },
            without_funding: '20',
            available: '187',
            usage: '22',
            adjustment: '-7',
            closing: '158',
            optimum: '250',
            requested: '15',
            suggested: '92',
        });
        expect(columns(report, syrup)).toMatchObject({
            opening: '20',
            receipts: '0',
            usage: '0',
            closing: '20',
            requested: '0',
        });
        const unit = [
            warehouse.id,
            pharmacy.id,
            transitWarehouse.id,
            transit.id,
        ];
        expect(await ledgerBalance(drug.id, unit, to)).toBe('158');
        expect(await ledgerBalance(syrup.id, unit, to)).toBe('20');
        expect(await ledgerBalance(syrup.id, [transit.id], to)).toBe('2');
        expect(columns(report, consumable)).toEqual({
            opening: '0',
            receipts: '0',
            funding: { APBD: '0', PROG: '0' },
            without_funding: '0',
            available: '0',
            usage: '0',
            adjustment: '0',
            closing: '0',
            optimum: '40',
            requested: '0',
            suggested: '40',
        });
        expect(report.rows.map((row) => row.item.code)).toEqual([
            'LPL-A',
            'LPL-B',
            'LPL-C',
        ]);
    });

    test('a category takes in every subcategory under it', async () => {
        const all = await lplpo(business, {
            operating_unit_id: business.unitId,
            category_id: medicine.id,
        });
        expect(all.rows.map((row) => row.item.code)).toEqual([
            'LPL-A',
            'LPL-C',
        ]);
        const leaf = await lplpo(business, {
            operating_unit_id: business.unitId,
            category_id: tuberculosis.id,
        });
        expect(leaf.rows.map((row) => row.item.code)).toEqual(['LPL-A']);
    });

    test('funding columns are the funding source master: a new source is a new column with nothing received yet', async () => {
        const before = await lplpo(business, { location_id: warehouse.id });
        expect(before.funding_sources.map((source) => source.code)).toEqual([
            'APBD',
            'PROG',
        ]);
        const dak = await created(`${inventoryApi}/funding-sources`, {
            code: 'DAK',
            name: 'DAK Fisik',
        });
        const after = await lplpo(business, { location_id: warehouse.id });
        const master = await pool.unsafe<{ code: string }[]>(
            `select kode as code from gd_m_sumber_dana
             where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null order by kode`,
            [business.tenantId, business.legalEntityId],
        );
        expect(after.funding_sources.map((source) => source.code)).toEqual(
            master.map((row) => row.code),
        );
        expect(rowOf(after, drug).receipts_by_funding[dak.id]).toBe('0');
        expect(
            lplpoTable(after).columns.map((column) => column.header),
        ).toContain('Penerimaan DAK Fisik');
    });

    test('the CSV is the table on screen, row for row', async () => {
        const report = await lplpo(business, {
            operating_unit_id: business.unitId,
        });
        const table = lplpoTable(report);
        const csv = reportCsv(table);
        expect(csv.startsWith('﻿')).toBe(true);
        const lines = csv
            .slice(1)
            .trimEnd()
            .split('\r\n')
            .map((line) => line.split(';'));
        expect(lines[0]).toEqual(table.columns.map((column) => column.header));
        expect(lines.slice(1)).toEqual(table.rows.map((row) => row.cells));
        const header = lines[0] ?? [];
        const drugLine = lines.find((line) => line[0] === 'LPL-A') ?? [];
        const cell = (name: string) => drugLine[header.indexOf(name)];
        expect([
            cell('Stok awal'),
            cell('Penerimaan'),
            cell('Penerimaan APBD Kabupaten'),
            cell('Pemakaian'),
            cell('Penyesuaian'),
            cell('Sisa stok'),
            cell('Saran permintaan'),
        ]).toEqual(['105', '82', '12', '22', '-7', '158', '92']);
    });

    test('a transit location, two scopes at once, a reversed period, and unknown filters are refused', async () => {
        const errors = (query: Record<string, string>) =>
            business.admin
                .get(
                    `${inventoryApi}/reports/lplpo?${new URLSearchParams(query)}`,
                )
                .then(refused);
        expect(
            Object.keys(await errors({ from, to, location_id: transit.id })),
        ).toEqual(['location_id']);
        expect(
            Object.keys(
                await errors({
                    from,
                    to,
                    location_id: warehouse.id,
                    operating_unit_id: business.unitId,
                }),
            ),
        ).toEqual(['location_id']);
        expect(
            Object.keys(
                await errors({
                    from: to,
                    to: from,
                    location_id: warehouse.id,
                    category_id: 'bukan-id',
                }),
            ).sort(),
        ).toEqual(['category_id', 'to']);
    });

    test('another legal entity sharing the operating unit never shows, and its locations are refused', async () => {
        const secondEntity = (
            await created('/api/v1/organizations', {
                classification: 'legal_entity',
                name: 'PT Klinik Uji LPLPO Kedua',
                company_code: `L${Math.floor(Math.random() * 1e6)}`,
                country_code: 'ID',
            })
        ).id;
        const firstEntity = business.legalEntityId;
        const switchTo = (legalEntityId: string) =>
            business.admin.put('/api/v1/workspace-context', {
                membership_id: business.member.membershipId,
                legal_entity_id: legalEntityId,
            });
        await json(await switchTo(secondEntity), 200);
        try {
            const unit = await created(`${inventoryApi}/units-of-measure`, {
                code: 'TAB',
                name: 'Tablet',
            });
            const foreignLocation = await business.location('LPL-GDG');
            const foreignItem = await business.item('LPL-A', {
                base_unit_id: unit.id,
            });
            const reasons = (
                await json<{ data: Reference[] }>(
                    await business.admin.get(`${inventoryApi}/reason-codes`),
                    200,
                )
            ).data;
            const foreignDraft = await created<{ id: string; version: number }>(
                `${inventoryApi}/adjustments`,
                {
                    direction: 'masuk',
                    location_id: foreignLocation.id,
                    posting_date: '2026-10-05',
                    reason_id: reasons.find(
                        (reason) => reason.code === 'SALDO-AWAL',
                    )?.id,
                    lines: [
                        {
                            item_id: foreignItem.id,
                            quantity: 999,
                            unit_cost: 1,
                        },
                    ],
                },
            );
            await json(await business.post(foreignDraft), 200);
            const own = await lplpo(business, {
                operating_unit_id: business.unitId,
            });
            expect(own.rows.map((row) => row.item.id)).toEqual([
                foreignItem.id,
            ]);
            expect(own.rows[0]?.receipts).toBe('0');
            expect(own.rows[0]?.adjustment).toBe('999');

            await json(await switchTo(firstEntity), 200);
            const first = await lplpo(business, {
                operating_unit_id: business.unitId,
            });
            expect(first.rows.map((row) => row.item.id)).not.toContain(
                foreignItem.id,
            );
            expect(columns(first, drug).closing).toBe('158');
            expect(
                Object.keys(
                    await refused(
                        await business.admin.get(
                            `${inventoryApi}/reports/lplpo?${new URLSearchParams(
                                {
                                    from,
                                    to,
                                    location_id: foreignLocation.id,
                                },
                            )}`,
                        ),
                    ),
                ),
            ).toEqual(['location_id']);
        } finally {
            await switchTo(firstEntity);
        }
    });

    test('the report needs the report right', async () => {
        const outsider = await createMember(pool, business.tenantId, [
            'core.inventory-item.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            outsider.membershipId,
        );
        const session = browser();
        await session.login(outsider.email, outsider.password);
        const query = new URLSearchParams({
            from,
            to,
            location_id: warehouse.id,
        });
        expect(
            (await session.get(`${inventoryApi}/reports/lplpo?${query}`))
                .status,
        ).toBe(403);
        const reader = await createMember(pool, business.tenantId, [
            'core.inventory-report.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            reader.membershipId,
        );
        const allowed = browser();
        await allowed.login(reader.email, reader.password);
        expect(
            (await allowed.get(`${inventoryApi}/reports/lplpo?${query}`))
                .status,
        ).toBe(200);
    });
});
