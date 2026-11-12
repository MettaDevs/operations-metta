import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    postItemLines,
    type ItemLine,
} from '../../../../src/foundation/inventory/index.ts';
import {
    Database,
    sqlErrorCode,
} from '../../../../src/platform/database/index.ts';
import { HttpFailure } from '../../../../src/platform/http/index.ts';
import {
    createBusiness,
    inventoryApi,
    json,
    refused,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';

type Batch = { id: string; batch_number: string; expiry_date: string | null };

// Mesin posting stok lewat dokumen penyesuaian dan lewat pemanggil langsung (transfer belum punya dokumen): urutan
// pengambilan menurut setelan, penolakan profil pelacakan, stok minus, transfer, pembatalan posting, dan kunci
// idempoten. Stok diperiksa dengan SQL langsung ke kartu gudang, bukan lewat API yang sedang diuji.
describe.skipIf(!process.env.DB_HOST)('item ledger posting', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let business: Business;
    let tracked: { id: string };
    afterAll(close);

    beforeAll(async () => {
        business = await createBusiness(pool, browser, 'Klinik Uji Stok');
        tracked = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
    });

    const receipt = (
        itemId: string,
        quantity: number,
        batch: string | null,
        expiry: string | null,
        unitCost = 1000,
    ) => ({
        item_id: itemId,
        quantity,
        batch_number: batch,
        expiry_date: expiry,
        unit_cost: unitCost,
    });

    async function batches(target: Business, itemId: string) {
        const found = (
            await json<{ data: Batch[] }>(
                await target.admin.get(
                    `${inventoryApi}/items/${itemId}/batches`,
                ),
                200,
            )
        ).data;
        return (number: string) => {
            const batch = found.find((entry) => entry.batch_number === number);
            if (!batch) throw new Error(`Batch ${number} was not recorded.`);
            return batch.id;
        };
    }

    async function postDirect(
        target: Business,
        lines: ItemLine[],
        postingDate = '2026-11-01',
    ) {
        const connection = await pool.reserve();
        try {
            const db = new Database(connection, undefined, 'uji');
            await db.transaction(() =>
                postItemLines(
                    db,
                    {
                        tenantId: target.tenantId,
                        legalEntityId: target.legalEntityId,
                        userId: null,
                        postingDate,
                        source: {
                            type: 'uji',
                            id: Bun.randomUUIDv7(),
                            number: null,
                        },
                    },
                    lines,
                ),
            );
        } finally {
            connection.release();
        }
    }

    async function refusedDirect(work: Promise<unknown>) {
        try {
            await work;
        } catch (error) {
            if (error instanceof HttpFailure && 'errors' in error.body)
                return error.body.errors as Record<string, string[]>;
            throw error;
        }
        throw new Error('Expected a refusal.');
    }

    test('FEFO takes the batch that expires first, whatever was received first', async () => {
        const location = await business.location('FEFO');
        const item = await business.item('FEFO-1', {
            tracking_code_id: tracked.id,
        });
        await business.posted('masuk', location.id, [
            receipt(item.id, 5, 'late', '2027-12-31'),
            receipt(item.id, 5, 'soon', '2027-03-31'),
        ]);
        await business.posted('keluar', location.id, [
            { item_id: item.id, quantity: 3 },
        ]);
        expect(await business.stock(item.id, location.id)).toEqual({
            LATE: 5,
            SOON: 2,
        });
    });

    // Penerimaan pertama membawa kedaluwarsa terjauh, jadi FIFO dan FEFO memilih batch yang berbeda.
    async function earliestFirst(locationId: string, code: string) {
        const item = await business.item(code, {
            tracking_code_id: tracked.id,
        });
        await business.posted(
            'masuk',
            locationId,
            [receipt(item.id, 5, 'first', '2027-12-31')],
            '2026-10-01',
        );
        await business.posted(
            'masuk',
            locationId,
            [receipt(item.id, 5, 'second', '2027-02-28')],
            '2026-10-05',
        );
        const issued = await business.adjust(
            'keluar',
            locationId,
            [{ item_id: item.id, quantity: 3 }],
            '2026-10-10',
        );
        expect(issued.status).toBe(200);
        return business.stock(item.id, locationId);
    }

    test('FIFO takes the earliest receipt when the operating unit overrides the legal entity', async () => {
        const unitId = await business.operatingUnit('Pustu FIFO');
        const override = await business.admin.put(
            `${inventoryApi}/setup/operating-units/${unitId}`,
            { picking_method: 'fifo', version: null },
        );
        expect(override.status).toBe(200);
        const location = await business.location('UNIT-FIFO', {
            operating_unit_id: unitId,
        });
        expect(await earliestFirst(location.id, 'FIFO-UNIT')).toEqual({
            FIRST: 2,
            SECOND: 5,
        });
    });

    test('FIFO takes the earliest receipt when the location overrides its operating unit', async () => {
        const unitId = await business.operatingUnit('Pustu Manual');
        const override = await business.admin.put(
            `${inventoryApi}/setup/operating-units/${unitId}`,
            { picking_method: 'manual', version: null },
        );
        expect(override.status).toBe(200);
        const location = await business.location('LOC-FIFO', {
            operating_unit_id: unitId,
            picking_method: 'fifo',
        });
        expect(await earliestFirst(location.id, 'FIFO-LOC')).toEqual({
            FIRST: 2,
            SECOND: 5,
        });
    });

    test('manual picking takes only the chosen batch', async () => {
        const location = await business.location('MANUAL', {
            picking_method: 'manual',
        });
        const item = await business.item('MANUAL-1', {
            tracking_code_id: tracked.id,
        });
        await business.posted('masuk', location.id, [
            receipt(item.id, 4, 'm1', '2027-01-31'),
            receipt(item.id, 4, 'm2', '2027-09-30'),
        ]);
        const batch = await batches(business, item.id);
        expect(
            Object.keys(
                await refused(
                    await business.adjust('keluar', location.id, [
                        { item_id: item.id, quantity: 1 },
                    ]),
                ),
            ),
        ).toEqual(['lines.0.batch_id']);
        await business.posted('keluar', location.id, [
            { item_id: item.id, quantity: 3, batch_id: batch('M2') },
        ]);
        expect(await business.stock(item.id, location.id)).toEqual({
            M1: 4,
            M2: 1,
        });
        expect(
            Object.keys(
                await refused(
                    await business.adjust('keluar', location.id, [
                        {
                            item_id: item.id,
                            quantity: 2,
                            batch_id: batch('M2'),
                        },
                    ]),
                ),
            ),
        ).toEqual(['lines.0.quantity']);
        expect(await business.stock(item.id, location.id)).toEqual({
            M1: 4,
            M2: 1,
        });
    });

    test('a strict expiry profile refuses an expired lot, chosen or picked', async () => {
        const strict = await business.trackingCode('KETAT', {
            batch_required: true,
            expiry_required: true,
            strict_expiry: true,
        });
        const location = await business.location('KETAT');
        const item = await business.item('KETAT-1', {
            tracking_code_id: strict.id,
        });
        await business.posted(
            'masuk',
            location.id,
            [receipt(item.id, 4, 'old', '2026-09-30')],
            '2026-10-01',
        );
        const batch = await batches(business, item.id);
        expect(
            Object.keys(
                await refused(
                    await business.adjust(
                        'keluar',
                        location.id,
                        [
                            {
                                item_id: item.id,
                                quantity: 1,
                                batch_id: batch('OLD'),
                            },
                        ],
                        '2026-10-02',
                    ),
                ),
            ),
        ).toEqual(['lines.0.batch_id']);
        expect(
            Object.keys(
                await refused(
                    await business.adjust(
                        'keluar',
                        location.id,
                        [{ item_id: item.id, quantity: 1 }],
                        '2026-10-02',
                    ),
                ),
            ),
        ).toEqual(['lines.0.quantity']);
        await business.posted(
            'masuk',
            location.id,
            [receipt(item.id, 2, 'new', '2027-01-31')],
            '2026-10-02',
        );
        await business.posted(
            'keluar',
            location.id,
            [{ item_id: item.id, quantity: 2 }],
            '2026-10-03',
        );
        expect(await business.stock(item.id, location.id)).toEqual({ OLD: 4 });
    });

    test('a tracked item refuses a receipt without its batch or expiry date, and an untracked one accepts it', async () => {
        const location = await business.location('LACAK');
        const item = await business.item('LACAK-1', {
            tracking_code_id: tracked.id,
        });
        expect(
            Object.keys(
                await refused(
                    await business.adjust('masuk', location.id, [
                        receipt(item.id, 1, null, null),
                    ]),
                ),
            ).sort(),
        ).toEqual(['lines.0.batch_number', 'lines.0.expiry_date']);
        expect(
            Object.keys(
                await refused(
                    await business.adjust('masuk', location.id, [
                        receipt(item.id, 1, 'b1', null),
                    ]),
                ),
            ),
        ).toEqual(['lines.0.expiry_date']);
        const plain = await business.item('POLOS-1');
        await business.posted('masuk', location.id, [
            receipt(plain.id, 7, null, null),
        ]);
        expect(await business.stock(plain.id, location.id)).toEqual({ '-': 7 });
        expect(await business.stock(item.id, location.id)).toEqual({});
    });

    test('a batch keeps the expiry date it was first received with', async () => {
        const location = await business.location('SAMA');
        const item = await business.item('SAMA-1', {
            tracking_code_id: tracked.id,
        });
        await business.posted('masuk', location.id, [
            receipt(item.id, 3, 'x1', '2027-01-31'),
        ]);
        const mismatch = await refused(
            await business.adjust('masuk', location.id, [
                receipt(item.id, 3, 'x1', '2027-02-28'),
            ]),
        );
        expect(Object.keys(mismatch)).toEqual(['lines.0.expiry_date']);
        expect(mismatch['lines.0.expiry_date']?.[0]).toContain('2027-01-31');
        await business.posted('masuk', location.id, [
            receipt(item.id, 2, 'x1', null),
        ]);
        expect(await business.stock(item.id, location.id)).toEqual({ X1: 5 });
        const [stored] = await pool.unsafe<{ expiry: string }[]>(
            `select distinct kedaluwarsa::text as expiry from gd_tr_kartu_gudang
             where tenant_id = $1 and barang_id = $2`,
            [business.tenantId, item.id],
        );
        expect(stored?.expiry).toBe('2027-01-31');
    });

    test('negative stock, when the item allows it, stays open until the next receipt settles it', async () => {
        const location = await business.location('MINUS');
        const item = await business.item('MINUS-1', {
            refuse_negative_stock: false,
        });
        const issued = await business.posted('keluar', location.id, [
            { item_id: item.id, quantity: 5 },
        ]);
        expect(await business.stock(item.id, location.id)).toEqual({ '-': -5 });
        await business.posted('masuk', location.id, [
            receipt(item.id, 8, null, null, 2500),
        ]);
        expect(await business.stock(item.id, location.id)).toEqual({ '-': 3 });
        const [settled] = await pool.unsafe<
            { open: string; applied: string }[]
        >(
            `select trim_scale(k.sisa)::text as open,
                    (select trim_scale(sum(a.jumlah))::text from gd_tr_kartu_gudang_aplikasi a
                     where a.entri_keluar_id = k.id) as applied
             from gd_tr_kartu_gudang k
             where k.tenant_id = $1 and k.sumber_id = $2`,
            [business.tenantId, issued.id],
        );
        expect(settled).toEqual({ open: '0', applied: '5' });
        const other = await business.item('MINUS-2');
        expect(
            Object.keys(
                await refused(
                    await business.adjust('keluar', location.id, [
                        { item_id: other.id, quantity: 1 },
                    ]),
                ),
            ),
        ).toEqual(['lines.0.quantity']);
    });

    test('a transfer refuses negative stock even when the legal entity allows it, and carries batch, expiry, and cost', async () => {
        const lenient = await createBusiness(
            pool,
            browser,
            'Klinik Uji Mutasi',
        );
        const setup = await json<{ data: { version: number } }>(
            await lenient.admin.get(`${inventoryApi}/setup`),
            200,
        );
        expect(
            (
                await lenient.admin.put(`${inventoryApi}/setup`, {
                    picking_method: 'fefo',
                    refuse_negative_stock: false,
                    transfer_mode: 'langsung',
                    version: setup.data.version,
                })
            ).status,
        ).toBe(200);
        const profile = await lenient.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
        });
        const source = await lenient.location('GUDANG');
        const target = await lenient.location('APOTEK');
        const item = await lenient.item('MUTASI-1', {
            tracking_code_id: profile.id,
        });
        await lenient.posted('masuk', source.id, [
            receipt(item.id, 4, 't1', '2027-05-31', 1500),
            receipt(item.id, 6, 't2', '2027-08-31', 2000.5),
        ]);
        const transfer = (quantity: bigint): ItemLine => ({
            kind: 'transfer',
            key: `uji-transfer:${Bun.randomUUIDv7()}`,
            field: 'lines.0',
            sourceLineId: null,
            itemId: item.id,
            quantity,
            fromLocationId: source.id,
            toLocationId: target.id,
            batchId: null,
        });
        expect(
            Object.keys(
                await refusedDirect(postDirect(lenient, [transfer(110000n)])),
            ),
        ).toEqual(['lines.0.quantity']);
        expect(await lenient.stock(item.id, target.id)).toEqual({});

        await postDirect(lenient, [transfer(60000n)]);
        expect(await lenient.stock(item.id, source.id)).toEqual({ T2: 4 });
        expect(await lenient.stock(item.id, target.id)).toEqual({
            T1: 4,
            T2: 2,
        });
        const arrived = await pool.unsafe<
            {
                batch: string;
                expiry: string;
                unit_cost: string;
                quantity: string;
            }[]
        >(
            `select t.no_batch as batch, k.kedaluwarsa::text as expiry, trim_scale(k.harga_satuan)::text as unit_cost,
                    trim_scale(k.jumlah)::text as quantity
             from gd_tr_kartu_gudang k join gd_m_batch t on t.id = k.batch_id
             where k.tenant_id = $1 and k.lokasi_id = $2 and k.jenis = 'transfer'
             order by t.no_batch`,
            [lenient.tenantId, target.id],
        );
        expect([...arrived]).toEqual([
            {
                batch: 'T1',
                expiry: '2027-05-31',
                unit_cost: '1500',
                quantity: '4',
            },
            {
                batch: 'T2',
                expiry: '2027-08-31',
                unit_cost: '2000.5',
                quantity: '2',
            },
        ]);
        const [value] = await pool.unsafe<{ value: string }[]>(
            `select trim_scale(sum(nilai))::text as value from gd_tr_kartu_gudang
             where tenant_id = $1 and lokasi_id = $2 and jenis = 'transfer'`,
            [lenient.tenantId, source.id],
        );
        expect(value?.value).toBe('-10001');
    }, 30_000);

    test('reversing an untouched receipt closes it, a touched receipt stays posted, and reversing an issue re-opens its stock', async () => {
        const location = await business.location('BALIK');
        const item = await business.item('BALIK-1', {
            tracking_code_id: tracked.id,
        });
        const untouched = await business.posted('masuk', location.id, [
            receipt(item.id, 4, 'u1', '2027-04-30'),
        ]);
        const undone = await json<{ data: { status: string } }>(
            await business.reverse(untouched),
            200,
        );
        expect(undone.data.status).toBe('dibatalkan');
        expect(await business.stock(item.id, location.id)).toEqual({});
        const [pointer] = await pool.unsafe<{ reversed: string }[]>(
            `select count(*)::text as reversed from gd_tr_kartu_gudang r
             join gd_tr_kartu_gudang o on o.id = r.dibalik_dari
             where r.tenant_id = $1 and o.sumber_id = $2 and r.jumlah = -o.jumlah`,
            [business.tenantId, untouched.id],
        );
        expect(pointer?.reversed).toBe('1');

        const received = await business.posted('masuk', location.id, [
            receipt(item.id, 5, 'r1', '2027-06-30', 1200),
        ]);
        const issued = await business.posted('keluar', location.id, [
            { item_id: item.id, quantity: 2 },
        ]);
        expect(
            Object.keys(await refused(await business.reverse(received))),
        ).toEqual(['_form']);
        expect(await business.stock(item.id, location.id)).toEqual({ R1: 3 });

        await json(await business.reverse(issued), 200);
        expect(await business.stock(item.id, location.id)).toEqual({ R1: 5 });
        const reopened = await pool.unsafe<
            { expiry: string; unit_cost: string; open: string }[]
        >(
            `select kedaluwarsa::text as expiry, trim_scale(harga_satuan)::text as unit_cost,
                    trim_scale(sisa)::text as open
             from gd_tr_kartu_gudang
             where tenant_id = $1 and sumber_id = $2 and dibalik_dari is not null`,
            [business.tenantId, issued.id],
        );
        expect([...reopened]).toEqual([
            { expiry: '2027-06-30', unit_cost: '1200', open: '2' },
        ]);
    });

    test('the idempotency key refuses a second posting of the same source line', async () => {
        const location = await business.location('KUNCI');
        const item = await business.item('KUNCI-1');
        const line: ItemLine = {
            kind: 'inbound',
            key: `uji:${Bun.randomUUIDv7()}`,
            field: 'lines.0',
            sourceLineId: null,
            entryKind: 'penyesuaian_tambah',
            itemId: item.id,
            locationId: location.id,
            quantity: 30000n,
            unitCost: 10000000n,
            batchNumber: null,
            expiry: null,
        };
        await postDirect(business, [line]);
        let code: string | undefined;
        try {
            await postDirect(business, [line]);
        } catch (error) {
            code = sqlErrorCode(error);
        }
        expect(code).toBe('23505');
        expect(await business.stock(item.id, location.id)).toEqual({ '-': 3 });
    });

    test('a transfer that applies to given entries takes only those, even when the picking order would take others first', async () => {
        const warehouse = await business.location('APPLY-G');
        const transit = await business.location('APPLY-T', {
            is_transit: true,
            picking_method: 'manual',
        });
        const target = await business.location('APPLY-D');
        const item = await business.item('APPLY-1', {
            tracking_code_id: tracked.id,
        });
        await business.posted(
            'masuk',
            warehouse.id,
            [receipt(item.id, 9, 'same', '2027-06-30')],
            '2026-10-01',
        );
        const tag = Bun.randomUUIDv7();
        const move = (
            name: string,
            from: string,
            to: string,
            quantity: bigint,
            appliesTo?: string[],
        ): ItemLine => ({
            kind: 'transfer',
            key: `${name}:${tag}`,
            field: 'lines.0',
            sourceLineId: null,
            itemId: item.id,
            quantity,
            fromLocationId: from,
            toLocationId: to,
            batchId: null,
            ...(appliesTo ? { appliesTo } : {}),
        });
        await postDirect(
            business,
            [move('apply-b', warehouse.id, transit.id, 50000n)],
            '2026-11-01',
        );
        await postDirect(
            business,
            [move('apply-a', warehouse.id, transit.id, 40000n)],
            '2026-11-02',
        );
        const entriesOf = async (name: string) =>
            (
                await pool.unsafe<{ id: string }[]>(
                    `select id from gd_tr_kartu_gudang
                     where tenant_id = $1 and lokasi_id = $2 and jumlah > 0 and kunci_idempoten like $3`,
                    [business.tenantId, transit.id, `${name}:${tag}:%`],
                )
            ).map((row) => row.id);
        const inTransit = async () => [
            ...(await pool.unsafe<{ source: string; open: string }[]>(
                `select split_part(kunci_idempoten, ':', 1) as source, trim_scale(sisa)::text as open
                     from gd_tr_kartu_gudang
                     where tenant_id = $1 and lokasi_id = $2 and jumlah > 0
                     order by kunci_idempoten`,
                [business.tenantId, transit.id],
            )),
        ];
        const applied = await entriesOf('apply-a');

        expect(
            Object.keys(
                await refusedDirect(
                    postDirect(
                        business,
                        [
                            move(
                                'apply-over',
                                transit.id,
                                target.id,
                                50000n,
                                applied,
                            ),
                        ],
                        '2026-11-03',
                    ),
                ),
            ),
        ).toEqual(['lines.0.quantity']);
        await postDirect(
            business,
            [move('apply-take', transit.id, target.id, 30000n, applied)],
            '2026-11-03',
        );
        expect(await inTransit()).toEqual([
            { source: 'apply-a', open: '1' },
            { source: 'apply-b', open: '5' },
        ]);
        expect(await business.stock(item.id, target.id)).toEqual({ SAME: 3 });
    });
});
