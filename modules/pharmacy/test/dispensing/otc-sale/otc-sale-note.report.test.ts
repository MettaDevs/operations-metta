import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { extractText, getDocumentProxy } from 'unpdf';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import { documentText } from '../../../../../test/support/receipt-fixture.ts';
import {
    createMember,
    createTenant,
    grantAllOrganizations,
} from '../../../../../test/support/tenant-fixtures.ts';
import {
    api,
    createPharmacy,
    inventoryApi,
    json,
    pharmacyDuties,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

type Reference = { id: string; code: string; name: string };
type Sold = { id: string; number: string; payment: { number: string } };

const sales = `${api}/otc-sales`;

// Nota penjualan obat bebas dicetak mesin cetak Core dari dataset farmasi: baris obat dan total dari kartu penjualan,
// pembayaran dari kasir Core lewat documentPayment. Angkanya dicocokkan dengan tagihan dan pembayaran kasir lewat SQL,
// termasuk sesudah retur, saat nota menulis jumlah yang diretur dan total yang ditagih ulang.
describe.skipIf(!process.env.DB_HOST)('OTC sale note', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    let pharmacy: Pharmacy;
    let counter: Reference;
    let paracetamol: Reference;
    let vitamin: Reference;
    let sold: Sold;
    const note = (id = sold.id, query = 'format=docx') =>
        `/api/v1/reports/pharmacy.otc-sale-note/records/${id}?${query}`;

    async function printed(query = 'format=docx') {
        const response = await pharmacy.admin.get(note(sold.id, query));
        expect(response.status).toBe(200);
        return documentText(new Uint8Array(await response.arrayBuffer()));
    }

    async function billed() {
        const [row] = await pool.unsafe<
            { billed: string; paid: string; change: string; number: string }[]
        >(
            `select trim_scale(sum(round(d.qty * d.nilai * (100 - d.disc) / 100, 2)))::text as billed,
                    (select trim_scale(k.nilai - k.nilai_discount + k.biaya_tambahan)::text from kasir k
                     where k.sumber_dokumen_id = $1 and k.status = 'diposting') as paid,
                    (select trim_scale(k.nilai_kembalian)::text from kasir k
                     where k.sumber_dokumen_id = $1 and k.status = 'diposting') as change,
                    (select k.no_bukti from kasir k where k.sumber_dokumen_id = $1 and k.status = 'diposting')
                        as number
             from tagihan_kasir_detail d where d.tagihan_sumber_dokumen_id = $1 and d.deleted_at is null`,
            [sold.id],
        );
        if (!row) throw new Error('Tagihan penjualan tidak ditemukan.');
        return row;
    }

    const rupiah = (value: string) =>
        Number(value).toLocaleString('id-ID', { maximumFractionDigits: 0 });

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Apotek Nota Bebas', {
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
                lines: [paracetamol, vitamin].map((item) => ({
                    item_id: item.id,
                    quantity: 50,
                    unit_cost: 500,
                })),
            },
        );
        await json(
            await pharmacy.admin.post(
                `${inventoryApi}/adjustments/${draft.id}/post`,
                { version: draft.version },
            ),
            200,
        );
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
        const body = {
            location_id: counter.id,
            lines: [
                { item: paracetamol, quantity: 10 },
                { item: vitamin, quantity: 2 },
            ].map((line) => ({
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
        sold = (
            await json<{ data: Sold }>(
                await pharmacy.admin.post(sales, {
                    ...body,
                    buyer_name: 'Budi Pembeli',
                    expected_total: total,
                    payment: { received: '50000' },
                }),
                201,
            )
        ).data;
    });

    test('the note lists the drugs, the total in words, and the cash payment with change, matching the cashier', async () => {
        const text = await printed();
        const cashier = await billed();
        expect(cashier.billed).toBe('14000');
        expect(cashier.paid).toBe('14000');
        expect(cashier.change).toBe('36000');
        expect(text).toContain('NOTA PENJUALAN');
        expect(text).toContain(sold.number);
        expect(text).toContain('Budi Pembeli');
        expect(text).toContain(`${paracetamol.code} ${paracetamol.name}`);
        expect(text).toContain(`${vitamin.code} ${vitamin.name}`);
        expect(text).toContain(rupiah(cashier.billed));
        expect(text).toContain('Empat Belas Ribu Rupiah');
        expect(text).toContain(sold.payment.number);
        expect(text).toContain(cashier.number);
        expect(text).toContain('Tunai');
        expect(text).toContain(rupiah('50000'));
        expect(text).toContain(rupiah(cashier.change));
        expect(text).not.toContain('BELUM DIBAYAR');
        expect(text).not.toContain('diretur');
        expect(text).not.toContain('{');
    });

    test('after a return the note shows the returned quantity and the smaller total paid again', async () => {
        const [payment] = await pool.unsafe<{ id: string; version: number }[]>(
            `select id, version from kasir where sumber_dokumen_id = $1 and status = 'diposting'`,
            [sold.id],
        );
        await json(
            await pharmacy.admin.post(
                `/api/v1/billing/payments/${payment?.id}/cancel`,
                { reason: 'Obat dikembalikan', version: payment?.version },
            ),
            200,
        );
        expect(await printed()).toContain('BELUM DIBAYAR');

        const returnable = (
            await json<{
                data: {
                    returnable: {
                        dispensing_line_id: string;
                        batch: { id: string } | null;
                        item: Reference | null;
                    }[];
                };
            }>(await pharmacy.admin.get(`${sales}/${sold.id}/returns`), 200)
        ).data.returnable;
        await json(
            await pharmacy.admin.post(`${sales}/${sold.id}/returns`, {
                reason: 'Pembeli salah beli',
                lines: returnable.map((row) => ({
                    dispensing_line_id: row.dispensing_line_id,
                    batch_id: row.batch?.id ?? null,
                    quantity: row.item?.code === paracetamol.code ? 3 : 0,
                })),
            }),
            200,
        );
        const [bill] = await pool.unsafe<{ version: number }[]>(
            'select version from tagihan_kasir where sumber_dokumen_id = $1',
            [sold.id],
        );
        await json(
            await pharmacy.admin.post(
                `/api/v1/billing/visits/${sold.id}/payments`,
                { version: bill?.version, received: '12000' },
            ),
            201,
        );

        const text = await printed();
        const cashier = await billed();
        expect(cashier.billed).toBe('11000');
        expect(cashier.paid).toBe('11000');
        expect(text).toContain('(diretur 3, ditagih 7)');
        expect(text).toContain(rupiah(cashier.billed));
        expect(text).toContain('Sebelas Ribu Rupiah');
        expect(text).toContain(cashier.number);
        expect(text).toContain(rupiah(cashier.change));
        expect(text).not.toContain('BELUM DIBAYAR');
    });

    test('the note needs the OTC sale read permission, and another tenant gets no note', async () => {
        const clerk = await createMember(pool, pharmacy.tenantId, [
            'core.organization.manage',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            clerk.membershipId,
        );
        const session = browser();
        await session.login(clerk.email, clerk.password);
        expect((await session.get(note())).status).toBe(403);

        const tenantId = await createTenant(pool, 'Tanpa farmasi nota');
        const stranger = await createMember(pool, tenantId, [
            'pharmacy.otc-sale.operate',
        ]);
        await grantAllOrganizations(pool, tenantId, stranger.membershipId);
        const outside = browser();
        await outside.login(stranger.email, stranger.password);
        expect((await outside.get(note())).status).toBe(404);
    });

    test.skipIf(!process.env.RENDERER_URL)(
        'the PDF is A4 by default and 76 mm on the thermal layout, like the cashier receipt',
        async () => {
            for (const [query, size] of [
                ['format=pdf', [0, 0, 595, 842]],
                ['format=pdf&layout=builtin:thermal-76', [0, 0, 215, 567]],
            ] as const) {
                const response = await pharmacy.admin.get(note(sold.id, query));
                expect(response.status).toBe(200);
                const pdf = await getDocumentProxy(
                    new Uint8Array(await response.arrayBuffer()),
                );
                const page = await pdf.getPage(1);
                expect(page.view.map(Math.round)).toEqual([...size]);
                const { text } = await extractText(pdf, { mergePages: true });
                expect(text).toContain(sold.number);
                expect(text).toContain(paracetamol.name);
            }
        },
    );
});
