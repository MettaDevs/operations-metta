import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    chargeLockedMessage,
    lockChargeForChange,
    receivableBuyerMessage,
    registerBillingEventHandlers,
    replaceSaleBill,
    type SaleBill,
} from '../../../../src/foundation/billing/index.ts';
import { clerkSales } from '../../../../src/foundation/billing/clerk/clerk.sales.ts';
import { Database } from '../../../../src/platform/database/index.ts';
import { HttpFailure } from '../../../../src/platform/http/index.ts';
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

// Tagihan penjualan tanpa kunjungan yang ditulis module penjual (replaceSaleBill) lalu dibayar dengan mesin kasir yang
// sama dengan tagihan kunjungan: rumus, kembalian, piutang, batal, kunci perubahan, event, dan Clerk End. Module memakai
// payBill di transaksinya sendiri; di sini tagihannya dibayar lewat Simpan pembayaran kasir, yang menjalankan fungsi
// yang sama. Diperiksa dengan SQL langsung.
describe.skipIf(!process.env.DB_HOST)('billing sale bills', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp({ DB_POOL_SIZE: '8' });
    afterAll(close);
    let tenantId: string;
    let legalEntityId: string;
    let cashier: Browser;
    let buyerPartyId: string;
    const methods: Record<string, string> = {};

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

    const sale = (
        documentId: string,
        buyer: SaleBill['buyer'] = { partyId: null, name: 'Budi' },
    ): SaleBill => ({
        tenantId,
        legalEntityId,
        operatingUnitId: null,
        module: 'pharmacy',
        documentId,
        number: `OTC-${documentId.slice(-4)}`,
        date: '2026-11-16',
        buyer,
        group: 'OBAT',
        lines: [
            {
                lineId: Bun.randomUUIDv7(),
                item: {
                    id: Bun.randomUUIDv7(),
                    code: 'PCT',
                    name: 'Parasetamol',
                },
                quantity: '10',
                unitPrice: '1500',
                discountPercent: '0',
            },
            {
                lineId: Bun.randomUUIDv7(),
                item: {
                    id: Bun.randomUUIDv7(),
                    code: 'VTC',
                    name: 'Vitamin C',
                },
                quantity: '2',
                unitPrice: '5000',
                discountPercent: '10',
            },
        ],
    });

    // Module penjual menulis tagihannya; versinya dikirim bersama pembayaran.
    const bill = (written: SaleBill) =>
        withDatabase((db) =>
            db.transaction(() => replaceSaleBill(db, written)),
        );
    const pay = (
        documentId: string,
        version: number,
        body: Record<string, unknown>,
    ) =>
        cashier.post(`/api/v1/billing/visits/${documentId}/payments`, {
            version,
            ...body,
        });
    async function sell(written: SaleBill, body: Record<string, unknown>) {
        const { version } = await bill(written);
        return json<{ data: { id: string; number: string } }>(
            await pay(written.documentId, version, body),
            201,
        );
    }

    beforeAll(async () => {
        registerBillingEventHandlers();
        const business = await createBillingBusiness(
            pool,
            browser,
            'Apotek Uji Penjualan',
            [
                'core.billing-setup.manage',
                'core.clerk.operate',
                'core.payment.operate',
                'core.payment-cancel.approve',
            ],
        );
        tenantId = business.tenantId;
        legalEntityId = business.legalEntityId;
        cashier = business.admin;
        for (const method of [
            { code: 'TUN', behavior: 'tunai', counted_at_close: true },
            { code: 'BON', behavior: 'piutang', party: 'pasien' },
            {
                code: 'SIS',
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
        buyerPartyId = Bun.randomUUIDv7();
        await pool.unsafe(
            `insert into parties (id, tenant_id, type, name, search_name) values ($1, $2, 'person', $3, $3)`,
            [buyerPartyId, tenantId, 'Budi Santoso'],
        );
        await json(
            await cashier.post('/api/v1/billing/clerks/start', {
                password: testPassword,
            }),
            201,
        );
    });

    test('a cash sale bills its lines once and pays them with change, and finance hears of the sale document', async () => {
        const documentId = Bun.randomUUIDv7();
        const paid = await sell(sale(documentId), { received: '50000' });
        expect(paid.data.number).toMatch(/^KSR-\d{8}$/);
        const [payment] = await pool.unsafe<Record<string, string>[]>(
            `select k.sumber_module, k.nilai::text, k.jumlah_bayar::text, k.nilai_kembalian::text, k.status,
                    t.jenis, t.sumber_nomor, t.pembeli_nama
             from kasir k
             join tagihan_kasir t on t.tenant_id = k.tenant_id and t.sumber_dokumen_id = k.sumber_dokumen_id
             where k.id = $1`,
            [paid.data.id],
        );
        expect(payment).toEqual({
            sumber_module: 'pharmacy',
            nilai: '24000.0000',
            jumlah_bayar: '50000.0000',
            nilai_kembalian: '26000.0000',
            status: 'diposting',
            jenis: 'penjualan',
            sumber_nomor: `OTC-${documentId.slice(-4)}`,
            pembeli_nama: 'Budi',
        });
        const [lines] = await pool.unsafe<{ billed: number; total: number }[]>(
            `select count(*) filter (where status = 'ditagih' and kasir_id = $2)::int as billed, count(*)::int as total
             from tagihan_kasir_detail
             where tagihan_sumber_dokumen_id = $1 and sumber_dokumen_id = $1 and group_biaya = 'OBAT'
               and deleted_at is null`,
            [documentId, paid.data.id],
        );
        expect(lines).toEqual({ billed: 2, total: 2 });
        const contract = await eventContract('billing.invoice.posted.v2');
        const [sent] = (
            await outboxEnvelopes(pool, tenantId, 'billing.invoice.posted.v2')
        ).filter((envelope) => envelope.data.payment_id === paid.data.id);
        expect(contract.safeParse(sent).error).toBeUndefined();
        expect(sent?.data).toMatchObject({
            source_module: 'pharmacy',
            source_document_id: documentId,
            source_document_number: `OTC-${documentId.slice(-4)}`,
            value: '24000',
        });
    });

    test('writing the sale again replaces its lines and bumps the version, so a stale payment is refused', async () => {
        const documentId = Bun.randomUUIDv7();
        const first = await bill(sale(documentId));
        const second = await bill(sale(documentId));
        expect(second.version).toBeGreaterThan(first.version);
        expect(
            (await pay(documentId, first.version, { received: '24000' }))
                .status,
        ).toBe(409);
        const [lines] = await pool.unsafe<{ open: number }[]>(
            `select count(*)::int as open from tagihan_kasir_detail
             where tagihan_sumber_dokumen_id = $1 and deleted_at is null`,
            [documentId],
        );
        expect(lines?.open).toBe(2);
    });

    test('a receivable belongs to the buyer, so an anonymous buyer cannot pay on credit', async () => {
        const anonymous = sale(Bun.randomUUIDv7(), {
            partyId: null,
            name: null,
        });
        expect(
            await refused(
                await pay(
                    anonymous.documentId,
                    (await bill(anonymous)).version,
                    {
                        lines: [
                            {
                                payment_method_id: methods.BON,
                                amount: '24000',
                            },
                        ],
                    },
                ),
            ),
        ).toEqual({ 'lines.0.payment_method_id': [receivableBuyerMessage] });
        const named = sale(Bun.randomUUIDv7(), { partyId: null, name: 'Budi' });
        expect(
            await refused(
                await pay(named.documentId, (await bill(named)).version, {
                    received: '4000',
                    take_remainder: true,
                }),
            ),
        ).toEqual({ _form: [receivableBuyerMessage] });

        const known = await sell(
            sale(Bun.randomUUIDv7(), {
                partyId: buyerPartyId,
                name: 'Budi Santoso',
            }),
            { lines: [{ payment_method_id: methods.BON, amount: '24000' }] },
        );
        const [receivable] = await pool.unsafe<Record<string, string>[]>(
            'select pihak_jenis, pihak_id, pihak_nama, nilai::text from piutang where kasir_id = $1',
            [known.data.id],
        );
        expect(receivable).toEqual({
            pihak_jenis: 'pihak',
            pihak_id: buyerPartyId,
            pihak_nama: 'Budi Santoso',
            nilai: '24000.0000',
        });
    });

    test('a paid sale is locked, and Batal reopens it so it can be paid again', async () => {
        const documentId = Bun.randomUUIDv7();
        const paid = await sell(sale(documentId), { received: '24000' });
        const locked = await withDatabase((db) =>
            db.transaction(() =>
                lockChargeForChange(db, { tenantId, documentId }),
            ),
        ).then(
            () => null,
            (error: unknown) => error,
        );
        expect(locked).toBeInstanceOf(HttpFailure);
        expect(locked instanceof HttpFailure && locked.body).toMatchObject({
            errors: { _form: [chargeLockedMessage] },
        });

        const [row] = await pool.unsafe<{ version: number }[]>(
            'select version from kasir where id = $1',
            [paid.data.id],
        );
        await json(
            await cashier.post(
                `/api/v1/billing/payments/${paid.data.id}/cancel`,
                { version: row?.version, reason: 'Salah hitung' },
            ),
            200,
        );
        const contract = await eventContract('billing.invoice.cancelled.v2');
        const [cancelled] = (
            await outboxEnvelopes(
                pool,
                tenantId,
                'billing.invoice.cancelled.v2',
            )
        ).filter((envelope) => envelope.data.payment_id === paid.data.id);
        expect(contract.safeParse(cancelled).error).toBeUndefined();
        expect(cancelled?.data).toMatchObject({
            source_module: 'pharmacy',
            source_document_id: documentId,
        });

        const [current] = await pool.unsafe<{ version: number }[]>(
            'select version from tagihan_kasir where sumber_dokumen_id = $1',
            [documentId],
        );
        const again = await json<{ data: { id: string } }>(
            await pay(documentId, current?.version ?? 0, {
                received: '24000',
            }),
            201,
        );
        const [status] = await pool.unsafe<{ status: string }[]>(
            'select status from kasir where id = $1',
            [again.data.id],
        );
        expect(status?.status).toBe('diposting');
    });

    test('Clerk End counts sale payments in the clerk that took them', async () => {
        const clerk = await json<{ data: { id: string } }>(
            await cashier.get('/api/v1/billing/clerks/current'),
            200,
        );
        const sales = await withDatabase((db) =>
            clerkSales(db, { tenantId, id: clerk.data.id }),
        );
        const [taken] = await pool.unsafe<{ cash: string }[]>(
            `select coalesce(sum(d.nilai), 0)::text as cash
             from kasir_detail d join kasir k on k.id = d.kasir_id
             where k.tenant_id = $1 and k.clerk_id = $2 and k.status = 'diposting' and d.jenis_bayar_id = $3
               and k.sumber_module = 'pharmacy'`,
            [tenantId, clerk.data.id, methods.TUN ?? ''],
        );
        expect(Number(taken?.cash)).toBeGreaterThan(0);
        expect(Number(sales.byMethod.get(methods.TUN ?? '')?.local)).toBe(
            Number(taken?.cash),
        );
    });

    test('the database refuses a sale bill that carries a visit snapshot', async () => {
        const failed = await pool
            .unsafe(
                `insert into tagihan_kasir (id, tenant_id, legal_entity_id, sumber_module, sumber_dokumen_id, sumber_nomor,
                                            tanggal, jenis, pasien_nama, status, created_at, updated_at)
                 values ($1, $2, $3, 'pharmacy', $1, 'OTC-X', '2026-11-16', 'penjualan', 'Pasien', 'selesai', now(), now())`,
                [Bun.randomUUIDv7(), tenantId, legalEntityId],
            )
            .then(
                () => null,
                (error: unknown) => error,
            );
        expect(String(failed)).toContain('tagihan_kasir_jenis_check');
    });
});
