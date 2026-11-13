import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    clerkNotStartedMessage,
    openClerk,
} from '../../../../src/foundation/billing/index.ts';
import { Database } from '../../../../src/platform/database/index.ts';
import { HttpFailure } from '../../../../src/platform/http/index.ts';
import {
    createBillingBusiness,
    json,
    refused,
} from '../../../support/billing-fixtures.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
    setCurrencyPrecision,
} from '../../../support/tenant-fixtures.ts';

const api = '/api/v1/billing/clerks';
const notStarted = {
    status: 422,
    body: {
        message: clerkNotStartedMessage,
        errors: { _form: [clerkNotStartedMessage] },
    },
};

type Clerk = {
    id: string;
    code: string;
    status: 'start' | 'end';
    transactions: number;
    opening_total: string;
    system_total: string;
    clerk_total: string;
    difference_total: string;
    version: number;
    lines: {
        payment_method_id: string;
        code: string;
        opening_amount: string;
        system_amount: string | null;
        counted_amount: string | null;
        difference: string | null;
    }[];
};
type Current = {
    data: Clerk | null;
    opening_methods: { payment_method_id: string; code: string }[];
    local_currency: string;
    password_required: boolean;
    can_operate: boolean;
};

// Clerk Start dan Clerk End lewat aplikasi sungguhan: kata sandi diketik ulang, satu clerk berjalan per kasir, Clerk End
// hanya menghitung jenis bayar bertanda dihitung saat tutup kas, dan pembayaran ditolak dengan pesan sistem lama selama
// kasir belum Clerk Start. Belum ada pembayaran yang bisa dicatat, jadi jumlah sistem setiap sesi nol.
describe.skipIf(!process.env.DB_HOST)('clerk', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let tenantId: string;
    let legalEntityId: string;
    let cashier: Browser;
    let cashierUserId: string;
    let methods: Record<string, string>;

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
    const guard = () =>
        withDatabase((db) =>
            openClerk(db, {
                tenantId,
                legalEntityId,
                userId: cashierUserId,
            }),
        );

    // Penolakan pintu pembayaran, atau null bila kasir boleh membayar.
    const refusal = async () => {
        try {
            await guard();
            return null;
        } catch (error) {
            if (error instanceof HttpFailure)
                return { status: error.status, body: error.body };
            throw error;
        }
    };

    beforeAll(async () => {
        const business = await createBillingBusiness(
            pool,
            browser,
            'Klinik Uji Clerk',
            ['core.billing-setup.manage', 'core.clerk.operate'],
        );
        tenantId = business.tenantId;
        legalEntityId = business.legalEntityId;
        cashier = business.admin;
        cashierUserId = business.member.userId;
        // Hitungan Clerk End di sini memakai sen, jadi presisi jumlah rupiah tenant ini dua angka di belakang koma.
        await setCurrencyPrecision(pool, tenantId, {
            amount_decimals: 2,
            unit_amount_decimals: 2,
            invoice_rounding_precision: '0',
            invoice_rounding_type: 'nearest',
        });
        methods = {};
        for (const method of [
            {
                code: 'TUN',
                name: 'TUNAI',
                sort_order: 1,
                behavior: 'tunai',
                counted_at_close: true,
            },
            {
                code: 'BNK',
                name: 'KARTU KREDIT/DEBIT',
                sort_order: 2,
                behavior: 'non_tunai',
                counted_at_close: true,
            },
            {
                code: 'BPJ',
                name: 'DIJAMIN BPJS',
                sort_order: 3,
                behavior: 'penjamin',
            },
        ])
            methods[method.code] = (
                await json<{ data: { id: string } }>(
                    await cashier.post('/api/v1/billing/payment-methods', {
                        ...method,
                    }),
                    201,
                )
            ).data.id;
    });

    test('paying before Clerk Start is refused with the legacy message', async () => {
        expect(await refusal()).toEqual(notStarted);
        const current = await json<Current>(
            await cashier.get(`${api}/current`),
            200,
        );
        // Uang awal hanya untuk jenis bayar tunai yang dihitung saat Clerk End.
        expect(current).toEqual({
            data: null,
            opening_methods: [
                expect.objectContaining({
                    payment_method_id: methods.TUN,
                    code: 'TUN',
                }),
            ],
            local_currency: 'IDR',
            password_required: true,
            can_operate: true,
        });
    });

    test('Clerk Start needs the cashier password, and opens one session with a legacy-shaped code', async () => {
        expect(
            await refused(
                await cashier.post(`${api}/start`, { password: 'salah' }),
            ),
        ).toEqual({
            password: [
                'Password Anda Salah... Proses tidak dapat dilanjutkan.',
            ],
        });
        expect(
            await refused(
                await cashier.post(`${api}/start`, {
                    password: 'kata-sandi-uji-yang-panjang',
                    opening: { [methods.TUN!]: '-1', [methods.BNK!]: '5000' },
                }),
            ),
        ).toEqual({
            opening: [
                'Uang awal hanya untuk jenis bayar tunai yang dihitung saat Clerk End. Muat ulang, lalu isi lagi.',
            ],
            [`opening.${methods.TUN}`]: [
                'Isi uang awal 0 atau lebih, paling banyak dua angka di belakang koma.',
            ],
        });
        expect(
            (
                await pool.unsafe<{ id: string }[]>(
                    'select id from clerk where tenant_id = $1',
                    [tenantId],
                )
            ).length,
        ).toBe(0);
        const started = await json<{ data: Clerk; message: string }>(
            await cashier.post(`${api}/start`, {
                password: 'kata-sandi-uji-yang-panjang',
                opening: { [methods.TUN!]: '100000' },
            }),
            201,
        );
        expect(started.message).toBe('Proses Clerk Start sudah dilakukan');
        const [today] = await pool.unsafe<{ date: string }[]>(
            `select to_char(now() at time zone timezone, 'DDMMYYYY') as date
             from legal_entities where organization_id = $1`,
            [legalEntityId],
        );
        expect(started.data.code).toMatch(
            new RegExp(`^C-${today?.date}-[0-9A-Z]{5}$`),
        );
        expect(started.data.status).toBe('start');
        // Clerk End diisi buta: jenis bayar yang dihitung tampil dengan uang awalnya, tanpa jumlah sistem.
        expect(
            started.data.lines.map((line) => [
                line.code,
                line.opening_amount,
                line.system_amount,
            ]),
        ).toEqual([
            ['TUN', '100000', null],
            ['BNK', '0', null],
        ]);
        expect(
            (
                await cashier.post(`${api}/start`, {
                    password: 'kata-sandi-uji-yang-panjang',
                })
            ).status,
        ).toBe(409);
        expect((await guard()).id).toBe(started.data.id);
    });

    test('another cashier cannot end a session that is not theirs', async () => {
        const other = await createMember(pool, tenantId, [
            'core.clerk.operate',
        ]);
        await grantAllOrganizations(pool, tenantId, other.membershipId);
        const colleague = browser();
        await colleague.login(other.email, other.password);
        const current = await json<Current>(
            await cashier.get(`${api}/current`),
            200,
        );
        const clerk = current.data;
        expect(clerk).not.toBeNull();
        expect(
            (
                await colleague.post(`${api}/${clerk?.id}/end`, {
                    password: 'kata-sandi-uji-yang-panjang',
                    counts: {},
                    version: clerk?.version,
                })
            ).status,
        ).toBe(403);
    });

    test('Clerk End counts only the methods counted at close, and the difference is counted minus opening cash and system', async () => {
        const clerk = (
            await json<Current>(await cashier.get(`${api}/current`), 200)
        ).data;
        if (!clerk) throw new Error('Clerk belum berjalan.');
        const refusedCounts = await refused(
            await cashier.post(`${api}/${clerk.id}/end`, {
                password: 'kata-sandi-uji-yang-panjang',
                counts: {
                    [methods.BPJ!]: '250000',
                    [methods.TUN!]: 'seratus',
                },
                version: clerk.version,
            }),
        );
        expect(Object.keys(refusedCounts).sort()).toEqual([
            'counts',
            `counts.${methods.TUN}`,
        ]);
        const ended = await json<{ data: Clerk; message: string }>(
            await cashier.post(`${api}/${clerk.id}/end`, {
                password: 'kata-sandi-uji-yang-panjang',
                counts: { [methods.TUN!]: '125000.50', [methods.BNK!]: '' },
                version: clerk.version,
            }),
            200,
        );
        expect(ended.message).toBe('Proses Clerk End sudah dilakukan');
        expect(ended.data).toMatchObject({
            status: 'end',
            transactions: 0,
            opening_total: '100000',
            system_total: '0',
            clerk_total: '125000.5',
            difference_total: '25000.5',
        });
        const stored = await pool.unsafe<
            {
                kode: string;
                awal: string;
                sistem: string;
                total: string;
                selisih: string;
            }[]
        >(
            `select j.kode, d.uang_awal::text as awal, d.jumlah_sistem::text as sistem,
                    d.jumlah_total::text as total, d.jumlah_selisih::text as selisih
             from clerk_detail d join jenis_bayar j on j.id = d.jenis_bayar_id
             where d.clerk_id = $1 order by j.kode`,
            [clerk.id],
        );
        expect([...stored]).toEqual([
            {
                kode: 'BNK',
                awal: '0.0000',
                sistem: '0.0000',
                total: '0.0000',
                selisih: '0.0000',
            },
            {
                kode: 'TUN',
                awal: '100000.0000',
                sistem: '0.0000',
                total: '125000.5000',
                selisih: '25000.5000',
            },
        ]);
        expect(
            (
                await cashier.post(`${api}/${clerk.id}/end`, {
                    password: 'kata-sandi-uji-yang-panjang',
                    counts: {},
                    version: ended.data.version,
                })
            ).status,
        ).toBe(409);
        expect(await refusal()).toEqual(notStarted);
    });

    test('a payment method counted in a closed session is not deleted', async () => {
        const [method] = await pool.unsafe<{ version: number }[]>(
            'select version from jenis_bayar where id = $1',
            [methods.TUN!],
        );
        expect(
            Object.keys(
                await refused(
                    await cashier.delete(
                        `/api/v1/billing/payment-methods/${methods.TUN}`,
                        { version: method?.version },
                    ),
                ),
            ),
        ).toEqual(['_form']);
    });

    test('the clerk list shows every session in the legal entity, newest first', async () => {
        const listed = await json<{ data: Clerk[] }>(
            await cashier.get(api),
            200,
        );
        expect(listed.data.map((row) => row.status)).toEqual(['end']);
        const shown = await json<{ data: Clerk }>(
            await cashier.get(`${api}/${listed.data[0]?.id}`),
            200,
        );
        expect(
            shown.data.lines.map((line) => [
                line.code,
                line.opening_amount,
                line.difference,
            ]),
        ).toEqual([
            ['TUN', '100000', '25000.5'],
            ['BNK', '0', '0'],
        ]);
    });
});
