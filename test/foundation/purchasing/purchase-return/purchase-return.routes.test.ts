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

type Reference = { id: string; code: string; name: string };
type Receipt = {
    id: string;
    number: string;
    version: number;
    lines: { id: string }[];
};
type ReturnView = {
    data: {
        receipt_status: string;
        returnable: {
            receipt_line_id: string;
            received: string;
            returned: string;
            returnable: string;
        }[];
        returns: {
            id: string;
            number: string;
            status: string;
            version: number;
        }[];
    };
    permissions: { create: boolean; reverse: boolean };
};

const receipts = '/api/v1/purchasing/receipts';
const duties = [
    ...inventoryDuties,
    'core.vendor.manage',
    'core.purchase-receipt.manage',
];

// Retur ke vendor atas penerimaan yang sudah diposting: stok keluar tepat dari baris kartu gudang penerimaan itu dengan
// harga dan batchnya, tidak pernah melebihi yang masih ada di lokasi, bisa dibatalkan dan diulang, dan penerimaan yang
// sudah diretur tidak bisa dibatalkan postingnya. Kartu gudang diperiksa dengan SQL langsung.
describe.skipIf(!process.env.DB_HOST)('purchase returns', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let business: Business;
    let medicine: { id: string };
    let box: Reference;
    let vendor: { id: string };

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Retur Vendor',
            duties,
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
        const tracked = await business.trackingCode('OBAT', {
            batch_required: true,
            expiry_required: true,
            strict_expiry: true,
        });
        medicine = await business.item('AMX', {
            tracking_code_id: tracked.id,
        });
        box = await created(`${inventoryApi}/units-of-measure`, {
            code: 'BOX',
            name: 'Kotak',
        });
        await created(`${inventoryApi}/item-units`, {
            item_id: medicine.id,
            unit_id: box.id,
            quantity_per_unit: 100,
        });
        vendor = await created('/api/v1/purchasing/vendors', {
            name: 'PBF Uji Retur',
        });
    });

    // Dua kotak batch R-001 (200 tablet) seharga 150.000 per kotak, diskon 10%: 1.350 per tablet.
    async function postedReceipt(
        locationId: string,
        overrides: Record<string, unknown> = {},
    ) {
        const draft = await json<{ data: Receipt }>(
            await business.admin.post(receipts, {
                vendor_id: vendor.id,
                location_id: locationId,
                posting_date: '2026-11-02',
                lines: [
                    {
                        item_id: medicine.id,
                        unit_id: box.id,
                        quantity: 2,
                        unit_cost: 150000,
                        discount_percent: 10,
                        batch_number: 'R-001',
                        expiry_date: '2027-06-30',
                        ...overrides,
                    },
                ],
            }),
            201,
        );
        return (
            await json<{ data: Receipt }>(
                await business.admin.post(`${receipts}/${draft.data.id}/post`, {
                    version: draft.data.version,
                }),
                200,
            )
        ).data;
    }
    const view = async (receipt: Receipt) =>
        json<ReturnView>(
            await business.admin.get(`${receipts}/${receipt.id}/returns`),
            200,
        );
    const returnOf = (
        receipt: Receipt,
        quantity: number | string,
        overrides: Record<string, unknown> = {},
    ) =>
        business.admin.post(`${receipts}/${receipt.id}/returns`, {
            posting_date: '2026-11-05',
            reason: 'Kemasan rusak',
            lines: [
                {
                    receipt_line_id: receipt.lines[0]?.id,
                    quantity,
                    unit_id: box.id,
                },
            ],
            ...overrides,
        });
    const reverseReturn = (
        receipt: Receipt,
        returned: { id: string; version: number },
    ) =>
        business.admin.post(
            `${receipts}/${receipt.id}/returns/${returned.id}/reverse`,
            { version: returned.version },
        );

    async function returnLedger(receiptId: string) {
        return [
            ...(await pool.unsafe<
                {
                    quantity: string;
                    amount: string;
                    kind: string;
                    batch: string | null;
                    reversal: boolean;
                }[]
            >(
                `select trim_scale(k.jumlah)::text as quantity, trim_scale(k.nilai)::text as amount, k.jenis as kind,
                        t.no_batch as batch, k.dibalik_dari is not null as reversal
                 from gd_tr_kartu_gudang k
                 join bl_tr_retur h on h.id = k.sumber_id
                 left join gd_m_batch t on t.id = k.batch_id
                 where k.tenant_id = $1 and k.sumber_jenis = 'retur_pembelian' and h.penerimaan_id = $2
                 order by k.id`,
                [business.tenantId, receiptId],
            )),
        ];
    }

    test('a return takes stock out of the receipt entry itself, at its cost and batch, in base units', async () => {
        const location = await business.location('RETUR1');
        const receipt = await postedReceipt(location.id);
        const saved = await json<ReturnView>(await returnOf(receipt, 0.5), 200);
        expect(saved.data.returns).toHaveLength(1);
        expect(saved.data.returns[0]?.number).toMatch(/^RPB-\d{8}$/);
        expect(saved.data.returnable[0]).toMatchObject({
            received: '200',
            returned: '50',
            returnable: '150',
        });
        expect(await returnLedger(receipt.id)).toEqual([
            {
                quantity: '-50',
                amount: '-67500',
                kind: 'penerimaan',
                batch: 'R-001',
                reversal: false,
            },
        ]);
        const [entry] = await pool.unsafe<{ open: string }[]>(
            `select trim_scale(sisa)::text as open from gd_tr_kartu_gudang
             where tenant_id = $1 and sumber_jenis = 'penerimaan' and sumber_id = $2`,
            [business.tenantId, receipt.id],
        );
        expect(entry?.open).toBe('150');
        expect(await business.stock(medicine.id, location.id)).toEqual({
            'R-001': 150,
        });
    });

    test('a return larger than what is left of the receipt at its location is refused and writes nothing', async () => {
        const location = await business.location('RETUR2');
        const receipt = await postedReceipt(location.id, {
            batch_number: 'R-002',
        });
        await business.posted('keluar', location.id, [
            { item_id: medicine.id, quantity: 120 },
        ]);
        const errors = await refused(await returnOf(receipt, 1));
        expect(errors['lines.0.quantity']?.[0]).toBe(
            'Paling banyak 80 TAB: barang dari penerimaan ini yang masih ada di Lokasi RETUR2.',
        );
        expect(await returnLedger(receipt.id)).toEqual([]);
        const [count] = await pool.unsafe<{ count: string }[]>(
            'select count(*)::text as count from bl_tr_retur where penerimaan_id = $1',
            [receipt.id],
        );
        expect(count?.count).toBe('0');
        expect(
            (
                await json<ReturnView>(
                    await returnOf(receipt, 80, {
                        lines: [
                            {
                                receipt_line_id: receipt.lines[0]?.id,
                                quantity: 80,
                                unit_id: business.uom.id,
                            },
                        ],
                    }),
                    200,
                )
            ).data.returnable[0]?.returnable,
        ).toBe('0');
    });

    test('an expired batch can still go back to the vendor', async () => {
        const location = await business.location('RETUR3');
        const receipt = await postedReceipt(location.id, {
            batch_number: 'R-003',
            expiry_date: '2026-11-03',
        });
        const saved = await json<ReturnView>(
            await returnOf(receipt, 2, { posting_date: '2026-11-10' }),
            200,
        );
        expect(saved.data.returnable[0]?.returnable).toBe('0');
        expect(await business.stock(medicine.id, location.id)).toEqual({});
    });

    test('cancelling a return puts the stock back, the same goods can be returned again, and the receipt can no longer be reversed', async () => {
        const location = await business.location('RETUR4');
        const receipt = await postedReceipt(location.id, {
            batch_number: 'R-004',
        });
        const first = (await json<ReturnView>(await returnOf(receipt, 2), 200))
            .data.returns[0];
        if (!first) throw new Error('return missing');
        const cancelled = await json<ReturnView>(
            await reverseReturn(receipt, first),
            200,
        );
        expect(cancelled.data.returns[0]?.status).toBe('dibatalkan');
        expect(cancelled.data.returnable[0]).toMatchObject({
            returned: '0',
            returnable: '200',
        });
        expect(await business.stock(medicine.id, location.id)).toEqual({
            'R-004': 200,
        });
        expect((await reverseReturn(receipt, first)).status).toBe(200);
        expect(
            (await returnLedger(receipt.id)).map((row) => [
                row.quantity,
                row.amount,
                row.reversal,
            ]),
        ).toEqual([
            ['-200', '-270000', false],
            ['200', '270000', true],
        ]);

        const again = await json<ReturnView>(await returnOf(receipt, 1), 200);
        expect(again.data.returnable[0]).toMatchObject({
            returned: '100',
            returnable: '100',
        });
        expect(await business.stock(medicine.id, location.id)).toEqual({
            'R-004': 100,
        });

        const errors = await refused(
            await business.admin.post(`${receipts}/${receipt.id}/reverse`, {
                version: receipt.version,
            }),
        );
        expect(errors._form?.[0]).toBe(
            `Barang dari penerimaan ini sudah pernah diretur ke vendor (${first.number}), jadi postingnya tidak bisa dibatalkan. Kembalikan barang lain yang salah terima lewat Retur ke vendor.`,
        );
        const [header] = await pool.unsafe<{ status: string }[]>(
            'select status from bl_tr_penerimaan where id = $1',
            [receipt.id],
        );
        expect(header?.status).toBe('diposting');
    });

    test('a return dated in a closed inventory period is refused, and so is cancelling one dated there', async () => {
        const location = await business.location('RETUR5');
        const receipt = await postedReceipt(location.id, {
            batch_number: 'R-005',
        });
        const returned = (
            await json<ReturnView>(
                await returnOf(receipt, 1, { posting_date: '2026-11-20' }),
                200,
            )
        ).data.returns[0];
        if (!returned) throw new Error('return missing');
        const period = await business.closedPeriod('2026-11-30');
        expect(
            (await refused(await returnOf(receipt, 1)))._form?.[0],
        ).toContain(
            'sudah ditutup, jadi stok bertanggal 5 November 2026 tidak bisa diposting.',
        );
        expect(
            (await refused(await reverseReturn(receipt, returned)))._form?.[0],
        ).toContain(
            'posting bertanggal 20 November 2026 tidak bisa dibatalkan.',
        );
        const [header] = await pool.unsafe<{ status: string }[]>(
            'select status from bl_tr_retur where id = $1',
            [returned.id],
        );
        expect(header?.status).toBe('diposting');
        expect((await business.reopenPeriod(period)).status).toBe(200);
    });

    test('a draft receipt, a date before the receipt, and a missing reason are refused', async () => {
        const location = await business.location('RETUR6');
        const draft = (
            await json<{ data: Receipt }>(
                await business.admin.post(receipts, {
                    vendor_id: vendor.id,
                    location_id: location.id,
                    posting_date: '2026-11-02',
                    lines: [
                        {
                            item_id: medicine.id,
                            unit_id: box.id,
                            quantity: 1,
                            unit_cost: 1000,
                            batch_number: 'R-006',
                            expiry_date: '2027-06-30',
                        },
                    ],
                }),
                201,
            )
        ).data;
        expect((await refused(await returnOf(draft, 1)))._form?.[0]).toBe(
            `Penerimaan ${draft.number} belum diposting, jadi belum ada barang yang bisa diretur. Ubah atau hapus drafnya saja.`,
        );
        const receipt = await postedReceipt(location.id, {
            batch_number: 'R-007',
        });
        const errors = await refused(
            await returnOf(receipt, 1, {
                posting_date: '2026-11-01',
                reason: ' ',
            }),
        );
        expect(errors.posting_date?.[0]).toBe(
            'Tanggal retur tidak boleh sebelum tanggal penerimaan.',
        );
        expect(errors.reason?.[0]).toBe(
            'Tulis alasan barang dikembalikan ke vendor.',
        );
        expect((await view(receipt)).data.returns).toEqual([]);
    });
});
