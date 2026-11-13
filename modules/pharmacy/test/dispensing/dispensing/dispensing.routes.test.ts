import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
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

type Dispensing = {
    prescription: { id: string; location: { id: string } | null };
    dispensing: {
        id: string;
        number: string;
        status: string;
        location: { id: string } | null;
        pharmacist: { id: string; name: string } | null;
        assistant: { id: string; name: string } | null;
        handed_over_by: { name: string } | null;
        called_at: string | null;
        handed_over_at: string | null;
        version: number;
    } | null;
    lines: {
        prescription_line_id: string;
        quantity: string;
        unit: { id: string; code: string };
        quantity_per_unit: string;
        units: { code: string; quantity_per_unit: string }[];
        reason: string | null;
        batch: { id: string } | null;
        taken: {
            batch_number: string | null;
            expiry_date: string | null;
            quantity: string;
        }[];
    }[];
    cancelled: { number: string }[];
    stock: { item_id: string; quantity: string }[];
};
type Reference = { id: string; code: string; name: string };

// Penyerahan obat: Siapkan memposting stok keluar di lokasi yang melayani resep (FEFO atau batch pilihan), jumlah boleh
// kurang dengan alasan, stok kurang ditolak, Siapkan serentak memposting sekali, Batal siapkan mengembalikan stok, lalu
// Panggil dan Serahkan mencatat waktu dan orangnya. Stok diperiksa lewat SQL atas gd_tr_kartu_gudang, bukan lewat API
// yang sedang diuji. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('dispensing', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let farmasi: Reference;
    let drug: Reference;
    let reasonId: string;
    let tracked: Reference;

    const path = (prescriptionId: string, action = '') =>
        `${api}/prescriptions/${prescriptionId}/dispensing${action}`;

    // Stok per nomor batch di satu lokasi, langsung dari kartu gudang.
    async function stock(itemId: string, locationId: string) {
        const rows = await pool.unsafe<
            { batch: string | null; stock: string }[]
        >(
            `select t.no_batch as batch, trim_scale(sum(k.sisa))::text as stock
             from gd_tr_kartu_gudang k
             left join gd_m_batch t on t.id = k.batch_id
             where k.tenant_id = $1 and k.barang_id = $2 and k.lokasi_id = $3
             group by t.no_batch having sum(k.sisa) <> 0 order by t.no_batch nulls first`,
            [pharmacy.tenantId, itemId, locationId],
        );
        return Object.fromEntries(
            rows.map((row) => [row.batch ?? '-', Number(row.stock)]),
        );
    }

    // Baris kartu gudang yang ditulis satu penyerahan: jenis, batch, jumlah.
    async function entries(billId: string) {
        return [
            ...(await pool.unsafe<
                {
                    kind: string;
                    batch: string | null;
                    quantity: string;
                    reversal: boolean;
                }[]
            >(
                `select k.jenis as kind, t.no_batch as batch, trim_scale(k.jumlah)::text as quantity,
                        k.dibalik_dari is not null as reversal
                 from gd_tr_kartu_gudang k left join gd_m_batch t on t.id = k.batch_id
                 where k.tenant_id = $1 and k.sumber_jenis = 'bill_farmasi' and k.sumber_id = $2
                 order by k.created_at, k.id`,
                [pharmacy.tenantId, billId],
            )),
        ];
    }

    async function receive(
        locationId: string,
        lines: {
            item: Reference;
            batch: string;
            expiry: string;
            quantity: number;
        }[],
    ) {
        const draft = (
            await json<{ data: { id: string; version: number } }>(
                await pharmacy.admin.post(`${inventoryApi}/adjustments`, {
                    direction: 'masuk',
                    location_id: locationId,
                    posting_date: '2026-11-01',
                    reason_id: reasonId,
                    lines: lines.map((line) => ({
                        item_id: line.item.id,
                        quantity: line.quantity,
                        unit_cost: 1000,
                        batch_number: line.batch,
                        expiry_date: line.expiry,
                    })),
                }),
                201,
            )
        ).data;
        await json(
            await pharmacy.admin.post(
                `${inventoryApi}/adjustments/${draft.id}/post`,
                { version: draft.version },
            ),
            200,
        );
    }

    async function queuedId(prescriptionId: string) {
        const [row] = await pharmacy.queued(prescriptionId);
        if (!row) throw new Error('Resep tidak masuk antrean.');
        return row.id;
    }

    async function prescribe(item: Reference, quantity: string) {
        const { prescriptionId } = await pharmacy.issue([{ item, quantity }]);
        return queuedId(prescriptionId);
    }

    const shown = async (id: string) =>
        (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.get(path(id)),
                200,
            )
        ).data;

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Serah', {
            duties: [...pharmacyDuties, 'pharmacy.dispensing.manage'],
        });
        farmasi = await pharmacy.location('FARMASI');
        await json(
            await pharmacy.admin.post(`${api}/service-locations`, {
                operating_unit_id: pharmacy.unitId,
                section_id: null,
                location_id: farmasi.id,
            }),
            201,
        );
        const reasons = (
            await json<{ data: Reference[] }>(
                await pharmacy.admin.get(`${inventoryApi}/reason-codes`),
                200,
            )
        ).data;
        reasonId =
            reasons.find((reason) => reason.code === 'SALDO-AWAL')?.id ?? '';
        tracked = await pharmacy.created(
            `${inventoryApi}/item-tracking-codes`,
            {
                code: 'OBAT',
                name: 'Obat berbatch',
                batch_required: true,
                expiry_required: true,
            },
        );
        drug = await pharmacy.item('AMX-500', { tracking_code_id: tracked.id });
    });

    test('Siapkan takes the earliest expiry first at the mapped location, and the card shows the batches taken', async () => {
        const item = await pharmacy.item('FEFO-1', {
            tracking_code_id: tracked.id,
        });
        await receive(farmasi.id, [
            { item, batch: 'LAMBAT', expiry: '2027-12-31', quantity: 10 },
            { item, batch: 'CEPAT', expiry: '2027-01-31', quantity: 5 },
        ]);
        const id = await prescribe(item, '8');
        const before = await shown(id);
        expect(before.dispensing).toBeNull();
        expect(before.stock).toEqual([{ item_id: item.id, quantity: '15' }]);
        const prepared = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(path(id, '/prepare')),
                200,
            )
        ).data;
        expect(prepared.dispensing?.status).toBe('disiapkan');
        expect(prepared.dispensing?.location?.id).toBe(farmasi.id);
        expect(prepared.dispensing?.assistant?.id).toBe(pharmacy.member.userId);
        expect(await stock(item.id, farmasi.id)).toEqual({ LAMBAT: 7 });
        expect(await entries(prepared.dispensing?.id ?? '')).toEqual([
            {
                kind: 'penyerahan',
                batch: 'CEPAT',
                quantity: '-5',
                reversal: false,
            },
            {
                kind: 'penyerahan',
                batch: 'LAMBAT',
                quantity: '-3',
                reversal: false,
            },
        ]);
        expect(prepared.lines[0]?.taken).toEqual([
            { batch_number: 'CEPAT', expiry_date: '2027-01-31', quantity: '5' },
            {
                batch_number: 'LAMBAT',
                expiry_date: '2027-12-31',
                quantity: '3',
            },
        ]);
    });

    test('a batch chosen by the pharmacist is taken instead of the earliest expiry, and a manual location requires one', async () => {
        const item = await pharmacy.item('MANUAL-1', {
            tracking_code_id: tracked.id,
        });
        await receive(farmasi.id, [
            { item, batch: 'PILIH', expiry: '2027-12-31', quantity: 10 },
            { item, batch: 'DULU', expiry: '2027-01-31', quantity: 10 },
        ]);
        const [chosen] = await pool.unsafe<{ id: string }[]>(
            "select id from gd_m_batch where barang_id = $1 and no_batch = 'PILIH'",
            [item.id],
        );
        const id = await prescribe(item, '4');
        const draft = await shown(id);
        const lines = draft.lines.map((line) => ({
            prescription_line_id: line.prescription_line_id,
            quantity: line.quantity,
            batch_id: chosen?.id,
            reason: null,
        }));
        const prepared = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(path(id, '/prepare'), { lines }),
                200,
            )
        ).data;
        expect(await entries(prepared.dispensing?.id ?? '')).toEqual([
            {
                kind: 'penyerahan',
                batch: 'PILIH',
                quantity: '-4',
                reversal: false,
            },
        ]);
        const manual = await pharmacy.location('FAR-MANUAL', {
            picking_method: 'manual',
        });
        await receive(manual.id, [
            { item, batch: 'PILIH', expiry: '2027-12-31', quantity: 3 },
        ]);
        const other = await prescribe(item, '1');
        const proposed = await shown(other);
        expect(
            await refused(
                await pharmacy.admin.post(path(other, '/prepare'), {
                    location_id: manual.id,
                    lines: proposed.lines.map((line) => ({
                        prescription_line_id: line.prescription_line_id,
                        quantity: line.quantity,
                    })),
                }),
            ),
        ).toEqual({
            'lines.0.batch_id': [
                'Pilih batch yang diambil. Lokasi ini mengambil stok dari batch yang dipilih.',
            ],
        });
        expect(await stock(item.id, manual.id)).toEqual({ PILIH: 3 });
    });

    test('a smaller quantity needs a reason, zero is allowed, and more than prescribed is refused', async () => {
        await receive(farmasi.id, [
            {
                item: drug,
                batch: 'SEBAGIAN',
                expiry: '2028-06-30',
                quantity: 50,
            },
        ]);
        const second = await pharmacy.item('KOSONG-1', {
            tracking_code_id: tracked.id,
        });
        const { prescriptionId } = await pharmacy.issue([
            { item: drug, quantity: '10' },
            { item: second, quantity: '2' },
        ]);
        const id = await queuedId(prescriptionId);
        const [first, other] = (await shown(id)).lines;
        const body = (
            quantity: string,
            reason: string | null,
            secondQuantity = '0',
            secondReason: string | null = 'Stok habis',
        ) => ({
            lines: [
                {
                    prescription_line_id: first?.prescription_line_id,
                    quantity,
                    reason,
                },
                {
                    prescription_line_id: other?.prescription_line_id,
                    quantity: secondQuantity,
                    reason: secondReason,
                },
            ],
        });
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.put(path(id), body('3', null)),
                ),
            ),
        ).toEqual(['lines.0.reason']);
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.put(path(id), body('11', null)),
                ),
            ),
        ).toEqual(['lines.0.quantity']);
        const saved = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.put(
                    path(id),
                    body('3', 'Pasien minta 3 dulu'),
                ),
                200,
            )
        ).data;
        expect(saved.dispensing?.status).toBe('draf');
        expect(saved.lines.map((line) => [line.quantity, line.reason])).toEqual(
            [
                ['3', 'Pasien minta 3 dulu'],
                ['0', 'Stok habis'],
            ],
        );
        const before = await stock(drug.id, farmasi.id);
        const prepared = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(path(id, '/prepare'), {
                    version: saved.dispensing?.version,
                }),
                200,
            )
        ).data;
        expect(await entries(prepared.dispensing?.id ?? '')).toEqual([
            {
                kind: 'penyerahan',
                batch: 'SEBAGIAN',
                quantity: '-3',
                reversal: false,
            },
        ]);
        expect((await stock(drug.id, farmasi.id)).SEBAGIAN).toBe(
            (before.SEBAGIAN ?? 0) - 3,
        );
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.put(path(id), body('2', 'x')),
                ),
            ),
        ).toEqual(['_form']);
    });

    test('a prescription in strips is dispensed in strips or tablets, stock leaves in tablets, and more than prescribed is refused in tablets', async () => {
        const item = await pharmacy.item('STRIP-1', {
            tracking_code_id: tracked.id,
        });
        const strip = await pharmacy.created(
            `${inventoryApi}/units-of-measure`,
            { code: 'STRIP', name: 'Strip' },
        );
        const box = await pharmacy.created(`${inventoryApi}/units-of-measure`, {
            code: 'BOX',
            name: 'Kotak',
        });
        await pharmacy.created(`${inventoryApi}/item-units`, {
            item_id: item.id,
            unit_id: strip.id,
            quantity_per_unit: 10,
        });
        await receive(farmasi.id, [
            { item, batch: 'STRIP', expiry: '2027-09-30', quantity: 60 },
        ]);
        const inStrips = async () => {
            const { prescriptionId } = await pharmacy.issue([
                {
                    item,
                    quantity: '2',
                    unit: strip,
                    quantity_per_unit: '10',
                },
            ]);
            return queuedId(prescriptionId);
        };
        const stored = async (billId: string) =>
            pool.unsafe<{ jumlah: string; satuan: string; konversi: string }[]>(
                `select trim_scale(d.jumlah)::text as jumlah, s.kode as satuan,
                        trim_scale(d.konversi)::text as konversi
                 from bill_farmasi_detail d join gd_m_satuan s on s.id = d.satuan_id
                 where d.bill_farmasi_id = $1`,
                [billId],
            );

        const asWritten = await inStrips();
        const proposed = await shown(asWritten);
        expect(proposed.lines[0]).toMatchObject({
            quantity: '2',
            unit: { id: strip.id, code: 'STRIP' },
            quantity_per_unit: '10',
            units: [
                { code: 'TAB', quantity_per_unit: '1' },
                { code: 'STRIP', quantity_per_unit: '10' },
            ],
        });
        const prepared = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(path(asWritten, '/prepare')),
                200,
            )
        ).data;
        expect(await entries(prepared.dispensing?.id ?? '')).toEqual([
            {
                kind: 'penyerahan',
                batch: 'STRIP',
                quantity: '-20',
                reversal: false,
            },
        ]);
        expect([...(await stored(prepared.dispensing?.id ?? ''))]).toEqual([
            { jumlah: '2', satuan: 'STRIP', konversi: '10' },
        ]);

        const inTablets = await inStrips();
        const [line] = (await shown(inTablets)).lines;
        const body = (quantity: string, unitId: string) => ({
            lines: [
                {
                    prescription_line_id: line?.prescription_line_id,
                    quantity,
                    unit_id: unitId,
                },
            ],
        });
        expect(
            await refused(
                await pharmacy.admin.put(
                    path(inTablets),
                    body('21', pharmacy.uom.id),
                ),
            ),
        ).toEqual({
            'lines.0.quantity': [
                'Jumlah yang diserahkan paling banyak 2 STRIP, sesuai resep.',
            ],
        });
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.put(
                        path(inTablets),
                        body('1', box.id),
                    ),
                ),
            ),
        ).toEqual(['lines.0.unit_id']);
        const tablets = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(
                    path(inTablets, '/prepare'),
                    body('20', pharmacy.uom.id),
                ),
                200,
            )
        ).data;
        expect(await entries(tablets.dispensing?.id ?? '')).toEqual([
            {
                kind: 'penyerahan',
                batch: 'STRIP',
                quantity: '-20',
                reversal: false,
            },
        ]);
        expect([...(await stored(tablets.dispensing?.id ?? ''))]).toEqual([
            { jumlah: '20', satuan: 'TAB', konversi: '1' },
        ]);
        expect(await stock(item.id, farmasi.id)).toEqual({ STRIP: 20 });
    });

    test('more than the location holds is refused, and nothing is kept', async () => {
        const item = await pharmacy.item('HABIS-1', {
            tracking_code_id: tracked.id,
        });
        await receive(farmasi.id, [
            { item, batch: 'SEDIKIT', expiry: '2027-06-30', quantity: 2 },
        ]);
        const id = await prescribe(item, '5');
        const errors = await refused(
            await pharmacy.admin.post(path(id, '/prepare')),
        );
        expect(Object.keys(errors)).toEqual(['lines.0.quantity']);
        expect(await stock(item.id, farmasi.id)).toEqual({ SEDIKIT: 2 });
        const [kept] = await pool.unsafe<{ total: number }[]>(
            'select count(*)::int as total from bill_farmasi where resep_id = $1',
            [id],
        );
        expect(kept?.total).toBe(0);
    });

    test('Siapkan pressed at the same time by several people posts once', async () => {
        const item = await pharmacy.item('SERENTAK-1', {
            tracking_code_id: tracked.id,
        });
        await receive(farmasi.id, [
            { item, batch: 'SATU', expiry: '2027-03-31', quantity: 20 },
        ]);
        const id = await prescribe(item, '6');
        const sessions = await Promise.all(
            Array.from({ length: 4 }, async () => {
                const session = browser();
                await session.login(
                    pharmacy.member.email,
                    pharmacy.member.password,
                );
                return session;
            }),
        );
        const answers = await Promise.all(
            sessions.map((session) => session.post(path(id, '/prepare'))),
        );
        expect(answers.map((answer) => answer.status)).toEqual([
            200, 200, 200, 200,
        ]);
        const [bill] = await pool.unsafe<{ id: string }[]>(
            'select id from bill_farmasi where resep_id = $1',
            [id],
        );
        expect(await entries(bill?.id ?? '')).toEqual([
            {
                kind: 'penyerahan',
                batch: 'SATU',
                quantity: '-6',
                reversal: false,
            },
        ]);
        expect(await stock(item.id, farmasi.id)).toEqual({ SATU: 14 });
    });

    test('Batal siapkan returns the stock, and the prescription is prepared again with a new document', async () => {
        const item = await pharmacy.item('BATAL-1', {
            tracking_code_id: tracked.id,
        });
        await receive(farmasi.id, [
            { item, batch: 'BALIK', expiry: '2027-08-31', quantity: 9 },
        ]);
        const id = await prescribe(item, '4');
        const first = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(path(id, '/prepare')),
                200,
            )
        ).data;
        expect(await stock(item.id, farmasi.id)).toEqual({ BALIK: 5 });
        const cancelled = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(path(id, '/cancel-preparation'), {
                    version: first.dispensing?.version,
                }),
                200,
            )
        ).data;
        expect(cancelled.dispensing).toBeNull();
        expect(cancelled.cancelled.map((row) => row.number)).toEqual([
            first.dispensing?.number ?? '',
        ]);
        expect(await stock(item.id, farmasi.id)).toEqual({ BALIK: 9 });
        expect(await entries(first.dispensing?.id ?? '')).toEqual([
            {
                kind: 'penyerahan',
                batch: 'BALIK',
                quantity: '-4',
                reversal: false,
            },
            {
                kind: 'penyerahan',
                batch: 'BALIK',
                quantity: '4',
                reversal: true,
            },
        ]);
        const again = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(path(id, '/prepare')),
                200,
            )
        ).data;
        expect(again.dispensing?.number).not.toBe(first.dispensing?.number);
        expect(await stock(item.id, farmasi.id)).toEqual({ BALIK: 5 });
    });

    test('Panggil and Serahkan record when and who; nothing changes after handover', async () => {
        const item = await pharmacy.item('SERAH-1', {
            tracking_code_id: tracked.id,
        });
        await receive(farmasi.id, [
            { item, batch: 'SERAH', expiry: '2027-08-31', quantity: 9 },
        ]);
        const id = await prescribe(item, '2');
        const prepared = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(path(id, '/prepare')),
                200,
            )
        ).data;
        const called = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(path(id, '/call')),
                200,
            )
        ).data;
        expect(called.dispensing?.status).toBe('dipanggil');
        expect(called.dispensing?.called_at).not.toBeNull();
        expect(
            (
                await pharmacy.admin.post(path(id, '/hand-over'), {
                    version: prepared.dispensing?.version,
                })
            ).status,
        ).toBe(409);
        const handed = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(path(id, '/hand-over'), {
                    version: called.dispensing?.version,
                }),
                200,
            )
        ).data;
        expect(handed.dispensing?.status).toBe('diserahkan');
        expect(handed.dispensing?.handed_over_at).not.toBeNull();
        expect(handed.dispensing?.pharmacist?.id).toBe(pharmacy.member.userId);
        expect(handed.dispensing?.handed_over_by?.name).toBe('Anggota uji');
        expect(
            (
                await pharmacy.admin.post(path(id, '/hand-over'), {
                    version: handed.dispensing?.version,
                })
            ).status,
        ).toBe(200);
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(path(id, '/cancel-preparation'), {
                        version: handed.dispensing?.version,
                    }),
                ),
            ),
        ).toEqual(['_form']);
        expect(await stock(item.id, farmasi.id)).toEqual({ SERAH: 7 });
    });

    test('a prescription without a pharmacy location is refused with the unit to set up, and preparing from a chosen location works', async () => {
        const unit = await pharmacy.operatingUnit('Pustu Tanpa Setelan');
        const item = await pharmacy.item('TANPA-1', {
            tracking_code_id: tracked.id,
        });
        await receive(farmasi.id, [
            { item, batch: 'PUSTU', expiry: '2027-08-31', quantity: 3 },
        ]);
        const { prescriptionId } = await pharmacy.issue(
            [{ item, quantity: '1' }],
            {
                unitId: unit,
            },
        );
        const id = await queuedId(prescriptionId);
        expect(
            await refused(await pharmacy.admin.post(path(id, '/prepare'))),
        ).toEqual({
            location_id: [
                'Belum ada lokasi farmasi untuk resep ini. Pilih lokasi farmasi di resep, atau atur Lokasi layanan resep untuk Pustu Tanpa Setelan.',
            ],
        });
        const proposed = await shown(id);
        const prepared = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(path(id, '/prepare'), {
                    location_id: farmasi.id,
                    lines: proposed.lines.map((line) => ({
                        prescription_line_id: line.prescription_line_id,
                        quantity: line.quantity,
                    })),
                }),
                200,
            )
        ).data;
        expect(prepared.dispensing?.location?.id).toBe(farmasi.id);
        expect(await stock(item.id, farmasi.id)).toEqual({ PUSTU: 2 });
    });

    test('malformed references are refused field by field; other legal entities and unknown prescriptions are 404', async () => {
        const id = await prescribe(drug, '1');
        const [line] = (await shown(id)).lines;
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.put(path(id), {
                        location_id: 'bukan-uuid',
                        pharmacist_id: 'x',
                        assistant_id: Bun.randomUUIDv7(),
                        lines: [
                            {
                                prescription_line_id:
                                    line?.prescription_line_id,
                                quantity: 'satu',
                                batch_id: 'y',
                            },
                        ],
                    }),
                ),
            ).sort(),
        ).toEqual([
            'assistant_id',
            'lines.0.batch_id',
            'lines.0.quantity',
            'location_id',
            'pharmacist_id',
        ]);
        const other = await createPharmacy(
            pool,
            browser,
            'Farmasi Uji Serah Lain',
        );
        const foreignItem = await other.item('LAIN');
        const { prescriptionId } = await other.issue([
            { item: foreignItem, quantity: '1' },
        ]);
        const [foreign] = await other.queued(prescriptionId);
        for (const target of [
            foreign?.id ?? '',
            Bun.randomUUIDv7(),
            'bukan-uuid',
        ]) {
            expect((await pharmacy.admin.get(path(target))).status).toBe(404);
            expect(
                (await pharmacy.admin.post(path(target, '/prepare'))).status,
            ).toBe(404);
        }
    });

    test('an assistant prepares and calls but cannot hand over or cancel; viewers cannot prepare', async () => {
        const id = await prescribe(drug, '1');
        const as = async (duty: string) => {
            const account = await createMember(pool, pharmacy.tenantId, [duty]);
            await grantAllOrganizations(
                pool,
                pharmacy.tenantId,
                account.membershipId,
            );
            const session = browser();
            await session.login(account.email, account.password);
            return session;
        };
        const viewer = await as('pharmacy.dispensing.inquire');
        expect((await viewer.get(path(id))).status).toBe(200);
        expect((await viewer.post(path(id, '/prepare'))).status).toBe(403);
        const assistant = await as('pharmacy.dispensing.prepare');
        const prepared = (
            await json<{ data: Dispensing }>(
                await assistant.post(path(id, '/prepare')),
                200,
            )
        ).data;
        expect((await assistant.post(path(id, '/call'))).status).toBe(200);
        expect(
            (
                await assistant.post(path(id, '/hand-over'), {
                    version: prepared.dispensing?.version,
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await assistant.post(path(id, '/cancel-preparation'), {
                    version: prepared.dispensing?.version,
                })
            ).status,
        ).toBe(403);
    });

    test('the queue counts and filters prescriptions by where they are in the flow', async () => {
        const location = await pharmacy.location('FAR-HITUNG');
        const item = await pharmacy.item('HITUNG-1', {
            tracking_code_id: tracked.id,
        });
        await receive(location.id, [
            { item, batch: 'H', expiry: '2027-08-31', quantity: 10 },
        ]);
        const ids = await Promise.all(
            [1, 2, 3].map(() => prescribe(item, '1')),
        );
        for (const id of ids) {
            const proposed = await shown(id);
            await json(
                await pharmacy.admin.put(path(id), {
                    location_id: location.id,
                    lines: proposed.lines.map((line) => ({
                        prescription_line_id: line.prescription_line_id,
                        quantity: line.quantity,
                    })),
                }),
                200,
            );
        }
        const saved = await shown(ids[1] ?? '');
        await json(
            await pharmacy.admin.post(path(ids[1] ?? '', '/prepare'), {
                version: saved.dispensing?.version,
            }),
            200,
        );
        const queue = await json<{
            data: { id: string; queue_status: string }[];
            counts: { status: string; total: number }[];
        }>(
            await pharmacy.admin.get(
                `${api}/prescriptions?location=${location.id}`,
            ),
            200,
        );
        expect(queue.counts).toEqual([
            { status: 'menunggu', total: 2 },
            { status: 'disiapkan', total: 1 },
            { status: 'dipanggil', total: 0 },
            { status: 'diserahkan', total: 0 },
        ]);
        const prepared = await json<{ data: { id: string }[] }>(
            await pharmacy.admin.get(
                `${api}/prescriptions?location=${location.id}&status=disiapkan`,
            ),
            200,
        );
        expect(prepared.data.map((row) => row.id)).toEqual([ids[1] ?? '']);
    });
});
