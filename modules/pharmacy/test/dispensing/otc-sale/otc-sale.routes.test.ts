import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { clerkNotStartedMessage } from '@core/foundation/billing/index.ts';
import { outboxEnvelopes } from '../../../../../test/support/event-contracts.ts';
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
type Line = { item_id: string; unit_id: string; quantity: string | number };
type Quote = {
    lines: (Line & {
        unit_price: string;
        discount_percent: string;
        amount: string;
    })[];
    total: string;
};
type Sold = {
    id: string;
    number: string;
    payment: { id: string; number: string };
};

const sales = `${api}/otc-sales`;
const remainderMessage = 'Masih terdapat Sisa pembayaran!!';

// Penjualan obat bebas di loket farmasi dalam satu langkah: obat dihargai dengan grading harga obat, stok keluar FEFO,
// bill_farmasi tanpa resep lahir diserahkan, dan tagihan penjualan kasir dibayar di transaksi yang sama. Tenant ini hanya
// memasang farmasi, tanpa layanan kesehatan. Hasilnya dibaca lewat SQL, dan yang ditolak tidak menulis apa pun.
describe.skipIf(!process.env.DB_HOST)(
    'OTC sale at the pharmacy counter',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp({
            DB_POOL_SIZE: '8',
        });
        afterAll(close);
        let pharmacy: Pharmacy;
        let counter: Reference;
        let warehouse: Reference;
        let strip: Reference;
        let umum: Reference;
        let tracked: Reference;
        let otcGroup: Reference;
        let reasonId: string;
        let buyerPartyId: string;
        const methods: Record<string, string> = {};

        async function receive(
            item: Reference,
            batches: { batch: string; expiry: string; quantity: number }[],
        ) {
            const draft = await pharmacy.created<{
                id: string;
                version: number;
            }>(`${inventoryApi}/adjustments`, {
                direction: 'masuk',
                location_id: counter.id,
                posting_date: '2026-11-01',
                reason_id: reasonId,
                lines: batches.map((line) => ({
                    item_id: item.id,
                    quantity: line.quantity,
                    unit_cost: 500,
                    batch_number: line.batch,
                    expiry_date: line.expiry,
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

        // Obat bebas berharga dasar 1000 per tablet, dijual per tablet atau per strip isi 10, dalam kelompok grading OTC.
        async function drug(
            code: string,
            batches: { batch: string; expiry: string; quantity: number }[],
        ) {
            const item = await pharmacy.item(code, {
                base_price: '1000',
                tracking_code_id: tracked.id,
            });
            await pharmacy.created(`${inventoryApi}/item-units`, {
                item_id: item.id,
                unit_id: strip.id,
                quantity_per_unit: 10,
            });
            await json(
                await pharmacy.admin.put(`${api}/drugs/${item.id}`, {
                    drug_class_id: null,
                    grading_group_id: otcGroup.id,
                    is_generic: false,
                    is_formulary: false,
                    version: 0,
                }),
                200,
            );
            if (batches.length) await receive(item, batches);
            return item;
        }

        const quote = async (
            body: Record<string, unknown>,
            as = pharmacy.admin,
        ) =>
            (
                await json<{ data: Quote }>(
                    await as.post(`${sales}/quote`, body),
                    200,
                )
            ).data;

        // Simpan dan bayar dengan total yang baru saja ditampilkan quote.
        async function sell(
            body: Record<string, unknown> & { lines: Line[] },
            payment: Record<string, unknown>,
            as: Browser = pharmacy.admin,
        ) {
            const { total } = await quote(
                {
                    location_id: body.location_id ?? counter.id,
                    price_group_id: body.price_group_id,
                    ktp_patient: body.ktp_patient,
                    lines: body.lines,
                },
                as,
            );
            return as.post(sales, {
                location_id: counter.id,
                expected_total: total,
                payment,
                ...body,
            });
        }

        async function written() {
            const [row] = await pool.unsafe<Record<string, number>[]>(
                `select (select count(*)::int from bill_farmasi where tenant_id = $1) as bills,
                    (select count(*)::int from bill_farmasi_detail where tenant_id = $1) as lines,
                    (select count(*)::int from gd_tr_kartu_gudang
                     where tenant_id = $1 and sumber_jenis = 'bill_farmasi') as entries,
                    (select count(*)::int from tagihan_kasir where tenant_id = $1) as invoices,
                    (select count(*)::int from tagihan_kasir_detail where tenant_id = $1) as charges,
                    (select count(*)::int from kasir where tenant_id = $1) as payments`,
                [pharmacy.tenantId],
            );
            return row;
        }

        async function member(duties: string[]) {
            const created = await createMember(pool, pharmacy.tenantId, duties);
            await grantAllOrganizations(
                pool,
                pharmacy.tenantId,
                created.membershipId,
            );
            const signedIn = browser();
            await signedIn.login(created.email, created.password);
            return signedIn;
        }

        beforeAll(async () => {
            pharmacy = await createPharmacy(pool, browser, 'Apotek Uji Bebas', {
                duties: [
                    ...pharmacyDuties,
                    'pharmacy.otc-sale.operate',
                    'core.pricing-setup.manage',
                    'core.reference-data.manage',
                    'core.billing-setup.manage',
                    'core.clerk.operate',
                    'core.payment.operate',
                ],
            });
            counter = await pharmacy.location('LOKET');
            warehouse = await pharmacy.location('GUDANG');
            strip = await pharmacy.created(`${inventoryApi}/units-of-measure`, {
                code: 'STRIP',
                name: 'Strip',
            });
            tracked = await pharmacy.created(
                `${inventoryApi}/item-tracking-codes`,
                {
                    code: 'OBAT',
                    name: 'Obat berbatch',
                    batch_required: true,
                    expiry_required: true,
                },
            );
            reasonId =
                (
                    await json<{ data: Reference[] }>(
                        await pharmacy.admin.get(
                            `${inventoryApi}/reason-codes`,
                        ),
                        200,
                    )
                ).data.find((reason) => reason.code === 'SALDO-AWAL')?.id ?? '';
            umum = await pharmacy.created('/api/v1/pricing/price-groups', {
                code: 'UMUM',
                name: 'Umum',
            });
            otcGroup = await pharmacy.created(`${api}/grading-groups`, {
                name: 'OBAT BEBAS',
            });
            for (const row of [
                { ktp_patient: true, markup_percent: 20, discount_percent: 5 },
                { ktp_patient: false, markup_percent: 10, discount_percent: 0 },
            ])
                await pharmacy.created(`${api}/drug-prices`, {
                    price_group_id: umum.id,
                    grading_group_id: otcGroup.id,
                    price_from: 0,
                    price_to: 1000000000,
                    effective_from: '2026-01-01',
                    ...row,
                });
            await pharmacy.created(`${api}/otc-sale-locations`, {
                location_id: counter.id,
                price_group_id: umum.id,
            });
            for (const method of [
                { code: 'TUN', name: 'Tunai', behavior: 'tunai' },
                {
                    code: 'BON',
                    name: 'Bon',
                    behavior: 'piutang',
                    party: 'pasien',
                },
            ])
                methods[method.code] = (
                    await pharmacy.created(
                        '/api/v1/billing/payment-methods',
                        method,
                    )
                ).id;
            buyerPartyId = Bun.randomUUIDv7();
            await pool.unsafe(
                `insert into parties (id, tenant_id, type, name, search_name, status, created_at, updated_at)
             values ($1, $2, 'person', 'Sari Pembeli', 'sari pembeli', 'active', now(), now())`,
                [buyerPartyId, pharmacy.tenantId],
            );
            await json(
                await pharmacy.admin.post('/api/v1/billing/clerks/start', {
                    password: testPassword,
                }),
                201,
            );
        });

        test('the tenant has pharmacy installed and no healthcare module', async () => {
            const installed = await pool.unsafe<{ module_id: string }[]>(
                `select module_id from core_module_installations
             where tenant_id = $1 and status = 'installed' order by module_id`,
                [pharmacy.tenantId],
            );
            expect(installed.map((row) => row.module_id)).toEqual(['pharmacy']);
        });

        test('a cash sale takes stock out earliest expiry first, hands over a bill without prescription, and pays the sale bill with change', async () => {
            const item = await drug('OTC-FEFO', [
                { batch: 'LAMBAT', expiry: '2028-12-31', quantity: 20 },
                { batch: 'CEPAT', expiry: '2027-06-30', quantity: 15 },
            ]);
            const quoted = await quote({
                location_id: counter.id,
                lines: [{ item_id: item.id, unit_id: strip.id, quantity: 2 }],
            });
            expect(quoted).toEqual({
                lines: [
                    {
                        item_id: item.id,
                        unit_id: strip.id,
                        quantity: '2',
                        unit_price: '12000',
                        discount_percent: '5',
                        amount: '22800',
                    },
                ],
                total: '22800',
            });
            const sold = (
                await json<{ data: Sold }>(
                    await pharmacy.admin.post(sales, {
                        location_id: counter.id,
                        lines: [
                            {
                                item_id: item.id,
                                unit_id: strip.id,
                                quantity: 2,
                            },
                        ],
                        expected_total: quoted.total,
                        payment: { received: '50000' },
                    }),
                    201,
                )
            ).data;
            expect(sold.number).toMatch(/-FAR-\d{8}$/);

            const [bill] = await pool.unsafe<Record<string, unknown>[]>(
                `select nomor, status, resep_id, lokasi_id, operating_unit_id, tanggal is not null as dated,
                    disiapkan_pada = diserahkan_pada as same_stamp,
                    disiapkan_oleh_user_id = diserahkan_oleh_user_id and diserahkan_oleh_user_id = $2 as same_user,
                    dipanggil_pada, termasuk_jasa, kelompok_harga_id, pasien_ktp, pembeli_pihak_id, pembeli_nama
             from bill_farmasi where id = $1`,
                [sold.id, pharmacy.member.userId],
            );
            expect(bill).toEqual({
                nomor: sold.number,
                status: 'diserahkan',
                resep_id: null,
                lokasi_id: counter.id,
                operating_unit_id: pharmacy.unitId,
                dated: true,
                same_stamp: true,
                same_user: true,
                dipanggil_pada: null,
                termasuk_jasa: false,
                kelompok_harga_id: umum.id,
                pasien_ktp: true,
                pembeli_pihak_id: null,
                pembeli_nama: null,
            });
            const lines = await pool.unsafe<Record<string, unknown>[]>(
                `select resep_detail_id, trim_scale(jumlah)::text as jumlah, satuan_id, trim_scale(konversi)::text as konversi,
                    trim_scale(harga_dasar)::text as harga_dasar, trim_scale(harga_satuan)::text as harga_satuan,
                    trim_scale(persen_diskon)::text as persen_diskon
             from bill_farmasi_detail where bill_farmasi_id = $1`,
                [sold.id],
            );
            expect([...lines]).toEqual([
                {
                    resep_detail_id: null,
                    jumlah: '2',
                    satuan_id: strip.id,
                    konversi: '10',
                    harga_dasar: '1000',
                    harga_satuan: '12000',
                    persen_diskon: '5',
                },
            ]);
            const taken = await pool.unsafe<
                { batch: string; quantity: string }[]
            >(
                `select t.no_batch as batch, trim_scale(k.jumlah)::text as quantity
             from gd_tr_kartu_gudang k join gd_m_batch t on t.id = k.batch_id
             where k.sumber_jenis = 'bill_farmasi' and k.sumber_id = $1 and k.jenis = 'penyerahan'
               and k.lokasi_id = $2
             order by t.kedaluwarsa`,
                [sold.id, counter.id],
            );
            expect([...taken]).toEqual([
                { batch: 'CEPAT', quantity: '-15' },
                { batch: 'LAMBAT', quantity: '-5' },
            ]);

            const [invoice] = await pool.unsafe<Record<string, unknown>[]>(
                `select jenis, sumber_module, sumber_nomor, status, operating_unit_id, pembeli_pihak_id, pembeli_nama
             from tagihan_kasir where sumber_dokumen_id = $1`,
                [sold.id],
            );
            expect(invoice).toEqual({
                jenis: 'penjualan',
                sumber_module: 'pharmacy',
                sumber_nomor: sold.number,
                status: 'selesai',
                operating_unit_id: pharmacy.unitId,
                pembeli_pihak_id: null,
                pembeli_nama: null,
            });
            const charges = await pool.unsafe<Record<string, unknown>[]>(
                `select group_biaya, jenis_biaya_id, trim_scale(qty)::text as qty, trim_scale(nilai)::text as nilai,
                    trim_scale(disc)::text as disc, status
             from tagihan_kasir_detail where tagihan_sumber_dokumen_id = $1 and deleted_at is null`,
                [sold.id],
            );
            expect([...charges]).toEqual([
                {
                    group_biaya: 'OBAT',
                    jenis_biaya_id: item.id,
                    qty: '2',
                    nilai: '12000',
                    disc: '5',
                    status: 'ditagih',
                },
            ]);
            const [payment] = await pool.unsafe<Record<string, unknown>[]>(
                `select id, no_bukti, status, trim_scale(nilai)::text as nilai,
                    trim_scale(jumlah_bayar)::text as jumlah_bayar,
                    trim_scale(nilai_kembalian)::text as nilai_kembalian
             from kasir where sumber_dokumen_id = $1`,
                [sold.id],
            );
            expect(payment).toEqual({
                id: sold.payment.id,
                no_bukti: sold.payment.number,
                status: 'diposting',
                nilai: '22800',
                jumlah_bayar: '50000',
                nilai_kembalian: '27200',
            });
            const visitCharges = (
                await outboxEnvelopes(
                    pool,
                    pharmacy.tenantId,
                    'pharmacy.dispensing.charges-replaced.v1',
                )
            ).filter((envelope) => envelope.data.dispensing_id === sold.id);
            expect(visitCharges).toEqual([]);
        });

        test('an anonymous buyer may go without a name or with a typed name', async () => {
            const item = await drug('OTC-ANON', [
                { batch: 'A1', expiry: '2028-01-31', quantity: 50 },
            ]);
            const lines = [
                { item_id: item.id, unit_id: pharmacy.uom.id, quantity: 1 },
            ];
            const nameless = (
                await json<{ data: Sold }>(
                    await sell({ lines }, { received: '2000' }),
                    201,
                )
            ).data;
            const named = (
                await json<{ data: Sold }>(
                    await sell(
                        { lines, buyer_name: '  Budi  ' },
                        { received: '2000' },
                    ),
                    201,
                )
            ).data;
            const buyers = await pool.unsafe<Record<string, unknown>[]>(
                `select b.pembeli_pihak_id as bill_party, b.pembeli_nama as bill_name,
                    t.pembeli_pihak_id as invoice_party, t.pembeli_nama as invoice_name
             from bill_farmasi b join tagihan_kasir t on t.sumber_dokumen_id = b.id
             where b.id in ($1, $2) order by b.id`,
                [nameless.id, named.id],
            );
            expect([...buyers]).toEqual([
                {
                    bill_party: null,
                    bill_name: null,
                    invoice_party: null,
                    invoice_name: null,
                },
                {
                    bill_party: null,
                    bill_name: 'Budi',
                    invoice_party: null,
                    invoice_name: 'Budi',
                },
            ]);
        });

        test('a buyer from the address book carries the party name unless another name is typed, and may pay on credit', async () => {
            const item = await drug('OTC-PIHAK', [
                { batch: 'P1', expiry: '2028-01-31', quantity: 50 },
            ]);
            const lines = [
                { item_id: item.id, unit_id: pharmacy.uom.id, quantity: 2 },
            ];
            const onCredit = (
                await json<{ data: Sold }>(
                    await sell(
                        { lines, buyer_party_id: buyerPartyId },
                        {
                            lines: [
                                {
                                    payment_method_id: methods.BON,
                                    amount: '2280',
                                },
                            ],
                        },
                    ),
                    201,
                )
            ).data;
            const typed = (
                await json<{ data: Sold }>(
                    await sell(
                        {
                            lines,
                            buyer_party_id: buyerPartyId,
                            buyer_name: 'Ibu Sari',
                        },
                        { received: '2280' },
                    ),
                    201,
                )
            ).data;
            const buyers = await pool.unsafe<Record<string, unknown>[]>(
                `select b.pembeli_pihak_id as bill_party, b.pembeli_nama as bill_name, t.pembeli_nama as invoice_name
             from bill_farmasi b join tagihan_kasir t on t.sumber_dokumen_id = b.id
             where b.id in ($1, $2) order by b.id`,
                [onCredit.id, typed.id],
            );
            expect([...buyers]).toEqual([
                {
                    bill_party: buyerPartyId,
                    bill_name: 'Sari Pembeli',
                    invoice_name: 'Sari Pembeli',
                },
                {
                    bill_party: buyerPartyId,
                    bill_name: 'Ibu Sari',
                    invoice_name: 'Ibu Sari',
                },
            ]);
            const [receivable] = await pool.unsafe<Record<string, unknown>[]>(
                `select p.pihak_id, trim_scale(p.nilai)::text as nilai from piutang p
             join kasir k on k.id = p.kasir_id where k.sumber_dokumen_id = $1`,
                [onCredit.id],
            );
            expect(receivable).toEqual({
                pihak_id: buyerPartyId,
                nilai: '2280',
            });
            expect(
                await refused(
                    await pharmacy.admin.post(sales, {
                        location_id: counter.id,
                        buyer_party_id: Bun.randomUUIDv7(),
                        lines,
                        expected_total: '2280',
                        payment: { received: '2280' },
                    }),
                ),
            ).toEqual({ buyer_party_id: ['Pilih pembeli dari buku alamat.'] });
        });

        test('the price group comes from the location unless chosen, and the grading follows the Patient KTP', async () => {
            const item = await drug('OTC-KTP', [
                { batch: 'K1', expiry: '2028-01-31', quantity: 50 },
            ]);
            const lines = [
                { item_id: item.id, unit_id: pharmacy.uom.id, quantity: 3 },
            ];
            const priced = async (body: Record<string, unknown>) => {
                const {
                    lines: [line],
                    total,
                } = await quote({
                    location_id: counter.id,
                    lines,
                    ...body,
                });
                return {
                    unit_price: line?.unit_price,
                    discount_percent: line?.discount_percent,
                    total,
                };
            };
            expect(await priced({})).toEqual({
                unit_price: '1200',
                discount_percent: '5',
                total: '3420',
            });
            expect(await priced({ ktp_patient: false })).toEqual({
                unit_price: '1100',
                discount_percent: '0',
                total: '3300',
            });
            expect(await priced({ price_group_id: null })).toEqual({
                unit_price: '1000',
                discount_percent: '0',
                total: '3000',
            });
            const sold = (
                await json<{ data: Sold }>(
                    await sell(
                        { lines, ktp_patient: false },
                        { received: '3300' },
                    ),
                    201,
                )
            ).data;
            const [stored] = await pool.unsafe<Record<string, unknown>[]>(
                `select b.kelompok_harga_id, b.pasien_ktp, trim_scale(d.harga_satuan)::text as harga_satuan,
                    trim_scale(k.nilai)::text as dibayar
             from bill_farmasi b
             join bill_farmasi_detail d on d.bill_farmasi_id = b.id
             join kasir k on k.sumber_dokumen_id = b.id
             where b.id = $1`,
                [sold.id],
            );
            expect(stored).toEqual({
                kelompok_harga_id: umum.id,
                pasien_ktp: false,
                harga_satuan: '1100',
                dibayar: '3300',
            });
        });

        test('a location not set up for OTC sale is refused', async () => {
            const item = await drug('OTC-LOK', []);
            const lines = [
                { item_id: item.id, unit_id: pharmacy.uom.id, quantity: 1 },
            ];
            const before = await written();
            expect(
                Object.keys(
                    await refused(
                        await pharmacy.admin.post(`${sales}/quote`, {
                            location_id: warehouse.id,
                            lines,
                        }),
                    ),
                ),
            ).toEqual(['location_id']);
            expect(
                Object.keys(
                    await refused(
                        await pharmacy.admin.post(sales, {
                            location_id: warehouse.id,
                            lines,
                            expected_total: '1000',
                            payment: { received: '1000' },
                        }),
                    ),
                ),
            ).toEqual(['location_id']);
            expect(await written()).toEqual(before);
        });

        test('a total that changed since the quote is refused with stale_total, and nothing is written', async () => {
            const item = await drug('OTC-BASI', [
                { batch: 'B1', expiry: '2028-01-31', quantity: 50 },
            ]);
            const before = await written();
            const response = await pharmacy.admin.post(sales, {
                location_id: counter.id,
                lines: [
                    { item_id: item.id, unit_id: pharmacy.uom.id, quantity: 1 },
                ],
                expected_total: '1000',
                payment: { received: '5000' },
            });
            expect(response.status).toBe(409);
            expect(
                ((await response.json()) as { error: { code: string } }).error
                    .code,
            ).toBe('stale_total');
            expect(await written()).toEqual(before);
        });

        test('a sale beyond the stock at the location is refused on the drug line, and nothing is written', async () => {
            const item = await drug('OTC-HABIS', [
                { batch: 'H1', expiry: '2028-01-31', quantity: 4 },
            ]);
            const before = await written();
            const errors = await refused(
                await sell(
                    {
                        lines: [
                            {
                                item_id: item.id,
                                unit_id: pharmacy.uom.id,
                                quantity: 5,
                            },
                        ],
                    },
                    { received: '10000' },
                ),
            );
            expect(Object.keys(errors)).toEqual(['lines.0.quantity']);
            expect(await written()).toEqual(before);
        });

        test('payment refusals sit under payment, apart from the drug lines, and nothing is written', async () => {
            const item = await drug('OTC-KURANG', [
                { batch: 'U1', expiry: '2028-01-31', quantity: 50 },
            ]);
            const lines = [
                { item_id: item.id, unit_id: pharmacy.uom.id, quantity: 2 },
            ];
            const before = await written();
            expect(
                await refused(await sell({ lines }, { received: '1000' })),
            ).toEqual({ _form: [remainderMessage] });
            expect(
                Object.keys(
                    await refused(
                        await sell(
                            { lines },
                            {
                                lines: [
                                    {
                                        payment_method_id: Bun.randomUUIDv7(),
                                        amount: '2280',
                                    },
                                ],
                            },
                        ),
                    ),
                ),
            ).toEqual(['payment.lines.0.payment_method_id']);
            expect(await written()).toEqual(before);
        });

        test('a counter user who has not done Clerk Start gets the clerk message', async () => {
            const item = await drug('OTC-CLERK', [
                { batch: 'C1', expiry: '2028-01-31', quantity: 50 },
            ]);
            const clerkless = await member([
                'pharmacy.otc-sale.operate',
                'core.payment.operate',
            ]);
            const before = await written();
            expect(
                await refused(
                    await sell(
                        {
                            lines: [
                                {
                                    item_id: item.id,
                                    unit_id: pharmacy.uom.id,
                                    quantity: 1,
                                },
                            ],
                        },
                        { received: '2000' },
                        clerkless,
                    ),
                ),
            ).toEqual({ _form: [clerkNotStartedMessage] });
            expect(await written()).toEqual(before);
        });

        test('a counter user without the cashier duty cannot take money', async () => {
            const item = await drug('OTC-IZIN', [
                { batch: 'Z1', expiry: '2028-01-31', quantity: 50 },
            ]);
            const seller = await member(['pharmacy.otc-sale.operate']);
            const before = await written();
            const response = await sell(
                {
                    lines: [
                        {
                            item_id: item.id,
                            unit_id: pharmacy.uom.id,
                            quantity: 1,
                        },
                    ],
                },
                { received: '2000' },
                seller,
            );
            expect(response.status).toBe(403);
            expect(await written()).toEqual(before);
        });

        test('lines are checked field by field before anything is priced', async () => {
            const item = await drug('OTC-ISIAN', []);
            expect(
                await refused(
                    await pharmacy.admin.post(`${sales}/quote`, {
                        location_id: counter.id,
                        price_group_id: Bun.randomUUIDv7(),
                        lines: [
                            {
                                item_id: Bun.randomUUIDv7(),
                                unit_id: strip.id,
                                quantity: 1,
                            },
                            {
                                item_id: item.id,
                                unit_id: Bun.randomUUIDv7(),
                                quantity: 1,
                            },
                            {
                                item_id: item.id,
                                unit_id: strip.id,
                                quantity: 0,
                            },
                            {
                                item_id: item.id,
                                unit_id: pharmacy.uom.id,
                                quantity: '0.00001',
                            },
                        ],
                    }),
                ),
            ).toMatchObject({
                price_group_id: ['Pilih kelompok harga dari daftar.'],
                'lines.0.item_id': ['Pilih obat dari daftar.'],
                'lines.1.unit_id': ['Pilih satuan obat ini dari daftar.'],
                'lines.2.quantity': [expect.any(String)],
                'lines.3.quantity': [expect.any(String)],
            });
        });

        test('the counter options carry the sale locations and the cashier tender choices', async () => {
            const options = (
                await json<{
                    data: {
                        locations: (Reference & {
                            price_group: Reference | null;
                        })[];
                        payment_methods: {
                            id: string;
                            behavior: string;
                            takes_remainder: boolean;
                            currency_code: string | null;
                            rate: string | null;
                        }[];
                        merchants: Reference[];
                        can_pay: boolean;
                        amount_decimals: number;
                        local_currency: string;
                        date: string;
                        can_search_buyers: boolean;
                    };
                }>(await pharmacy.admin.get(`${sales}/options`), 200)
            ).data;
            expect(options.locations).toEqual([
                {
                    id: counter.id,
                    code: counter.code,
                    name: counter.name,
                    price_group: {
                        id: umum.id,
                        code: umum.code,
                        name: umum.name,
                    },
                },
            ]);
            expect(
                options.payment_methods.map((method) => ({
                    id: method.id,
                    behavior: method.behavior,
                    currency_code: method.currency_code,
                    rate: method.rate,
                })),
            ).toEqual([
                {
                    id: methods.BON ?? '',
                    behavior: 'piutang',
                    currency_code: null,
                    rate: null,
                },
                {
                    id: methods.TUN ?? '',
                    behavior: 'tunai',
                    currency_code: null,
                    rate: null,
                },
            ]);
            expect(options).toMatchObject({
                merchants: [],
                can_pay: true,
                amount_decimals: expect.any(Number),
                local_currency: expect.any(String),
                date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            });
            const seller = await member(['pharmacy.otc-sale.operate']);
            expect(
                (
                    await json<{
                        data: { can_pay: boolean; can_search_buyers: boolean };
                    }>(await seller.get(`${sales}/options`), 200)
                ).data,
            ).toMatchObject({ can_pay: false, can_search_buyers: false });
        });

        test('the drug search finds items with their units, the sales unit, and the stock at a sale location only', async () => {
            const item = await drug('OTC-CARI', [
                { batch: 'S1', expiry: '2027-03-31', quantity: 12 },
                { batch: 'S2', expiry: '2028-03-31', quantity: 30 },
            ]);
            type Found = Reference & {
                sales_unit_id: string;
                units: (Reference & { quantity_per_unit: string })[];
                stock: string | null;
            };
            const search = async (locationId: string) =>
                (
                    await json<{ data: Found[] }>(
                        await pharmacy.admin.get(
                            `${sales}/items?q=OTC-CARI&location_id=${locationId}`,
                        ),
                        200,
                    )
                ).data;
            const [found] = await search(counter.id);
            expect(found).toMatchObject({
                id: item.id,
                code: 'OTC-CARI',
                sales_unit_id: pharmacy.uom.id,
                stock: '42',
            });
            expect(
                found?.units.map((unit) => [
                    unit.id,
                    Number(unit.quantity_per_unit),
                ]),
            ).toEqual([
                [pharmacy.uom.id, 1],
                [strip.id, 10],
            ]);
            expect((await search(warehouse.id))[0]?.stock).toBeNull();
        });

        test('a counter user reads drugs and batches without prescription access; others are refused', async () => {
            const item = await drug('OTC-BATCH', [
                { batch: 'B1', expiry: '2027-05-31', quantity: 5 },
            ]);
            const seller = await member(['pharmacy.otc-sale.operate']);
            expect(
                (
                    await json<{ data: Reference[] }>(
                        await seller.get(
                            `${api}/lookups/batches?item_id=${item.id}&location_id=${counter.id}`,
                        ),
                        200,
                    )
                ).data.map((batch) => batch.code),
            ).toEqual(['B1']);
            expect(
                (await seller.get(`${sales}/items?q=OTC-BATCH`)).status,
            ).toBe(200);
            const outsider = await member(['core.payment.operate']);
            expect((await outsider.get(`${sales}/items`)).status).toBe(403);
            expect(
                (
                    await outsider.get(
                        `${api}/lookups/batches?item_id=${item.id}&location_id=${counter.id}`,
                    )
                ).status,
            ).toBe(403);
        });
    },
);
