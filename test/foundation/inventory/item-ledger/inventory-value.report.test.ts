import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { extractText, getDocumentProxy } from 'unpdf';
import {
    createBusiness,
    inventoryApi,
    inventoryDuties,
    json,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import {
    createMember,
    createTenant,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';
import { readWorkbook } from '../../../support/workbook-reader.ts';

type Reference = { id: string; code: string; name: string; version: number };

// Nilai persediaan per lokasi dari kartu gudang, diunduh sebagai workbook Excel layout bawaan. Angkanya dibaca dari
// berkas yang diunduh dan dicocokkan dengan kartu gudang lewat SQL langsung.
describe.skipIf(!process.env.DB_HOST)('inventory value', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let warehouse: { id: string };
    let medicine: Reference;
    let devices: Reference;
    const november = { from: '2026-11-01', to: '2026-11-30' };

    const print = (
        query: Record<string, string>,
        session = business.admin,
        locationId = warehouse.id,
    ) =>
        session.get(
            `/api/v1/reports/core.inventory-value/records/${locationId}?${new URLSearchParams(query).toString()}`,
        );
    const workbook = async (query: Record<string, string>) => {
        const response = await print(query);
        expect(response.status).toBe(200);
        return readWorkbook(new Uint8Array(await response.arrayBuffer()));
    };
    const lines = (book: ReturnType<typeof readWorkbook>) => {
        const table = book.table('lines');
        return table.rows.map((row) =>
            Object.fromEntries(
                table.header.map((name, index) => [
                    name,
                    row[index]?.value ?? '',
                ]),
            ),
        );
    };
    const numbers = (row: Record<string, string> | undefined) =>
        row &&
        [
            'opening_quantity',
            'opening_value',
            'received_quantity',
            'received_value',
            'issued_quantity',
            'issued_value',
            'closing_quantity',
            'closing_value',
            'unit_cost',
        ].map((key) => (row[key] ? Number(row[key]) : null));

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Nilai Persediaan',
            [
                ...inventoryDuties,
                'core.inventory-report.inquire',
                'core.vendor.manage',
                'core.purchase-receipt.manage',
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
        const pharmacy = await business.location('FARMASI');
        medicine = await created(`${inventoryApi}/item-categories`, {
            code: 'OBAT',
            name: 'Obat',
        });
        const children = await created(`${inventoryApi}/item-categories`, {
            code: 'OBAT-ANAK',
            name: 'Obat anak',
            parent_id: medicine.id,
        });
        devices = await created(`${inventoryApi}/item-categories`, {
            code: 'ALKES',
            name: 'Alat kesehatan',
        });
        const funded = await business.item('OBT-E', {
            category_id: children.id,
        });
        const cancelled = await business.item('ALK-1', {
            category_id: devices.id,
        });
        const elsewhere = await business.item('OBT-D', {
            category_id: medicine.id,
        });
        const vendor = await created('/api/v1/purchasing/vendors', {
            name: 'PBF Uji Nilai Persediaan',
            tax_number: '01.234.567.8-901.000',
        });
        const source = (code: string) =>
            created(`${inventoryApi}/funding-sources`, {
                code,
                name: `Dana ${code}`,
            });
        const apbd = await source('APBD');
        const blud = await source('BLUD');
        await source('HIBAH');
        for (const [fundingSource, quantity, unitCost, date] of [
            [apbd, 7, 100, '2026-10-20'],
            [apbd, 40, 100, '2026-11-03'],
            [blud, 25, 120, '2026-11-08'],
        ] as const) {
            const receipt = await created<{ id: string; version: number }>(
                '/api/v1/purchasing/receipts',
                {
                    vendor_id: vendor.id,
                    location_id: warehouse.id,
                    posting_date: date,
                    vendor_document_number: `SJ-${date}`,
                    lines: [
                        {
                            item_id: funded.id,
                            unit_id: business.uom.id,
                            quantity,
                            unit_cost: unitCost,
                            funding_source_id: fundingSource.id,
                        },
                    ],
                },
            );
            await json(
                await business.admin.post(
                    `/api/v1/purchasing/receipts/${receipt.id}/post`,
                    { version: receipt.version },
                ),
                200,
            );
        }
        await business.posted(
            'masuk',
            warehouse.id,
            [{ item_id: funded.id, quantity: 5, unit_cost: 100 }],
            '2026-11-09',
        );
        await business.posted(
            'keluar',
            warehouse.id,
            [{ item_id: funded.id, quantity: 30 }],
            '2026-11-12',
        );
        await business.posted(
            'masuk',
            warehouse.id,
            [{ item_id: funded.id, quantity: 9, unit_cost: 100 }],
            '2026-12-01',
        );
        const reversed = await business.posted(
            'masuk',
            warehouse.id,
            [{ item_id: cancelled.id, quantity: 4, unit_cost: 50 }],
            '2026-11-10',
        );
        await json(await business.reverse(reversed), 200);
        await business.posted(
            'masuk',
            pharmacy.id,
            [{ item_id: elsewhere.id, quantity: 5, unit_cost: 100 }],
            '2026-11-05',
        );
    });

    test('each item and funding source at the location gets opening, received, issued, and closing at ledger cost', async () => {
        const book = await workbook(november);
        const rows = lines(book);
        expect(
            rows.map((row) => [row.funding_source_name, row.item_code]),
        ).toEqual([
            ['Dana APBD', 'OBT-E'],
            ['Dana BLUD', 'OBT-E'],
            ['Tanpa sumber dana', 'ALK-1'],
            ['Tanpa sumber dana', 'OBT-E'],
        ]);
        // Pemakaian 30 diambil FIFO dari penerimaan APBD 20 Oktober (7) dan 3 November (23).
        expect(numbers(rows[0])).toEqual([
            7, 700, 40, 4000, 30, 3000, 17, 1700, 100,
        ]);
        expect(numbers(rows[1])).toEqual([0, 0, 25, 3000, 0, 0, 25, 3000, 120]);
        // Penyesuaian masuk yang dibatalkan: pembatalannya bertanda negatif, jadi terhitung pengeluaran seperti LPLPO.
        expect(numbers(rows[2])).toEqual([0, 0, 4, 200, 4, 200, 0, 0, null]);
        expect(numbers(rows[3])).toEqual([0, 0, 5, 500, 0, 0, 5, 500, 100]);
        expect(rows.map((row) => row.item_code)).not.toContain('OBT-D');
        const [ledger] = await pool.unsafe<
            { quantity: string; value: string }[]
        >(
            `select trim_scale(sum(k.jumlah))::text as quantity, trim_scale(sum(k.nilai))::text as value
             from gd_tr_kartu_gudang k
             join gd_m_barang b on b.id = k.barang_id
             where k.tenant_id = $1 and k.lokasi_id = $2 and b.kode = 'OBT-E' and k.tanggal_posting <= '2026-11-30'`,
            [business.tenantId, warehouse.id],
        );
        const closing = rows
            .filter((row) => row.item_code === 'OBT-E')
            .reduce(
                (total, row) => ({
                    quantity: total.quantity + Number(row.closing_quantity),
                    value: total.value + Number(row.closing_value),
                }),
                { quantity: 0, value: 0 },
            );
        expect(closing).toEqual({
            quantity: Number(ledger?.quantity),
            value: Number(ledger?.value),
        });
    });

    test('the workbook names the location and the period, and its pivot reads the lines table', async () => {
        const response = await print(november);
        expect(response.headers.get('content-type')).toContain('spreadsheetml');
        expect(response.headers.get('content-disposition')).toContain(
            encodeURIComponent(
                'Nilai persediaan GUDANG 2026-11-01 sampai 2026-11-30.xlsx',
            ),
        );
        const book = readWorkbook(new Uint8Array(await response.arrayBuffer()));
        expect(book.value('Report.location_name').value).toBe('Lokasi GUDANG');
        // 1 November 2026 adalah serial Excel 46327.
        expect(book.value('Report.date_from')).toMatchObject({
            value: '46327',
            format: 'date',
        });
        expect(book.value('Report.date_to').value).toBe('46356');
        expect(book.value('Report.category_name').kind).toBe('empty');
        expect(book.part('xl/pivotCache/pivotCacheDefinition1.xml')).toContain(
            '<worksheetSource name="lines"/>',
        );
        expect(book.part('xl/pivotTables/pivotTable1.xml')).toContain(
            'grandTotalCaption="TOTAL PERSEDIAAN"',
        );
    });

    test('the category filter keeps the items of that category and its subcategories', async () => {
        const medicines = await workbook({
            ...november,
            category_id: medicine.id,
        });
        expect(lines(medicines).map((row) => row.item_code)).toEqual([
            'OBT-E',
            'OBT-E',
            'OBT-E',
        ]);
        expect(medicines.value('Report.category_name').value).toBe('Obat');
        const tools = await workbook({ ...november, category_id: devices.id });
        expect(lines(tools).map((row) => row.item_code)).toEqual(['ALK-1']);
    });

    test('a period that ends before it starts, or a category that does not exist, is refused per field', async () => {
        const refused = await json<{ errors: Record<string, string[]> }>(
            await print({
                from: '2026-11-30',
                to: '2026-11-01',
                category_id: Bun.randomUUIDv7(),
            }),
            422,
        );
        expect(Object.keys(refused.errors).sort()).toEqual([
            'category_id',
            'to',
        ]);
    });

    test('printing needs the inventory report permission, and another tenant cannot find the location', async () => {
        const clerk = await createMember(
            pool,
            business.tenantId,
            inventoryDuties,
        );
        await grantAllOrganizations(
            pool,
            business.tenantId,
            clerk.membershipId,
        );
        const session = browser();
        await session.login(clerk.email, clerk.password);
        expect((await print(november, session)).status).toBe(403);
        const otherTenant = await createTenant(pool, 'Tenant lain');
        const outsider = await createMember(pool, otherTenant, [
            'core.inventory-report.inquire',
        ]);
        await grantAllOrganizations(pool, otherTenant, outsider.membershipId);
        const stranger = browser();
        await stranger.login(outsider.email, outsider.password);
        expect((await print(november, stranger)).status).toBe(404);
    });

    test.skipIf(!process.env.RENDERER_URL)(
        'LibreOffice builds the pivot from the lines table, with a total per funding source and the grand total',
        async () => {
            const response = await print(november);
            const form = new FormData();
            form.append(
                'files',
                new Blob([await response.arrayBuffer()]),
                'nilai-persediaan.xlsx',
            );
            const converted = await fetch(
                `${process.env.RENDERER_URL}/forms/libreoffice/convert`,
                { method: 'POST', body: form },
            );
            expect(converted.status).toBe(200);
            const pdf = await getDocumentProxy(
                new Uint8Array(await converted.arrayBuffer()),
            );
            const { text } = await extractText(pdf, { mergePages: true });
            expect(text).toContain('NILAI PERSEDIAAN');
            expect(text).toMatch(
                /Dana APBD Result 7 700(\.00)? 40 4,000(\.00)? 30 3,000(\.00)? 17 1,700/,
            );
            expect(text).toMatch(
                /(Total Result|TOTAL PERSEDIAAN) 7 700(\.00)? 74 7,700(\.00)? 34 3,200(\.00)? 47 5,200/,
            );
        },
    );

    test('a location kept for its own employees is refused to others', async () => {
        const location = (
            await json<{ data: Reference[] }>(
                await business.admin.get(`${inventoryApi}/locations`),
                200,
            )
        ).data.find((row) => row.id === warehouse.id);
        if (!location) throw new Error('Gudang tidak ditemukan.');
        await json(
            await business.admin.patch(
                `${inventoryApi}/locations/${location.id}`,
                {
                    code: location.code,
                    name: location.name,
                    operating_unit_id: business.unitId,
                    restricted_to_employees: true,
                    version: location.version,
                },
            ),
            200,
        );
        const refused = await json<{ errors: Record<string, string[]> }>(
            await print(november),
            422,
        );
        expect(Object.keys(refused.errors)).toEqual(['_form']);
    });
});
