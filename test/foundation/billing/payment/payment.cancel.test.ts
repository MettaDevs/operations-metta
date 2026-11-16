import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    chargeLockedMessage,
    closedClerkMessage,
    lockChargeForChange,
    registerBillingEventHandlers,
} from '../../../../src/foundation/billing/index.ts';
import { Database } from '../../../../src/platform/database/index.ts';
import { publishEvent } from '../../../../src/platform/events/index.ts';
import { HttpFailure } from '../../../../src/platform/http/index.ts';
import {
    createBillingBusiness,
    json,
    payVisit,
    refused,
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
    grantAllOrganizations,
    testPassword,
} from '../../../support/tenant-fixtures.ts';

type Payment = { id: string; version: number; number: string };

// Batal pembayaran kasir lewat aplikasi sungguhan, diperiksa dengan SQL langsung: hanya pengguna yang memegang izin batal
// pembayaran yang boleh membatalkan, alasan wajib, TglBatal, BATAL, AlasanBatal, dan siapa yang membatalkan tercatat,
// baris biaya kunjungan terbuka lagi sehingga kunci perubahan biaya lepas, finance diberi tahu sekali dengan angka yang
// sama dengan saat bayar, termasuk jumlah valuta dan kursnya, dan pembayaran di clerk yang sudah Clerk End tidak bisa
// dibatalkan.
describe.skipIf(!process.env.DB_HOST)('billing payment cancel', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    const foreign = 'XTS';
    let tenantId: string;
    let legalEntityId: string;
    let cashier: Browser;
    let cashierUserId: string;
    const methods: Record<string, string> = {};
    const visits = {
        local: Bun.randomUUIDv7(),
        foreign: Bun.randomUUIDv7(),
        closed: Bun.randomUUIDv7(),
    };

    async function withDatabase<T>(work: (db: Database) => Promise<T>) {
        const connection = await pool.reserve();
        try {
            return await work(
                new Database(connection, undefined, Bun.randomUUIDv7()),
            );
        } finally {
            connection.release();
        }
    }
    const publish = (type: string, data: Record<string, unknown>) =>
        withDatabase((db) =>
            db.transaction(() =>
                publishEvent(db, {
                    type: type as `${string}.${string}.${string}.v1`,
                    tenantId,
                    legalEntityId,
                    data: data as Record<string, string>,
                }),
            ),
        );
    async function completedVisit(visitId: string, tariff: string) {
        await publish('healthcare.visit.completed.v1', {
            visit_id: visitId,
            registration_number: `REG-${visitId.slice(-4)}`,
            date: '2026-11-13',
            registered_at: '2026-11-13T01:00:00Z',
            patient: {
                id: Bun.randomUUIDv7(),
                medical_record_number: visitId.slice(-6),
                name: 'Pasien Batal',
            },
            patient_type: { id: Bun.randomUUIDv7(), name: 'UMUM' },
            guarantor: null,
            card_number: null,
            sections: [{ id: Bun.randomUUIDv7(), name: 'Poli Umum' }],
        });
        await publish('healthcare.examination.charges-replaced.v1', {
            examination_id: Bun.randomUUIDv7(),
            visit_id: visitId,
            registration_number: `REG-${visitId.slice(-4)}`,
            lines: [
                {
                    line_id: Bun.randomUUIDv7(),
                    procedure_id: Bun.randomUUIDv7(),
                    procedure_code: 'J-1',
                    procedure_name: 'Tindakan',
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
    }
    async function pay(visitId: string, body: Record<string, unknown>) {
        const created = await json<{ data: { id: string; number: string } }>(
            await payVisit(cashier, visitId, body),
            201,
        );
        const [row] = await pool.unsafe<{ version: number }[]>(
            'select version from kasir where id = $1',
            [created.data.id],
        );
        return { ...created.data, version: row?.version ?? 0 };
    }
    const cancel = (payment: Payment, body: Record<string, unknown>) =>
        cashier.post(`/api/v1/billing/payments/${payment.id}/cancel`, {
            version: payment.version,
            ...body,
        });
    const withReason = { reason: 'Salah pilih pasien' };
    // Penolakan kunci perubahan biaya kunjungan itu, atau null bila biayanya boleh diubah.
    const lockRefusal = (visitId: string) =>
        withDatabase(async (db) => {
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
    const envelopes = async (type: string, paymentId: string) =>
        (await outboxEnvelopes(pool, tenantId, type)).filter(
            (envelope) => envelope.data.payment_id === paymentId,
        );

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Batal Bayar',
            [
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
                'core.payment-cancel.approve',
                'core.reference-data.manage',
            ],
        );
        tenantId = business.tenantId;
        legalEntityId = business.legalEntityId;
        cashier = business.admin;
        cashierUserId = business.member.userId;
        await json(
            await cashier.post('/api/v1/currencies', {
                currency_code: foreign,
                amount_decimals: 2,
                unit_amount_decimals: 4,
                invoice_rounding_precision: '0',
                invoice_rounding_type: 'nearest',
            }),
            201,
        );
        await json(
            await cashier.post('/api/v1/exchange-rates', {
                currency_code: foreign,
                starting_date: '2000-01-01',
                rate: '16250.5',
            }),
            201,
        );
        for (const method of [
            { code: 'TUN', behavior: 'tunai', counted_at_close: true },
            {
                code: foreign,
                behavior: 'tunai',
                currency_code: foreign,
                counted_at_close: true,
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
        await completedVisit(visits.local, '175000');
        await completedVisit(visits.foreign, '200000');
        await completedVisit(visits.closed, '50000');
        await json(
            await cashier.post('/api/v1/billing/clerks/start', {
                password: testPassword,
            }),
            201,
        );
    });

    test('a cancel needs a reason, and a cashier without the cancel permission neither sees Batal nor may cancel', async () => {
        const payment = await pay(visits.local, { received: '200000' });
        expect(await refused(await cancel(payment, {}))).toEqual({
            reason: ['Isi alasan batal.'],
        });
        const colleague = await createMember(pool, tenantId, [
            'core.clerk.operate',
            'core.payment.operate',
        ]);
        await grantAllOrganizations(pool, tenantId, colleague.membershipId);
        const other = browser();
        await other.login(colleague.email, colleague.password);
        const shown = async (member: Browser) =>
            (
                await json<{ data: { can_cancel: boolean } }>(
                    await member.get(`/api/v1/billing/visits/${visits.local}`),
                    200,
                )
            ).data.can_cancel;
        expect(await shown(cashier)).toBe(true);
        expect(await shown(other)).toBe(false);
        expect(
            (
                await other.post(
                    `/api/v1/billing/payments/${payment.id}/cancel`,
                    {
                        version: payment.version,
                        ...withReason,
                    },
                )
            ).status,
        ).toBe(403);
        const [still] = await pool.unsafe<{ status: string }[]>(
            'select status from kasir where id = $1',
            [payment.id],
        );
        expect(still?.status).toBe('diposting');
    });

    test('a cancel records TglBatal, BATAL, AlasanBatal, and who cancelled, opens the charge lines, releases the change lock, and tells finance once', async () => {
        const [payment] = await pool.unsafe<Payment[]>(
            "select id, version, no_bukti as number from kasir where sumber_dokumen_id = $1 and status = 'diposting'",
            [visits.local],
        );
        if (!payment) throw new Error('The visit is not paid.');
        expect(await lockRefusal(visits.local)).toEqual({
            message: chargeLockedMessage,
            errors: { _form: [chargeLockedMessage] },
        });
        const result = await json<{ message: string }>(
            await cancel(payment, withReason),
            200,
        );
        expect(result.message).toBe('Item data baru berhasil dibatalkan!');
        const [stored] = await pool.unsafe<Record<string, unknown>[]>(
            `select status, tgl_batal is not null as dated, alasan_batal, dibatalkan_oleh_user_id
             from kasir where id = $1`,
            [payment.id],
        );
        expect(stored).toEqual({
            status: 'batal',
            dated: true,
            alasan_batal: 'Salah pilih pasien',
            dibatalkan_oleh_user_id: cashierUserId,
        });
        expect([
            ...(await pool.unsafe<{ status: string; kasir_id: null }[]>(
                'select status, kasir_id from tagihan_kasir_detail where tagihan_sumber_dokumen_id = $1',
                [visits.local],
            )),
        ]).toEqual([{ status: 'terbuka', kasir_id: null }]);
        expect(await lockRefusal(visits.local)).toBeNull();

        const contract = await eventContract('billing.invoice.cancelled.v1');
        const sent = await envelopes(
            'billing.invoice.cancelled.v1',
            payment.id,
        );
        expect(sent).toHaveLength(1);
        expect(contract.safeParse(sent[0]).error).toBeUndefined();
        const [posted] = await envelopes(
            'billing.invoice.posted.v1',
            payment.id,
        );
        expect(sent[0]?.data).toMatchObject({
            payment_number: payment.number,
            visit_id: visits.local,
            value: '175000',
            reason: 'Salah pilih pasien',
            payments: posted?.data.payments,
        });

        expect(
            (
                await cancel(
                    { ...payment, version: payment.version + 1 },
                    withReason,
                )
            ).status,
        ).toBe(409);
        // Kunjungan kembali belum dibayar dan bisa dibayar lagi dengan nomor baru.
        const again = await pay(visits.local, { received: '175000' });
        expect(again.number).not.toBe(payment.number);
    });

    test('a foreign-currency payment cancels with its rate and amounts kept as recorded', async () => {
        const payment = await pay(visits.foreign, {
            lines: [{ payment_method_id: methods[foreign], amount: '12.35' }],
        });
        const lines = () =>
            pool.unsafe<Record<string, string>[]>(
                `select jenis_bayar_id, mata_uang, trim_scale(nilai_valuta)::text as nilai_valuta,
                        trim_scale(kurs)::text as kurs, trim_scale(nilai)::text as nilai
                 from kasir_detail where kasir_id = $1 order by jenis_bayar_id`,
                [payment.id],
            );
        const before = [...(await lines())];
        await json(await cancel(payment, withReason), 200);
        expect([...(await lines())]).toEqual(before);
        const [sent] = await envelopes(
            'billing.invoice.cancelled.v1',
            payment.id,
        );
        expect(sent?.data.payments).toContainEqual({
            payment_method_id: methods[foreign],
            amount: '200694',
            currency_code: foreign,
            currency_amount: '12.35',
            exchange_rate: '16250.5',
        });
    });

    test('Clerk End leaves the cancelled payments out, and a payment in an ended clerk cannot be cancelled', async () => {
        const payment = await pay(visits.closed, { received: '50000' });
        const current = await json<{ data: { id: string; version: number } }>(
            await cashier.get('/api/v1/billing/clerks/current'),
            200,
        );
        const ended = await json<{
            data: { transactions: number; system_total: string };
        }>(
            await cashier.post(
                `/api/v1/billing/clerks/${current.data.id}/end`,
                {
                    password: testPassword,
                    counts: {},
                    version: current.data.version,
                },
            ),
            200,
        );
        // Empat pembayaran di sesi ini, dua di antaranya dibatalkan: 175.000 + 50.000.
        expect([ended.data.transactions, ended.data.system_total]).toEqual([
            2,
            '225000',
        ]);
        expect(await refused(await cancel(payment, withReason))).toEqual({
            _form: [closedClerkMessage],
        });
    });
});
