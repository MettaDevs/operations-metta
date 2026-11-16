import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { registerBillingEventHandlers } from '@core/foundation/billing/index.ts';
import {
    eventContract,
    outboxEnvelopes,
} from '../../../../../test/support/event-contracts.ts';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import { testPassword } from '../../../../../test/support/tenant-fixtures.ts';
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
type Charge = {
    kode: string;
    nama: string;
    qty: string;
    nilai: string;
};
type Fee = { kind: string; name: string; amount: string };
const chargesReplaced = 'pharmacy.dispensing.charges-replaced.v1';
const fees = `${api}/dispensing-fees`;

// Biaya racik (satu per racikan, Qty 1) dan biaya resep (satu per obat tunggal, tidak dikali jumlah) dari setelan per
// legal entity, lokasi, dan kelompok harga, dibekukan saat Siapkan dan Simpan dan bayar, lalu ditagih kasir sebagai
// baris sendiri. Tanpa setelan tidak ada biaya. Baris kasir dibaca lewat SQL.
describe.skipIf(!process.env.DB_HOST)('dispensing fees', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    let pharmacy: Pharmacy;
    let farmasi: Reference;
    let counter: Reference;
    let karyawan: Reference;
    let single: Reference;
    let other: Reference;
    let component: Reference;
    let serviceLocation: { id: string; version: number };

    const path = (prescriptionId: string, action = '') =>
        `${api}/prescriptions/${prescriptionId}/dispensing${action}`;
    async function prescribe(
        visitId: string,
        priceGroup: Reference | null = null,
    ) {
        const { prescriptionId } = await pharmacy.issue(
            [
                { item: single, quantity: '10' },
                { item: other, quantity: '4' },
                { compound: 1, requested_quantity: '10' },
                { item: component, quantity: '5', compound: 1 },
                { item: single, quantity: '5', compound: 1 },
                { compound: 2, requested_quantity: '6' },
                { item: component, quantity: '3', compound: 2 },
            ],
            {
                data: {
                    visit_id: visitId,
                    price_group: priceGroup && {
                        id: priceGroup.id,
                        code: priceGroup.code,
                        name: priceGroup.name,
                    },
                },
            },
        );
        const [row] = await pharmacy.queued(prescriptionId);
        if (!row) throw new Error('Resep tidak masuk antrean.');
        await json(await pharmacy.admin.post(path(row.id, '/prepare')), 200);
        return row.id;
    }
    const charges = (documentId: string) =>
        pool.unsafe<Charge[]>(
            `select jenis_biaya_kode as kode, jenis_biaya_nama as nama, trim_scale(qty)::text as qty,
                    trim_scale(nilai)::text as nilai
             from tagihan_kasir_detail
             where tenant_id = $1 and tagihan_sumber_dokumen_id = $2 and deleted_at is null
               and jenis_biaya_kode in ('RACIKAN', 'RESEP')
             order by jenis_biaya_kode, jenis_biaya_nama`,
            [pharmacy.tenantId, documentId],
        );
    const setFee = (body: Record<string, unknown>) =>
        pharmacy.created<{ id: string; version: number }>(fees, body);

    beforeAll(async () => {
        registerBillingEventHandlers();
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Biaya', {
            duties: [
                ...pharmacyDuties,
                'pharmacy.dispensing.manage',
                'pharmacy.otc-sale.operate',
                'core.pricing-setup.manage',
                'core.reference-data.manage',
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
            ],
        });
        farmasi = await pharmacy.location('FARMASI');
        counter = await pharmacy.location('LOKET');
        serviceLocation = await pharmacy.created<{
            id: string;
            version: number;
        }>(`${api}/service-locations`, {
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
        single = await pharmacy.item('BYA-1', { base_price: '1000' });
        other = await pharmacy.item('BYA-2', { base_price: '500' });
        component = await pharmacy.item('BYA-3', { base_price: '200' });
        for (const location of [farmasi, counter]) {
            const draft = await pharmacy.created<{
                id: string;
                version: number;
            }>(`${inventoryApi}/adjustments`, {
                direction: 'masuk',
                location_id: location.id,
                posting_date: '2026-11-01',
                reason_id: reasonId,
                lines: [single, other, component].map((item) => ({
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
        karyawan = await pharmacy.created('/api/v1/pricing/price-groups', {
            code: 'KARYAWAN',
            name: 'Karyawan',
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
            await pharmacy.admin.post('/api/v1/billing/clerks/start', {
                password: testPassword,
            }),
            201,
        );
    });

    test('without a fee row nothing is billed', async () => {
        const visitId = Bun.randomUUIDv7();
        await prescribe(visitId);
        expect([...(await charges(visitId))]).toEqual([]);
    });

    test('a fee row is one per kind, location, and price group, with a valid amount', async () => {
        await setFee({ kind: 'racik', amount: '15000' });
        await setFee({ kind: 'resep', amount: '2000' });
        expect(
            await refused(
                await pharmacy.admin.post(fees, {
                    kind: 'racik',
                    amount: '9000',
                }),
            ),
        ).toEqual({
            kind: [
                'Biaya ini sudah diatur untuk lokasi dan kelompok harga yang sama. Ubah baris yang ada.',
            ],
        });
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(fees, {
                        kind: 'antar',
                        amount: '-1',
                    }),
                ),
            ).sort(),
        ).toEqual(['amount', 'kind']);
    });

    test('Siapkan bills one compounding fee per compound and one prescription fee per single drug, never multiplied', async () => {
        const visitId = Bun.randomUUIDv7();
        const id = await prescribe(visitId);
        expect([...(await charges(visitId))]).toEqual([
            {
                kode: 'RACIKAN',
                nama: 'Biaya racik Racikan 1',
                qty: '1',
                nilai: '15000',
            },
            {
                kode: 'RACIKAN',
                nama: 'Biaya racik Racikan 2',
                qty: '1',
                nilai: '15000',
            },
            {
                kode: 'RESEP',
                nama: 'Biaya resep Obat BYA-1',
                qty: '1',
                nilai: '2000',
            },
            {
                kode: 'RESEP',
                nama: 'Biaya resep Obat BYA-2',
                qty: '1',
                nilai: '2000',
            },
        ]);
        const [sent] = (
            await outboxEnvelopes(pool, pharmacy.tenantId, chargesReplaced)
        ).filter((row) => row.data.visit_id === visitId);
        expect(
            (await eventContract(chargesReplaced)).safeParse(sent).error,
        ).toBeUndefined();
        const shown = await json<{
            data: { fees: Fee[]; dispensing: { total_amount: string } };
        }>(await pharmacy.admin.get(path(id)), 200);
        expect(shown.data.fees.map((fee) => fee.amount)).toEqual([
            '15000',
            '15000',
            '2000',
            '2000',
        ]);
        // Obat 10 x 1000 + 4 x 500 + komponen 5 x 200 + 5 x 1000 + 3 x 200, ditambah biaya 34000.
        expect(shown.data.dispensing.total_amount).toBe('52600');
    });

    test('a drug returned in full loses its prescription fee, and the compounding fee stays', async () => {
        const visitId = Bun.randomUUIDv7();
        const id = await prescribe(visitId);
        const version = (
            await json<{ data: { dispensing: { version: number } } }>(
                await pharmacy.admin.get(path(id)),
                200,
            )
        ).data.dispensing.version;
        await json(
            await pharmacy.admin.post(path(id, '/hand-over'), {
                received_by_patient: true,
                version,
            }),
            200,
        );
        const returnsPath = `${api}/prescriptions/${id}/returns`;
        const returnable = (
            await json<{
                data: {
                    returnable: {
                        dispensing_line_id: string;
                        item: Reference | null;
                        batch: { id: string } | null;
                        dispensed: string;
                    }[];
                };
            }>(await pharmacy.admin.get(returnsPath), 200)
        ).data.returnable;
        const returned = returnable.filter(
            (line) =>
                line.item?.code === other.code ||
                line.item?.code === component.code,
        );
        await json(
            await pharmacy.admin.post(returnsPath, {
                reason: 'Pasien alergi',
                lines: returned.map((line) => ({
                    dispensing_line_id: line.dispensing_line_id,
                    batch_id: line.batch?.id ?? null,
                    quantity: line.dispensed,
                })),
            }),
            200,
        );
        expect((await charges(visitId)).map((row) => row.nama)).toEqual([
            'Biaya racik Racikan 1',
            'Biaya racik Racikan 2',
            'Biaya resep Obat BYA-1',
        ]);
    });

    test('the most specific row wins: price group first, then location, and a 0 row bills nothing', async () => {
        await setFee({
            kind: 'resep',
            location_id: farmasi.id,
            amount: '3000',
        });
        await setFee({
            kind: 'resep',
            price_group_id: karyawan.id,
            amount: '0',
        });
        const general = Bun.randomUUIDv7();
        await prescribe(general);
        expect(
            (await charges(general))
                .filter((row) => row.kode === 'RESEP')
                .map((row) => row.nilai),
        ).toEqual(['3000', '3000']);
        const employee = Bun.randomUUIDv7();
        await prescribe(employee, karyawan);
        expect((await charges(employee)).map((row) => row.kode)).toEqual([
            'RACIKAN',
            'RACIKAN',
        ]);
    });

    test('a dispensing included in the service bills no fee', async () => {
        serviceLocation = (
            await json<{ data: { id: string; version: number } }>(
                await pharmacy.admin.patch(
                    `${api}/service-locations/${serviceLocation.id}`,
                    {
                        location_id: farmasi.id,
                        includes_service: true,
                        version: serviceLocation.version,
                    },
                ),
                200,
            )
        ).data;
        const visitId = Bun.randomUUIDv7();
        await prescribe(visitId);
        expect([...(await charges(visitId))]).toEqual([]);
        serviceLocation = (
            await json<{ data: { id: string; version: number } }>(
                await pharmacy.admin.patch(
                    `${api}/service-locations/${serviceLocation.id}`,
                    {
                        location_id: farmasi.id,
                        includes_service: false,
                        version: serviceLocation.version,
                    },
                ),
                200,
            )
        ).data;
    });

    test('an OTC sale bills the prescription fee only when sold with a prescription', async () => {
        const priced = [
            { item_id: single.id, unit_id: pharmacy.uom.id, quantity: 2 },
            { item_id: other.id, unit_id: pharmacy.uom.id, quantity: 1 },
        ];
        const quote = async (body: Record<string, unknown>) =>
            (
                await json<{ data: { fees: Fee[]; total: string } }>(
                    await pharmacy.admin.post(`${api}/otc-sales/quote`, body),
                    200,
                )
            ).data;
        const plain = await quote({ location_id: counter.id, lines: priced });
        expect(plain.fees).toEqual([]);
        expect(plain.total).toBe('2500');
        const withPrescription = await quote({
            location_id: counter.id,
            without_prescription: false,
            lines: priced,
        });
        expect(withPrescription.fees).toEqual([
            { kind: 'resep', name: 'Biaya resep Obat BYA-1', amount: '2000' },
            { kind: 'resep', name: 'Biaya resep Obat BYA-2', amount: '2000' },
        ]);
        expect(withPrescription.total).toBe('6500');
        const sold = await json<{ data: { id: string } }>(
            await pharmacy.admin.post(`${api}/otc-sales`, {
                location_id: counter.id,
                without_prescription: false,
                lines: priced,
                expected_total: withPrescription.total,
                payment: { received: '6500' },
            }),
            201,
        );
        expect(
            (await charges(sold.data.id)).map((row) => [row.nama, row.nilai]),
        ).toEqual([
            ['Biaya resep Obat BYA-1', '2000'],
            ['Biaya resep Obat BYA-2', '2000'],
        ]);
        const card = await json<{
            data: { fees: Fee[]; total: string; without_prescription: boolean };
        }>(await pharmacy.admin.get(`${api}/otc-sales/${sold.data.id}`), 200);
        expect(card.data.without_prescription).toBe(false);
        expect(card.data.total).toBe('6500');
        expect(card.data.fees.map((fee) => fee.amount)).toEqual([
            '2000',
            '2000',
        ]);
    });
});
