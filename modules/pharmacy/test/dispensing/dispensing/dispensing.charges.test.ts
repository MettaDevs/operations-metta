import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    chargeLockedMessage,
    registerBillingEventHandlers,
} from '@core/foundation/billing/index.ts';
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
    testPassword,
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
type Charge = {
    sumber_dokumen_id: string;
    qty: string;
    nilai: string;
    harga_orig: string;
    status: string;
};
const chargesReplaced = 'pharmacy.dispensing.charges-replaced.v1';
const paidMessage = 'Data ini sudah melakukan Pembayaran diKasir!';

// Obat resep sampai ke tagihan kunjungan di kasir sejak Siapkan, dengan harga yang dibekukan saat Siapkan dan Qty bersih
// sesudah retur (blok BILLFarmasi GetDetailRincianBiaya). Obat termasuk jasa bernilai 0. Sesudah kasir menerima
// pembayaran, Siapkan, Batal siapkan, dan retur ditolak sampai pembayarannya dibatalkan. Baris kasir dibaca lewat SQL.
describe.skipIf(!process.env.DB_HOST)(
    'dispensing charges to the cashier',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp();
        afterAll(close);
        let pharmacy: Pharmacy;
        let item: Reference;
        let serviceLocation: { id: string; version: number };
        let farmasi: Reference;

        const path = (prescriptionId: string, action = '') =>
            `${api}/prescriptions/${prescriptionId}/dispensing${action}`;
        async function prescribe(visitId: string, quantity = '3') {
            const { prescriptionId } = await pharmacy.issue(
                [{ item, quantity }],
                { data: { visit_id: visitId } },
            );
            const [row] = await pharmacy.queued(prescriptionId);
            if (!row) throw new Error('Resep tidak masuk antrean.');
            return row.id;
        }
        const prepare = (id: string) =>
            pharmacy.admin.post(path(id, '/prepare'));
        async function version(id: string) {
            return (
                await json<{
                    data: { dispensing: { version: number } | null };
                }>(await pharmacy.admin.get(path(id)), 200)
            ).data.dispensing?.version;
        }
        const charges = (visitId: string) =>
            pool.unsafe<Charge[]>(
                `select sumber_dokumen_id, trim_scale(qty)::text as qty, trim_scale(nilai)::text as nilai,
                    trim_scale(harga_orig)::text as harga_orig, status
             from kunjungan_kasir_detail
             where tenant_id = $1 and kunjungan_id = $2 and group_biaya = 'OBAT' and deleted_at is null
             order by created_at, id`,
                [pharmacy.tenantId, visitId],
            );

        beforeAll(async () => {
            registerBillingEventHandlers();
            pharmacy = await createPharmacy(
                pool,
                browser,
                'Farmasi Uji Kasir',
                {
                    duties: [
                        ...pharmacyDuties,
                        'pharmacy.dispensing.manage',
                        'core.reference-data.manage',
                    ],
                },
            );
            farmasi = await pharmacy.location('FARMASI');
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
                        await pharmacy.admin.get(
                            `${inventoryApi}/reason-codes`,
                        ),
                        200,
                    )
                ).data.find((reason) => reason.code === 'SALDO-AWAL')?.id ?? '';
            item = await pharmacy.item('KSR-1', { base_price: '1500' });
            const draft = await pharmacy.created<{
                id: string;
                version: number;
            }>(`${inventoryApi}/adjustments`, {
                direction: 'masuk',
                location_id: farmasi.id,
                posting_date: '2026-11-01',
                reason_id: reasonId,
                lines: [{ item_id: item.id, quantity: 100, unit_cost: 900 }],
            });
            await json(
                await pharmacy.admin.post(
                    `${inventoryApi}/adjustments/${draft.id}/post`,
                    { version: draft.version },
                ),
                200,
            );
        });

        test('Siapkan sends the priced drugs to the visit bill as their contract says, and Batal siapkan takes them out', async () => {
            const visitId = Bun.randomUUIDv7();
            const id = await prescribe(visitId);
            await json(await prepare(id), 200);
            expect([...(await charges(visitId))]).toMatchObject([
                {
                    qty: '3',
                    nilai: '1500',
                    harga_orig: '1500',
                    status: 'terbuka',
                },
            ]);
            const [sent] = (
                await outboxEnvelopes(pool, pharmacy.tenantId, chargesReplaced)
            ).filter((row) => row.data.visit_id === visitId);
            const contract = await eventContract(chargesReplaced);
            expect(contract.safeParse(sent).error).toBeUndefined();
            await json(
                await pharmacy.admin.post(path(id, '/cancel-preparation'), {
                    version: await version(id),
                }),
                200,
            );
            expect([...(await charges(visitId))]).toEqual([]);
        });

        test('a return lowers the drug quantity on the bill, and reversing it brings it back', async () => {
            const visitId = Bun.randomUUIDv7();
            const id = await prescribe(visitId, '5');
            await json(await prepare(id), 200);
            await json(
                await pharmacy.admin.post(path(id, '/hand-over'), {
                    received_by_patient: true,
                    version: await version(id),
                }),
                200,
            );
            const returnsPath = (suffix = '') =>
                `${api}/prescriptions/${id}/returns${suffix}`;
            const [line] = (
                await json<{
                    data: {
                        returnable: {
                            dispensing_line_id: string;
                            batch: { id: string } | null;
                        }[];
                    };
                }>(await pharmacy.admin.get(returnsPath()), 200)
            ).data.returnable;
            const returned = await json<{
                data: { returns: { id: string; version: number }[] };
            }>(
                await pharmacy.admin.post(returnsPath(), {
                    reason: 'Pasien alergi',
                    lines: [
                        {
                            dispensing_line_id: line?.dispensing_line_id,
                            batch_id: line?.batch?.id ?? null,
                            quantity: '2',
                        },
                    ],
                }),
                200,
            );
            expect((await charges(visitId)).map((row) => row.qty)).toEqual([
                '3',
            ]);
            const [posted] = returned.data.returns;
            await json(
                await pharmacy.admin.post(
                    returnsPath(`/${posted?.id}/reverse`),
                    {
                        version: posted?.version,
                    },
                ),
                200,
            );
            expect((await charges(visitId)).map((row) => row.qty)).toEqual([
                '5',
            ]);
        });

        test('drugs included in the service are worth 0 on the bill, with their price kept', async () => {
            serviceLocation = await json<{
                data: { id: string; version: number };
            }>(
                await pharmacy.admin.patch(
                    `${api}/service-locations/${serviceLocation.id}`,
                    {
                        location_id: farmasi.id,
                        includes_service: true,
                        version: serviceLocation.version,
                    },
                ),
                200,
            ).then((body) => body.data);
            const visitId = Bun.randomUUIDv7();
            await json(await prepare(await prescribe(visitId)), 200);
            expect([...(await charges(visitId))]).toMatchObject([
                { qty: '3', nilai: '0', harga_orig: '1500' },
            ]);
            serviceLocation = await json<{
                data: { id: string; version: number };
            }>(
                await pharmacy.admin.patch(
                    `${api}/service-locations/${serviceLocation.id}`,
                    {
                        location_id: farmasi.id,
                        includes_service: false,
                        version: serviceLocation.version,
                    },
                ),
                200,
            ).then((body) => body.data);
        });

        test('after the cashier is paid, Batal siapkan and returns get the legacy message, and Siapkan gets the cashier lock', async () => {
            const visitId = Bun.randomUUIDv7();
            const handed = await prescribe(visitId, '2');
            await json(await prepare(handed), 200);
            await json(
                await pharmacy.admin.post(path(handed, '/hand-over'), {
                    received_by_patient: true,
                    version: await version(handed),
                }),
                200,
            );
            const prepared = await prescribe(visitId, '1');
            await json(await prepare(prepared), 200);
            await visitCharges(pool, {
                tenantId: pharmacy.tenantId,
                legalEntityId: pharmacy.legalEntityId,
            }).completedVisit(visitId, []);
            const cashier = await openCashier();
            await billingJson(
                await payVisit(cashier, visitId, {
                    received: '4500',
                }),
                201,
            );
            expect(
                (await charges(visitId)).map((row) => [row.qty, row.status]),
            ).toEqual([
                ['2', 'ditagih'],
                ['1', 'ditagih'],
            ]);
            const waiting = await prescribe(visitId, '1');
            expect(
                await refused(
                    await pharmacy.admin.post(
                        path(prepared, '/cancel-preparation'),
                        { version: await version(prepared) },
                    ),
                ),
            ).toEqual({ _form: [paidMessage] });
            const [line] = (
                await json<{
                    data: {
                        returnable: {
                            dispensing_line_id: string;
                            batch: { id: string } | null;
                        }[];
                    };
                }>(
                    await pharmacy.admin.get(
                        `${api}/prescriptions/${handed}/returns`,
                    ),
                    200,
                )
            ).data.returnable;
            expect(
                await refused(
                    await pharmacy.admin.post(
                        `${api}/prescriptions/${handed}/returns`,
                        {
                            reason: 'Pasien alergi',
                            lines: [
                                {
                                    dispensing_line_id:
                                        line?.dispensing_line_id,
                                    batch_id: line?.batch?.id ?? null,
                                    quantity: '1',
                                },
                            ],
                        },
                    ),
                ),
            ).toEqual({ _form: [paidMessage] });
            expect(await refused(await prepare(waiting))).toEqual({
                _form: [chargeLockedMessage],
            });
        });

        test('the cashier refuses Simpan while a prescription waits, and pays once it is prepared or cancelled', async () => {
            const visitId = Bun.randomUUIDv7();
            const prepared = await prescribe(visitId, '1');
            const cancelled = await prescribe(visitId, '1');
            await visitCharges(pool, {
                tenantId: pharmacy.tenantId,
                legalEntityId: pharmacy.legalEntityId,
            }).completedVisit(visitId, []);
            const cashier = await openCashier();
            const pay = () =>
                payVisit(cashier, visitId, {
                    received: '1500',
                });
            const number = async (id: string) =>
                (
                    await pool.unsafe<{ number: string }[]>(
                        'select nomor_resep as number from far_tr_resep where id = $1',
                        [id],
                    )
                )[0]?.number;
            const advice =
                'belum disiapkan farmasi. Tunggu farmasi menyiapkannya dulu, atau minta farmasi membatalkan resep yang tidak diambil pasien.';
            const both = [await number(prepared), await number(cancelled)]
                .sort()
                .join(' dan ');
            expect(await refused(await pay())).toEqual({
                _form: [`Resep ${both} ${advice}`],
            });
            await json(await prepare(prepared), 200);
            expect(await refused(await pay())).toEqual({
                _form: [`Resep ${await number(cancelled)} ${advice}`],
            });
            await json(
                await pharmacy.admin.post(
                    `${api}/prescriptions/${cancelled}/cancel`,
                    { reason: 'Pasien tidak mengambil obat', version: null },
                ),
                200,
            );
            await billingJson(await pay(), 201);
            expect(
                (await charges(visitId)).map((row) => [row.qty, row.status]),
            ).toEqual([['1', 'ditagih']]);
        });

        // Pengganti peringatan saat form dibuka di sistem lama: Daftar Pembayaran dan header Form Pembayaran membaca
        // resep yang belum disiapkan per kunjungan, dengan hitungan yang sama dengan penolakan Simpan.
        test('the payment list shows how many prescriptions each unpaid visit still waits for', async () => {
            const waitingVisit = Bun.randomUUIDv7();
            const readyVisit = Bun.randomUUIDv7();
            const first = await prescribe(waitingVisit, '1');
            const second = await prescribe(waitingVisit, '1');
            const prepared = await prescribe(readyVisit, '1');
            const visits = visitCharges(pool, {
                tenantId: pharmacy.tenantId,
                legalEntityId: pharmacy.legalEntityId,
            });
            await visits.completedVisit(waitingVisit, []);
            await visits.completedVisit(readyVisit, []);
            await json(await prepare(prepared), 200);
            const cashier = await openCashier();
            const holds = async () =>
                Object.fromEntries(
                    (
                        await billingJson<{
                            data: { visit_id: string; holds: string[] }[];
                        }>(
                            await cashier.get(
                                '/api/v1/billing/visits/holds?from=2026-11-13&to=2026-11-13',
                            ),
                            200,
                        )
                    ).data
                        .filter((row) =>
                            [waitingVisit, readyVisit].includes(row.visit_id),
                        )
                        .map((row) => [row.visit_id, row.holds]),
                );
            expect(await holds()).toEqual({
                [waitingVisit]: ['2 resep menunggu farmasi'],
            });
            await json(await prepare(first), 200);
            expect(await holds()).toEqual({
                [waitingVisit]: ['1 resep menunggu farmasi'],
            });
            await json(
                await pharmacy.admin.post(
                    `${api}/prescriptions/${second}/cancel`,
                    { reason: 'Pasien tidak mengambil obat', version: null },
                ),
                200,
            );
            expect(await holds()).toEqual({});
        });

        // Sistem lama tidak menunggu farmasi untuk bayar otomatis BPJS: Seroja melunasi dari poli tanpa memeriksa resep,
        // dan Kuta melunasi obat saat Siapkan. Di sini pembayaran otomatis dilunasi ulang saat obatnya disiapkan.
        test('an automatic payment does not wait for the pharmacy, and is settled again once the drugs are prepared', async () => {
            const cashier = await openCashier();
            const automatic = await billingJson<{ data: { id: string } }>(
                await cashier.post('/api/v1/billing/payment-methods', {
                    code: 'BPJ',
                    name: 'BPJS',
                    behavior: 'penjamin',
                    party: 'penjamin_kunjungan',
                }),
                201,
            );
            const visitId = Bun.randomUUIDv7();
            const waiting = await prescribe(visitId, '2');
            await visitCharges(pool, {
                tenantId: pharmacy.tenantId,
                legalEntityId: pharmacy.legalEntityId,
            }).completedVisit(visitId, ['10000'], {
                automatic_payment_method_id: automatic.data.id,
            });
            const payments = () =>
                pool.unsafe<{ value: string; status: string }[]>(
                    `select trim_scale(nilai)::text as value, status from kasir
                     where tenant_id = $1 and kunjungan_id = $2 order by created_at, id`,
                    [pharmacy.tenantId, visitId],
                );
            expect([...(await payments())]).toEqual([
                { value: '10000', status: 'diposting' },
            ]);
            await json(await prepare(waiting), 200);
            expect([...(await payments())]).toEqual([
                { value: '10000', status: 'batal' },
                { value: '13000', status: 'diposting' },
            ]);
        });

        // Petugas kasir yang sudah Clerk Start dengan jenis bayar tunai di legal entity farmasi, dibuat sekali.
        let cashierSession: Promise<Browser> | undefined;
        function openCashier(): Promise<Browser> {
            cashierSession ??= startCashier();
            return cashierSession;
        }
        async function startCashier(): Promise<Browser> {
            const member = await createMember(pool, pharmacy.tenantId, [
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
            ]);
            await grantAllOrganizations(
                pool,
                pharmacy.tenantId,
                member.membershipId,
            );
            const cashier = browser();
            await cashier.login(member.email, member.password);
            await billingJson(
                await cashier.post('/api/v1/billing/payment-methods', {
                    code: 'TUN',
                    name: 'Tunai',
                    behavior: 'tunai',
                }),
                201,
            );
            await billingJson(
                await cashier.post('/api/v1/billing/clerks/start', {
                    password: testPassword,
                }),
                201,
            );
            return cashier;
        }
    },
);
