import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    approvalMessage,
    automaticPaymentMessage,
    clerkNotStartedMessage,
    closedClerkMessage,
    openClerkPaymentMessage,
    outstandingPaymentMessage,
    registerBillingEventHandlers,
} from '../../../../src/foundation/billing/index.ts';
import {
    createBillingBusiness,
    json,
    refused,
    visitCharges,
} from '../../../support/billing-fixtures.ts';
import {
    eventContract,
    outboxEnvelopes,
} from '../../../support/event-contracts.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';
import {
    createMember,
    testPassword,
} from '../../../support/tenant-fixtures.ts';

type Clerk = {
    data: {
        id: string;
        version: number;
        transactions: number;
        system_total: string;
        lines: { payment_method_id: string; system_amount: string | null }[];
    };
};

// Nota kredit lewat aplikasi sungguhan, diperiksa dengan SQL langsung: pembayaran yang clerk-nya sudah Clerk End hanya
// bisa dikoreksi lewat nota kredit di clerk kasir yang sedang berjalan, uang yang diterima dikembalikan per jenis bayar
// persis seperti saat dibayar, piutangnya dibatalkan, kunjungannya bisa dibayar lagi, dan Clerk End clerk nota itu
// mengurangkan pengembaliannya.
describe.skipIf(!process.env.DB_HOST)('billing credit memo', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    let tenantId: string;
    let cashier: Browser;
    let cashierUserId: string;
    let approver: { userId: string; email: string; password: string };
    let charges: ReturnType<typeof visitCharges>;
    let merchantId: string;
    let endedClerkId: string;
    let memoClerkId: string;
    const methods: Record<string, string> = {};
    const visits = {
        cash: Bun.randomUUIDv7(),
        mixed: Bun.randomUUIDv7(),
        paidOff: Bun.randomUUIDv7(),
        automatic: Bun.randomUUIDv7(),
    };
    const payments = { cash: '', mixed: '', paidOff: '' };

    const pay = (visitId: string, body: Record<string, unknown>) =>
        cashier.post(`/api/v1/billing/visits/${visitId}/payments`, body);
    async function paid(visitId: string, body: Record<string, unknown>) {
        return (
            await json<{ data: { id: string; number: string } }>(
                await pay(visitId, body),
                201,
            )
        ).data;
    }
    const version = async (paymentId: string) =>
        (
            await pool.unsafe<{ version: number }[]>(
                'select version from kasir where id = $1',
                [paymentId],
            )
        )[0]?.version;
    const approved = {
        reason: 'Pasien membatalkan tindakan',
        get approver_email() {
            return approver.email;
        },
        get approver_password() {
            return approver.password;
        },
    };
    const creditMemo = async (
        paymentId: string,
        body: Record<string, unknown> = approved,
    ) =>
        cashier.post(`/api/v1/billing/payments/${paymentId}/credit-memo`, {
            version: await version(paymentId),
            ...body,
        });
    const cancel = async (paymentId: string) =>
        cashier.post(`/api/v1/billing/payments/${paymentId}/cancel`, {
            version: await version(paymentId),
            ...approved,
        });
    async function startClerk() {
        await json(
            await cashier.post('/api/v1/billing/clerks/start', {
                password: testPassword,
            }),
            201,
        );
        return (
            await json<Clerk>(
                await cashier.get('/api/v1/billing/clerks/current'),
                200,
            )
        ).data.id;
    }
    async function endClerk() {
        const current = await json<Clerk>(
            await cashier.get('/api/v1/billing/clerks/current'),
            200,
        );
        return (
            await json<Clerk>(
                await cashier.post(
                    `/api/v1/billing/clerks/${current.data.id}/end`,
                    {
                        password: testPassword,
                        counts: {},
                        version: current.data.version,
                    },
                ),
                200,
            )
        ).data;
    }
    const memoOf = (paymentId: string) =>
        pool.unsafe<Record<string, unknown>[]>(
            `select no_bukti, clerk_id, user_id, penyetuju_user_id, alasan, trim_scale(nilai)::text as nilai
             from nota_kredit where kasir_id = $1`,
            [paymentId],
        );
    const refundsOf = async (paymentId: string) => [
        ...(await pool.unsafe<Record<string, string | null>[]>(
            `select j.kode, trim_scale(d.nilai)::text as nilai, d.mata_uang, trim_scale(d.nilai_valuta)::text as nilai_valuta,
                    trim_scale(d.kurs)::text as kurs, d.merchan_id, d.referensi
             from nota_kredit_detail d
             join nota_kredit n on n.id = d.nota_kredit_id
             join jenis_bayar j on j.id = d.jenis_bayar_id
             where n.kasir_id = $1 order by j.kode`,
            [paymentId],
        )),
    ];
    const sentFor = async (paymentId: string) =>
        (
            await outboxEnvelopes(
                pool,
                tenantId,
                'billing.credit-memo.posted.v1',
            )
        ).filter((envelope) => envelope.data.payment_id === paymentId);

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Nota Kredit',
            [
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
            ],
        );
        tenantId = business.tenantId;
        cashier = business.admin;
        cashierUserId = business.member.userId;
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
                counted_at_close: true,
            },
            {
                code: 'BON',
                behavior: 'piutang',
                party: 'pasien',
                takes_remainder: true,
            },
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
        await charges.completedVisit(visits.cash, ['175000']);
        await charges.completedVisit(visits.mixed, ['300000']);
        await charges.completedVisit(visits.paidOff, ['80000']);
        await charges.completedVisit(visits.automatic, ['60000'], {
            automatic_payment_method_id: methods.BPJ,
        });

        endedClerkId = await startClerk();
        // Tunai 200.000 untuk tagihan 175.000: yang tinggal di laci 175.000, kembaliannya 25.000.
        payments.cash = (await paid(visits.cash, { received: '200000' })).id;
        // Tunai 150.000, kartu 100.000, dan sisa 50.000 menjadi bon pasien.
        payments.mixed = (
            await paid(visits.mixed, {
                received: '150000',
                take_remainder: true,
                lines: [
                    {
                        payment_method_id: methods.KRT,
                        amount: '100000',
                        merchant_id: merchantId,
                        reference: '4111-XXXX',
                    },
                ],
            })
        ).id;
        payments.paidOff = (
            await paid(visits.paidOff, { received: '0', take_remainder: true })
        ).id;
        const [receivable] = await pool.unsafe<{ id: string }[]>(
            'select id from piutang where kasir_id = $1',
            [payments.paidOff],
        );
        await json(
            await cashier.post('/api/v1/billing/receivable-payments', {
                receivable_id: receivable?.id,
                payment_method_id: methods.TUN,
                amount: '10000',
            }),
            201,
        );
    });

    test('a payment whose clerk is still open is corrected with Batal, not a credit memo', async () => {
        expect(await refused(await creditMemo(payments.cash))).toEqual({
            _form: [openClerkPaymentMessage],
        });
        const form = await json<{
            data: { payment: { clerk_ended: boolean; credit_memo: null } };
        }>(await cashier.get(`/api/v1/billing/visits/${visits.cash}`), 200);
        expect(form.data.payment).toMatchObject({
            clerk_ended: false,
            credit_memo: null,
        });
    });

    test('an automatic payment belongs to no clerk, so it is cancelled instead', async () => {
        const [automatic] = await pool.unsafe<{ id: string }[]>(
            "select id from kasir where kunjungan_id = $1 and status = 'diposting'",
            [visits.automatic],
        );
        expect(await refused(await creditMemo(automatic!.id))).toEqual({
            _form: [automaticPaymentMessage],
        });
    });

    test('after Clerk End the payment can only be corrected with a credit memo, posted in an open clerk with an approver', async () => {
        await endClerk();
        expect(await refused(await cancel(payments.cash))).toEqual({
            _form: [closedClerkMessage],
        });
        expect(await refused(await creditMemo(payments.cash))).toEqual({
            _form: [clerkNotStartedMessage],
        });
        memoClerkId = await startClerk();
        expect(
            Object.keys(await refused(await creditMemo(payments.cash, {})))
                .sort()
                .join(),
        ).toBe('approver_email,approver_password,reason');
        // Kasir itu sendiri tidak memegang hak menyetujui, dan kata sandi yang salah ditolak dengan pesan yang sama.
        const [self] = await pool.unsafe<{ email: string }[]>(
            'select email from users where id = $1',
            [cashierUserId],
        );
        for (const credentials of [
            { approver_email: self?.email, approver_password: testPassword },
            { approver_email: approver.email, approver_password: 'salah' },
        ])
            expect(
                await refused(
                    await creditMemo(payments.cash, {
                        ...credentials,
                        reason: approved.reason,
                    }),
                ),
            ).toEqual({ approver_password: [approvalMessage] });
        expect(await memoOf(payments.cash)).toHaveLength(0);

        const form = await json<{
            data: {
                payment: {
                    clerk_ended: boolean;
                    credit_memo: {
                        refunds: {
                            label: string;
                            amount: string;
                            currency_code: string;
                            currency_amount: string;
                        }[];
                        receivables: unknown[];
                    };
                };
            };
        }>(await cashier.get(`/api/v1/billing/visits/${visits.cash}`), 200);
        expect(form.data.payment.clerk_ended).toBe(true);
        expect(form.data.payment.credit_memo).toEqual({
            refunds: [
                {
                    label: 'TUN',
                    amount: '175000',
                    currency_code: 'IDR',
                    currency_amount: '175000',
                },
            ],
            receivables: [],
        });

        const posted = await json<{ data: { id: string; number: string } }>(
            await creditMemo(payments.cash),
            201,
        );
        expect(posted.data.number).toMatch(/^NK-\d{8}$/);
        expect([...(await memoOf(payments.cash))]).toEqual([
            {
                no_bukti: posted.data.number,
                clerk_id: memoClerkId,
                user_id: cashierUserId,
                penyetuju_user_id: approver.userId,
                alasan: approved.reason,
                nilai: '175000',
            },
        ]);
        expect(await refundsOf(payments.cash)).toEqual([
            {
                kode: 'TUN',
                nilai: '175000',
                mata_uang: 'IDR',
                nilai_valuta: '175000',
                kurs: '1',
                merchan_id: null,
                referensi: null,
            },
        ]);
        const [credited] = await pool.unsafe<{ status: string }[]>(
            'select status from kasir where id = $1',
            [payments.cash],
        );
        expect(credited?.status).toBe('dikreditkan');
        expect([
            ...(await pool.unsafe<{ status: string; kasir_id: null }[]>(
                'select status, kasir_id from kunjungan_kasir_detail where kunjungan_id = $1',
                [visits.cash],
            )),
        ]).toEqual([{ status: 'terbuka', kasir_id: null }]);

        const contract = await eventContract('billing.credit-memo.posted.v1');
        const sent = await sentFor(payments.cash);
        expect(sent).toHaveLength(1);
        expect(contract.safeParse(sent[0]).error).toBeUndefined();
        expect(sent[0]?.data).toMatchObject({
            credit_memo_id: posted.data.id,
            credit_memo_number: posted.data.number,
            visit_id: visits.cash,
            value: '175000',
            discount: '0',
            reason: approved.reason,
            refunds: [
                {
                    payment_method_id: methods.TUN,
                    amount: '175000',
                    currency_code: 'IDR',
                    currency_amount: '175000',
                    exchange_rate: '1',
                },
            ],
            cancelled_receivable_ids: [],
        });

        expect((await creditMemo(payments.cash)).status).toBe(409);
        // Kunjungan kembali belum dibayar, bisa dibayar lagi dengan nomor baru, dan layarnya menampilkan koreksinya.
        const list = await json<{ data: { id: string; paid: boolean }[] }>(
            await cashier.get('/api/v1/billing/visits?from=2026-11-13'),
            200,
        );
        expect(list.data.find((visit) => visit.id === visits.cash)?.paid).toBe(
            false,
        );
        const again = await paid(visits.cash, { received: '175000' });
        expect(again.number).toMatch(/^KSR-/);
        const [original] = await pool.unsafe<{ no_bukti: string }[]>(
            'select no_bukti from kasir where id = $1',
            [payments.cash],
        );
        expect(again.number).not.toBe(original?.no_bukti);
        const shown = await json<{
            data: {
                credit_memos: { number: string; payment_number: string }[];
            };
        }>(await cashier.get(`/api/v1/billing/visits/${visits.cash}`), 200);
        expect(shown.data.credit_memos).toEqual([
            {
                number: posted.data.number,
                payment_number: original?.no_bukti ?? '',
            },
        ]);
    });

    test('refunds mirror the money received, and a bon cancels its receivable instead of being refunded', async () => {
        const receivables = async () => [
            ...(await pool.unsafe<{ id: string; status: string }[]>(
                'select id, status from piutang where kasir_id = $1',
                [payments.mixed],
            )),
        ];
        const [receivable] = await receivables();
        expect(receivable?.status).toBe('terbuka');
        await json(await creditMemo(payments.mixed), 201);
        expect(await refundsOf(payments.mixed)).toEqual([
            {
                kode: 'KRT',
                nilai: '100000',
                mata_uang: 'IDR',
                nilai_valuta: '100000',
                kurs: '1',
                merchan_id: merchantId,
                referensi: '4111-XXXX',
            },
            {
                kode: 'TUN',
                nilai: '150000',
                mata_uang: 'IDR',
                nilai_valuta: '150000',
                kurs: '1',
                merchan_id: null,
                referensi: null,
            },
        ]);
        expect(await receivables()).toEqual([
            { id: receivable?.id ?? '', status: 'batal' },
        ]);
        const [sent] = await sentFor(payments.mixed);
        expect(sent?.data.cancelled_receivable_ids).toEqual([receivable?.id]);
    });

    test('a bon that has been partly paid off blocks the credit memo with the legacy message', async () => {
        expect(await refused(await creditMemo(payments.paidOff))).toEqual({
            _form: [outstandingPaymentMessage],
        });
        expect(await memoOf(payments.paidOff)).toHaveLength(0);
    });

    test('Clerk End of the clerk the memo was posted in takes the refunds out of its system amounts', async () => {
        const ended = await endClerk();
        expect(ended.id).toBe(memoClerkId);
        const system = (methodId: string | undefined) =>
            ended.lines.find((line) => line.payment_method_id === methodId)
                ?.system_amount;
        // Pembayaran ulang 175.000 tunai, dikurangi pengembalian tunai 175.000 dan 150.000 serta kartu 100.000.
        expect([
            ended.transactions,
            ended.system_total,
            system(methods.TUN),
            system(methods.KRT),
        ]).toEqual([3, '-250000', '-150000', '-100000']);
        // Clerk asal pembayaran yang dikoreksi tidak berubah.
        const [origin] = await pool.unsafe<{ jumlah_transaksi: number }[]>(
            'select jumlah_transaksi from clerk where id = $1',
            [endedClerkId],
        );
        expect(origin?.jumlah_transaksi).toBe(4);
    });
});
