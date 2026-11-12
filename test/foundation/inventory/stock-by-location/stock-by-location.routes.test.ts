import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    postItemLines,
    quantityScale,
} from '../../../../src/foundation/inventory/index.ts';
import { reportCsv } from '../../../../src/foundation/inventory/report-table.ts';
import { stockByLocationTable } from '../../../../src/foundation/inventory/stock-by-location/stock-by-location-table.ts';
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
type Stock = {
    items: {
        item: Reference & { unit: string };
        quantity: string;
        value: string;
        lines: {
            location: Reference;
            batch: {
                id: string;
                batch_number: string;
                expiry_date: string | null;
            } | null;
            quantity: string;
            value: string;
        }[];
    }[];
};

const asOf = '2026-11-30';

// Stok per lokasi per tanggal dari kartu gudang: batch, kedaluwarsa, nilai, total per barang, lokasi transit hanya bila
// dipilih, saringan hampir dan sudah kedaluwarsa, kategori beserta subkategorinya, posting sesudah tanggal tidak
// ikut, dan legal entity lain tidak pernah tampil. Harapan dihitung dari skenario dan dicocokkan dengan SQL langsung.
describe.skipIf(!process.env.DB_HOST)('stock by location', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let medicine: Reference;
    let warehouse: { id: string };
    let pharmacy: { id: string };
    let transit: { id: string };
    let tablet: { id: string };
    let loose: { id: string };
    let device: { id: string };

    async function created<T = Reference>(
        path: string,
        body: Record<string, unknown>,
    ) {
        return (
            await json<{ data: T }>(await business.admin.post(path, body), 201)
        ).data;
    }
    const batch = async (itemId: string, number: string) => {
        const [found] = await pool.unsafe<{ id: string }[]>(
            'select id from gd_m_batch where barang_id = $1 and no_batch = $2',
            [itemId, number],
        );
        if (!found) throw new Error(`Batch ${number} was not recorded.`);
        return found.id;
    };
    const stock = async (
        target: Business,
        query: Record<string, string> = {},
    ) =>
        json<Stock>(
            await target.admin.get(
                `${inventoryApi}/reports/stock-by-location?${new URLSearchParams({ as_of: asOf, ...query })}`,
            ),
            200,
        );
    const summary = (report: Stock) =>
        report.items.map((group) => ({
            item: group.item.code,
            quantity: group.quantity,
            value: group.value,
            lines: group.lines.map((line) =>
                [
                    line.location.code,
                    line.batch?.batch_number ?? '-',
                    line.batch?.expiry_date ?? '-',
                    line.quantity,
                    line.value,
                ].join(' '),
            ),
        }));

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Stok Lokasi',
            [...inventoryDuties, 'core.inventory-report.inquire'],
        );
        const tracked = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        medicine = await created(`${inventoryApi}/item-categories`, {
            code: 'OBAT',
            name: 'Obat',
        });
        const children = await created(`${inventoryApi}/item-categories`, {
            code: 'OBAT-ANAK',
            name: 'Obat anak',
            parent_id: medicine.id,
        });
        const tools = await created(`${inventoryApi}/item-categories`, {
            code: 'ALKES',
            name: 'Alat kesehatan',
        });
        tablet = await business.item('STK-1', {
            tracking_code_id: tracked.id,
            category_id: children.id,
        });
        loose = await business.item('STK-2');
        device = await business.item('STK-3', { category_id: tools.id });
        warehouse = await business.location('STK-GDG');
        pharmacy = await business.location('STK-FAR');
        transit = await business.location('STK-TRN', { is_transit: true });

        const lot = (
            number: string,
            expiry: string,
            quantity: number,
            cost: number,
        ) => ({
            item_id: tablet.id,
            quantity,
            batch_number: number,
            expiry_date: expiry,
            unit_cost: cost,
        });
        await business.posted(
            'masuk',
            warehouse.id,
            [
                lot('E1', '2026-12-10', 10, 100),
                lot('E2', '2026-11-20', 5, 200),
                lot('E3', '2027-12-31', 7, 300),
                { item_id: loose.id, quantity: 4, unit_cost: 50 },
                { item_id: device.id, quantity: 6, unit_cost: 10 },
            ],
            '2026-11-01',
        );
        await business.posted(
            'masuk',
            pharmacy.id,
            [lot('E1', '2026-12-10', 3, 100)],
            '2026-11-02',
        );
        await business.posted(
            'keluar',
            warehouse.id,
            [
                {
                    item_id: tablet.id,
                    quantity: 2,
                    batch_id: await batch(tablet.id, 'E3'),
                },
            ],
            '2026-11-05',
        );
        const firstLot = await batch(tablet.id, 'E1');
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
                        postingDate: '2026-11-10',
                        source: {
                            type: 'uji-kirim',
                            id: Bun.randomUUIDv7(),
                            number: null,
                        },
                    },
                    [
                        {
                            kind: 'transfer',
                            key: `uji-kirim:${Bun.randomUUIDv7()}`,
                            field: 'lines.0',
                            sourceLineId: null,
                            itemId: tablet.id,
                            quantity: 10n ** BigInt(quantityScale),
                            fromLocationId: warehouse.id,
                            toLocationId: transit.id,
                            batchId: firstLot,
                        },
                    ],
                ),
            );
        } finally {
            connection.release();
        }
        await business.posted(
            'masuk',
            warehouse.id,
            [lot('E1', '2026-12-10', 100, 100)],
            '2026-12-05',
        );
    });

    test('stock on a date lists every location and batch with its value and one total per item, without transit', async () => {
        expect(summary(await stock(business))).toEqual([
            {
                item: 'STK-1',
                quantity: '22',
                value: '3700',
                lines: [
                    'STK-FAR E1 2026-12-10 3 300',
                    'STK-GDG E2 2026-11-20 5 1000',
                    'STK-GDG E1 2026-12-10 9 900',
                    'STK-GDG E3 2027-12-31 5 1500',
                ],
            },
            {
                item: 'STK-2',
                quantity: '4',
                value: '200',
                lines: ['STK-GDG - - 4 200'],
            },
            {
                item: 'STK-3',
                quantity: '6',
                value: '60',
                lines: ['STK-GDG - - 6 60'],
            },
        ]);
        const [direct] = await pool.unsafe<
            { quantity: string; value: string }[]
        >(
            `select trim_scale(sum(k.jumlah))::text as quantity, trim_scale(sum(k.nilai))::text as value
             from gd_tr_kartu_gudang k join gd_m_lokasi l on l.id = k.lokasi_id
             where k.barang_id = $1 and k.tanggal_posting <= $2::date and not l.transit`,
            [tablet.id, asOf],
        );
        expect(direct).toEqual({ quantity: '22', value: '3700' });
    });

    test('a transit location shows only when chosen', async () => {
        expect(
            summary(await stock(business, { location_id: transit.id })),
        ).toEqual([
            {
                item: 'STK-1',
                quantity: '1',
                value: '100',
                lines: ['STK-TRN E1 2026-12-10 1 100'],
            },
        ]);
    });

    test('an earlier date shows the stock of that day, ignoring what was posted later', async () => {
        expect(
            summary(
                await stock(business, {
                    as_of: '2026-11-03',
                    item_id: tablet.id,
                }),
            ),
        ).toEqual([
            {
                item: 'STK-1',
                quantity: '25',
                value: '4400',
                lines: [
                    'STK-FAR E1 2026-12-10 3 300',
                    'STK-GDG E2 2026-11-20 5 1000',
                    'STK-GDG E1 2026-12-10 10 1000',
                    'STK-GDG E3 2027-12-31 7 2100',
                ],
            },
        ]);
        expect((await stock(business, { as_of: '2026-10-31' })).items).toEqual(
            [],
        );
    });

    test('expired and near-expiry filters count from the stock date and leave out stock without an expiry', async () => {
        expect(summary(await stock(business, { expiry: 'expired' }))).toEqual([
            {
                item: 'STK-1',
                quantity: '5',
                value: '1000',
                lines: ['STK-GDG E2 2026-11-20 5 1000'],
            },
        ]);
        expect(
            summary(await stock(business, { expiry: 'expiring', days: '30' })),
        ).toEqual([
            {
                item: 'STK-1',
                quantity: '12',
                value: '1200',
                lines: [
                    'STK-FAR E1 2026-12-10 3 300',
                    'STK-GDG E1 2026-12-10 9 900',
                ],
            },
        ]);
        expect(
            (await stock(business, { expiry: 'expiring', days: '5' })).items,
        ).toEqual([]);
        expect(
            Object.keys(
                await refused(
                    await business.admin.get(
                        `${inventoryApi}/reports/stock-by-location?${new URLSearchParams(
                            {
                                as_of: asOf,
                                expiry: 'expiring',
                            },
                        )}`,
                    ),
                ),
            ),
        ).toEqual(['days']);
    });

    test('a category takes in its subcategories, and an item filter keeps one item', async () => {
        expect(
            (await stock(business, { category_id: medicine.id })).items.map(
                (group) => group.item.code,
            ),
        ).toEqual(['STK-1']);
        expect(
            (await stock(business, { item_id: loose.id })).items.map(
                (group) => group.item.code,
            ),
        ).toEqual(['STK-2']);
    });

    test('the CSV is the table on screen, with the total rows', async () => {
        const table = stockByLocationTable(await stock(business));
        const lines = reportCsv(table)
            .slice(1)
            .trimEnd()
            .split('\r\n')
            .map((line) => line.split(';'));
        expect(lines[0]).toEqual(table.columns.map((column) => column.header));
        expect(lines.slice(1)).toEqual(table.rows.map((row) => row.cells));
        expect(
            lines.find((line) => line[0] === 'STK-1' && line[2] === 'Total'),
        ).toEqual([
            'STK-1',
            'Barang STK-1',
            'Total',
            '',
            '',
            '22',
            'TAB',
            '3.700',
        ]);
        expect(lines[2]?.slice(2, 5)).toEqual([
            'STK-GDG · Lokasi STK-GDG',
            'E2',
            '20/11/2026',
        ]);
    });

    test('another legal entity never shows and its locations are refused', async () => {
        const secondEntity = (
            await created('/api/v1/organizations', {
                classification: 'legal_entity',
                name: 'PT Klinik Uji Stok Lokasi Kedua',
                company_code: `S${Math.floor(Math.random() * 1e6)}`,
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
        let foreignLocation = { id: '' };
        let foreignItem = { id: '' };
        try {
            const unit = await created(`${inventoryApi}/units-of-measure`, {
                code: 'TAB',
                name: 'Tablet',
            });
            foreignLocation = await business.location('STK-GDG');
            foreignItem = await business.item('STK-1', {
                base_unit_id: unit.id,
            });
            const reasons = (
                await json<{ data: Reference[] }>(
                    await business.admin.get(`${inventoryApi}/reason-codes`),
                    200,
                )
            ).data;
            const draft = await created<{ id: string; version: number }>(
                `${inventoryApi}/adjustments`,
                {
                    direction: 'masuk',
                    location_id: foreignLocation.id,
                    posting_date: '2026-11-01',
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
            await json(await business.post(draft), 200);
            expect(summary(await stock(business))).toEqual([
                {
                    item: 'STK-1',
                    quantity: '999',
                    value: '999',
                    lines: ['STK-GDG - - 999 999'],
                },
            ]);
        } finally {
            await json(await switchTo(firstEntity), 200);
        }
        const own = await stock(business);
        expect(own.items.map((group) => group.item.id)).not.toContain(
            foreignItem.id,
        );
        expect(own.items[0]?.quantity).toBe('22');
        expect(
            Object.keys(
                await refused(
                    await business.admin.get(
                        `${inventoryApi}/reports/stock-by-location?${new URLSearchParams(
                            {
                                as_of: asOf,
                                location_id: foreignLocation.id,
                            },
                        )}`,
                    ),
                ),
            ),
        ).toEqual(['location_id']);
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
        expect(
            (
                await session.get(
                    `${inventoryApi}/reports/stock-by-location?as_of=${asOf}`,
                )
            ).status,
        ).toBe(403);
    });
});
