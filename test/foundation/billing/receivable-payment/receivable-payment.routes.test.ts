import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    clerkNotStartedMessage,
    lockChargeForChange,
    outstandingPaymentMessage,
    registerBillingEventHandlers,
} from '../../../../src/foundation/billing/index.ts';
import {
    closedClerkMessage,
    exceedsObligationMessage,
    incompleteCardMessage,
    newerPaymentMessage,
} from '../../../../src/foundation/billing/receivable-payment/receivable-payment.service.ts';
import { HttpFailure } from '../../../../src/platform/http/index.ts';
import {
    createBillingBusiness,
    json,
    refused,
    visitCharges,
} from '../../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';
import {
    createMember,
    testPassword,
} from '../../../support/tenant-fixtures.ts';

type Receivable = {
    id: string;
    kode: string;
    pihak_jenis: string;
    pihak_id: string | null;
    pihak_nama: string;
    nilai: string;
    sisa: string;
    status: string;
};
type Payoff = { data: { id: string; number: string; version: number } };

// Piutang dari pembayaran dan Pembayaran Hutang (pelunasan bon), lewat aplikasi sungguhan dan diperiksa dengan SQL
// langsung.
describe.skipIf(!process.env.DB_HOST)('billing receivable payments', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    let tenantId: string;
    let cashier: Browser;
    let charges: ReturnType<typeof visitCharges>;
    let approver: { email: string; password: string };
    let merchantId: string;
    const methods: Record<string, string> = {};

    const pay = (visitId: string, body: Record<string, unknown>) =>
        cashier.post(`/api/v1/billing/visits/${visitId}/payments`, body);
    const payoff = (body: Record<string, unknown>) =>
        cashier.post('/api/v1/billing/receivable-payments', body);
    const cancelPayoff = (
        payment: Payoff['data'],
        reason = 'Salah input nilai',
    ) =>
        cashier.post(
            `/api/v1/billing/receivable-payments/${payment.id}/cancel`,
            { reason, version: payment.version },
        );
    const receivablesOf = async (visitId: string) => [
        ...(await pool.unsafe<Receivable[]>(
            `select r.id, j.kode, r.pihak_jenis, r.pihak_id, r.pihak_nama, trim_scale(r.nilai)::text as nilai,
                    trim_scale(r.sisa)::text as sisa, r.status
             from piutang r join kasir k on k.id = r.kasir_id join jenis_bayar j on j.id = r.jenis_bayar_id
             where r.tenant_id = $1 and k.kunjungan_id = $2 order by k.created_at, j.kode`,
            [tenantId, visitId],
        )),
    ];
    const receivable = async (visitId: string) => {
        const [found] = (await receivablesOf(visitId)).filter(
            (row) => row.status !== 'batal',
        );
        if (!found) throw new Error('The visit has no receivable.');
        return found;
    };
    // Kunjungan yang dibayar dengan tunai `received` dan sisanya dicentang Pasien BON.
    async function bon(tariff: string, received = '0') {
        const visitId = Bun.randomUUIDv7();
        await charges.completedVisit(visitId, [tariff]);
        const paid = await json<{ data: { id: string } }>(
            await pay(visitId, { received, take_remainder: true }),
            201,
        );
        return { visitId, paymentId: paid.data.id };
    }
    async function paidOff(receivableId: string, amount: string) {
        return (
            await json<Payoff>(
                await payoff({
                    receivable_id: receivableId,
                    payment_method_id: methods.TUN,
                    amount,
                }),
                201,
            )
        ).data;
    }
    const cancelPayment = async (paymentId: string) => {
        const [row] = await pool.unsafe<{ version: number }[]>(
            'select version from kasir where id = $1',
            [paymentId],
        );
        return cashier.post(`/api/v1/billing/payments/${paymentId}/cancel`, {
            version: row?.version,
            reason: 'Salah pilih pasien',
            approver_email: approver.email,
            approver_password: approver.password,
        });
    };

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Piutang',
            [
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
            ],
        );
        tenantId = business.tenantId;
        cashier = business.admin;
        charges = visitCharges(pool, {
            tenantId,
            legalEntityId: business.legalEntityId,
        });
        approver = await createMember(pool, tenantId, [
            'core.payment-cancel.approve',
        ]);
        for (const method of [
            { code: 'TUN', behavior: 'tunai', counted_at_close: true },
            {
                code: 'KRT',
                behavior: 'non_tunai',
                requires_merchant: true,
                requires_reference: true,
                allows_surcharge: true,
            },
            {
                code: 'BON',
                behavior: 'piutang',
                party: 'pasien',
                takes_remainder: true,
            },
            { code: 'KRY', behavior: 'piutang', party: 'pilih_pihak' },
            { code: 'BPJ', behavior: 'penjamin', party: 'penjamin_kunjungan' },
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
        merchantId = (
            await json<{ data: { id: string } }>(
                await cashier.post('/api/v1/billing/merchants', {
                    code: 'EDC',
                    name: 'EDC Uji',
                }),
                201,
            )
        ).data.id;
        await json(
            await cashier.post('/api/v1/billing/clerks/start', {
                password: testPassword,
            }),
            201,
        );
    });

    test('a bon opens one receivable that partial and full payoffs settle, never beyond what is owed', async () => {
        const { visitId } = await bon('150000', '50000');
        const opened = await receivable(visitId);
        expect(opened).toMatchObject({
            kode: 'BON',
            pihak_jenis: 'pasien',
            pihak_nama: 'Pasien Uji',
            nilai: '100000',
            sisa: '100000',
            status: 'terbuka',
        });
        expect(await receivablesOf(visitId)).toHaveLength(1);
        const lookup = await json<{
            data: { id: string; remaining: string; party_name: string }[];
        }>(await cashier.get('/api/v1/billing/receivables'), 200);
        expect(lookup.data.find((row) => row.id === opened.id)).toMatchObject({
            remaining: '100000',
            party_name: 'Pasien Uji',
        });

        const first = await paidOff(opened.id, '40000');
        expect(first.number).toMatch(/^PBO-\d{8}$/);
        expect(await receivable(visitId)).toMatchObject({
            sisa: '60000',
            status: 'terbuka',
        });
        expect(
            await refused(
                await payoff({
                    receivable_id: opened.id,
                    payment_method_id: methods.TUN,
                    amount: '60001',
                }),
            ),
        ).toEqual({ amount: [exceedsObligationMessage] });
        expect(
            await refused(
                await payoff({
                    receivable_id: opened.id,
                    payment_method_id: methods.KRT,
                    amount: '60000',
                }),
            ),
        ).toEqual({
            merchant_id: [incompleteCardMessage],
            reference: [incompleteCardMessage],
        });
        await json(
            await payoff({
                receivable_id: opened.id,
                payment_method_id: methods.KRT,
                amount: '60000',
                merchant_id: merchantId,
                reference: '4111-XXXX',
                surcharge_percent: '2',
            }),
            201,
        );
        expect(await receivable(visitId)).toMatchObject({
            sisa: '0',
            status: 'lunas',
        });
        const stored = await pool.unsafe<
            { nilai: string; biaya_tambahan: string; kode: string }[]
        >(
            `select trim_scale(o.nilai)::text as nilai, trim_scale(o.biaya_tambahan)::text as biaya_tambahan, j.kode
             from pembayaran_outstanding o join jenis_bayar j on j.id = o.jenis_bayar_id
             where o.piutang_id = $1 order by o.jam, o.id`,
            [opened.id],
        );
        expect([...stored]).toEqual([
            { nilai: '40000', biaya_tambahan: '0', kode: 'TUN' },
            { nilai: '60000', biaya_tambahan: '1200', kode: 'KRT' },
        ]);
        const settled = await json<{ data: { id: string }[] }>(
            await cashier.get('/api/v1/billing/receivables'),
            200,
        );
        expect(settled.data.map((row) => row.id)).not.toContain(opened.id);
        expect(
            await refused(
                await payoff({
                    receivable_id: opened.id,
                    payment_method_id: methods.TUN,
                    amount: '1',
                }),
            ),
        ).toEqual({
            receivable_id: [
                'Pilih nomor invoice yang belum lunas dari daftar.',
            ],
        });
        const list = await json<{
            data: {
                number: string;
                invoice_number: string;
                amount: string;
                previously_paid: string;
                receivable_amount: string;
            }[];
        }>(await cashier.get('/api/v1/billing/receivable-payments'), 200);
        expect(
            list.data.find((row) => row.number === first.number),
        ).toMatchObject({
            amount: '40000',
            previously_paid: '0',
            receivable_amount: '100000',
        });
    });

    test('only the newest payoff of a receivable can be cancelled, and cancelling restores what is owed', async () => {
        const { visitId } = await bon('100000');
        const opened = await receivable(visitId);
        const older = await paidOff(opened.id, '30000');
        const newer = await paidOff(opened.id, '20000');
        expect(await refused(await cancelPayoff(older))).toEqual({
            _form: [newerPaymentMessage],
        });
        expect(await refused(await cancelPayoff(newer, ' '))).toEqual({
            reason: ['Isi alasan batal.'],
        });
        await json(await cancelPayoff(newer), 200);
        expect(await receivable(visitId)).toMatchObject({
            sisa: '70000',
            status: 'terbuka',
        });
        await json(await cancelPayoff(older), 200);
        expect(await receivable(visitId)).toMatchObject({
            sisa: '100000',
            status: 'terbuka',
        });
        const cancelled = await pool.unsafe<{ status: string }[]>(
            'select status from pembayaran_outstanding where piutang_id = $1',
            [opened.id],
        );
        expect(cancelled.map((row) => row.status)).toEqual(['batal', 'batal']);
    });

    test('a payment whose receivable has a payoff cannot be cancelled until the payoff is', async () => {
        const { visitId, paymentId } = await bon('90000');
        const opened = await receivable(visitId);
        const settled = await paidOff(opened.id, '90000');
        expect(await refused(await cancelPayment(paymentId))).toEqual({
            _form: [outstandingPaymentMessage],
        });
        await json(await cancelPayoff(settled), 200);
        await json(await cancelPayment(paymentId), 200);
        expect(await receivablesOf(visitId)).toMatchObject([
            { sisa: '90000', status: 'batal' },
        ]);
        expect(
            await refused(
                await payoff({
                    receivable_id: opened.id,
                    payment_method_id: methods.TUN,
                    amount: '1000',
                }),
            ),
        ).toEqual({
            receivable_id: [
                'Pilih nomor invoice yang belum lunas dari daftar.',
            ],
        });
    });

    test('a bon to a chosen party belongs to that party, and an unknown party is refused', async () => {
        const partyId = Bun.randomUUIDv7();
        await pool.unsafe(
            `insert into parties (id, tenant_id, type, name, search_name) values ($1, $2, 'person', $3, $3)`,
            [partyId, tenantId, 'Karyawan Uji'],
        );
        const visitId = Bun.randomUUIDv7();
        await charges.completedVisit(visitId, ['70000']);
        expect(
            await refused(
                await pay(visitId, {
                    lines: [
                        {
                            payment_method_id: methods.KRY,
                            amount: '70000',
                            party_id: Bun.randomUUIDv7(),
                        },
                    ],
                }),
            ),
        ).toEqual({
            'lines.0.party_id': ['Anda belum memilih Dokter/Karyawan Bon!'],
        });
        await json(
            await pay(visitId, {
                lines: [
                    {
                        payment_method_id: methods.KRY,
                        amount: '70000',
                        party_id: partyId,
                    },
                ],
            }),
            201,
        );
        expect(await receivablesOf(visitId)).toMatchObject([
            {
                kode: 'KRY',
                pihak_jenis: 'pihak',
                pihak_id: partyId,
                pihak_nama: 'Karyawan Uji',
                nilai: '70000',
            },
        ]);
    });

    test('an automatic guarantor payment is a receivable from the visit guarantor, and its payoff locks the bill', async () => {
        const guarantorId = Bun.randomUUIDv7();
        const visitId = Bun.randomUUIDv7();
        await charges.completedVisit(visitId, ['60000'], {
            automatic_payment_method_id: methods.BPJ,
            guarantor: { id: guarantorId, name: 'Penjamin Uji' },
        });
        const opened = await receivable(visitId);
        expect(opened).toMatchObject({
            kode: 'BPJ',
            pihak_jenis: 'penjamin',
            pihak_id: guarantorId,
            pihak_nama: 'Penjamin Uji',
            nilai: '60000',
            sisa: '60000',
        });
        const noGuarantor = Bun.randomUUIDv7();
        await charges.completedVisit(noGuarantor, ['10000'], {
            automatic_payment_method_id: methods.BPJ,
        });
        expect(await receivable(noGuarantor)).toMatchObject({
            pihak_jenis: 'pasien',
            pihak_nama: 'Pasien Uji',
        });

        await paidOff(opened.id, '60000');
        const refusal = await charges.withDatabase(async (db) => {
            try {
                await db.transaction(() =>
                    lockChargeForChange(db, {
                        tenantId,
                        sourceModule: 'healthcare',
                        visitId,
                    }),
                );
                return null;
            } catch (error) {
                if (error instanceof HttpFailure) return error.body;
                throw error;
            }
        });
        expect(refusal).toEqual({
            message: outstandingPaymentMessage,
            errors: { _form: [outstandingPaymentMessage] },
        });
        expect(await receivable(visitId)).toMatchObject({
            sisa: '0',
            status: 'lunas',
        });
    });

    test('Clerk End counts cash payoffs as money in the drawer, and a closed clerk takes no payoff and cancels none', async () => {
        const current = async () =>
            (
                await json<{ data: { id: string; version: number } }>(
                    await cashier.get('/api/v1/billing/clerks/current'),
                    200,
                )
            ).data;
        const end = async (counted: string) => {
            const clerk = await current();
            return json<{
                data: { transactions: number; system_total: string };
            }>(
                await cashier.post(`/api/v1/billing/clerks/${clerk.id}/end`, {
                    password: testPassword,
                    counts: { [methods.TUN!]: counted },
                    version: clerk.version,
                }),
                200,
            );
        };
        await end('0');
        await json(
            await cashier.post('/api/v1/billing/clerks/start', {
                password: testPassword,
            }),
            201,
        );
        const { visitId } = await bon('100000');
        const opened = await receivable(visitId);
        const cash = await paidOff(opened.id, '40000');
        const clerkId = (await current()).id;
        const ended = await end('40000');
        expect(ended.data).toMatchObject({
            transactions: 2,
            system_total: '140000',
        });
        const [drawer] = await pool.unsafe<{ jumlah_sistem: string }[]>(
            `select trim_scale(jumlah_sistem)::text as jumlah_sistem from clerk_detail
             where clerk_id = $1 and jenis_bayar_id = $2`,
            [clerkId, methods.TUN!],
        );
        expect(drawer?.jumlah_sistem).toBe('40000');
        expect(
            await refused(
                await payoff({
                    receivable_id: opened.id,
                    payment_method_id: methods.TUN,
                    amount: '1000',
                }),
            ),
        ).toEqual({ _form: [clerkNotStartedMessage] });
        expect(await refused(await cancelPayoff(cash))).toEqual({
            _form: [closedClerkMessage],
        });
    });
});
