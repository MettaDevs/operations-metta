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
type Count = {
    id: string;
    number: string;
    status: string;
    version: number;
    count_started_at: string | null;
    lines: {
        id: string;
        item: Reference;
        batch: { id: string; batch_number: string } | null;
        batch_number: string | null;
        unit: Reference;
        quantity_expected: string;
        quantity_counted: string | null;
        quantity_expected_at_posting: string | null;
        moved_after_count_started: boolean | null;
    }[];
};
type Position = {
    item: Reference & { base_unit_id: string };
    batch: { id: string; batch_number: string } | null;
    quantity: string;
};
type Line = Record<string, unknown>;

const path = `${inventoryApi}/stock-counts`;
const duties = [
    ...inventoryDuties,
    'core.vendor.manage',
    'core.purchase-receipt.manage',
    'core.inventory-count.manage',
];

// Opname sebagai Physical Inventory Order: Hitung baris dari stok per batch, selisih yang dihitung ulang saat posting,
// harga dan sumber dana stok temuan, posting sekali, batal posting, dan penolakan. Kartu gudang diperiksa dengan SQL
// langsung, bukan lewat API yang sedang diuji.
describe.skipIf(!process.env.DB_HOST)('stock counts', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let box: Reference;
    let tracked: { id: string };
    let apbd: Reference;
    let jkn: Reference;

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
            'Klinik Uji Opname',
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
        jkn = await created(business, `${inventoryApi}/funding-sources`, {
            code: 'JKN',
            name: 'Kapitasi JKN',
        });
    });

    // Obat bersatuan dasar tablet, wajib batch dan kedaluwarsa, dengan satuan kemasan kotak berisi 10.
    async function medicine(code: string, body: Line = {}) {
        const item = await business.item(code, {
            tracking_code_id: tracked.id,
            ...body,
        });
        await created(business, `${inventoryApi}/item-units`, {
            item_id: item.id,
            unit_id: box.id,
            quantity_per_unit: 10,
        });
        return item;
    }

    let vendor: string | undefined;
    // Stok masuk lewat penerimaan dari vendor, supaya harga, sumber dana, dan tahun anggaran ikut tercatat.
    async function received(
        locationId: string,
        lines: Line[],
        postingDate = '2026-11-01',
    ) {
        vendor ??= (
            await created(business, '/api/v1/purchasing/vendors', {
                name: 'PBF Uji Opname',
            })
        ).id;
        const draft = await created<{ id: string; version: number }>(
            business,
            '/api/v1/purchasing/receipts',
            {
                vendor_id: vendor,
                location_id: locationId,
                posting_date: postingDate,
                lines: lines.map((line) => ({
                    unit_id: business.uom.id,
                    unit_cost: 1000,
                    ...line,
                })),
            },
        );
        await json(
            await business.admin.post(
                `/api/v1/purchasing/receipts/${draft.id}/post`,
                { version: draft.version },
            ),
            200,
        );
    }

    const calculate = async (body: Line) =>
        (
            await json<{ data: Position[] }>(
                await business.admin.post(`${path}/calculate-lines`, {
                    posting_date: '2026-11-12',
                    ...body,
                }),
                200,
            )
        ).data;
    // Baris dari Hitung baris dalam satuan dasar, dengan jumlah dihitung yang diberikan per nomor batch.
    const linesFrom = (
        positions: Position[],
        counted: Record<string, number | null>,
    ) =>
        positions.map((position) => ({
            item_id: position.item.id,
            batch_id: position.batch?.id ?? null,
            unit_id: position.item.base_unit_id,
            quantity_counted:
                counted[position.batch?.batch_number ?? '-'] ?? null,
        }));
    const draft = async (
        locationId: string,
        lines: Line[],
        header: Line = {},
    ) =>
        created<Count>(business, path, {
            location_id: locationId,
            count_date: '2026-11-12',
            posting_date: '2026-11-12',
            ...header,
            lines,
        });
    const act = (count: Count, action: string, body: Line = {}) =>
        business.admin.post(`${path}/${count.id}/${action}`, {
            version: count.version,
            ...body,
        });
    const done = async (response: Response) =>
        (await json<{ data: Count }>(response, 200)).data;
    const post = (count: Count, postingDate = '2026-11-12') =>
        act(count, 'post', { posting_date: postingDate });
    const finished = async (
        locationId: string,
        lines: Line[],
        header: Line = {},
    ) => done(await act(await draft(locationId, lines, header), 'finish'));
    const posted = async (locationId: string, lines: Line[]) =>
        done(await post(await finished(locationId, lines)));

    async function ledger(countId: string) {
        const rows = await pool.unsafe<
            {
                kind: string;
                batch: string | null;
                expiry: string | null;
                quantity: string;
                unit_cost: string | null;
                amount: string;
                funding: string | null;
                year: number | null;
                reversal: boolean;
            }[]
        >(
            `select k.jenis as kind, t.no_batch as batch, k.kedaluwarsa::text as expiry,
                    trim_scale(k.jumlah)::text as quantity, trim_scale(k.harga_satuan)::text as unit_cost,
                    trim_scale(k.nilai)::text as amount, f.kode as funding, k.tahun_anggaran as year,
                    k.dibalik_dari is not null as reversal
             from gd_tr_kartu_gudang k
             left join gd_m_batch t on t.id = k.batch_id
             left join gd_m_sumber_dana f on f.id = k.sumber_dana_id
             where k.sumber_jenis = 'opname' and k.sumber_id = $1
             order by k.id`,
            [countId],
        );
        return [...rows];
    }

    test('Hitung baris lists the stock of the location per item and batch, narrowed by item, category, and stock', async () => {
        const store = await business.location('HB-GDG');
        const elsewhere = await business.location('HB-LAIN');
        const category = await created(
            business,
            `${inventoryApi}/item-categories`,
            { code: 'HB-ALKES', name: 'Alkes' },
        );
        const child = await created(
            business,
            `${inventoryApi}/item-categories`,
            {
                code: 'HB-ALKES-2',
                name: 'Alkes habis pakai',
                parent_id: category.id,
            },
        );
        const first = await medicine('HB-1');
        const second = await business.item('HB-2', { category_id: child.id });
        const empty = await business.item('HB-3', { category_id: category.id });
        await received(store.id, [
            {
                item_id: first.id,
                quantity: 50,
                batch_number: 'A-1',
                expiry_date: '2027-01-31',
            },
            {
                item_id: first.id,
                quantity: 20,
                batch_number: 'A-2',
                expiry_date: '2027-06-30',
            },
            { item_id: second.id, quantity: 5 },
        ]);
        await received(elsewhere.id, [{ item_id: empty.id, quantity: 9 }]);

        const byItem = await calculate({
            location_id: store.id,
            item_ids: [first.id],
        });
        expect(
            byItem.map((row) => [
                row.item.code,
                row.batch?.batch_number ?? null,
                row.quantity,
            ]),
        ).toEqual([
            ['HB-1', 'A-1', '50'],
            ['HB-1', 'A-2', '20'],
        ]);
        const byCategory = await calculate({
            location_id: store.id,
            category_id: category.id,
            only_in_stock: false,
        });
        expect(
            byCategory.map((row) => [
                row.item.code,
                row.batch?.batch_number ?? null,
                row.quantity,
            ]),
        ).toEqual([
            ['HB-2', null, '5'],
            ['HB-3', null, '0'],
        ]);
        expect(
            await calculate({
                location_id: store.id,
                category_id: category.id,
            }),
        ).toHaveLength(1);

        const count = await draft(store.id, linesFrom(byItem, {}));
        expect(count.number).toMatch(/^OPN-\d{8}$/);
        expect(count.count_started_at).not.toBeNull();
        expect(
            count.lines.map((line) => [
                line.batch?.batch_number,
                line.quantity_expected,
                line.quantity_counted,
            ]),
        ).toEqual([
            ['A-1', '50', null],
            ['A-2', '20', null],
        ]);
    });

    test('counting less posts a negative adjustment on that batch only, carrying its funding, and batal posting restores it', async () => {
        const store = await business.location('KURANG-GDG');
        const item = await medicine('KURANG-1');
        await received(store.id, [
            {
                item_id: item.id,
                quantity: 50,
                batch_number: 'K-1',
                expiry_date: '2027-01-31',
                funding_source_id: apbd.id,
                budget_year: 2026,
            },
            {
                item_id: item.id,
                quantity: 30,
                batch_number: 'K-2',
                expiry_date: '2027-06-30',
                unit_cost: 1200,
                funding_source_id: jkn.id,
                budget_year: 2025,
            },
        ]);
        const positions = await calculate({
            location_id: store.id,
            item_ids: [item.id],
        });
        // K-2 dihitung dalam kotak: 3 kotak = 30 tablet, sama dengan yang tercatat.
        const lines = linesFrom(positions, { 'K-1': 45 }).map((line) =>
            line.batch_id === positions[1]?.batch?.id
                ? { ...line, unit_id: box.id, quantity_counted: 3 }
                : line,
        );
        const count = await posted(store.id, lines);
        expect(count.status).toBe('diposting');
        expect(await ledger(count.id)).toEqual([
            {
                kind: 'penyesuaian_kurang',
                batch: 'K-1',
                expiry: '2027-01-31',
                quantity: '-5',
                unit_cost: null,
                amount: '-5000',
                funding: 'APBD',
                year: 2026,
                reversal: false,
            },
        ]);
        expect(await business.stock(item.id, store.id)).toEqual({
            'K-1': 45,
            'K-2': 30,
        });

        const reversed = await done(await act(count, 'reverse'));
        expect(reversed.status).toBe('dibatalkan');
        expect(await business.stock(item.id, store.id)).toEqual({
            'K-1': 50,
            'K-2': 30,
        });
        expect((await ledger(count.id)).at(-1)).toEqual({
            kind: 'penyesuaian_kurang',
            batch: 'K-1',
            expiry: '2027-01-31',
            quantity: '5',
            unit_cost: '1000',
            amount: '5000',
            funding: 'APBD',
            year: 2026,
            reversal: true,
        });
    });

    test('stock without a batch is corrected on its own, never taken from a batch that FEFO would pick first', async () => {
        const store = await business.location('TANPA-GDG');
        const item = await business.item('TANPA-1');
        await received(store.id, [
            {
                item_id: item.id,
                quantity: 10,
                batch_number: 'T-1',
                expiry_date: '2026-12-31',
            },
            { item_id: item.id, quantity: 10 },
        ]);
        const positions = await calculate({
            location_id: store.id,
            item_ids: [item.id],
        });
        const count = await posted(
            store.id,
            linesFrom(positions, { '-': 7, 'T-1': 10 }),
        );
        expect(
            (await ledger(count.id)).map((row) => [row.batch, row.quantity]),
        ).toEqual([[null, '-3']]);
        expect(await business.stock(item.id, store.id)).toEqual({
            '-': 7,
            'T-1': 10,
        });
    });

    test('an expired batch counted short is still written off, even where expired stock may not be issued', async () => {
        const strict = await business.trackingCode('KETAT', {
            batch_required: true,
            expiry_required: true,
            strict_expiry: true,
        });
        const store = await business.location('KDL-GDG');
        const item = await business.item('KDL-1', {
            tracking_code_id: strict.id,
        });
        await received(store.id, [
            {
                item_id: item.id,
                quantity: 10,
                batch_number: 'X-1',
                expiry_date: '2026-11-05',
            },
        ]);
        const positions = await calculate({
            location_id: store.id,
            item_ids: [item.id],
        });
        const count = await posted(
            store.id,
            linesFrom(positions, { 'X-1': 0 }),
        );
        expect(
            (await ledger(count.id)).map((row) => [row.batch, row.quantity]),
        ).toEqual([['X-1', '-10']]);
        expect(await business.stock(item.id, store.id)).toEqual({});
    });

    test('counting more posts a positive adjustment priced and funded by the latest receipt of that batch here, then of the item, then at zero', async () => {
        const store = await business.location('LEBIH-FAR');
        const warehouse = await business.location('LEBIH-GDG');
        const item = await medicine('LEBIH-1');
        await received(
            store.id,
            [
                {
                    item_id: item.id,
                    quantity: 50,
                    batch_number: 'L-1',
                    expiry_date: '2027-01-31',
                    unit_cost: 1000,
                    funding_source_id: apbd.id,
                    budget_year: 2026,
                },
            ],
            '2026-11-01',
        );
        // Penerimaan barang yang sama sesudahnya di lokasi lain tidak mengubah harga batch L-1 di lokasi ini.
        await received(
            warehouse.id,
            [
                {
                    item_id: item.id,
                    quantity: 5,
                    batch_number: 'L-9',
                    expiry_date: '2027-09-30',
                    unit_cost: 3000,
                    funding_source_id: jkn.id,
                    budget_year: 2025,
                },
            ],
            '2026-11-03',
        );
        const never = await business.item('LEBIH-2');
        const positions = await calculate({
            location_id: store.id,
            item_ids: [item.id],
        });
        const count = await posted(store.id, [
            ...linesFrom(positions, { 'L-1': 55 }),
            {
                item_id: item.id,
                batch_number: 'l-baru',
                expiry_date: '2027-12-31',
                unit_id: box.id,
                quantity_counted: 1,
            },
            {
                item_id: never.id,
                unit_id: business.uom.id,
                quantity_counted: 2,
            },
        ]);
        expect(await ledger(count.id)).toEqual([
            {
                kind: 'penyesuaian_tambah',
                batch: 'L-1',
                expiry: '2027-01-31',
                quantity: '5',
                unit_cost: '1000',
                amount: '5000',
                funding: 'APBD',
                year: 2026,
                reversal: false,
            },
            {
                kind: 'penyesuaian_tambah',
                batch: 'L-BARU',
                expiry: '2027-12-31',
                quantity: '10',
                unit_cost: '3000',
                amount: '30000',
                funding: 'JKN',
                year: 2025,
                reversal: false,
            },
            {
                kind: 'penyesuaian_tambah',
                batch: null,
                expiry: null,
                quantity: '2',
                unit_cost: '0',
                amount: '0',
                funding: null,
                year: null,
                reversal: false,
            },
        ]);
        expect(await business.stock(item.id, store.id)).toEqual({
            'L-1': 55,
            'L-BARU': 10,
        });
    });

    test('a movement after counting started is included in the recalculated difference, and the line is flagged', async () => {
        const store = await business.location('GERAK-FAR');
        const item = await medicine('GERAK-1');
        const still = await medicine('GERAK-2');
        await received(store.id, [
            {
                item_id: item.id,
                quantity: 50,
                batch_number: 'G-1',
                expiry_date: '2027-01-31',
            },
            {
                item_id: still.id,
                quantity: 8,
                batch_number: 'G-2',
                expiry_date: '2027-01-31',
            },
        ]);
        const positions = await calculate({
            location_id: store.id,
            item_ids: [item.id, still.id],
        });
        const count = await finished(
            store.id,
            linesFrom(positions, { 'G-1': 50, 'G-2': 8 }),
        );
        const [moving, resting] = count.lines;
        if (!moving || !resting) throw new Error('No lines.');
        // Kartu gudang mencatat waktu per detik, jadi gerak sesudah hitung dimulai harus jatuh di detik berikutnya.
        await Bun.sleep(1100);
        await business.posted('keluar', store.id, [
            {
                item_id: item.id,
                quantity: 10,
                batch_id: positions[0]?.batch?.id ?? null,
            },
        ]);
        const preview = await json<{
            data: {
                lines: {
                    id: string;
                    quantity_expected: string;
                    quantity_counted: string;
                    difference: string;
                    unit_cost: string | null;
                    moved_after_count_started: boolean;
                }[];
            };
        }>(
            await business.admin.get(
                `${path}/${count.id}/posting-preview?posting_date=2026-11-12`,
            ),
            200,
        );
        expect(preview.data.lines).toEqual([
            {
                id: moving.id,
                quantity_expected: '40',
                quantity_counted: '50',
                difference: '10',
                unit_cost: '1000',
                moved_after_count_started: true,
            },
            {
                id: resting.id,
                quantity_expected: '8',
                quantity_counted: '8',
                difference: '0',
                unit_cost: null,
                moved_after_count_started: false,
            },
        ]);
        const result = await done(await post(count));
        expect(
            result.lines.map((line) => [
                line.quantity_expected,
                line.quantity_expected_at_posting,
                line.moved_after_count_started,
            ]),
        ).toEqual([
            ['50', '40', true],
            ['8', '8', false],
        ]);
        expect(
            (await ledger(count.id)).map((row) => [row.batch, row.quantity]),
        ).toEqual([['G-1', '10']]);
    });

    test('simultaneous and repeated postings of one count write once', async () => {
        const store = await business.location('SERENTAK-FAR');
        const item = await medicine('SERENTAK-1');
        await received(store.id, [
            {
                item_id: item.id,
                quantity: 40,
                batch_number: 'S-1',
                expiry_date: '2027-01-31',
            },
        ]);
        const positions = await calculate({
            location_id: store.id,
            item_ids: [item.id],
        });
        const count = await finished(
            store.id,
            linesFrom(positions, { 'S-1': 36 }),
        );
        const responses = await Promise.all(
            Array.from({ length: 6 }, () => post(count)),
        );
        expect(responses.map((response) => response.status)).toEqual([
            200, 200, 200, 200, 200, 200,
        ]);
        expect((await post(count)).status).toBe(200);
        expect(await ledger(count.id)).toHaveLength(1);
        expect(await business.stock(item.id, store.id)).toEqual({ 'S-1': 36 });
    });

    test('a found tracked item needs its batch before counting is finished, and an uncounted line blocks finishing', async () => {
        const store = await business.location('BATCH-FAR');
        const item = await medicine('BATCH-1');
        const count = await draft(store.id, [
            { item_id: item.id, unit_id: business.uom.id, quantity_counted: 3 },
            { item_id: item.id, unit_id: business.uom.id, batch_number: 'B-1' },
        ]);
        const errors = await refused(await act(count, 'finish'));
        expect(Object.keys(errors).sort()).toEqual([
            'lines.0.batch_number',
            'lines.1.expiry_date',
            'lines.1.quantity_counted',
        ]);
        const [row] = await pool.unsafe<{ status: string }[]>(
            'select status from gd_tr_opname where id = $1',
            [count.id],
        );
        expect(row?.status).toBe('draf');

        const nothing = await finished(store.id, [
            { item_id: item.id, unit_id: business.uom.id, quantity_counted: 0 },
        ]);
        expect(nothing.status).toBe('dihitung');
        const reopened = await done(await act(nothing, 'reopen'));
        expect(reopened.status).toBe('draf');
        const cancelled = await done(await act(reopened, 'cancel'));
        expect(cancelled.status).toBe('dibatalkan');
        expect((await refused(await post(cancelled)))._form?.[0]).toContain(
            'dibatalkan',
        );
    });

    test('a transit location cannot be counted', async () => {
        const transit = await business.location('OPN-TRANSIT', {
            is_transit: true,
        });
        expect(
            Object.keys(
                await refused(
                    await business.admin.post(path, {
                        location_id: transit.id,
                        count_date: '2026-11-12',
                        posting_date: '2026-11-12',
                        lines: [],
                    }),
                ),
            ),
        ).toEqual(['location_id']);
        expect(
            Object.keys(
                await refused(
                    await business.admin.post(`${path}/calculate-lines`, {
                        location_id: transit.id,
                        posting_date: '2026-11-12',
                    }),
                ),
            ),
        ).toEqual(['location_id']);
    });

    test('batal posting is refused once the stock it brought in has been used', async () => {
        const store = await business.location('PAKAI-FAR');
        const item = await medicine('PAKAI-1');
        const count = await posted(store.id, [
            {
                item_id: item.id,
                batch_number: 'P-1',
                expiry_date: '2027-03-31',
                unit_id: business.uom.id,
                quantity_counted: 6,
            },
        ]);
        const [batch] = await pool.unsafe<{ id: string }[]>(
            `select id from gd_m_batch where barang_id = $1 and no_batch = 'P-1'`,
            [item.id],
        );
        await business.posted('keluar', store.id, [
            { item_id: item.id, quantity: 2, batch_id: batch?.id ?? null },
        ]);
        const errors = await refused(await act(count, 'reverse'));
        expect(errors._form?.[0]).toContain('sudah dipakai');
        expect(await ledger(count.id)).toHaveLength(1);
        const [row] = await pool.unsafe<{ status: string }[]>(
            'select status from gd_tr_opname where id = $1',
            [count.id],
        );
        expect(row?.status).toBe('diposting');
    });

    test('locations, items, and batches of another legal entity are refused, malformed ids are refused field by field, and unknown counts are 404', async () => {
        const other = await createBusiness(
            pool,
            browser,
            'Klinik Uji Opname Lintas',
            duties,
        );
        const foreign = {
            location: await other.location('GUDANG'),
            item: await other.item('LINTAS-1'),
        };
        await other.posted('masuk', foreign.location.id, [
            {
                item_id: foreign.item.id,
                quantity: 3,
                unit_cost: 100,
                batch_number: 'F-1',
            },
        ]);
        const [foreignBatch] = await pool.unsafe<{ id: string }[]>(
            `select id from gd_m_batch where barang_id = $1`,
            [foreign.item.id],
        );
        const store = await business.location('LINTAS-FAR');
        const mine = await business.item('LINTAS-2');
        const errors = await refused(
            await business.admin.post(path, {
                location_id: foreign.location.id,
                count_date: '2026-11-12',
                posting_date: '2026-11-12',
                lines: [
                    {
                        item_id: foreign.item.id,
                        unit_id: other.uom.id,
                        quantity_counted: 1,
                    },
                    {
                        item_id: mine.id,
                        batch_id: foreignBatch?.id,
                        unit_id: business.uom.id,
                        quantity_counted: 1,
                    },
                ],
            }),
        );
        expect(Object.keys(errors).sort()).toEqual([
            'lines.0.item_id',
            'lines.0.unit_id',
            'lines.1.batch_id',
            'location_id',
        ]);
        expect(
            Object.keys(
                await refused(
                    await business.admin.post(`${path}/calculate-lines`, {
                        location_id: store.id,
                        posting_date: '2026-11-12',
                        item_ids: [foreign.item.id],
                    }),
                ),
            ),
        ).toEqual(['item_ids.0']);
        const [count] = await pool.unsafe<{ counts: number }[]>(
            'select count(*)::int as counts from gd_tr_opname where tenant_id = $1',
            [business.tenantId],
        );
        const before = count?.counts;
        const malformed = await refused(
            await business.admin.post(path, {
                location_id: 'bukan-uuid',
                count_date: '12-11-2026',
                posting_date: '2026-13-01',
                lines: [
                    {
                        item_id: 'x',
                        batch_id: 'y',
                        unit_id: '',
                        quantity_counted: 'banyak',
                    },
                ],
            }),
        );
        expect(Object.keys(malformed).sort()).toEqual([
            'count_date',
            'lines.0.batch_id',
            'lines.0.item_id',
            'lines.0.quantity_counted',
            'lines.0.unit_id',
            'location_id',
            'posting_date',
        ]);
        const [after] = await pool.unsafe<{ counts: number }[]>(
            'select count(*)::int as counts from gd_tr_opname where tenant_id = $1',
            [business.tenantId],
        );
        expect(after?.counts).toBe(before);
        expect((await business.admin.get(`${path}/bukan-uuid`)).status).toBe(
            404,
        );
        expect(
            (await business.admin.get(`${path}/${Bun.randomUUIDv7()}`)).status,
        ).toBe(404);
        expect(
            (
                await business.admin.post(
                    `${path}/${Bun.randomUUIDv7()}/post`,
                    {
                        version: 1,
                        posting_date: '2026-11-12',
                    },
                )
            ).status,
        ).toBe(404);
        expect(
            (
                await business.admin.post(`${path}/bukan-uuid/reverse`, {
                    version: 1,
                })
            ).status,
        ).toBe(404);
    });

    test('counting and posting are separate rights', async () => {
        const store = await business.location('HAK-FAR');
        const item = await business.item('HAK-1');
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
        const counter = await member('core.inventory-count.count');
        const reader = await member('core.inventory-count.inquire');
        const body = {
            location_id: store.id,
            count_date: '2026-11-12',
            posting_date: '2026-11-12',
            lines: [
                {
                    item_id: item.id,
                    unit_id: business.uom.id,
                    quantity_counted: 1,
                },
            ],
        };
        expect((await reader.post(path, body)).status).toBe(403);
        const count = (
            await json<{ data: Count }>(await counter.post(path, body), 201)
        ).data;
        const ready = (
            await json<{ data: Count }>(
                await counter.post(`${path}/${count.id}/finish`, {
                    version: count.version,
                }),
                200,
            )
        ).data;
        expect((await reader.get(`${path}/${ready.id}`)).status).toBe(200);
        expect(
            (
                await counter.post(`${path}/${ready.id}/post`, {
                    version: ready.version,
                    posting_date: '2026-11-12',
                })
            ).status,
        ).toBe(403);
        expect(await ledger(ready.id)).toHaveLength(0);
    });
});
