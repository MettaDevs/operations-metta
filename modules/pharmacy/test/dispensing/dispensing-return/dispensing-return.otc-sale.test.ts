import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { outboxEnvelopes } from '../../../../../test/support/event-contracts.ts';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../../../test/support/tenant-fixtures.ts';
import {
    api,
    createPharmacy,
    inventoryApi,
    json,
    pharmacyDuties,
    refused,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

type Reference = { id: string; code: string; name: string };
type Sold = { id: string; number: string; payment: { id: string } };
type Returns = {
    data: {
        returnable: {
            dispensing_line_id: string;
            batch: { id: string } | null;
            item: Reference | null;
        }[];
        returns: { id: string; number: string; version: number }[];
    };
};

const paidMessage = 'Data ini sudah melakukan Pembayaran diKasir!';
const sales = `${api}/otc-sales`;

// Retur penjualan obat bebas memakai retur farmasi yang sama dengan resep, dengan kunci kasir yang sama: penjualan yang
// sudah dibayar menolak retur sampai kasir membatalkan pembayarannya. Sesudah retur, tagihan penjualan hanya berisi obat
// yang tidak dikembalikan, jadi kasir menagih ulang angka yang lebih kecil. Hasilnya dibaca lewat SQL.
describe.skipIf(!process.env.DB_HOST)('returns on an OTC sale', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    let pharmacy: Pharmacy;
    let counter: Reference;
    let paracetamol: Reference;
    let vitamin: Reference;

    async function receive(item: Reference, quantity: number) {
        const reasonId =
            (
                await json<{ data: Reference[] }>(
                    await pharmacy.admin.get(`${inventoryApi}/reason-codes`),
                    200,
                )
            ).data.find((reason) => reason.code === 'SALDO-AWAL')?.id ?? '';
        const draft = await pharmacy.created<{ id: string; version: number }>(
            `${inventoryApi}/adjustments`,
            {
                direction: 'masuk',
                location_id: counter.id,
                posting_date: '2026-11-01',
                reason_id: reasonId,
                lines: [{ item_id: item.id, quantity, unit_cost: 500 }],
            },
        );
        await json(
            await pharmacy.admin.post(
                `${inventoryApi}/adjustments/${draft.id}/post`,
                { version: draft.version },
            ),
            200,
        );
    }

    async function sell(lines: { item: Reference; quantity: number }[]) {
        const body = {
            location_id: counter.id,
            lines: lines.map((line) => ({
                item_id: line.item.id,
                unit_id: pharmacy.uom.id,
                quantity: line.quantity,
            })),
        };
        const { total } = (
            await json<{ data: { total: string } }>(
                await pharmacy.admin.post(`${sales}/quote`, body),
                200,
            )
        ).data;
        return (
            await json<{ data: Sold }>(
                await pharmacy.admin.post(sales, {
                    ...body,
                    buyer_name: 'Budi',
                    expected_total: total,
                    payment: { received: total },
                }),
                201,
            )
        ).data;
    }

    const returns = async (saleId: string) =>
        json<Returns>(
            await pharmacy.admin.get(`${sales}/${saleId}/returns`),
            200,
        );

    async function returnLines(
        saleId: string,
        quantities: Map<string, number>,
    ) {
        const { data } = await returns(saleId);
        return pharmacy.admin.post(`${sales}/${saleId}/returns`, {
            reason: 'Pembeli salah beli',
            lines: data.returnable.map((row) => ({
                dispensing_line_id: row.dispensing_line_id,
                batch_id: row.batch?.id ?? null,
                quantity: quantities.get(row.item?.code ?? '') ?? 0,
            })),
        });
    }

    async function charges(saleId: string) {
        return [
            ...(await pool.unsafe<{ item_id: string; qty: string }[]>(
                `select jenis_biaya_id as item_id, trim_scale(qty)::text as qty from tagihan_kasir_detail
                 where tagihan_sumber_dokumen_id = $1 and deleted_at is null order by jenis_biaya_kode`,
                [saleId],
            )),
        ];
    }

    async function stock(item: Reference) {
        const [row] = await pool.unsafe<{ quantity: string }[]>(
            `select trim_scale(coalesce(sum(jumlah), 0))::text as quantity from gd_tr_kartu_gudang
             where tenant_id = $1 and barang_id = $2 and lokasi_id = $3`,
            [pharmacy.tenantId, item.id, counter.id],
        );
        return row?.quantity;
    }

    async function written(saleId: string) {
        const [row] = await pool.unsafe<Record<string, unknown>[]>(
            `select (select count(*)::int from retur_farmasi where bill_farmasi_id = $1) as returns,
                    (select count(*)::int from gd_tr_kartu_gudang
                     where tenant_id = $2 and sumber_jenis = 'retur_farmasi') as entries,
                    (select json_agg(json_build_object('qty', trim_scale(qty)::text, 'status', status,
                                                       'deleted', deleted_at is not null) order by id)
                     from tagihan_kasir_detail where tagihan_sumber_dokumen_id = $1) as charges,
                    (select json_agg(status order by id) from kasir where sumber_dokumen_id = $1) as payments`,
            [saleId, pharmacy.tenantId],
        );
        return row;
    }

    async function cancelPayment(saleId: string) {
        const [payment] = await pool.unsafe<{ id: string; version: number }[]>(
            `select id, version from kasir where sumber_dokumen_id = $1 and status = 'diposting'`,
            [saleId],
        );
        await json(
            await pharmacy.admin.post(
                `/api/v1/billing/payments/${payment?.id}/cancel`,
                { reason: 'Obat dikembalikan', version: payment?.version },
            ),
            200,
        );
    }

    async function payAgain(saleId: string, received: string) {
        const [bill] = await pool.unsafe<{ version: number }[]>(
            'select version from tagihan_kasir where sumber_dokumen_id = $1',
            [saleId],
        );
        return pharmacy.admin.post(
            `/api/v1/billing/visits/${saleId}/payments`,
            {
                version: bill?.version,
                received,
            },
        );
    }

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Apotek Retur Bebas', {
            duties: [
                ...pharmacyDuties,
                'pharmacy.otc-sale.operate',
                'pharmacy.dispensing.manage',
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
                'core.payment-cancel.approve',
            ],
        });
        counter = await pharmacy.location('LOKET');
        paracetamol = await pharmacy.item('PCT', { base_price: '1000' });
        vitamin = await pharmacy.item('VIT', { base_price: '2000' });
        await receive(paracetamol, 50);
        await receive(vitamin, 20);
        await pharmacy.created(`${api}/otc-sale-locations`, {
            location_id: counter.id,
            price_group_id: null,
        });
        await pharmacy.created('/api/v1/billing/payment-methods', {
            code: 'TUN',
            name: 'Tunai',
            behavior: 'tunai',
        });
        await json(
            await pharmacy.admin.post('/api/v1/billing/clerks/start', {}),
            201,
        );
    });

    test('a paid sale refuses the return with the legacy message and writes nothing', async () => {
        const sold = await sell([{ item: paracetamol, quantity: 10 }]);
        const before = await written(sold.id);
        expect(
            await refused(
                await returnLines(sold.id, new Map([[paracetamol.code, 3]])),
            ),
        ).toEqual({ _form: [paidMessage] });
        expect(await written(sold.id)).toEqual(before);
        expect(await stock(paracetamol)).toBe('40');
    });

    test('after Batal pembayaran the return posts stock back, the sale bill keeps only what was kept, and the smaller total is paid again', async () => {
        const sold = await sell([
            { item: paracetamol, quantity: 10 },
            { item: vitamin, quantity: 2 },
        ]);
        expect(await stock(paracetamol)).toBe('30');
        await cancelPayment(sold.id);

        const posted = await returnLines(
            sold.id,
            new Map([
                [paracetamol.code, 3],
                [vitamin.code, 2],
            ]),
        );
        const view = await json<Returns>(posted, 200);
        expect(view.data.returns).toHaveLength(1);
        expect(await stock(paracetamol)).toBe('33');
        expect(await stock(vitamin)).toBe('20');
        expect(await charges(sold.id)).toEqual([
            { item_id: paracetamol.id, qty: '7' },
        ]);

        const card = (
            await json<{
                data: {
                    total: string;
                    paid: boolean;
                    lines: { quantity: string; net_quantity: string }[];
                };
            }>(await pharmacy.admin.get(`${sales}/${sold.id}`), 200)
        ).data;
        expect(card.paid).toBe(false);
        expect(
            card.lines.map((line) => [line.quantity, line.net_quantity]),
        ).toEqual([
            ['10', '7'],
            ['2', '0'],
        ]);
        expect(
            await refused(
                await payAgain(sold.id, String(Number(card.total) - 1)),
            ),
        ).toEqual({ _form: ['Masih terdapat Sisa pembayaran!!'] });
        await json(await payAgain(sold.id, card.total), 201);
        const [payment] = await pool.unsafe<{ nilai: string }[]>(
            `select trim_scale(nilai)::text as nilai from kasir
             where sumber_dokumen_id = $1 and status = 'diposting'`,
            [sold.id],
        );
        expect(payment?.nilai).toBe(card.total);

        const listed = (
            await json<{
                data: { id: string; total: string; paid: boolean }[];
            }>(await pharmacy.admin.get(`${sales}?q=${sold.number}`), 200)
        ).data;
        expect(listed).toEqual([
            expect.objectContaining({
                id: sold.id,
                total: card.total,
                paid: true,
            }),
        ]);
    });

    test('Batal retur is locked while paid, and after Batal pembayaran it restores the stock and the sale bill lines', async () => {
        const sold = await sell([{ item: vitamin, quantity: 4 }]);
        await cancelPayment(sold.id);
        await json(
            await returnLines(sold.id, new Map([[vitamin.code, 3]])),
            200,
        );
        expect(await charges(sold.id)).toEqual([
            { item_id: vitamin.id, qty: '1' },
        ]);
        expect(await stock(vitamin)).toBe('19');
        const [posted] = (await returns(sold.id)).data.returns;
        const reverse = () =>
            pharmacy.admin.post(
                `${sales}/${sold.id}/returns/${posted?.id}/reverse`,
                { version: posted?.version },
            );
        const { total } = (
            await json<{ data: { total: string } }>(
                await pharmacy.admin.get(`${sales}/${sold.id}`),
                200,
            )
        ).data;
        await json(await payAgain(sold.id, total), 201);
        expect(await refused(await reverse())).toEqual({
            _form: [paidMessage],
        });

        await cancelPayment(sold.id);
        await json(await reverse(), 200);
        expect(await charges(sold.id)).toEqual([
            { item_id: vitamin.id, qty: '4' },
        ]);
        expect(await stock(vitamin)).toBe('16');
    });

    test('OTC returns publish no event to healthcare, and the prescription return route does not open a sale', async () => {
        for (const type of [
            'pharmacy.return.posted.v1',
            'pharmacy.return.reversed.v1',
            'pharmacy.dispensing.charges-replaced.v1',
        ])
            expect(
                await outboxEnvelopes(pool, pharmacy.tenantId, type),
            ).toEqual([]);
        const [sale] = await pool.unsafe<{ id: string }[]>(
            'select id from bill_farmasi where tenant_id = $1 limit 1',
            [pharmacy.tenantId],
        );
        await json(
            await pharmacy.admin.get(
                `${api}/prescriptions/${sale?.id}/returns`,
            ),
            404,
        );
    });

    // Penolakan membawa jalan keluarnya: yang boleh membuka pembayaran kasir mendapat aksi yang membuka pembayaran itu
    // (kunci record core.payment, id dokumen sumbernya); yang tidak boleh mendapat nomor pembayarannya di pesan.
    test('the refusal opens the payment for whoever may read payments, and names the payment number to whoever may not', async () => {
        const sold = await sell([{ item: paracetamol, quantity: 2 }]);
        const [payment] = await pool.unsafe<{ no_bukti: string }[]>(
            `select no_bukti from kasir where sumber_dokumen_id = $1 and status = 'diposting'`,
            [sold.id],
        );
        const lines = new Map([[paracetamol.code, 1]]);
        const cashierView = await json<{
            errors: Record<string, string[]>;
            actions?: unknown;
        }>(await returnLines(sold.id, lines), 422);
        expect(cashierView).toMatchObject({
            errors: { _form: [paidMessage] },
            actions: [
                {
                    kind: 'open',
                    label: `Buka pembayaran ${payment?.no_bukti}`,
                    page: 'core.payment',
                    recordId: sold.id,
                },
            ],
        });

        const pharmacist = await createMember(pool, pharmacy.tenantId, [
            ...pharmacyDuties,
            'pharmacy.otc-sale.operate',
            'pharmacy.dispensing.manage',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            pharmacist.membershipId,
        );
        const session = browser();
        await session.login(pharmacist.email, pharmacist.password);
        const { data } = await json<Returns>(
            await session.get(`${sales}/${sold.id}/returns`),
            200,
        );
        const pharmacistView = await json<{
            errors: Record<string, string[]>;
            actions?: unknown;
        }>(
            await session.post(`${sales}/${sold.id}/returns`, {
                reason: 'Pembeli salah beli',
                lines: data.returnable.map((row) => ({
                    dispensing_line_id: row.dispensing_line_id,
                    batch_id: row.batch?.id ?? null,
                    quantity: 1,
                })),
            }),
            422,
        );
        expect(pharmacistView.errors).toEqual({
            _form: [
                `${paidMessage} Minta kasir membatalkan pembayaran ${payment?.no_bukti}.`,
            ],
        });
        expect(pharmacistView.actions).toBeUndefined();
    });
});
