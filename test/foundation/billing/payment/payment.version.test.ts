import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { registerBillingEventHandlers } from '../../../../src/foundation/billing/index.ts';
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

type Shown = {
    data: { visit: { version: number }; totals: { value: string } };
};

// Form Pembayaran mengirim versi tagihan yang ditampilkannya. Biaya yang berubah sesudah form dibuka menolak Simpan,
// supaya kasir tidak menerima uang untuk total yang tidak ia lihat. Tagihan yang tidak berubah lolos.
describe.skipIf(!process.env.DB_HOST)('bill version at Simpan', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let cashier: Browser;
    let charges: ReturnType<typeof visitCharges>;

    const show = async (visitId: string) =>
        (
            await json<Shown>(
                await cashier.get(`/api/v1/billing/visits/${visitId}`),
                200,
            )
        ).data;
    const pay = (visitId: string, body: Record<string, unknown>) =>
        cashier.post(`/api/v1/billing/visits/${visitId}/payments`, body);
    const newProcedure = (visitId: string, tariff: string) =>
        charges.publish('healthcare.examination.charges-replaced.v1', {
            examination_id: Bun.randomUUIDv7(),
            visit_id: visitId,
            registration_number: `REG-${visitId.slice(-4)}`,
            lines: [
                {
                    line_id: Bun.randomUUIDv7(),
                    procedure_id: Bun.randomUUIDv7(),
                    procedure_code: 'J-BARU',
                    procedure_name: 'Tindakan susulan',
                    service_group_id: null,
                    service_group_name: 'Tindakan Medis',
                    service_group_order: 1,
                    category_name: null,
                    quantity: '1',
                    tariff,
                    doctor_id: null,
                    doctor_name: null,
                    section_id: Bun.randomUUIDv7(),
                    section_name: 'Poli Umum',
                    date: '2026-11-13',
                    components: [],
                },
            ],
        });

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Versi Tagihan',
            [
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
            ],
        );
        cashier = business.admin;
        charges = visitCharges(pool, business);
        await json(
            await cashier.post('/api/v1/billing/payment-methods', {
                code: 'TUN',
                name: 'Tunai',
                behavior: 'tunai',
            }),
            201,
        );
        await json(
            await cashier.post('/api/v1/billing/clerks/start', {
                password: testPassword,
            }),
            201,
        );
    });

    test('a charge added after the form loaded refuses Simpan until the form reloads the bill', async () => {
        const visitId = Bun.randomUUIDv7();
        await charges.completedVisit(visitId, ['60000']);
        const loaded = await show(visitId);
        expect(loaded.totals.value).toBe('60000');
        await newProcedure(visitId, '20000');
        const stale = await pay(visitId, {
            version: loaded.visit.version,
            received: '60000',
        });
        expect(
            (await json<{ error: { code: string } }>(stale, 409)).error.code,
        ).toBe('stale_version');
        const reloaded = await show(visitId);
        expect(reloaded.totals.value).toBe('80000');
        await json(
            await pay(visitId, {
                version: reloaded.visit.version,
                received: '80000',
            }),
            201,
        );
    });

    test('an unchanged bill passes, and Simpan without the bill version is refused', async () => {
        const visitId = Bun.randomUUIDv7();
        await charges.completedVisit(visitId, ['45000']);
        const loaded = await show(visitId);
        expect((await pay(visitId, { received: '45000' })).status).toBe(428);
        await json(
            await pay(visitId, {
                version: loaded.visit.version,
                received: '45000',
            }),
            201,
        );
    });
});
