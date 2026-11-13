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
    setCurrencyPrecision,
} from '../../../support/tenant-fixtures.ts';

type Reference = { id: string; code: string; name: string };
type Receipt = {
    id: string;
    number: string;
    status: string;
    amount: string;
    version: number;
    lines: { id: string; amount: string; quantity_per_unit: string }[];
};
type Line = Record<string, unknown>;

const path = '/api/v1/purchasing/receipts';
const receiptDuties = [
    ...inventoryDuties,
    'core.vendor.manage',
    'core.purchase-receipt.manage',
];

// Penerimaan barang dari vendor: satuan kemasan menjadi satuan dasar di kartu gudang, profil pelacakan dan batch dijaga
// mesin posting, posting aman diulang, batal posting, dan rujukan yang hanya sah di legal entity sendiri. Isi kartu
// gudang diperiksa dengan SQL langsung, bukan lewat API yang sedang diuji.
describe.skipIf(!process.env.DB_HOST)('purchase receipts', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let location: { id: string };
    let medicine: { id: string };
    let plain: { id: string };
    let box: Reference;
    let pack: Reference;
    let vendor: { id: string };
    let apbd: Reference;
    let blud: Reference;
    let malaria: Reference;

    function setup(target: Business) {
        const created = async <T = Reference>(
            route: string,
            body: Record<string, unknown>,
        ) =>
            (await json<{ data: T }>(await target.admin.post(route, body), 201))
                .data;
        return {
            created,
            vendor: (name: string) =>
                created<{ id: string; number: string }>(
                    '/api/v1/purchasing/vendors',
                    { name, tax_number: '01.234.567.8-901.000' },
                ),
            code: (list: string, code: string) =>
                created(`${inventoryApi}/${list}`, {
                    code,
                    name: `Uji ${code}`,
                }),
            packaging: (itemId: string, unitId: string, quantity: number) =>
                created(`${inventoryApi}/item-units`, {
                    item_id: itemId,
                    unit_id: unitId,
                    quantity_per_unit: quantity,
                }),
        };
    }

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Penerimaan',
            receiptDuties,
        );
        // Harga satuan di sini memakai desimal.
        await setCurrencyPrecision(pool, business.tenantId, {
            amount_decimals: 2,
            unit_amount_decimals: 4,
            invoice_rounding_precision: '0',
            invoice_rounding_type: 'nearest',
        });
        const make = setup(business);
        location = await business.location('GUDANG');
        const tracked = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        medicine = await business.item('AMX', {
            tracking_code_id: tracked.id,
        });
        plain = await business.item('KASA');
        box = await make.code('units-of-measure', 'BOX');
        await make.packaging(medicine.id, box.id, 100);
        pack = await make.code('units-of-measure', 'PAK');
        await make.packaging(plain.id, pack.id, 2.5);
        vendor = await make.vendor('PBF Sehat Sentosa');
        apbd = await make.code('funding-sources', 'APBD');
        blud = await make.code('funding-sources', 'BLUD');
        malaria = await make.code('procurement-programs', 'MALARIA');
    });

    const boxLine = (overrides: Line = {}): Line => ({
        item_id: medicine.id,
        unit_id: box.id,
        quantity: 2,
        unit_cost: 150000,
        discount_percent: 10,
        batch_number: 'b-001',
        expiry_date: '2027-06-30',
        funding_source_id: apbd.id,
        procurement_program_id: malaria.id,
        budget_year: 2026,
        ...overrides,
    });
    const plainLine = (quantity: number): Line => ({
        item_id: plain.id,
        unit_id: business.uom.id,
        quantity,
        unit_cost: 500,
    });

    async function draft(lines: Line[], overrides: Line = {}) {
        return (
            await json<{ data: Receipt }>(
                await business.admin.post(path, {
                    vendor_id: vendor.id,
                    location_id: location.id,
                    posting_date: '2026-11-10',
                    vendor_document_number: 'SJ-2611-001',
                    lines,
                    ...overrides,
                }),
                201,
            )
        ).data;
    }
    const post = (document: { id: string; version: number }) =>
        business.admin.post(`${path}/${document.id}/post`, {
            version: document.version,
        });
    const reverse = (document: { id: string; version: number }) =>
        business.admin.post(`${path}/${document.id}/reverse`, {
            version: document.version,
        });
    const posted = async (lines: Line[]) =>
        (await json<{ data: Receipt }>(await post(await draft(lines)), 200))
            .data;

    async function ledger(documentId: string) {
        const rows = await pool.unsafe<
            {
                quantity: string;
                open: string;
                unit_cost: string | null;
                amount: string;
                kind: string;
                batch: string | null;
                expiry: string | null;
                funding: string | null;
                program: string | null;
                year: number | null;
                reversal: boolean;
            }[]
        >(
            `select trim_scale(k.jumlah)::text as quantity, trim_scale(k.sisa)::text as open,
                    trim_scale(k.harga_satuan)::text as unit_cost, trim_scale(k.nilai)::text as amount, k.jenis as kind,
                    t.no_batch as batch, k.kedaluwarsa::text as expiry, k.sumber_dana_id as funding,
                    k.program_pengadaan_id as program, k.tahun_anggaran as year,
                    k.dibalik_dari is not null as reversal
             from gd_tr_kartu_gudang k
             left join gd_m_batch t on t.id = k.batch_id
             where k.tenant_id = $1 and k.sumber_jenis = 'penerimaan' and k.sumber_id = $2
             order by k.dibalik_dari nulls first, k.id`,
            [business.tenantId, documentId],
        );
        return [...rows];
    }

    test('a receipt in boxes posts base quantity and base unit cost after discount, with its funding, to the ledger', async () => {
        const document = await draft([boxLine()]);
        expect(document.number).toMatch(/^PNR-\d{8}$/);
        expect(document.status).toBe('draf');
        expect(document.lines[0]?.quantity_per_unit).toBe('100');
        expect(document.lines[0]?.amount).toBe('270000');
        expect(document.amount).toBe('270000');
        expect(await ledger(document.id)).toEqual([]);

        const result = await json<{ data: Receipt }>(await post(document), 200);
        expect(result.data.status).toBe('diposting');
        expect(await ledger(document.id)).toEqual([
            {
                quantity: '200',
                open: '200',
                unit_cost: '1350',
                amount: '270000',
                kind: 'penerimaan',
                batch: 'B-001',
                expiry: '2027-06-30',
                funding: apbd.id,
                program: malaria.id,
                year: 2026,
                reversal: false,
            },
        ]);
    });

    test('a line in the base unit posts as is, and a unit that does not belong to the item or a fraction the base unit cannot hold is refused', async () => {
        const document = await posted([plainLine(7)]);
        expect(
            (await ledger(document.id)).map((row) => [
                row.quantity,
                row.unit_cost,
                row.funding,
            ]),
        ).toEqual([['7', '500', null]]);

        const errors = await refused(
            await business.admin.post(path, {
                vendor_id: vendor.id,
                location_id: location.id,
                posting_date: '2026-11-10',
                lines: [
                    { ...plainLine(1), unit_id: box.id },
                    { ...plainLine(1), unit_id: pack.id, quantity: '0.0001' },
                ],
            }),
        );
        expect(Object.keys(errors).sort()).toEqual([
            'lines.0.unit_id',
            'lines.1.quantity',
        ]);
    });

    test("a line without a unit takes the item's purchase unit, and the base unit while none is chosen", async () => {
        const syrup = await json<{
            data: {
                id: string;
                code: string;
                name: string;
                version: number;
            };
        }>(
            await business.admin.post(`${inventoryApi}/items`, {
                code: 'SIRUP',
                name: 'Sirup',
                base_unit_id: business.uom.id,
            }),
            201,
        );
        const make = setup(business);
        const crate = await make.code('units-of-measure', 'DUS');
        const lineOf = () => ({
            item_id: syrup.data.id,
            quantity: 3,
            unit_cost: 1200,
        });
        const before = await draft([lineOf()]);
        expect(before.lines[0]).toMatchObject({
            unit: { id: business.uom.id },
            quantity_per_unit: '1',
        });

        await make.packaging(syrup.data.id, crate.id, 24);
        await json(
            await business.admin.patch(
                `${inventoryApi}/items/${syrup.data.id}`,
                {
                    code: syrup.data.code,
                    name: syrup.data.name,
                    base_unit_id: business.uom.id,
                    purchase_unit_id: crate.id,
                    version: syrup.data.version,
                },
            ),
            200,
        );
        const document = await posted([lineOf()]);
        expect(document.lines[0]).toMatchObject({
            unit: { id: crate.id, code: 'DUS' },
            quantity_per_unit: '24',
            quantity: '3',
        });
        expect(
            (await ledger(document.id)).map((row) => [
                row.quantity,
                row.unit_cost,
            ]),
        ).toEqual([['72', '50']]);
    });

    test('a tracked item refuses a line without batch or expiry at posting, and nothing reaches the ledger', async () => {
        const noBatch = await draft([
            boxLine({ batch_number: null, expiry_date: null }),
        ]);
        expect(Object.keys(await refused(await post(noBatch))).sort()).toEqual([
            'lines.0.batch_number',
            'lines.0.expiry_date',
        ]);
        const noExpiry = await draft([
            boxLine({ batch_number: 'B-NOEXP', expiry_date: null }),
        ]);
        expect(Object.keys(await refused(await post(noExpiry)))).toEqual([
            'lines.0.expiry_date',
        ]);
        const [statuses] = await pool.unsafe<{ drafts: number }[]>(
            `select count(*) filter (where status = 'draf')::int as drafts from bl_tr_penerimaan
             where id in ($1, $2)`,
            [noBatch.id, noExpiry.id],
        );
        expect(statuses?.drafts).toBe(2);
        expect(await ledger(noBatch.id)).toEqual([]);
        expect(await ledger(noExpiry.id)).toEqual([]);
    });

    test('a batch already recorded with another expiry is refused', async () => {
        await posted([
            boxLine({ batch_number: 'B-EXP', expiry_date: '2027-01-31' }),
        ]);
        const mismatch = await draft([
            boxLine({ batch_number: 'B-EXP', expiry_date: '2027-12-31' }),
        ]);
        const errors = await refused(await post(mismatch));
        expect(Object.keys(errors)).toEqual(['lines.0.expiry_date']);
        expect(errors['lines.0.expiry_date']?.[0]).toContain('2027-01-31');
        expect(await ledger(mismatch.id)).toEqual([]);
    });

    test('the same batch received under two funding sources keeps both, and stock issued from it carries each source', async () => {
        const first = await posted([
            boxLine({ batch_number: 'B-DANA', quantity: 1 }),
        ]);
        const second = await posted([
            boxLine({
                batch_number: 'B-DANA',
                quantity: 1,
                funding_source_id: blud.id,
                procurement_program_id: null,
                budget_year: 2025,
            }),
        ]);
        expect((await ledger(first.id))[0]?.funding).toBe(apbd.id);
        expect((await ledger(second.id))[0]?.funding).toBe(blud.id);

        const location2 = await business.location('DANA');
        const local = await json<{ data: Receipt }>(
            await post(
                await draft(
                    [
                        boxLine({ batch_number: 'B-DANA3', quantity: 1 }),
                        boxLine({
                            batch_number: 'B-DANA3',
                            quantity: 1,
                            funding_source_id: blud.id,
                            procurement_program_id: null,
                            budget_year: 2025,
                        }),
                    ],
                    { location_id: location2.id },
                ),
            ),
            200,
        );
        expect(local.data.status).toBe('diposting');
        await business.posted('keluar', location2.id, [
            { item_id: medicine.id, quantity: 150 },
        ]);
        const issued = await pool.unsafe<
            { quantity: string; funding: string | null; year: number | null }[]
        >(
            `select trim_scale(jumlah)::text as quantity, sumber_dana_id as funding, tahun_anggaran as year
             from gd_tr_kartu_gudang
             where tenant_id = $1 and lokasi_id = $2 and jumlah < 0
             order by sumber_dana_id = $3 desc`,
            [business.tenantId, location2.id, apbd.id],
        );
        expect([...issued]).toEqual([
            { quantity: '-100', funding: apbd.id, year: 2026 },
            { quantity: '-50', funding: blud.id, year: 2025 },
        ]);
    });

    test('posting again, in sequence or at the same time, writes the ledger once', async () => {
        const document = await draft([
            boxLine({ batch_number: 'B-TWICE' }),
            plainLine(3),
        ]);
        expect((await post(document)).status).toBe(200);
        const again = await json<{ data: Receipt }>(await post(document), 200);
        expect(again.data.status).toBe('diposting');
        expect(await ledger(document.id)).toHaveLength(2);

        const racing = await draft([boxLine({ batch_number: 'B-RACE' })]);
        const responses = await Promise.all(
            Array.from({ length: 5 }, () => post(racing)),
        );
        expect(responses.map((response) => response.status)).toEqual([
            200, 200, 200, 200, 200,
        ]);
        expect(await ledger(racing.id)).toHaveLength(1);
    });

    test('reversing an untouched receipt writes mirror rows and leaves no stock, and a second reversal is a no-op', async () => {
        const location3 = await business.location('BATAL');
        const document = await json<{ data: Receipt }>(
            await post(
                await draft([boxLine({ batch_number: 'B-BATAL' })], {
                    location_id: location3.id,
                }),
            ),
            200,
        );
        const reversed = await json<{ data: Receipt }>(
            await reverse(document.data),
            200,
        );
        expect(reversed.data.status).toBe('dibatalkan');
        expect(
            (await ledger(document.data.id)).map((row) => [
                row.quantity,
                row.open,
                row.funding,
                row.reversal,
            ]),
        ).toEqual([
            ['200', '0', apbd.id, false],
            ['-200', '0', apbd.id, true],
        ]);
        expect(await business.stock(medicine.id, location3.id)).toEqual({});
        expect((await reverse(document.data)).status).toBe(200);
        expect(await ledger(document.data.id)).toHaveLength(2);
        expect(
            Object.keys(
                await refused(
                    await business.admin.patch(`${path}/${document.data.id}`, {
                        vendor_id: vendor.id,
                        location_id: location3.id,
                        posting_date: '2026-11-10',
                        lines: [],
                        version: reversed.data.version,
                    }),
                ),
            ),
        ).toEqual(['_form']);
    });

    test('reversing a receipt whose stock was partly issued is refused with 422 and changes nothing', async () => {
        const location4 = await business.location('PAKAI');
        const document = await json<{ data: Receipt }>(
            await post(
                await draft([boxLine({ batch_number: 'B-PAKAI' })], {
                    location_id: location4.id,
                }),
            ),
            200,
        );
        await business.posted('keluar', location4.id, [
            { item_id: medicine.id, quantity: 30 },
        ]);
        const errors = await refused(await reverse(document.data));
        expect(errors._form?.[0]).toContain('sudah dipakai');
        const [header] = await pool.unsafe<{ status: string }[]>(
            'select status from bl_tr_penerimaan where id = $1',
            [document.data.id],
        );
        expect(header?.status).toBe('diposting');
        expect(
            (await ledger(document.data.id)).map((row) => [
                row.quantity,
                row.open,
            ]),
        ).toEqual([['200', '170']]);
    });

    test('an inactive vendor cannot be chosen, and a draft whose vendor was deactivated cannot be posted', async () => {
        const make = setup(business);
        const leaving = await make.vendor('PBF Tutup');
        const document = await draft([plainLine(1)], { vendor_id: leaving.id });
        await json(
            await business.admin.patch(
                `/api/v1/purchasing/vendors/${leaving.id}`,
                { name: 'PBF Tutup', status: 'inactive', version: 1 },
            ),
            200,
        );
        expect(Object.keys(await refused(await post(document)))).toEqual([
            'vendor_id',
        ]);
        expect(
            Object.keys(
                await refused(
                    await business.admin.post(path, {
                        vendor_id: leaving.id,
                        location_id: location.id,
                        posting_date: '2026-11-10',
                        lines: [],
                    }),
                ),
            ),
        ).toEqual(['vendor_id']);
        expect(await ledger(document.id)).toEqual([]);
    });

    test('vendor, location, item, unit, funding source, and program of another legal entity are refused', async () => {
        const other = await createBusiness(
            pool,
            browser,
            'Klinik Uji Penerimaan Lintas',
            receiptDuties,
        );
        const make = setup(other);
        const foreign = {
            vendor: await make.vendor('PBF Entitas Pertama'),
            location: await other.location('GUDANG'),
            item: await other.item('AMX'),
            funding: await make.code('funding-sources', 'APBD'),
            program: await make.code('procurement-programs', 'MALARIA'),
        };
        const secondEntity = (
            await json<{ data: { id: string } }>(
                await other.admin.post('/api/v1/organizations', {
                    classification: 'legal_entity',
                    name: 'PT Klinik Uji Penerimaan Kedua',
                    company_code: `P${Math.floor(Math.random() * 1e6)}`,
                    country_code: 'ID',
                }),
                201,
            )
        ).data.id;
        await json(
            await other.admin.put('/api/v1/workspace-context', {
                membership_id: other.member.membershipId,
                legal_entity_id: secondEntity,
            }),
            200,
        );
        const errors = await refused(
            await other.admin.post(path, {
                vendor_id: foreign.vendor.id,
                location_id: foreign.location.id,
                posting_date: '2026-11-10',
                lines: [
                    {
                        item_id: foreign.item.id,
                        unit_id: other.uom.id,
                        quantity: 1,
                        unit_cost: 1,
                        funding_source_id: foreign.funding.id,
                        procurement_program_id: foreign.program.id,
                    },
                ],
            }),
        );
        expect(Object.keys(errors).sort()).toEqual([
            'lines.0.funding_source_id',
            'lines.0.item_id',
            'lines.0.procurement_program_id',
            'lines.0.unit_id',
            'location_id',
            'vendor_id',
        ]);
        const [count] = await pool.unsafe<{ receipts: number }[]>(
            'select count(*)::int as receipts from bl_tr_penerimaan where tenant_id = $1',
            [other.tenantId],
        );
        expect(count?.receipts).toBe(0);
    });

    test('malformed ids are refused field by field with 422, and an unknown document is 404, never 500', async () => {
        const errors = await refused(
            await business.admin.post(path, {
                vendor_id: 'bukan-uuid',
                location_id: '1',
                posting_date: '10-11-2026',
                lines: [
                    {
                        item_id: 'x',
                        unit_id: '',
                        quantity: 'satu',
                        unit_cost: -1,
                        discount_percent: 101,
                        expiry_date: '2027-13-01',
                        funding_source_id: 'zz',
                        procurement_program_id: '..',
                        budget_year: 26,
                    },
                ],
            }),
        );
        expect(Object.keys(errors).sort()).toEqual([
            'lines.0.budget_year',
            'lines.0.discount_percent',
            'lines.0.expiry_date',
            'lines.0.funding_source_id',
            'lines.0.item_id',
            'lines.0.procurement_program_id',
            'lines.0.quantity',
            'lines.0.unit_cost',
            'lines.0.unit_id',
            'location_id',
            'posting_date',
            'vendor_id',
        ]);
        expect(
            Object.keys(
                await refused(
                    await business.admin.post(path, { lines: 'semua' }),
                ),
            ).sort(),
        ).toEqual(['lines', 'location_id', 'posting_date', 'vendor_id']);
        expect((await business.admin.get(`${path}/bukan-uuid`)).status).toBe(
            404,
        );
        expect(
            (
                await business.admin.post(`${path}/bukan-uuid/post`, {
                    version: 1,
                })
            ).status,
        ).toBe(404);
    });

    test('a funding source used by a receipt line cannot be deleted', async () => {
        const make = setup(business);
        const used = await make.code('funding-sources', 'HIBAH');
        await draft([{ ...plainLine(1), funding_source_id: used.id }]);
        const response = await business.admin.delete(
            `${inventoryApi}/funding-sources/${used.id}`,
            { version: 1 },
        );
        expect(Object.keys(await refused(response))).toEqual(['_form']);
    });

    test('reading, editing drafts, posting, and reversing are separate rights', async () => {
        const reader = await createMember(pool, business.tenantId, [
            'core.purchase-receipt.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            reader.membershipId,
        );
        const readerBrowser = browser();
        await readerBrowser.login(reader.email, reader.password);
        const document = await draft([plainLine(1)]);
        expect((await readerBrowser.get(path)).status).toBe(200);
        expect((await readerBrowser.get(`${path}/${document.id}`)).status).toBe(
            200,
        );
        expect(
            (
                await readerBrowser.post(path, {
                    vendor_id: vendor.id,
                    location_id: location.id,
                    posting_date: '2026-11-10',
                    lines: [],
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await readerBrowser.post(`${path}/${document.id}/post`, {
                    version: document.version,
                })
            ).status,
        ).toBe(403);
        expect(await ledger(document.id)).toEqual([]);
    });

    // Harga dasar barang (Harga_Jual sistem lama) per satuan dasar: posting menaikkannya ke harga beli per satuan
    // dasar sebelum diskon bila lebih tinggi, penerimaan yang lebih murah dan batal posting tidak menurunkannya, dan
    // pengguna boleh mengubahnya di kartu barang. Nilainya dibaca langsung dari gd_m_barang.
    test('posting raises the base price to the higher purchase price per base unit, never lowers it, and a manual edit holds', async () => {
        const make = setup(business);
        const item = await business.item<{
            id: string;
            code: string;
            name: string;
            base_price: string;
            version: number;
        }>('PCT-HD');
        await make.packaging(item.id, box.id, 100);
        const basePrice = async () =>
            (
                await pool.unsafe<{ price: string }[]>(
                    'select trim_scale(harga_dasar)::text as price from gd_m_barang where id = $1',
                    [item.id],
                )
            )[0]?.price;
        const line = (unitCost: number): Line => ({
            item_id: item.id,
            unit_id: box.id,
            quantity: 1,
            unit_cost: unitCost,
            discount_percent: 10,
        });
        expect(item.base_price).toBe('0');

        const first = await posted([line(12000)]);
        expect(await basePrice()).toBe('120');
        await posted([line(11000)]);
        expect(await basePrice()).toBe('120');
        await posted([line(12500), { ...line(13000), quantity: 2 }]);
        expect(await basePrice()).toBe('130');
        await json(await reverse(first), 200);
        expect(await basePrice()).toBe('130');

        const [current] = await pool.unsafe<{ version: number }[]>(
            'select version from gd_m_barang where id = $1',
            [item.id],
        );
        const edited = await json<{ data: { base_price: string } }>(
            await business.admin.patch(`${inventoryApi}/items/${item.id}`, {
                code: item.code,
                name: item.name,
                base_unit_id: business.uom.id,
                base_price: '99.5',
                version: current?.version,
            }),
            200,
        );
        expect(edited.data.base_price).toBe('99.5');
        expect(await basePrice()).toBe('99.5');
        await posted([line(10000)]);
        expect(await basePrice()).toBe('100');
    });

    test('a receipt dated in a closed inventory period is refused at posting and at reversal until the period is reopened', async () => {
        const early = (
            await json<{ data: Receipt }>(
                await post(
                    await draft([plainLine(4)], { posting_date: '2026-08-14' }),
                ),
                200,
            )
        ).data;
        const late = await draft([plainLine(2)], {
            posting_date: '2026-08-20',
        });
        const period = await business.closedPeriod('2026-08-31');
        expect((await refused(await post(late)))._form?.[0]).toContain(
            'Periode persediaan Agustus 2026 sudah ditutup, jadi stok bertanggal 20 Agustus 2026 tidak bisa diposting.',
        );
        expect(await ledger(late.id)).toEqual([]);
        expect((await refused(await reverse(early)))._form?.[0]).toContain(
            'posting bertanggal 14 Agustus 2026 tidak bisa dibatalkan.',
        );
        expect((await ledger(early.id)).map((row) => row.reversal)).toEqual([
            false,
        ]);
        expect((await business.reopenPeriod(period)).status).toBe(200);
        expect((await reverse(early)).status).toBe(200);
        expect((await ledger(early.id)).map((row) => row.reversal)).toEqual([
            false,
            true,
        ]);
    });
});
