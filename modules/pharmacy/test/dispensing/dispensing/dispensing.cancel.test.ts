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
type Row = { id: string; queue_status: string };
type Counts = { status: string; total: number }[];
const cancelled = 'pharmacy.prescription.cancelled.v1';
const chargesReplaced = 'pharmacy.dispensing.charges-replaced.v1';
const paidMessage = 'Data ini sudah melakukan Pembayaran diKasir!';

// Batal resep ("Tidak Diambil" di antrean sistem lama): resep keluar dari antrean, resep yang sudah disiapkan ikut
// dibatalkan penyiapannya sehingga stok dan tagihan kasirnya kembali, obat yang sudah diserahkan ditolak, dan kunjungan
// yang sudah dibayar kasir mengunci pembatalan sampai pembayarannya dibatalkan. Stok, baris kasir, dan outbox dibaca
// lewat SQL.
describe.skipIf(!process.env.DB_HOST)('prescription cancel', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let item: Reference;
    let farmasi: Reference;

    const path = (prescriptionId: string, action = '') =>
        `${api}/prescriptions/${prescriptionId}/dispensing${action}`;
    const cancel = (id: string, body: Record<string, unknown>) =>
        pharmacy.admin.post(`${api}/prescriptions/${id}/cancel`, body);
    async function prescribe(visitId?: string, quantity = '3') {
        const { prescriptionId } = await pharmacy.issue(
            [{ item, quantity }],
            visitId ? { data: { visit_id: visitId } } : {},
        );
        const [row] = await pharmacy.queued(prescriptionId);
        if (!row) throw new Error('Resep tidak masuk antrean.');
        return { id: row.id, sourceId: prescriptionId };
    }
    async function version(id: string) {
        return (
            (
                await json<{
                    data: { dispensing: { version: number } | null };
                }>(await pharmacy.admin.get(path(id)), 200)
            ).data.dispensing?.version ?? null
        );
    }
    async function stock() {
        const [row] = await pool.unsafe<{ stock: string }[]>(
            `select trim_scale(coalesce(sum(sisa), 0))::text as stock from gd_tr_kartu_gudang
             where tenant_id = $1 and barang_id = $2 and lokasi_id = $3`,
            [pharmacy.tenantId, item.id, farmasi.id],
        );
        return Number(row?.stock);
    }
    const charges = (visitId: string) =>
        pool.unsafe<{ qty: string; status: string }[]>(
            `select trim_scale(qty)::text as qty, status from kunjungan_kasir_detail
             where tenant_id = $1 and kunjungan_id = $2 and group_biaya = 'OBAT' and deleted_at is null`,
            [pharmacy.tenantId, visitId],
        );
    const sent = async (type: string, sourceId: string) =>
        (await outboxEnvelopes(pool, pharmacy.tenantId, type)).filter(
            (row) => row.data.prescription_id === sourceId,
        );
    async function queue(status?: string) {
        return json<{ data: Row[]; counts: Counts }>(
            await pharmacy.admin.get(
                `${api}/prescriptions${status ? `?status=${status}` : ''}`,
            ),
            200,
        );
    }

    beforeAll(async () => {
        registerBillingEventHandlers();
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Batal', {
            duties: [...pharmacyDuties, 'pharmacy.dispensing.manage'],
        });
        farmasi = await pharmacy.location('FARMASI');
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
        item = await pharmacy.item('BTL-1', { base_price: '1500' });
        const draft = await pharmacy.created<{ id: string; version: number }>(
            `${inventoryApi}/adjustments`,
            {
                direction: 'masuk',
                location_id: farmasi.id,
                posting_date: '2026-11-01',
                reason_id: reasonId,
                lines: [{ item_id: item.id, quantity: 100, unit_cost: 900 }],
            },
        );
        await json(
            await pharmacy.admin.post(
                `${inventoryApi}/adjustments/${draft.id}/post`,
                { version: draft.version },
            ),
            200,
        );
    });

    test('a waiting prescription leaves the queue with its reason, once, as the contract says', async () => {
        const visitId = Bun.randomUUIDv7();
        const { id, sourceId } = await prescribe(visitId);
        expect(await refused(await cancel(id, { version: null }))).toEqual({
            reason: ['Isi alasan resep ini dibatalkan.'],
        });
        expect(
            await refused(await cancel(id, { reason: '  ', version: null })),
        ).toEqual({ reason: ['Isi alasan resep ini dibatalkan.'] });
        const before = await queue();
        const shown = await json<{
            data: {
                prescription: {
                    queue_status: string;
                    cancelled_at: string | null;
                    cancel_reason: string | null;
                };
            };
        }>(
            await cancel(id, {
                reason: 'Pasien tidak datang mengambil obat',
                version: null,
            }),
            200,
        );
        expect(shown.data.prescription).toMatchObject({
            queue_status: 'dibatalkan',
            cancel_reason: 'Pasien tidak datang mengambil obat',
        });
        expect(shown.data.prescription.cancelled_at).not.toBeNull();

        const after = await queue();
        expect(after.data.map((row) => row.id)).not.toContain(id);
        const total = (counts: Counts, status: string) =>
            counts.find((row) => row.status === status)?.total ?? 0;
        expect(total(after.counts, 'menunggu')).toBe(
            total(before.counts, 'menunggu') - 1,
        );
        expect(total(after.counts, 'dibatalkan')).toBe(
            total(before.counts, 'dibatalkan') + 1,
        );
        expect((await queue('dibatalkan')).data.map((row) => row.id)).toContain(
            id,
        );

        const [event, ...more] = await sent(cancelled, sourceId);
        expect(more).toEqual([]);
        expect(
            (await eventContract(cancelled)).safeParse(event).error,
        ).toBeUndefined();
        expect(event?.data).toMatchObject({
            visit_id: visitId,
            reason: 'Pasien tidak datang mengambil obat',
        });

        await json(await cancel(id, { reason: 'Diulang', version: null }), 200);
        expect(await sent(cancelled, sourceId)).toHaveLength(1);
        expect(
            await refused(await pharmacy.admin.post(path(id, '/prepare'))),
        ).toEqual({ _form: ['Resep ini sudah dibatalkan.'] });
    });

    test('a prepared prescription is cancelled with its preparation: stock and the bill come back', async () => {
        const visitId = Bun.randomUUIDv7();
        const { id, sourceId } = await prescribe(visitId, '4');
        const start = await stock();
        await json(await pharmacy.admin.post(path(id, '/prepare')), 200);
        expect(await stock()).toBe(start - 4);
        expect((await charges(visitId)).map((row) => row.qty)).toEqual(['4']);

        const prepared = await version(id);
        expect(
            (
                await cancel(id, {
                    reason: 'Pasien pulang',
                    version: null,
                })
            ).status,
        ).toBe(409);
        await json(
            await cancel(id, { reason: 'Pasien pulang', version: prepared }),
            200,
        );
        expect(await stock()).toBe(start);
        expect([...(await charges(visitId))]).toEqual([]);
        const [replaced] = (
            await outboxEnvelopes(pool, pharmacy.tenantId, chargesReplaced)
        )
            .filter((row) => row.data.visit_id === visitId)
            .slice(-1);
        expect(replaced?.data.lines).toEqual([]);
        expect(await sent(cancelled, sourceId)).toHaveLength(1);
    });

    test('handed-over drugs are not cancelled; they come back through a return', async () => {
        const { id } = await prescribe(Bun.randomUUIDv7(), '1');
        await json(await pharmacy.admin.post(path(id, '/prepare')), 200);
        await json(
            await pharmacy.admin.post(path(id, '/hand-over'), {
                received_by_patient: true,
                version: await version(id),
            }),
            200,
        );
        expect(
            await refused(
                await cancel(id, {
                    reason: 'Salah resep',
                    version: await version(id),
                }),
            ),
        ).toEqual({
            _form: [
                'Obat resep ini sudah diserahkan, jadi resepnya tidak bisa dibatalkan. Obat yang dikembalikan pasien dicatat lewat Retur.',
            ],
        });
    });

    test('after the cashier is paid, cancelling a prepared prescription gets the legacy message', async () => {
        const visitId = Bun.randomUUIDv7();
        const { id } = await prescribe(visitId, '1');
        await json(await pharmacy.admin.post(path(id, '/prepare')), 200);
        await visitCharges(pool, {
            tenantId: pharmacy.tenantId,
            legalEntityId: pharmacy.legalEntityId,
        }).completedVisit(visitId, []);
        const cashier = await openCashier();
        await billingJson(
            await payVisit(cashier, visitId, {
                received: '1500',
            }),
            201,
        );
        const before = await stock();
        expect(
            await refused(
                await cancel(id, {
                    reason: 'Pasien pulang',
                    version: await version(id),
                }),
            ),
        ).toEqual({ _form: [paidMessage] });
        expect(await stock()).toBe(before);
        expect((await charges(visitId)).map((row) => row.status)).toEqual([
            'ditagih',
        ]);
    });

    test('only holders of the cancel permission may cancel', async () => {
        const { id } = await prescribe();
        const member = await createMember(pool, pharmacy.tenantId, [
            'pharmacy.dispensing.prepare',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            member.membershipId,
        );
        const assistant = browser();
        await assistant.login(member.email, member.password);
        expect(
            (
                await assistant.post(`${api}/prescriptions/${id}/cancel`, {
                    reason: 'Pasien pulang',
                    version: null,
                })
            ).status,
        ).toBe(403);
    });

    // Petugas kasir yang sudah Clerk Start dengan jenis bayar tunai di legal entity farmasi.
    async function openCashier(): Promise<Browser> {
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
});
