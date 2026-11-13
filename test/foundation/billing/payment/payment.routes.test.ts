import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
    chargeLockedMessage,
    clerkNotStartedMessage,
    lockChargeForChange,
    registerBillingEventHandlers,
} from '../../../../src/foundation/billing/index.ts';
import { Database } from '../../../../src/platform/database/index.ts';
import { publishEvent } from '../../../../src/platform/events/index.ts';
import {
    createBillingBusiness,
    json,
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
import { testPassword } from '../../../support/tenant-fixtures.ts';

// Simpan pembayaran kasir lewat aplikasi sungguhan, diperiksa dengan SQL langsung: clerk wajib, rumus layar Kuta, sisa
// ke Pasien BON, satu pembayaran per kunjungan, event billing.invoice.posted, kunci perubahan biaya sesudah bayar, dan
// Clerk End yang kini menghitung jumlah sistem dari pembayaran.
describe.skipIf(!process.env.DB_HOST)('billing payments', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    let tenantId: string;
    let legalEntityId: string;
    let cashier: Browser;
    const methods: Record<string, string> = {};
    let merchantId: string;
    const visits = { first: Bun.randomUUIDv7(), second: Bun.randomUUIDv7() };

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
    async function completedVisit(visitId: string, tariffs: string[]) {
        await publish('healthcare.visit.completed.v1', {
            visit_id: visitId,
            registration_number: `REG-${visitId.slice(-4)}`,
            date: '2026-11-13',
            registered_at: '2026-11-13T01:00:00Z',
            patient: {
                id: Bun.randomUUIDv7(),
                medical_record_number: visitId.slice(-6),
                name: 'Pasien Bayar',
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
            lines: tariffs.map((tariff, index) => ({
                line_id: Bun.randomUUIDv7(),
                procedure_id: Bun.randomUUIDv7(),
                procedure_code: `J-${index}`,
                procedure_name: `Tindakan ${index}`,
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
            })),
        });
    }
    const pay = (visitId: string, body: Record<string, unknown>) =>
        cashier.post(`/api/v1/billing/visits/${visitId}/payments`, body);
    const lock = (visitId: string) =>
        withDatabase((db) =>
            db.transaction(() =>
                lockChargeForChange(db, {
                    tenantId,
                    sourceModule: 'healthcare',
                    visitId,
                }),
            ),
        );

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Pembayaran',
            [
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
            ],
        );
        tenantId = business.tenantId;
        legalEntityId = business.legalEntityId;
        cashier = business.admin;
        for (const method of [
            { code: 'TUN', behavior: 'tunai', counted_at_close: true },
            {
                code: 'BNK',
                behavior: 'non_tunai',
                requires_merchant: true,
                allows_surcharge: true,
                counted_at_close: true,
            },
            {
                code: 'KRE',
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
        merchantId = (
            await json<{ data: { id: string } }>(
                await cashier.post('/api/v1/billing/merchants', {
                    code: 'EDC',
                    name: 'EDC',
                }),
                201,
            )
        ).data.id;
        await completedVisit(visits.first, ['150000', '25000']);
        await completedVisit(visits.second, ['40000']);
    });

    test('paying before Clerk Start is refused with the legacy message', async () => {
        expect(
            await refused(await pay(visits.first, { received: '175000' })),
        ).toEqual({
            _form: [clerkNotStartedMessage],
        });
        await json(
            await cashier.post('/api/v1/billing/clerks/start', {
                password: testPassword,
            }),
            201,
        );
    });

    test('a remainder without Pasien BON and a card without a merchant are refused with the legacy messages', async () => {
        expect(
            await refused(await pay(visits.first, { received: '100000' })),
        ).toEqual({
            _form: ['Masih terdapat Sisa pembayaran!!'],
        });
        expect(
            await refused(
                await pay(visits.first, {
                    lines: [
                        { payment_method_id: methods.BNK, amount: '175000' },
                    ],
                }),
            ),
        ).toEqual({
            'lines.0.merchant_id': ['Anda belum memilih Merchan Bank!'],
        });
    });

    test('cash, card, and Pasien BON settle the Kuta value, bill the open charges, and tell finance once', async () => {
        const created = await json<{ data: { id: string; number: string } }>(
            await pay(visits.first, {
                received: '100000',
                lines: [
                    {
                        payment_method_id: methods.BNK,
                        amount: '50000',
                        merchant_id: merchantId,
                    },
                ],
                take_remainder: true,
            }),
            201,
        );
        expect(created.data.number).toMatch(/^KSR-\d{8}$/);
        const [payment] = await pool.unsafe<Record<string, string>[]>(
            `select nilai::text, jumlah_bayar::text, nilai_kembalian::text, status from kasir where id = $1`,
            [created.data.id],
        );
        expect(payment).toEqual({
            nilai: '175000.0000',
            jumlah_bayar: '100000.0000',
            nilai_kembalian: '0.0000',
            status: 'diposting',
        });
        const details = await pool.unsafe<{ kode: string; nilai: string }[]>(
            `select j.kode, d.nilai::text from kasir_detail d join jenis_bayar j on j.id = d.jenis_bayar_id
             where d.kasir_id = $1 order by j.kode`,
            [created.data.id],
        );
        expect([...details]).toEqual([
            { kode: 'BNK', nilai: '50000.0000' },
            { kode: 'KRE', nilai: '25000.0000' },
            { kode: 'TUN', nilai: '100000.0000' },
        ]);
        const [billed] = await pool.unsafe<{ open: number; billed: number }[]>(
            `select count(*) filter (where status = 'terbuka')::int as open,
                    count(*) filter (where status = 'ditagih' and kasir_id = $2)::int as billed
             from kunjungan_kasir_detail where kunjungan_id = $1 and deleted_at is null`,
            [visits.first, created.data.id],
        );
        expect(billed).toEqual({ open: 0, billed: 2 });
        const contract = await eventContract('billing.invoice.posted.v1');
        const sent = (
            await outboxEnvelopes(pool, tenantId, 'billing.invoice.posted.v1')
        ).filter((envelope) => envelope.data.visit_id === visits.first);
        expect(sent).toHaveLength(1);
        expect(contract.safeParse(sent[0]).error).toBeUndefined();
        expect((await pay(visits.first, { received: '175000' })).status).toBe(
            409,
        );
    });

    test('changing the charges of a paid visit is refused with the legacy message', async () => {
        const failure = await lock(visits.first).catch(
            (error: unknown) => error,
        );
        expect(JSON.stringify(failure)).toContain(chargeLockedMessage);
    });

    test('a charge change and a payment on the same visit run one after the other, and the payment then locks it', async () => {
        let release = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        let pid = 0;
        let taken = () => {};
        const lockTaken = new Promise<void>((resolve) => (taken = resolve));
        const holder = withDatabase((db) =>
            db.transaction(async () => {
                await lockChargeForChange(db, {
                    tenantId,
                    sourceModule: 'healthcare',
                    visitId: visits.second,
                });
                pid =
                    (
                        await db.one(
                            z.object({ pid: z.number() }),
                            'select pg_backend_pid() as pid',
                        )
                    )?.pid ?? 0;
                taken();
                await held;
            }),
        );
        await lockTaken;
        const payment = pay(visits.second, { received: '40000' });
        let waiting = false;
        for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
            const [row] = await pool.unsafe<{ waiting: boolean }[]>(
                'select exists (select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as waiting',
                [pid],
            );
            waiting = Boolean(row?.waiting);
            if (!waiting) await Bun.sleep(25);
        }
        expect(waiting).toBe(true);
        release();
        await holder;
        expect((await payment).status).toBe(201);
        const failure = await lock(visits.second).catch(
            (error: unknown) => error,
        );
        expect(JSON.stringify(failure)).toContain(chargeLockedMessage);
    });

    test('Clerk End counts the payments of the session per method', async () => {
        const current = await json<{
            data: { id: string; version: number };
        }>(await cashier.get('/api/v1/billing/clerks/current'), 200);
        const ended = await json<{
            data: {
                transactions: number;
                system_total: string;
                lines: {
                    code: string;
                    system_amount: string;
                    difference: string;
                }[];
            };
        }>(
            await cashier.post(
                `/api/v1/billing/clerks/${current.data.id}/end`,
                {
                    password: testPassword,
                    counts: {
                        [methods.TUN!]: '140000',
                        [methods.BNK!]: '50000',
                    },
                    version: current.data.version,
                },
            ),
            200,
        );
        expect(ended.data.transactions).toBe(2);
        expect(ended.data.system_total).toBe('215000');
        expect(
            ended.data.lines.map((line) => [
                line.code,
                line.system_amount,
                line.difference,
            ]),
        ).toEqual([
            ['BNK', '50000', '0'],
            ['TUN', '140000', '0'],
        ]);
    });
});
