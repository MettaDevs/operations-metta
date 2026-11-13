import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { registerBillingEventHandlers } from '../../../../src/foundation/billing/index.ts';
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
import { testPassword } from '../../../support/tenant-fixtures.ts';

// Tab Diskon kasir lewat aplikasi sungguhan, diperiksa dengan SQL langsung. Kunjungan contoh mengulang satu-satunya
// pembayaran berdiskon Seroja (hanya angka): Nilai 675.764, diskon 50.000 + 1.750 + 20.000, uang diterima 650.000,
// kembalian 45.986, dan tunai 604.014 = Nilai - NilaiDiscount. Ketiga diskon memakai tiga jenis diskon.
describe.skipIf(!process.env.DB_HOST)('billing payment discounts', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    let tenantId: string;
    let cashier: Browser;
    let charges: ReturnType<typeof visitCharges>;
    const ids = {
        doctor: Bun.randomUUIDv7(),
        consultation: Bun.randomUUIDv7(),
        administration: Bun.randomUUIDv7(),
        administrationGroup: Bun.randomUUIDv7(),
        package: Bun.randomUUIDv7(),
    };
    const discounts: Record<string, string> = {};
    let component: string;

    const created = async (path: string, body: Record<string, unknown>) =>
        (
            await json<{ data: { id: string } }>(
                await cashier.post(path, body),
                201,
            )
        ).data.id;
    // Tiga baris biaya bernilai 675.764. Konsultasi membawa komponen jasa dokter 35.000.
    async function visit() {
        const visitId = Bun.randomUUIDv7();
        const line = (
            procedureId: string,
            name: string,
            tariff: string,
            group: { id: string; name: string },
            components: { charge_component_id: string; value: string }[],
        ) => ({
            line_id: Bun.randomUUIDv7(),
            procedure_id: procedureId,
            procedure_code: name.slice(0, 3).toUpperCase(),
            procedure_name: name,
            service_group_id: group.id,
            service_group_name: group.name,
            service_group_order: 1,
            category_name: null,
            quantity: '1',
            tariff,
            doctor_id: ids.doctor,
            doctor_name: 'Dokter Uji',
            section_id: Bun.randomUUIDv7(),
            section_name: 'Poli Umum',
            date: '2026-11-13',
            components,
        });
        await charges.publish('healthcare.examination.charges-replaced.v1', {
            examination_id: Bun.randomUUIDv7(),
            visit_id: visitId,
            registration_number: `REG-${visitId.slice(-4)}`,
            lines: [
                line(
                    ids.consultation,
                    'Konsultasi',
                    '35000',
                    { id: Bun.randomUUIDv7(), name: 'Layanan Konsultasi' },
                    [{ charge_component_id: component, value: '35000' }],
                ),
                line(
                    ids.administration,
                    'Administrasi',
                    '20000',
                    { id: ids.administrationGroup, name: 'Administrasi' },
                    [],
                ),
                line(
                    ids.package,
                    'Paket',
                    '620764',
                    { id: Bun.randomUUIDv7(), name: 'Paket' },
                    [],
                ),
            ],
        });
        await charges.completedVisit(visitId, []);
        return visitId;
    }
    const pay = (visitId: string, body: Record<string, unknown>) =>
        cashier.post(`/api/v1/billing/visits/${visitId}/payments`, body);

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Diskon',
            [
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
                'core.pricing-setup.manage',
            ],
        );
        tenantId = business.tenantId;
        cashier = business.admin;
        charges = visitCharges(pool, {
            tenantId,
            legalEntityId: business.legalEntityId,
        });
        await created('/api/v1/billing/payment-methods', {
            code: 'TUN',
            name: 'TUNAI',
            behavior: 'tunai',
            counted_at_close: true,
        });
        component = await created('/api/v1/pricing/charge-components', {
            code: 'DT01',
            name: 'Jasa dokter',
        });
        await visit();
        discounts.total = await created('/api/v1/billing/discounts', {
            code: 'DSC67',
            name: 'Discount General',
            kind: 'total',
        });
        discounts.component = await created('/api/v1/billing/discounts', {
            code: 'DSC18',
            name: 'Discount Konsul Dokter',
            kind: 'komponen',
            charge_component_id: component,
        });
        discounts.group = await created('/api/v1/billing/discounts', {
            code: 'DSC04',
            name: 'Discount Administrasi',
            kind: 'kelompok_jasa',
            service_group_id: ids.administrationGroup,
        });
        await json(
            await cashier.post('/api/v1/billing/clerks/start', {
                password: testPassword,
            }),
            201,
        );
    });

    test('the Seroja discounts settle 675.764 with 650.000 cash, change 45.986, and cash 604.014', async () => {
        const visitId = await visit();
        const created = await json<{ data: { id: string } }>(
            await pay(visitId, {
                received: '650000',
                discounts: [
                    { discount_id: discounts.total, amount: '50000' },
                    {
                        discount_id: discounts.component,
                        doctor_id: ids.doctor,
                        procedure_id: ids.consultation,
                        percent: '5',
                    },
                    {
                        discount_id: discounts.group,
                        procedure_id: ids.administration,
                        amount: '20000',
                        note: 'Pasien lama',
                    },
                ],
            }),
            201,
        );
        const [payment] = await pool.unsafe<Record<string, string>[]>(
            `select trim_scale(nilai)::text as nilai, trim_scale(nilai_discount)::text as nilai_discount,
                    trim_scale(jumlah_bayar)::text as jumlah_bayar,
                    trim_scale(nilai_kembalian)::text as nilai_kembalian,
                    (select trim_scale(sum(d.nilai))::text from kasir_detail d where d.kasir_id = k.id) as dibayar
             from kasir k where id = $1`,
            [created.data.id],
        );
        expect(payment).toEqual({
            nilai: '675764',
            nilai_discount: '71750',
            jumlah_bayar: '650000',
            nilai_kembalian: '45986',
            dibayar: '604014',
        });
        const lines = await pool.unsafe<
            {
                kode: string;
                persen: string;
                nilai: string;
                jasa: string | null;
            }[]
        >(
            `select m.kode, trim_scale(x.persen)::text as persen, trim_scale(x.nilai)::text as nilai,
                    x.jenis_biaya_nama as jasa
             from kasir_discount x join discount m on m.id = x.discount_id
             where x.kasir_id = $1 order by m.kode`,
            [created.data.id],
        );
        expect([...lines]).toEqual([
            {
                kode: 'DSC04',
                persen: '0',
                nilai: '20000',
                jasa: 'Administrasi',
            },
            {
                kode: 'DSC18',
                persen: '5',
                nilai: '1750',
                jasa: 'Konsultasi',
            },
            { kode: 'DSC67', persen: '7.4', nilai: '50000', jasa: null },
        ]);
        const contract = await eventContract('billing.invoice.posted.v1');
        const [sent] = (
            await outboxEnvelopes(pool, tenantId, 'billing.invoice.posted.v1')
        ).filter((envelope) => envelope.data.visit_id === visitId);
        expect(contract.safeParse(sent).error).toBeUndefined();
        expect(sent?.data.discount).toBe('71750');
    });

    test('a discount above its base, a percent without a base, and discounts above the value are refused', async () => {
        const visitId = await visit();
        expect(
            await refused(
                await pay(visitId, {
                    received: '700000',
                    discounts: [
                        {
                            discount_id: discounts.component,
                            procedure_id: ids.consultation,
                            amount: '40000',
                        },
                        {
                            discount_id: discounts.group,
                            procedure_id: ids.administration,
                            percent: '10',
                        },
                        { discount_id: discounts.component, percent: '5' },
                    ],
                }),
            ),
        ).toEqual({
            'discounts.0.amount': ['Nilai diskon melebihi dasarnya, 35000.'],
            'discounts.1.amount': [
                'Isi nilai diskon. Persen diskon kelompok jasa tidak dihitung.',
            ],
            'discounts.2.procedure_id': ['Pilih jasa.'],
        });
        expect(
            await refused(
                await pay(visitId, {
                    received: '0',
                    discounts: [
                        { discount_id: discounts.total, percent: '100' },
                        { discount_id: discounts.total, amount: '1' },
                    ],
                }),
            ),
        ).toEqual({ _form: ['Jumlah diskon melebihi Nilai tagihan.'] });
    });

    test('a discount used by a payment cannot be deleted, and its code stays taken', async () => {
        const [row] = await pool.unsafe<{ version: number }[]>(
            'select version from discount where id = $1',
            [discounts.total!],
        );
        expect(
            await refused(
                await cashier.delete(
                    `/api/v1/billing/discounts/${discounts.total}`,
                    { version: row?.version },
                ),
            ),
        ).toEqual({
            _form: [
                'Diskon ini sudah dipakai pembayaran, jadi tidak bisa dihapus. Nonaktifkan saja supaya tidak dipilih lagi.',
            ],
        });
        expect(
            await refused(
                await cashier.post('/api/v1/billing/discounts', {
                    code: 'dsc67',
                    name: 'Lagi',
                    kind: 'total',
                }),
            ),
        ).toEqual({ code: ['Kode ini sudah dipakai diskon lain.'] });
    });

    test('a component discount needs a component, and a group discount needs a group the cashier has seen', async () => {
        expect(
            await refused(
                await cashier.post('/api/v1/billing/discounts', {
                    code: 'K1',
                    name: 'Komponen',
                    kind: 'komponen',
                }),
            ),
        ).toEqual({ charge_component_id: ['Pilih komponen biaya.'] });
        expect(
            await refused(
                await cashier.post('/api/v1/billing/discounts', {
                    code: 'G1',
                    name: 'Kelompok',
                    kind: 'kelompok_jasa',
                    service_group_id: Bun.randomUUIDv7(),
                }),
            ),
        ).toEqual({ service_group_id: ['Pilih kelompok jasa dari daftar.'] });
        expect(
            await refused(
                await cashier.post('/api/v1/billing/discounts', {
                    code: 'X1',
                    name: 'Lain',
                    kind: 'lain',
                }),
            ),
        ).toEqual({ kind: ['Pilih jenis diskon dari daftar.'] });
    });
});
