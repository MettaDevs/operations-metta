import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { registerBillingEventHandlers } from '@core/foundation/billing/index.ts';
import {
    json as billingJson,
    payVisit,
    visitCharges,
} from '../../../../../test/support/billing-fixtures.ts';
import {
    eventContract,
    outboxEnvelopes,
} from '../../../../../test/support/event-contracts.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../../../test/support/tenant-fixtures.ts';
import {
    api,
    createPharmacy,
    inventoryApi,
    json,
    pharmacyDuties,
    refused,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

type Reference = { id: string; code: string; name: string };
type Change = { by: string; at: string; reason: string } | null;
type Shown = {
    data: {
        dispensing: { version: number; total_amount: string | null };
        lines: {
            id: string;
            price: {
                unit_price: string;
                discount_percent: string;
                computed_unit_price: string;
                computed_discount_percent: string;
                changed: Change;
            } | null;
        }[];
        fees: {
            id: string;
            kind: string;
            amount: string;
            computed_amount: string;
            changed: Change;
        }[];
    };
    permissions: { override_price: boolean };
};
type StoredLine = {
    harga_satuan: string;
    persen_diskon: string;
    harga_satuan_hitung: string;
    persen_diskon_hitung: string;
    alasan_ubah_harga: string | null;
    harga_diubah_oleh_user_id: string | null;
    diubah: boolean;
};
const paidMessage = 'Data ini sudah melakukan Pembayaran diKasir!';
const chargesReplaced = 'pharmacy.dispensing.charges-replaced.v1';
const priceDuty = 'pharmacy.line-price.manage';

// Harga obat, diskon, dan biaya racik atau resep yang diketik per baris (Harga Jual dan Diskon di form farmasi Seroja dan
// Adapotek). Hanya pemegang duty ubah harga yang boleh; duty itu tidak dipegang role mana pun secara bawaan. Hitungan
// sistem tetap tersimpan, yang berbeda wajib beralasan, tagihan kasir mengikuti harga yang dipakai, dan kunjungan yang
// sudah dibayar terkunci. Isi database dibaca lewat SQL.
describe.skipIf(!process.env.DB_HOST)('line price override', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    let pharmacy: Pharmacy;
    let farmasi: Reference;
    let counter: Reference;
    let single: Reference;
    let component: Reference;
    let pricer: Browser;
    let pricerUserId: string;
    const duties = [
        ...pharmacyDuties,
        'pharmacy.dispensing.manage',
        'pharmacy.otc-sale.operate',
        'core.reference-data.manage',
        'core.billing-setup.manage',
        'core.clerk.operate',
        'core.payment.operate',
    ];

    const path = (prescriptionId: string, action = '') =>
        `${api}/prescriptions/${prescriptionId}/dispensing${action}`;
    async function prescribe(visitId: string) {
        const { prescriptionId } = await pharmacy.issue(
            [
                { item: single, quantity: '10' },
                { compound: 1, requested_quantity: '10' },
                { item: component, quantity: '5', compound: 1 },
            ],
            { data: { visit_id: visitId } },
        );
        const [row] = await pharmacy.queued(prescriptionId);
        if (!row) throw new Error('Resep tidak masuk antrean.');
        await json(await pharmacy.admin.post(path(row.id, '/prepare')), 200);
        return row.id;
    }
    const shown = async (id: string, session: Browser = pricer) =>
        json<Shown>(await session.get(path(id)), 200);
    const stored = (prescriptionId: string) =>
        pool.unsafe<StoredLine[]>(
            `select trim_scale(d.harga_satuan)::text as harga_satuan,
                    trim_scale(d.persen_diskon)::text as persen_diskon,
                    trim_scale(d.harga_satuan_hitung)::text as harga_satuan_hitung,
                    trim_scale(d.persen_diskon_hitung)::text as persen_diskon_hitung,
                    d.alasan_ubah_harga, d.harga_diubah_oleh_user_id, d.harga_diubah_pada is not null as diubah
             from bill_farmasi_detail d
             join bill_farmasi h on h.tenant_id = d.tenant_id and h.id = d.bill_farmasi_id
             where d.tenant_id = $1 and h.resep_id = $2 and h.status <> 'dibatalkan'
             order by d.urutan`,
            [pharmacy.tenantId, prescriptionId],
        );
    const charges = (documentId: string) =>
        pool.unsafe<
            { kode: string; qty: string; nilai: string; disc: string }[]
        >(
            `select jenis_biaya_kode as kode, trim_scale(qty)::text as qty, trim_scale(nilai)::text as nilai,
                    trim_scale(disc)::text as disc
             from tagihan_kasir_detail
             where tenant_id = $1 and tagihan_sumber_dokumen_id = $2 and deleted_at is null
             order by jenis_biaya_kode, nilai`,
            [pharmacy.tenantId, documentId],
        );

    beforeAll(async () => {
        registerBillingEventHandlers();
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Harga', {
            duties,
        });
        farmasi = await pharmacy.location('FARMASI');
        counter = await pharmacy.location('LOKET');
        await pharmacy.created(`${api}/service-locations`, {
            operating_unit_id: pharmacy.unitId,
            section_id: null,
            location_id: farmasi.id,
        });
        const reasonId =
            (
                await json<{ data: Reference[] }>(
                    await pharmacy.admin.get(`${inventoryApi}/reason-codes`),
                    200,
                )
            ).data.find((reason) => reason.code === 'SALDO-AWAL')?.id ?? '';
        single = await pharmacy.item('HRG-1', { base_price: '1000' });
        component = await pharmacy.item('HRG-2', { base_price: '200' });
        for (const location of [farmasi, counter]) {
            const draft = await pharmacy.created<{
                id: string;
                version: number;
            }>(`${inventoryApi}/adjustments`, {
                direction: 'masuk',
                location_id: location.id,
                posting_date: '2026-11-01',
                reason_id: reasonId,
                lines: [single, component].map((item) => ({
                    item_id: item.id,
                    quantity: 1000,
                    unit_cost: 100,
                })),
            });
            await json(
                await pharmacy.admin.post(
                    `${inventoryApi}/adjustments/${draft.id}/post`,
                    { version: draft.version },
                ),
                200,
            );
        }
        await pharmacy.created(`${api}/dispensing-fees`, {
            kind: 'racik',
            amount: '15000',
        });
        await pharmacy.created(`${api}/dispensing-fees`, {
            kind: 'resep',
            amount: '2000',
        });
        await pharmacy.created(`${api}/otc-sale-locations`, {
            location_id: counter.id,
        });
        await pharmacy.created('/api/v1/billing/payment-methods', {
            code: 'TUN',
            name: 'Tunai',
            behavior: 'tunai',
        });
        await json(
            await pharmacy.admin.post('/api/v1/billing/clerks/start', {}),
            201,
        );
        const member = await createMember(pool, pharmacy.tenantId, [
            ...duties,
            priceDuty,
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            member.membershipId,
        );
        pricerUserId = member.userId;
        pricer = browser();
        await pricer.login(member.email, member.password);
        await json(await pricer.post('/api/v1/billing/clerks/start', {}), 201);
    });

    test('Siapkan keeps the computed price next to the price used, with no change recorded', async () => {
        const id = await prescribe(Bun.randomUUIDv7());
        expect([...(await stored(id))]).toEqual([
            {
                harga_satuan: '1000',
                persen_diskon: '0',
                harga_satuan_hitung: '1000',
                persen_diskon_hitung: '0',
                alasan_ubah_harga: null,
                harga_diubah_oleh_user_id: null,
                diubah: false,
            },
            {
                harga_satuan: '200',
                persen_diskon: '0',
                harga_satuan_hitung: '200',
                persen_diskon_hitung: '0',
                alasan_ubah_harga: null,
                harga_diubah_oleh_user_id: null,
                diubah: false,
            },
        ]);
        expect(
            (await shown(id, pharmacy.admin)).permissions.override_price,
        ).toBe(false);
        expect((await shown(id)).permissions.override_price).toBe(true);
    });

    test('a user without the duty is refused, even when the screen field is bypassed', async () => {
        const id = await prescribe(Bun.randomUUIDv7());
        const view = await shown(id, pharmacy.admin);
        const response = await pharmacy.admin.post(path(id, '/prices'), {
            reason: 'Harga khusus',
            lines: [
                {
                    id: view.data.lines[0]?.id,
                    unit_price: '800',
                    discount_percent: '0',
                },
            ],
            version: view.data.dispensing.version,
        });
        expect(response.status).toBe(403);
        expect((await stored(id))[0]?.harga_satuan).toBe('1000');

        const sale = await pharmacy.admin.post(`${api}/otc-sales/quote`, {
            location_id: counter.id,
            lines: [
                {
                    item_id: single.id,
                    unit_id: pharmacy.uom.id,
                    quantity: 1,
                    unit_price: '800',
                },
            ],
        });
        expect(sale.status).toBe(403);
    });

    test('a changed price needs a reason, and the cashier bills the price used', async () => {
        const visitId = Bun.randomUUIDv7();
        const id = await prescribe(visitId);
        const view = await shown(id);
        const [line] = view.data.lines;
        const racik = view.data.fees.find((fee) => fee.kind === 'racik');
        const body = {
            lines: [
                { id: line?.id, unit_price: '800', discount_percent: '10' },
            ],
            fees: [{ id: racik?.id, amount: '0' }],
            version: view.data.dispensing.version,
        };
        expect(
            await refused(await pricer.post(path(id, '/prices'), body)),
        ).toEqual({
            reason: [
                'Isi alasan harga atau biaya diubah dari hitungan sistem.',
            ],
        });
        const after = await json<Shown>(
            await pricer.post(path(id, '/prices'), {
                ...body,
                reason: 'Harga langganan klinik',
            }),
            200,
        );
        expect(after.data.lines[0]?.price).toMatchObject({
            unit_price: '800',
            discount_percent: '10',
            computed_unit_price: '1000',
            computed_discount_percent: '0',
            changed: { reason: 'Harga langganan klinik' },
        });
        expect(
            after.data.fees.find((fee) => fee.kind === 'racik'),
        ).toMatchObject({
            amount: '0',
            computed_amount: '15000',
            changed: { reason: 'Harga langganan klinik' },
        });
        expect((await stored(id))[0]).toMatchObject({
            harga_satuan: '800',
            persen_diskon: '10',
            harga_satuan_hitung: '1000',
            persen_diskon_hitung: '0',
            alasan_ubah_harga: 'Harga langganan klinik',
            harga_diubah_oleh_user_id: pricerUserId,
            diubah: true,
        });
        // Obat tunggal 10 x 800 diskon 10 %, komponen racikan 5 x 200, biaya resep 2000; biaya racik 0 tidak ditagih.
        expect([...(await charges(visitId))]).toEqual([
            { kode: 'HRG-1', qty: '10', nilai: '800', disc: '10' },
            { kode: 'HRG-2', qty: '5', nilai: '200', disc: '0' },
            { kode: 'RESEP', qty: '1', nilai: '2000', disc: '0' },
        ]);
        const [sent] = (
            await outboxEnvelopes(pool, pharmacy.tenantId, chargesReplaced)
        )
            .filter((row) => row.data.visit_id === visitId)
            .reverse();
        expect(
            (await eventContract(chargesReplaced)).safeParse(sent).error,
        ).toBeUndefined();

        const reverted = await json<Shown>(
            await pricer.post(path(id, '/prices'), {
                lines: [
                    { id: line?.id, unit_price: '1000', discount_percent: '0' },
                ],
                version: after.data.dispensing.version,
            }),
            200,
        );
        expect(reverted.data.lines[0]?.price?.changed).toBeNull();
        expect((await stored(id))[0]).toMatchObject({
            harga_satuan: '1000',
            alasan_ubah_harga: null,
            diubah: false,
        });
    });

    test('after the cashier is paid the change is refused, with a button to the payment for whoever may open it', async () => {
        const visitId = Bun.randomUUIDv7();
        const id = await prescribe(visitId);
        await visitCharges(pool, {
            tenantId: pharmacy.tenantId,
            legalEntityId: pharmacy.legalEntityId,
        }).completedVisit(visitId, []);
        await billingJson(
            await payVisit(pharmacy.admin, visitId, { received: '28000' }),
            201,
        );
        const payment = (
            await pool.unsafe<{ no_bukti: string }[]>(
                "select no_bukti from kasir where tenant_id = $1 and sumber_dokumen_id = $2 and status = 'diposting'",
                [pharmacy.tenantId, visitId],
            )
        )[0]?.no_bukti;
        const view = await shown(id);
        const change = (session: Browser) =>
            session.post(path(id, '/prices'), {
                reason: 'Harga langganan klinik',
                lines: [
                    {
                        id: view.data.lines[0]?.id,
                        unit_price: '900',
                        discount_percent: '0',
                    },
                ],
                version: view.data.dispensing.version,
            });
        expect(
            await json<{ errors: Record<string, string[]>; actions?: unknown }>(
                await change(pricer),
                422,
            ),
        ).toMatchObject({
            errors: { _form: [paidMessage] },
            actions: [
                {
                    kind: 'open',
                    label: `Buka pembayaran ${payment ?? ''}`,
                    page: 'core.payment',
                },
            ],
        });

        const pharmacist = await createMember(pool, pharmacy.tenantId, [
            ...pharmacyDuties,
            'pharmacy.dispensing.manage',
            priceDuty,
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            pharmacist.membershipId,
        );
        const session = browser();
        await session.login(pharmacist.email, pharmacist.password);
        const refusedView = await json<{
            errors: Record<string, string[]>;
            actions?: unknown;
        }>(await change(session), 422);
        expect(refusedView.errors).toEqual({
            _form: [
                `${paidMessage} Minta kasir membatalkan pembayaran ${payment ?? ''}.`,
            ],
        });
        expect(refusedView.actions).toBeUndefined();
        expect((await stored(id))[0]?.harga_satuan).toBe('1000');
    });

    test('an OTC sale bills the typed price and prescription fee, and keeps what the system computed', async () => {
        const lines = [
            {
                item_id: single.id,
                unit_id: pharmacy.uom.id,
                quantity: 2,
                unit_price: '750',
                discount_percent: '0',
                fee_amount: '1000',
            },
        ];
        const quote = async (body: Record<string, unknown>) =>
            pricer.post(`${api}/otc-sales/quote`, body);
        expect(
            await refused(
                await quote({
                    location_id: counter.id,
                    without_prescription: false,
                    lines,
                }),
            ),
        ).toEqual({
            price_reason: [
                'Isi alasan harga atau biaya diubah dari hitungan sistem.',
            ],
        });
        const body = {
            location_id: counter.id,
            without_prescription: false,
            price_reason: 'Pembeli langganan',
            lines,
        };
        const quoted = await json<{
            data: {
                lines: {
                    unit_price: string;
                    computed_unit_price: string;
                    amount: string;
                }[];
                fees: {
                    amount: string;
                    computed_amount: string;
                    line_index: number | null;
                }[];
                total: string;
            };
        }>(await quote(body), 200);
        expect(quoted.data).toMatchObject({
            lines: [
                {
                    unit_price: '750',
                    computed_unit_price: '1000',
                    amount: '1500',
                },
            ],
            fees: [{ amount: '1000', computed_amount: '2000', line_index: 0 }],
            total: '2500',
        });
        const sold = await json<{ data: { id: string } }>(
            await pricer.post(`${api}/otc-sales`, {
                ...body,
                expected_total: quoted.data.total,
                payment: { received: '2500' },
            }),
            201,
        );
        expect([...(await charges(sold.data.id))]).toEqual([
            { kode: 'HRG-1', qty: '2', nilai: '750', disc: '0' },
            { kode: 'RESEP', qty: '1', nilai: '1000', disc: '0' },
        ]);
        const [row] = await pool.unsafe<
            {
                harga_satuan: string;
                harga_satuan_hitung: string;
                alasan_ubah_harga: string;
                nilai: string;
                nilai_hitung: string;
                alasan_ubah_nilai: string;
            }[]
        >(
            `select trim_scale(d.harga_satuan)::text as harga_satuan,
                    trim_scale(d.harga_satuan_hitung)::text as harga_satuan_hitung, d.alasan_ubah_harga,
                    trim_scale(f.nilai)::text as nilai, trim_scale(f.nilai_hitung)::text as nilai_hitung,
                    f.alasan_ubah_nilai
             from bill_farmasi_detail d
             join bill_farmasi_biaya f on f.tenant_id = d.tenant_id and f.bill_farmasi_detail_id = d.id
             where d.tenant_id = $1 and d.bill_farmasi_id = $2`,
            [pharmacy.tenantId, sold.data.id],
        );
        expect(row).toEqual({
            harga_satuan: '750',
            harga_satuan_hitung: '1000',
            alasan_ubah_harga: 'Pembeli langganan',
            nilai: '1000',
            nilai_hitung: '2000',
            alasan_ubah_nilai: 'Pembeli langganan',
        });
    });
});
