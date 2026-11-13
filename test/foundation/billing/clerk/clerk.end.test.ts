import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
    clerkNotStartedMessage,
    lockChargeForChange,
    registerBillingEventHandlers,
} from '../../../../src/foundation/billing/index.ts';
import type { Database } from '../../../../src/platform/database/index.ts';
import {
    createBillingBusiness,
    json,
    refused,
    visitCharges,
} from '../../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';
import {
    createMember,
    testPassword,
} from '../../../support/tenant-fixtures.ts';

type Ended = { data: { transactions: number; system_total: string } };

// Clerk End yang berjalan bersamaan dengan Simpan dan Batal pembayaran di clerk yang sama, lewat aplikasi sungguhan.
// Setiap test menahan satu pihak di tengah transaksinya, menjalankan pihak lain sampai ia menunggu, lalu melepasnya:
// jumlah sistem Clerk End harus sama dengan pembayaran yang akhirnya tersimpan di clerk itu.
describe.skipIf(!process.env.DB_HOST)('billing Clerk End and payments', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    let tenantId: string;
    let cashier: Browser;
    let approver: { email: string; password: string };
    let charges: ReturnType<typeof visitCharges>;
    let cash: string;

    const pay = (visitId: string, received: string) =>
        cashier.post(`/api/v1/billing/visits/${visitId}/payments`, {
            received,
        });
    async function paid(visitId: string, received: string) {
        const created = await json<{ data: { id: string } }>(
            await pay(visitId, received),
            201,
        );
        const [row] = await pool.unsafe<{ version: number }[]>(
            'select version from kasir where id = $1',
            [created.data.id],
        );
        return { id: created.data.id, version: row?.version ?? 0 };
    }
    async function startClerk() {
        await json(
            await cashier.post('/api/v1/billing/clerks/start', {
                password: testPassword,
            }),
            201,
        );
        return (
            await json<{ data: { id: string; version: number } }>(
                await cashier.get('/api/v1/billing/clerks/current'),
                200,
            )
        ).data;
    }
    const endClerk = (clerk: { id: string; version: number }, counted: string) =>
        cashier.post(`/api/v1/billing/clerks/${clerk.id}/end`, {
            password: testPassword,
            counts: { [cash]: counted },
            version: clerk.version,
        });
    async function visit(tariff: string) {
        const id = Bun.randomUUIDv7();
        await charges.completedVisit(id, [tariff]);
        return id;
    }

    // Transaksi yang ditahan di tengah jalan sampai release dipanggil, beserta pid backend-nya.
    async function hold(work: (db: Database) => Promise<void>) {
        let release = () => {};
        const released = new Promise<void>((resolve) => (release = resolve));
        let taken = (_pid: number) => {};
        const pid = new Promise<number>((resolve) => (taken = resolve));
        const done = charges.withDatabase((db) =>
            db.transaction(async () => {
                await work(db);
                taken(
                    (
                        await db.one(
                            z.object({ pid: z.number() }),
                            'select pg_backend_pid() as pid',
                        )
                    )?.pid ?? 0,
                );
                await released;
            }),
        );
        return { pid: await pid, release, done };
    }
    // Permintaan yang berjalan, dengan penanda apakah ia sudah selesai.
    function running(request: Promise<Response>) {
        const state = { settled: false, response: request };
        void request.finally(() => (state.settled = true));
        return state;
    }
    // Backend yang menunggu kunci milik backend pid, atau null bila permintaan yang diamati selesai tanpa menunggu.
    async function waitingOn(pid: number, watched: { settled: boolean }) {
        for (let attempt = 0; attempt < 400; attempt++) {
            const [row] = await pool.unsafe<{ pid: number }[]>(
                'select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid)) limit 1',
                [pid],
            );
            if (row) return row.pid;
            if (watched.settled) return null;
            await Bun.sleep(25);
        }
        return null;
    }

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Clerk End',
            [
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
            ],
        );
        tenantId = business.tenantId;
        cashier = business.admin;
        charges = visitCharges(pool, {
            tenantId,
            legalEntityId: business.legalEntityId,
        });
        approver = await createMember(pool, tenantId, [
            'core.payment-cancel.approve',
        ]);
        cash = (
            await json<{ data: { id: string } }>(
                await cashier.post('/api/v1/billing/payment-methods', {
                    code: 'TUN',
                    name: 'TUNAI',
                    behavior: 'tunai',
                    counted_at_close: true,
                }),
                201,
            )
        ).data.id;
    });

    test('a payment being saved when Clerk End starts finishes first and is counted', async () => {
        const clerk = await startClerk();
        const visitId = await visit('100000');
        // Kunci kunjungan ditahan, jadi Simpan pembayaran berhenti sesudah memeriksa clerk-nya.
        const holder = await hold((db) =>
            lockChargeForChange(db, {
                tenantId,
                sourceModule: 'healthcare',
                visitId,
            }),
        );
        const payment = running(pay(visitId, '100000'));
        const paymentPid = await waitingOn(holder.pid, payment);
        expect(paymentPid).not.toBeNull();
        const ending = running(endClerk(clerk, '100000'));
        await waitingOn(paymentPid ?? 0, ending);
        holder.release();
        await holder.done;
        expect((await payment.response).status).toBe(201);
        const ended = await json<Ended>(await ending.response, 200);
        expect([ended.data.transactions, ended.data.system_total]).toEqual([
            1, '100000',
        ]);
    });

    test('a payment being cancelled when Clerk End starts finishes first and drops out of the count', async () => {
        const clerk = await startClerk();
        await paid(await visit('40000'), '40000');
        const cancelled = await paid(await visit('60000'), '60000');
        // Baris pembayaran ditahan, jadi Batal berhenti sesudah memeriksa clerk-nya.
        const holder = await hold(async (db) => {
            await db.execute('select id from kasir where id = $1 for update', [
                cancelled.id,
            ]);
        });
        const cancel = running(
            cashier.post(`/api/v1/billing/payments/${cancelled.id}/cancel`, {
                version: cancelled.version,
                reason: 'Salah pilih pasien',
                approver_email: approver.email,
                approver_password: approver.password,
            }),
        );
        const cancelPid = await waitingOn(holder.pid, cancel);
        expect(cancelPid).not.toBeNull();
        const ending = running(endClerk(clerk, '40000'));
        await waitingOn(cancelPid ?? 0, ending);
        holder.release();
        await holder.done;
        expect((await cancel.response).status).toBe(200);
        const ended = await json<Ended>(await ending.response, 200);
        expect([ended.data.transactions, ended.data.system_total]).toEqual([
            1, '40000',
        ]);
    });

    test('a payment saved after Clerk End took the clerk waits for it and is refused', async () => {
        const clerk = await startClerk();
        await paid(await visit('30000'), '30000');
        const lateVisit = await visit('70000');
        // Baris hitungan Clerk End ditahan, jadi Clerk End berhenti sesudah mengakhiri clerk-nya.
        const holder = await hold(async (db) => {
            await db.execute('lock table clerk_detail in share mode');
        });
        const ending = running(endClerk(clerk, '30000'));
        const endingPid = await waitingOn(holder.pid, ending);
        expect(endingPid).not.toBeNull();
        const payment = running(pay(lateVisit, '70000'));
        await waitingOn(endingPid ?? 0, payment);
        holder.release();
        await holder.done;
        const ended = await json<Ended>(await ending.response, 200);
        expect([ended.data.transactions, ended.data.system_total]).toEqual([
            1, '30000',
        ]);
        expect(await refused(await payment.response)).toEqual({
            _form: [clerkNotStartedMessage],
        });
    });
});
