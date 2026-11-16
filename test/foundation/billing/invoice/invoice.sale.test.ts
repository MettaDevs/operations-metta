import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    onPaymentHolds,
    registerBillingEventHandlers,
    replaceSaleBill,
    type SaleBill,
} from '../../../../src/foundation/billing/index.ts';
import {
    createBillingBusiness,
    json,
    visitCharges,
} from '../../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';
import { testPassword } from '../../../support/tenant-fixtures.ts';

type Listed = {
    data: Record<string, unknown>[];
    counts: { unpaid: number; paid: number; total: number };
};
type Shown = {
    data: {
        visit: Record<string, unknown> | null;
        sale: {
            id: string;
            number: string;
            date: string;
            sold_at: string;
            buyer_name: string | null;
            buyer_party_id: string | null;
            source_module: string;
            version: number;
        } | null;
        charges: { name: string; quantity: string; value: string }[];
        totals: { value: string };
        payment: { id: string; version: number } | null;
    };
};

// Tagihan penjualan tanpa kunjungan yang ditulis module penjual (replaceSaleBill) tampil di Daftar Pembayaran dan Form
// Pembayaran di samping tagihan kunjungan, lalu dibayar, dibatalkan, dan dibayar lagi lewat route kasir yang sama.
describe.skipIf(!process.env.DB_HOST)(
    'billing sale bills on the cashier screens',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp({
            DB_POOL_SIZE: '8',
        });
        afterAll(close);
        let tenantId: string;
        let legalEntityId: string;
        let cashier: Browser;
        const visitId = Bun.randomUUIDv7();
        const saleId = Bun.randomUUIDv7();
        const anonymousSaleId = Bun.randomUUIDv7();
        const range = 'from=2026-11-13&to=2026-11-13';

        const sale = (documentId: string, buyer: string | null): SaleBill => ({
            tenantId,
            legalEntityId,
            operatingUnitId: null,
            module: 'pharmacy',
            documentId,
            number: `OTC-${documentId.slice(-4)}`,
            date: '2026-11-13',
            buyer: { partyId: null, name: buyer },
            group: 'OBAT',
            lines: [
                {
                    lineId: Bun.randomUUIDv7(),
                    item: {
                        id: Bun.randomUUIDv7(),
                        code: 'PCT',
                        name: 'Parasetamol',
                    },
                    quantity: '10',
                    unitPrice: '1500',
                    discountPercent: '0',
                },
            ],
        });

        const list = async (query = '') =>
            json<Listed>(
                await cashier.get(`/api/v1/billing/visits?${range}${query}`),
                200,
            );
        const show = async (documentId: string) =>
            json<Shown>(
                await cashier.get(`/api/v1/billing/visits/${documentId}`),
                200,
            );
        const paidOf = async (documentId: string) =>
            (await list()).data.find((row) => row.id === documentId)?.paid;

        beforeAll(async () => {
            registerBillingEventHandlers();
            const business = await createBillingBusiness(
                pool,
                browser,
                'Apotek Uji Daftar Penjualan',
                [
                    'core.billing-setup.manage',
                    'core.clerk.operate',
                    'core.payment.operate',
                    'core.payment-cancel.approve',
                ],
            );
            tenantId = business.tenantId;
            legalEntityId = business.legalEntityId;
            cashier = business.admin;
            await json(
                await cashier.post('/api/v1/billing/payment-methods', {
                    name: 'TUN',
                    code: 'TUN',
                    behavior: 'tunai',
                    counted_at_close: true,
                }),
                201,
            );
            await json(
                await cashier.post('/api/v1/billing/clerks/start', {
                    password: testPassword,
                }),
                201,
            );
            const charges = visitCharges(pool, { tenantId, legalEntityId });
            await charges.completedVisit(visitId, ['50000']);
            for (const [documentId, buyer] of [
                [saleId, 'Budi'],
                [anonymousSaleId, null],
            ] as const)
                await charges.withDatabase((db) =>
                    db.transaction(() =>
                        replaceSaleBill(db, sale(documentId, buyer)),
                    ),
                );
        });

        test('the list shows sale bills beside visit bills, and counts both kinds', async () => {
            const listed = await list();
            const byId = new Map(listed.data.map((row) => [row.id, row]));
            expect(byId.get(saleId)).toEqual({
                kind: 'sale',
                id: saleId,
                number: `OTC-${saleId.slice(-4)}`,
                date: '2026-11-13',
                sold_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
                buyer_name: 'Budi',
                paid: false,
            });
            expect(byId.get(anonymousSaleId)).toMatchObject({
                kind: 'sale',
                buyer_name: null,
            });
            expect(byId.get(visitId)).toEqual({
                kind: 'visit',
                id: visitId,
                registration_number: `REG-${visitId.slice(-4)}`,
                date: '2026-11-13',
                registered_at: '2026-11-13T01:00:00.000000Z',
                patient_medical_record_number: visitId.slice(-6),
                patient_name: 'Pasien Uji',
                patient_type_name: 'UMUM',
                sections: 'Poli Umum',
                paid: false,
            });
            expect(listed.counts).toEqual({ unpaid: 3, paid: 0, total: 3 });
        });

        test('search finds a sale by its number or its buyer', async () => {
            const ids = async (q: string) =>
                (await list(`&q=${encodeURIComponent(q)}`)).data.map(
                    (row) => row.id,
                );
            expect(await ids('Budi')).toEqual([saleId]);
            expect(await ids(`OTC-${saleId.slice(-4)}`)).toEqual([saleId]);
            expect(await ids('Pasien Uji')).toEqual([visitId]);
            expect((await list('&sort=time&direction=desc')).data.length).toBe(
                3,
            );
        });

        test('the payment form shows the sale header and its charges instead of a patient', async () => {
            const shown = await show(saleId);
            expect(shown.data.visit).toBeNull();
            expect(shown.data.sale).toMatchObject({
                id: saleId,
                number: `OTC-${saleId.slice(-4)}`,
                date: '2026-11-13',
                buyer_name: 'Budi',
                buyer_party_id: null,
                source_module: 'pharmacy',
            });
            expect(
                shown.data.charges.map((charge) => [
                    charge.name,
                    charge.quantity,
                    charge.value,
                ]),
            ).toEqual([['Parasetamol', '10', '1500']]);
            expect(shown.data.totals.value).toBe('15000');
            expect(shown.data.payment).toBeNull();
            expect((await show(visitId)).data.sale).toBeNull();
        });

        test('a sale is paid, cancelled back to unpaid, and paid again from the cashier screens', async () => {
            const pay = async () =>
                cashier.post(`/api/v1/billing/visits/${saleId}/payments`, {
                    version: (await show(saleId)).data.sale?.version,
                    received: '20000',
                });
            await json(await pay(), 201);
            expect(await paidOf(saleId)).toBe(true);
            expect((await list('&status=paid')).counts).toEqual({
                unpaid: 2,
                paid: 1,
                total: 3,
            });

            const payment = (await show(saleId)).data.payment;
            await json(
                await cashier.post(
                    `/api/v1/billing/payments/${payment?.id}/cancel`,
                    { version: payment?.version, reason: 'Salah hitung' },
                ),
                200,
            );
            expect(await paidOf(saleId)).toBe(false);
            expect((await show(saleId)).data.payment).toBeNull();

            await json(await pay(), 201);
            expect(await paidOf(saleId)).toBe(true);
        });

        test('only visit bills are asked whether they still wait', async () => {
            const probe = `holds-probe-${Bun.randomUUIDv7()}`;
            const asked: string[][] = [];
            onPaymentHolds(probe, (_db, held) => {
                asked.push(held.visitIds);
                return Promise.resolve(new Map<string, string>());
            });
            await pool.unsafe(
                `insert into core_module_installations (tenant_id, module_id, version, status, installed_at, created_at, updated_at)
             values ($1, $2, '1', 'installed', now(), now(), now())`,
                [tenantId, probe],
            );
            await json(
                await cashier.get(`/api/v1/billing/visits/holds?${range}`),
                200,
            );
            expect(asked).toEqual([[visitId]]);
        });
    },
);
