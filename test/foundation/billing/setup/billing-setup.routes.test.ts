import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    clerkNotStartedMessage,
    registerBillingEventHandlers,
    unclerkedPaymentMessage,
} from '../../../../src/foundation/billing/index.ts';
import {
    createBillingBusiness,
    json,
    payVisit,
    refused,
    visitCharges,
} from '../../../support/billing-fixtures.ts';
import { outboxEnvelopes } from '../../../support/event-contracts.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
    testPassword,
} from '../../../support/tenant-fixtures.ts';

type Setup = {
    data: { clerk_required: boolean; version: number };
    can_manage: boolean;
};

// Setelan kasir per legal entity lewat aplikasi sungguhan, diperiksa dengan SQL langsung: clerk wajib sampai setelan
// mematikannya; sesudah itu pembayaran, pembayaran hutang, dan batalnya berjalan tanpa clerk, tetap tampil di Daftar
// Pembayaran dan sampai ke finance, dan Clerk End hanya menghitung pembayaran yang masuk clerk-nya.
describe.skipIf(!process.env.DB_HOST)('billing setup', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    let tenantId: string;
    let cashier: Browser;
    let charges: ReturnType<typeof visitCharges>;
    const methods: Record<string, string> = {};

    const setup = async () =>
        json<Setup>(await cashier.get('/api/v1/billing/setup'), 200);
    const version = async (table: string, id: string) => {
        const [row] = await pool.unsafe<{ version: number }[]>(
            `select version from ${table} where id = $1`,
            [id],
        );
        return row?.version;
    };
    const clerkOf = async (table: string, id: string) => {
        const [row] = await pool.unsafe<{ clerk_id: string | null }[]>(
            `select clerk_id from ${table} where id = $1`,
            [id],
        );
        return row?.clerk_id;
    };
    async function visit(tariff: string) {
        const visitId = Bun.randomUUIDv7();
        await charges.completedVisit(visitId, [tariff]);
        return visitId;
    }
    async function paid(visitId: string, body: Record<string, unknown>) {
        return (
            await json<{ data: { id: string } }>(
                await payVisit(cashier, visitId, body),
                201,
            )
        ).data.id;
    }
    const cancelPayment = async (paymentId: string) =>
        cashier.post(`/api/v1/billing/payments/${paymentId}/cancel`, {
            version: await version('kasir', paymentId),
            reason: 'Salah pilih pasien',
        });

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Setelan Kasir',
            [
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
                'core.payment-cancel.approve',
            ],
        );
        tenantId = business.tenantId;
        cashier = business.admin;
        charges = visitCharges(pool, {
            tenantId,
            legalEntityId: business.legalEntityId,
        });
        for (const method of [
            { code: 'TUN', behavior: 'tunai', counted_at_close: true },
            {
                code: 'BON',
                behavior: 'piutang',
                party: 'pasien',
                takes_remainder: true,
            },
        ])
            methods[method.code] = (
                await json<{ data: { id: string } }>(
                    await cashier.post('/api/v1/billing/payment-methods', {
                        name: method.code,
                        ...method,
                    }),
                    201,
                )
            ).data.id;
    });

    test('a new legal entity requires Clerk Start until its setup turns that off', async () => {
        const shown = await setup();
        expect(shown).toMatchObject({
            data: { clerk_required: true },
            can_manage: true,
        });
        expect(
            await refused(
                await payVisit(cashier, await visit('50000'), {
                    received: '50000',
                }),
            ),
        ).toEqual({ _form: [clerkNotStartedMessage] });

        const stale = await cashier.put('/api/v1/billing/setup', {
            clerk_required: false,
            version: shown.data.version - 1,
        });
        expect(stale.status).toBe(409);
        const saved = await json<Setup>(
            await cashier.put('/api/v1/billing/setup', {
                clerk_required: false,
                version: shown.data.version,
            }),
            200,
        );
        expect(saved.data).toEqual({
            clerk_required: false,
            version: shown.data.version + 1,
        });
    });

    test('without a clerk, a payment saves, stays on the payment list, reaches finance, and cancels', async () => {
        const visitId = await visit('75000');
        const paymentId = await paid(visitId, { received: '75000' });
        expect(await clerkOf('kasir', paymentId)).toBeNull();

        const list = await json<{
            data: { id: string; paid: boolean }[];
        }>(
            await cashier.get(
                '/api/v1/billing/visits?from=2026-11-13&to=2026-11-13&status=paid',
            ),
            200,
        );
        expect(list.data.find((row) => row.id === visitId)?.paid).toBe(true);
        const posted = await outboxEnvelopes(
            pool,
            tenantId,
            'billing.invoice.posted.v1',
        );
        expect(
            posted.filter((envelope) => envelope.data.visit_id === visitId),
        ).toHaveLength(1);

        expect(
            await refused(
                await cashier.post(
                    `/api/v1/billing/payments/${paymentId}/credit-memo`,
                    {
                        version: await version('kasir', paymentId),
                        reason: 'Salah pilih pasien',
                    },
                ),
            ),
        ).toEqual({ _form: [unclerkedPaymentMessage] });
        await json(await cancelPayment(paymentId), 200);
        const [cancelled] = await pool.unsafe<{ status: string }[]>(
            'select status from kasir where id = $1',
            [paymentId],
        );
        expect(cancelled?.status).toBe('batal');
    });

    test('without a clerk, a bon payoff saves and cancels', async () => {
        const visitId = await visit('90000');
        await paid(visitId, { received: '0', take_remainder: true });
        const [receivable] = await pool.unsafe<{ id: string }[]>(
            `select r.id from piutang r join kasir k on k.id = r.kasir_id
             where k.sumber_dokumen_id = $1 and r.status = 'terbuka'`,
            [visitId],
        );
        const payoff = await json<{ data: { id: string } }>(
            await cashier.post('/api/v1/billing/receivable-payments', {
                receivable_id: receivable?.id,
                payment_method_id: methods.TUN,
                amount: '90000',
            }),
            201,
        );
        expect(
            await clerkOf('pembayaran_outstanding', payoff.data.id),
        ).toBeNull();
        await json(
            await cashier.post(
                `/api/v1/billing/receivable-payments/${payoff.data.id}/cancel`,
                {
                    reason: 'Salah input nilai',
                    version: await version(
                        'pembayaran_outstanding',
                        payoff.data.id,
                    ),
                },
            ),
            200,
        );
    });

    test('a cashier who starts a clerk anyway records payments there, and Clerk End counts only those', async () => {
        const started = await json<{ data: { id: string } }>(
            await cashier.post('/api/v1/billing/clerks/start', {
                password: testPassword,
            }),
            201,
        );
        const paymentId = await paid(await visit('30000'), {
            received: '30000',
        });
        expect(await clerkOf('kasir', paymentId)).toBe(started.data.id);
        const ended = await json<{
            data: { transactions: number; system_total: string };
        }>(
            await cashier.post(
                `/api/v1/billing/clerks/${started.data.id}/end`,
                {
                    password: testPassword,
                    counts: { [methods.TUN!]: '30000' },
                    version: await version('clerk', started.data.id),
                },
            ),
            200,
        );
        expect(ended.data).toMatchObject({
            transactions: 1,
            system_total: '30000',
        });
    });

    test('a member who may only look at the setup cannot change it', async () => {
        const viewer = await createMember(pool, tenantId, [
            'core.billing-setup.inquire',
        ]);
        await grantAllOrganizations(pool, tenantId, viewer.membershipId);
        const other = browser();
        await other.login(viewer.email, viewer.password);
        const shown = await json<Setup>(
            await other.get('/api/v1/billing/setup'),
            200,
        );
        expect(shown.can_manage).toBe(false);
        expect(
            (
                await other.put('/api/v1/billing/setup', {
                    clerk_required: true,
                    version: shown.data.version,
                })
            ).status,
        ).toBe(403);
    });
});
