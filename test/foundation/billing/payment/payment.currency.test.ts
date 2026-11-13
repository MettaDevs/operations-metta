import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { registerBillingEventHandlers } from '../../../../src/foundation/billing/index.ts';
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
import {
    setCurrencyPrecision,
    testPassword,
} from '../../../support/tenant-fixtures.ts';

// Pembayaran kasir dengan mata uang asing: jenis bayar bermata uang asing diisi dalam mata uang itu, dikali kurs Sys
// Admin › Kurs untuk tanggal pembayaran, dan kembaliannya mata uang lokal. Diperiksa dengan SQL langsung. Kode mata
// uangnya kode uji, bukan nama mata uang sungguhan.
describe.skipIf(!process.env.DB_HOST)(
    'billing payments in a foreign currency',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp({
            DB_POOL_SIZE: '8',
        });
        afterAll(close);
        const foreign = 'XTS';
        let tenantId: string;
        let legalEntityId: string;
        let roleId: string;
        let cashier: Browser;
        let today: string;
        const methods: Record<string, string> = {};
        const visits = {
            exact: Bun.randomUUIDv7(),
            cents: Bun.randomUUIDv7(),
            rate: Bun.randomUUIDv7(),
        };

        const publish = async (type: string, data: Record<string, unknown>) => {
            const connection = await pool.reserve();
            try {
                const db = new Database(
                    connection,
                    undefined,
                    Bun.randomUUIDv7(),
                );
                await db.transaction(() =>
                    publishEvent(db, {
                        type: type as `${string}.${string}.${string}.v1`,
                        tenantId,
                        legalEntityId,
                        data: data as Record<string, string>,
                    }),
                );
            } finally {
                connection.release();
            }
        };
        async function completedVisit(visitId: string, tariff: string) {
            await publish('healthcare.visit.completed.v1', {
                visit_id: visitId,
                registration_number: `REG-${visitId.slice(-4)}`,
                date: '2026-11-13',
                registered_at: '2026-11-13T01:00:00Z',
                patient: {
                    id: Bun.randomUUIDv7(),
                    medical_record_number: visitId.slice(-6),
                    name: 'Pasien Valuta',
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
        const pay = (visitId: string, body: Record<string, unknown>) =>
            cashier.post(`/api/v1/billing/visits/${visitId}/payments`, body);
        const details = async (paymentId: string) => [
            ...(await pool.unsafe<Record<string, string>[]>(
                `select j.kode, d.mata_uang, trim_scale(d.nilai_valuta)::text as nilai_valuta,
                    trim_scale(d.kurs)::text as kurs, trim_scale(d.kurs_bawaan)::text as kurs_bawaan,
                    trim_scale(d.nilai)::text as nilai
             from kasir_detail d join jenis_bayar j on j.id = d.jenis_bayar_id
             where d.kasir_id = $1 order by j.kode`,
                [paymentId],
            )),
        ];
        const addRate = async (starting_date: string, rate: string) =>
            json(
                await cashier.post('/api/v1/exchange-rates', {
                    currency_code: foreign,
                    starting_date,
                    rate,
                }),
                201,
            );

        beforeAll(async () => {
            registerBillingEventHandlers();
            const business = await createBillingBusiness(
                pool,
                browser,
                'Klinik Uji Valuta',
                [
                    'core.billing-setup.manage',
                    'core.clerk.operate',
                    'core.payment.operate',
                    'core.reference-data.manage',
                ],
            );
            tenantId = business.tenantId;
            legalEntityId = business.legalEntityId;
            if (!business.member.roleId)
                throw new Error('The cashier has no role.');
            roleId = business.member.roleId;
            cashier = business.admin;
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
            const [row] = await pool.unsafe<{ date: string }[]>(
                `select (now() at time zone l.timezone)::date::text as date
             from legal_entities l where l.tenant_id = $1 and l.organization_id = $2`,
                [tenantId, legalEntityId],
            );
            today = row?.date ?? '';
            for (const method of [
                { code: 'TUN', behavior: 'tunai', counted_at_close: true },
                {
                    code: foreign,
                    behavior: 'tunai',
                    currency_code: foreign.toLowerCase(),
                    counted_at_close: true,
                },
            ])
                methods[method.code] = (
                    await json<{ data: { id: string; currency_code: string } }>(
                        await cashier.post('/api/v1/billing/payment-methods', {
                            name: method.code,
                            ...method,
                        }),
                        201,
                    )
                ).data.id;
            await completedVisit(visits.exact, '200000');
            await completedVisit(visits.cents, '100000');
            await completedVisit(visits.rate, '100000');
            await json(
                await cashier.post('/api/v1/billing/clerks/start', {
                    password: testPassword,
                    opening: {
                        [methods.TUN!]: '1000000',
                        [methods[foreign]!]: '10',
                    },
                }),
                201,
            );
        });

        test('a method takes only a currency set up in Mata uang, and the method holding the remainder stays local', async () => {
            expect(
                await refused(
                    await cashier.post('/api/v1/billing/payment-methods', {
                        code: 'XXX',
                        name: 'Tidak disetel',
                        behavior: 'non_tunai',
                        currency_code: 'XXX',
                    }),
                ),
            ).toEqual({
                currency_code: [
                    'Pilih mata uang asing yang sudah disetel di Sys Admin › Mata uang, atau kosongkan untuk mata uang lokal.',
                ],
            });
            expect(
                await refused(
                    await cashier.post('/api/v1/billing/payment-methods', {
                        code: 'BON',
                        name: 'Bon',
                        behavior: 'piutang',
                        party: 'pasien',
                        takes_remainder: true,
                        currency_code: foreign,
                    }),
                ),
            ).toEqual({
                currency_code: [
                    'Jenis bayar yang menampung sisa selalu memakai mata uang lokal.',
                ],
            });
        });

        test('a foreign line without a rate for the payment date is refused with the rate message', async () => {
            expect(
                await refused(
                    await pay(visits.exact, {
                        lines: [
                            {
                                payment_method_id: methods[foreign],
                                amount: '12.35',
                            },
                        ],
                    }),
                ),
            ).toEqual({
                'lines.0.amount': [
                    `Kurs ${foreign} untuk ${today.split('-').reverse().join('/')} belum diisi. Atur di Sys Admin › Kurs.`,
                ],
            });
        });

        test('foreign cash settles the bill at the rate of the payment date, and the change comes back in local currency', async () => {
            await addRate('2000-01-01', '16250.5');
            // Kurs yang mulai berlaku sesudah tanggal pembayaran tidak dipakai.
            await addRate('2999-12-31', '99999');
            const created = await json<{ data: { id: string } }>(
                await pay(visits.exact, {
                    lines: [
                        {
                            payment_method_id: methods[foreign],
                            amount: '12.35',
                        },
                    ],
                }),
                201,
            );
            // 12,35 x 16.250,5 = 200.693,675, dibulatkan ke rupiah utuh: 200.694. Tagihan 200.000, kembalian 694 rupiah.
            const [payment] = await pool.unsafe<Record<string, string>[]>(
                `select trim_scale(nilai)::text as nilai, trim_scale(jumlah_bayar)::text as jumlah_bayar,
                    trim_scale(nilai_kembalian)::text as nilai_kembalian
             from kasir where id = $1`,
                [created.data.id],
            );
            expect(payment).toEqual({
                nilai: '200000',
                jumlah_bayar: '0',
                nilai_kembalian: '694',
            });
            expect(await details(created.data.id)).toEqual([
                {
                    kode: 'TUN',
                    mata_uang: 'IDR',
                    nilai_valuta: '-694',
                    kurs: '1',
                    kurs_bawaan: '1',
                    nilai: '-694',
                },
                {
                    kode: foreign,
                    mata_uang: foreign,
                    nilai_valuta: '12.35',
                    kurs: '16250.5',
                    kurs_bawaan: '16250.5',
                    nilai: '200694',
                },
            ]);
            const contract = await eventContract('billing.invoice.posted.v1');
            const [sent] = (
                await outboxEnvelopes(
                    pool,
                    tenantId,
                    'billing.invoice.posted.v1',
                )
            ).filter((envelope) => envelope.data.visit_id === visits.exact);
            expect(contract.safeParse(sent).error).toBeUndefined();
            expect(sent?.data.payments).toContainEqual({
                payment_method_id: methods[foreign],
                amount: '200694',
                currency_code: foreign,
                currency_amount: '12.35',
                exchange_rate: '16250.5',
            });
            // Pembayaran tersimpan tampil seperti saat diisi: uang tunai yang diterima di bawah label tunai, lalu
            // Kembalian, bukan baris tunai -694.
            const shown = await json<{
                data: { payment: Record<string, unknown> };
            }>(
                await cashier.get(`/api/v1/billing/visits/${visits.exact}`),
                200,
            );
            expect(shown.data.payment).toEqual({
                id: created.data.id,
                version: 1,
                number: expect.any(String),
                automatic: false,
                discount: '0',
                discounts: [],
                received: '0',
                change: '694',
                cash_label: 'TUN',
                lines: [
                    {
                        label: foreign,
                        amount: '200694',
                        currency_code: foreign,
                        currency_amount: '12.35',
                        rate: '16250.5',
                    },
                ],
            });
        });

        test('the foreign amount keeps its own precision, and the local amount is rounded once at the local precision', async () => {
            expect(
                await refused(
                    await pay(visits.cents, {
                        lines: [
                            {
                                payment_method_id: methods[foreign],
                                amount: '6.155',
                            },
                        ],
                    }),
                ),
            ).toEqual({
                'lines.0.amount': [
                    'Isi jumlah 0 atau lebih, paling banyak dua angka di belakang koma.',
                ],
            });
            await setCurrencyPrecision(pool, tenantId, {
                amount_decimals: 2,
                unit_amount_decimals: 2,
                invoice_rounding_precision: '0',
                invoice_rounding_type: 'nearest',
            });
            // 6,15 x 16.250,5 = 99.940,575, dibulatkan ke dua angka rupiah: 99.940,58. Sisanya 59,42 tunai rupiah.
            const created = await json<{ data: { id: string } }>(
                await pay(visits.cents, {
                    received: '59.42',
                    lines: [
                        { payment_method_id: methods[foreign], amount: '6.15' },
                    ],
                }),
                201,
            );
            expect(
                (await details(created.data.id)).map((row) => [
                    row.kode,
                    row.nilai_valuta,
                    row.nilai,
                ]),
            ).toEqual([
                ['TUN', '59.42', '59.42'],
                [foreign, '6.15', '99940.58'],
            ]);
        });

        test('a rate other than the default needs the rate right, and the default stays recorded beside it', async () => {
            const body = {
                lines: [
                    {
                        payment_method_id: methods[foreign],
                        amount: '6.25',
                        rate: '16000',
                    },
                ],
            };
            expect(await refused(await pay(visits.rate, body))).toEqual({
                'lines.0.rate': [
                    'Kurs hanya bisa diubah oleh pengguna yang berhak mengubah kurs.',
                ],
            });
            await pool.unsafe(
                'insert into security_role_duties (role_id, duty_code) values ($1, $2)',
                [roleId, 'core.payment-rate.operate'],
            );
            const created = await json<{ data: { id: string } }>(
                await pay(visits.rate, body),
                201,
            );
            expect(
                (await details(created.data.id)).map((row) => [
                    row.kode,
                    row.kurs,
                    row.kurs_bawaan,
                    row.nilai,
                ]),
            ).toEqual([[foreign, '16000', '16250.5', '100000']]);
        });

        test('a method that took payments keeps its currency', async () => {
            const [method] = await pool.unsafe<{ version: number }[]>(
                'select version from jenis_bayar where id = $1',
                [methods[foreign] ?? ''],
            );
            expect(
                await refused(
                    await cashier.patch(
                        `/api/v1/billing/payment-methods/${methods[foreign]}`,
                        {
                            code: foreign,
                            name: foreign,
                            behavior: 'tunai',
                            counted_at_close: true,
                            currency_code: null,
                            version: method?.version,
                        },
                    ),
                ),
            ).toEqual({
                currency_code: [
                    'Jenis bayar ini sudah dipakai, jadi mata uangnya tidak bisa diubah. Buat jenis bayar baru untuk mata uang lain.',
                ],
            });
        });

        test('Clerk End counts foreign cash in its own currency with its opening cash, and the local change leaves no false difference', async () => {
            const current = await json<{
                data: {
                    id: string;
                    version: number;
                    lines: { currency_code: string; amount_decimals: number }[];
                };
            }>(await cashier.get('/api/v1/billing/clerks/current'), 200);
            expect(
                current.data.lines.map((line) => [
                    line.currency_code,
                    line.amount_decimals,
                ]),
            ).toEqual([
                ['IDR', 2],
                [foreign, 2],
            ]);
            // Valuta sesi ini: 12,35 + 6,15 + 6,25 = 24,75, senilai 400.634,58 rupiah dengan kurs saat dibayar. Tunai rupiah
            // bersih -694 + 59,42 = -634,58 karena kembalian valuta keluar dari laci rupiah, dari uang awal 1.000.000. Kasir
            // menghitung 999.365,42 rupiah dan 34,70 valuta (uang awal 10); kurs hari ini 16.250,5.
            const ended = await json<{
                data: {
                    opening_total: string;
                    system_total: string;
                    clerk_total: string;
                    difference_total: string;
                    lines: {
                        code: string;
                        currency_code: string;
                        opening_amount: string;
                        system_amount: string;
                        counted_amount: string;
                        difference: string;
                        rate: string;
                        difference_local: string;
                    }[];
                };
            }>(
                await cashier.post(
                    `/api/v1/billing/clerks/${current.data.id}/end`,
                    {
                        password: testPassword,
                        counts: {
                            [methods.TUN!]: '999365.42',
                            [methods[foreign]!]: '34.70',
                        },
                        version: current.data.version,
                    },
                ),
                200,
            );
            expect(
                ended.data.lines.map((line) => [
                    line.code,
                    line.currency_code,
                    line.opening_amount,
                    line.system_amount,
                    line.counted_amount,
                    line.difference,
                    line.rate,
                    line.difference_local,
                ]),
            ).toEqual([
                [
                    'TUN',
                    'IDR',
                    '1000000',
                    '-634.58',
                    '999365.42',
                    '0',
                    '1',
                    '0',
                ],
                [
                    foreign,
                    foreign,
                    '10',
                    '24.75',
                    '34.7',
                    '-0.05',
                    '16250.5',
                    '-812.53',
                ],
            ]);
            // Uang awal dan jumlah fisik dinilai dengan kurs hari ini: 1.000.000 + 10 x 16.250,5 = 1.162.505, dan
            // 999.365,42 + 34,70 x 16.250,5 = 1.563.257,77.
            expect([
                ended.data.opening_total,
                ended.data.system_total,
                ended.data.clerk_total,
                ended.data.difference_total,
            ]).toEqual(['1162505', '400000', '1563257.77', '-812.53']);
        });
    },
);
