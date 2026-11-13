import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    automaticCancelReason,
    lockChargeForChange,
    patientTypeMessage,
    registerBillingEventHandlers,
} from '../../../../src/foundation/billing/index.ts';
import { publishEvent } from '../../../../src/platform/events/index.ts';
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

type Method = { refusal: string | null; id: string };

// Pembatas jenis bayar per tipe pasien dan bayar otomatis, dari potret kunjungan selesai yang dikirim layanan
// kesehatan, lewat aplikasi sungguhan dan diperiksa dengan SQL langsung.
describe.skipIf(!process.env.DB_HOST)('billing patient type payments', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    let tenantId: string;
    let legalEntityId: string;
    let cashier: Browser;
    let charges: ReturnType<typeof visitCharges>;
    let approver: { email: string; password: string };
    const methods: Record<string, string> = {};

    const pay = (visitId: string, body: Record<string, unknown>) =>
        cashier.post(`/api/v1/billing/visits/${visitId}/payments`, body);
    const paymentsOf = (visitId: string) =>
        pool.unsafe<
            {
                id: string;
                version: number;
                nilai: string;
                status: string;
                otomatis: boolean;
                clerk_id: string | null;
            }[]
        >(
            `select id, version, trim_scale(nilai)::text as nilai, status, otomatis, clerk_id
             from kasir where tenant_id = $1 and kunjungan_id = $2 order by created_at, id`,
            [tenantId, visitId],
        );

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Tipe Pasien',
            [
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
            ],
        );
        tenantId = business.tenantId;
        legalEntityId = business.legalEntityId;
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
            { code: 'PRS', behavior: 'penjamin', party: 'penjamin_kunjungan' },
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
        await json(
            await cashier.post('/api/v1/billing/clerks/start', {
                password: testPassword,
            }),
            201,
        );
    });

    test('a method reserved for another patient type is refused on the server with the legacy message, and the form knows it', async () => {
        const visitId = Bun.randomUUIDv7();
        await charges.completedVisit(visitId, ['150000'], {
            restricted_payment_method_ids: [methods.PRS, methods.BPJ],
        });
        expect(
            await refused(
                await pay(visitId, {
                    lines: [
                        { payment_method_id: methods.PRS, amount: '150000' },
                    ],
                }),
            ),
        ).toEqual({ 'lines.0.amount': [patientTypeMessage] });
        const form = await json<{
            data: { payment_methods: (Method & { label: string })[] };
        }>(await cashier.get(`/api/v1/billing/visits/${visitId}`), 200);
        expect(
            form.data.payment_methods.map((method) => [
                method.label,
                method.refusal,
            ]),
        ).toEqual([
            ['BPJ', patientTypeMessage],
            ['PRS', patientTypeMessage],
            ['TUN', null],
        ]);
        expect([...(await paymentsOf(visitId))]).toEqual([]);
        expect((await pay(visitId, { received: '150000' })).status).toBe(201);
    });

    test('a visit whose patient type settles automatically is paid in full with that method when it completes', async () => {
        const visitId = Bun.randomUUIDv7();
        await charges.completedVisit(visitId, ['150000', '25000'], {
            restricted_payment_method_ids: [methods.PRS],
            automatic_payment_method_id: methods.BPJ,
        });
        const [payment, ...others] = await paymentsOf(visitId);
        expect(others).toEqual([]);
        expect(payment).toMatchObject({
            nilai: '175000',
            status: 'diposting',
            otomatis: true,
            clerk_id: null,
        });
        const details = await pool.unsafe<{ kode: string; nilai: string }[]>(
            `select j.kode, trim_scale(d.nilai)::text as nilai
             from kasir_detail d join jenis_bayar j on j.id = d.jenis_bayar_id where d.kasir_id = $1`,
            [payment!.id],
        );
        expect([...details]).toEqual([{ kode: 'BPJ', nilai: '175000' }]);
        const [billed] = await pool.unsafe<{ open: number }[]>(
            `select count(*) filter (where status = 'terbuka')::int as open
             from kunjungan_kasir_detail where kunjungan_id = $1 and deleted_at is null`,
            [visitId],
        );
        expect(billed?.open).toBe(0);
        const contract = await eventContract('billing.invoice.posted.v1');
        const sent = (
            await outboxEnvelopes(pool, tenantId, 'billing.invoice.posted.v1')
        ).filter((envelope) => envelope.data.visit_id === visitId);
        expect(sent).toHaveLength(1);
        expect(contract.safeParse(sent[0]).error).toBeUndefined();
        // Kunjungan yang selesai lagi tidak dibayar dua kali.
        await charges.publish('healthcare.visit.completed.v1', {
            visit_id: visitId,
            registration_number: `REG-${visitId.slice(-4)}`,
            date: '2026-11-13',
            registered_at: '2026-11-13T01:00:00Z',
            patient: {
                id: Bun.randomUUIDv7(),
                medical_record_number: visitId.slice(-6),
                name: 'Pasien Uji',
            },
            patient_type: { id: Bun.randomUUIDv7(), name: 'BPJS' },
            guarantor: null,
            card_number: null,
            sections: [{ id: Bun.randomUUIDv7(), name: 'Poli Umum' }],
            restricted_payment_method_ids: [],
            automatic_payment_method_id: methods.BPJ,
        });
        expect(await paymentsOf(visitId)).toHaveLength(1);
    });

    test('an automatic payment follows its bill: drugs prepared after the visit completes settle it again', async () => {
        const visitId = Bun.randomUUIDv7();
        await charges.completedVisit(visitId, ['60000'], {
            automatic_payment_method_id: methods.BPJ,
        });
        await charges.withDatabase((db) =>
            db.transaction(async () => {
                await lockChargeForChange(db, {
                    tenantId,
                    sourceModule: 'healthcare',
                    visitId,
                });
                await publishEvent(db, {
                    type: 'pharmacy.dispensing.charges-replaced.v1',
                    tenantId,
                    legalEntityId,
                    data: {
                        dispensing_id: Bun.randomUUIDv7(),
                        dispensing_number: 'FAR-1',
                        prescription_id: Bun.randomUUIDv7(),
                        prescription_number: 'RSP-1',
                        visit_id: visitId,
                        registration_number: `REG-${visitId.slice(-4)}`,
                        date: '2026-11-13',
                        includes_service: false,
                        lines: [
                            {
                                line_id: Bun.randomUUIDv7(),
                                item: {
                                    id: Bun.randomUUIDv7(),
                                    code: 'OBT',
                                    name: 'Obat',
                                },
                                quantity: '2',
                                unit_price: '5000',
                                discount_percent: '0',
                            },
                        ],
                    },
                });
            }),
        );
        const payments = await pool.unsafe<
            {
                nilai: string;
                status: string;
                otomatis: boolean;
                alasan: string | null;
            }[]
        >(
            `select trim_scale(nilai)::text as nilai, status, otomatis, alasan_batal as alasan
             from kasir where tenant_id = $1 and kunjungan_id = $2 order by created_at, id`,
            [tenantId, visitId],
        );
        expect([...payments]).toEqual([
            {
                nilai: '60000',
                status: 'batal',
                otomatis: true,
                alasan: automaticCancelReason,
            },
            {
                nilai: '70000',
                status: 'diposting',
                otomatis: true,
                alasan: null,
            },
        ]);
    });

    test('an automatic payment belongs to no clerk and can still be cancelled, after which the cashier pays the visit', async () => {
        const visitId = Bun.randomUUIDv7();
        await charges.completedVisit(visitId, ['60000'], {
            automatic_payment_method_id: methods.BPJ,
        });
        const [payment] = await paymentsOf(visitId);
        const cancel = await cashier.post(
            `/api/v1/billing/payments/${payment?.id}/cancel`,
            {
                version: payment?.version,
                reason: 'Tipe pasien salah',
                approver_email: approver.email,
                approver_password: approver.password,
            },
        );
        expect(cancel.status).toBe(200);
        expect((await paymentsOf(visitId))[0]?.status).toBe('batal');
        expect((await pay(visitId, { received: '60000' })).status).toBe(201);
    });

    test('an automatic method that can no longer settle on its own is skipped, and the cashier pays the visit', async () => {
        const visitId = Bun.randomUUIDv7();
        await charges.completedVisit(visitId, ['80000'], {
            automatic_payment_method_id: methods.TUN,
        });
        expect([...(await paymentsOf(visitId))]).toEqual([]);
        expect((await pay(visitId, { received: '80000' })).status).toBe(201);
    });
});
