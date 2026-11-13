import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../../../test/support/tenant-fixtures.ts';
import {
    eventContract,
    outboxEnvelopes,
} from '../../../../../test/support/event-contracts.ts';
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
type Returns = {
    returnable: {
        dispensing_line_id: string;
        batch: { id: string; batch_number: string } | null;
        dispensed: string;
        returned: string;
    }[];
    returns: { id: string; number: string; status: string; version: number }[];
};

const dispensed = 'pharmacy.prescription.dispensed.v1';

// Serahkan menerbitkan pharmacy.prescription.dispensed.v1 sekali, sesuai kontraknya; retur mengembalikan stok ke
// lokasi asal dengan batch, harga satuan, dan sumber dana yang sama dengan saat keluar, tidak pernah melebihi yang
// diserahkan, dan bisa dibatalkan selama stoknya belum terpakai. Stok diperiksa lewat SQL atas gd_tr_kartu_gudang.
// Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('handover event and returns', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let farmasi: Reference;
    let item: Reference;
    let apbd: Reference;
    let blud: Reference;

    const dispensing = (id: string, action = '') =>
        `${api}/prescriptions/${id}/dispensing${action}`;
    const returnsPath = (id: string, suffix = '') =>
        `${api}/prescriptions/${id}/returns${suffix}`;

    // Penerimaan dari vendor: dua batch dengan harga dan sumber dana berbeda.
    async function receive(
        lines: {
            batch: string;
            expiry: string;
            quantity: number;
            cost: number;
            funding: Reference;
        }[],
    ) {
        const vendor = await pharmacy.created('/api/v1/purchasing/vendors', {
            name: `PBF ${Bun.randomUUIDv7().slice(-6)}`,
            tax_number: '01.234.567.8-901.000',
        });
        const draft = (
            await json<{ data: { id: string; version: number } }>(
                await pharmacy.admin.post('/api/v1/purchasing/receipts', {
                    vendor_id: vendor.id,
                    location_id: farmasi.id,
                    posting_date: '2026-11-01',
                    lines: lines.map((line) => ({
                        item_id: item.id,
                        unit_id: pharmacy.uom.id,
                        quantity: line.quantity,
                        unit_cost: line.cost,
                        batch_number: line.batch,
                        expiry_date: line.expiry,
                        funding_source_id: line.funding.id,
                        budget_year: 2026,
                    })),
                }),
                201,
            )
        ).data;
        await json(
            await pharmacy.admin.post(
                `/api/v1/purchasing/receipts/${draft.id}/post`,
                { version: draft.version },
            ),
            200,
        );
    }

    async function handedOver(quantity: string) {
        const { prescriptionId, data } = await pharmacy.issue([
            { item, quantity },
        ]);
        const [row] = await pharmacy.queued(prescriptionId);
        const id = row?.id ?? '';
        const prepared = await json<{
            data: { dispensing: { version: number } | null };
        }>(await pharmacy.admin.post(dispensing(id, '/prepare')), 200);
        await json(
            await pharmacy.admin.post(dispensing(id, '/hand-over'), {
                version: prepared.data.dispensing?.version,
            }),
            200,
        );
        return { id, prescriptionId, data };
    }

    // Baris kartu gudang retur: batch, jumlah, harga satuan, dan sumber dana, langsung dari tabel.
    async function returnEntries(returnId: string) {
        return [
            ...(await pool.unsafe<
                {
                    kind: string;
                    batch: string | null;
                    quantity: string;
                    unit_cost: string | null;
                    funding: string | null;
                    location: string;
                }[]
            >(
                `select k.jenis as kind, t.no_batch as batch, trim_scale(k.jumlah)::text as quantity,
                        trim_scale(k.harga_satuan)::text as unit_cost, s.kode as funding, k.lokasi_id as location
                 from gd_tr_kartu_gudang k
                 left join gd_m_batch t on t.id = k.batch_id
                 left join gd_m_sumber_dana s on s.id = k.sumber_dana_id
                 where k.tenant_id = $1 and k.sumber_jenis = 'retur_farmasi' and k.sumber_id = $2
                 order by k.created_at, k.id`,
                [pharmacy.tenantId, returnId],
            )),
        ];
    }

    async function stock() {
        const rows = await pool.unsafe<{ batch: string; stock: string }[]>(
            `select t.no_batch as batch, trim_scale(sum(k.sisa))::text as stock
             from gd_tr_kartu_gudang k join gd_m_batch t on t.id = k.batch_id
             where k.tenant_id = $1 and k.barang_id = $2 and k.lokasi_id = $3
             group by t.no_batch order by t.no_batch`,
            [pharmacy.tenantId, item.id, farmasi.id],
        );
        return Object.fromEntries(
            rows.map((row) => [row.batch, Number(row.stock)]),
        );
    }

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Retur', {
            duties: [
                ...pharmacyDuties,
                'core.vendor.manage',
                'core.purchase-receipt.manage',
                'pharmacy.dispensing.manage',
            ],
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
        const tracked = await pharmacy.created(
            `${inventoryApi}/item-tracking-codes`,
            {
                code: 'OBAT',
                name: 'Obat berbatch',
                batch_required: true,
                expiry_required: true,
            },
        );
        item = await pharmacy.item('AMX-500', { tracking_code_id: tracked.id });
        apbd = await pharmacy.created(`${inventoryApi}/funding-sources`, {
            code: 'APBD',
            name: 'APBD',
        });
        blud = await pharmacy.created(`${inventoryApi}/funding-sources`, {
            code: 'BLUD',
            name: 'BLUD',
        });
        await receive([
            {
                batch: 'DULU',
                expiry: '2027-01-31',
                quantity: 4,
                cost: 600,
                funding: apbd,
            },
            {
                batch: 'NANTI',
                expiry: '2027-12-31',
                quantity: 20,
                cost: 650,
                funding: blud,
            },
        ]);
    });

    test('Serahkan publishes pharmacy.prescription.dispensed.v1 once, as its contract says, with the batches taken', async () => {
        const { id, prescriptionId, data } = await handedOver('6');
        const envelopes = (
            await outboxEnvelopes(pool, pharmacy.tenantId, dispensed)
        ).filter((row) => row.data.prescription_id === prescriptionId);
        expect(envelopes.length).toBe(1);
        const [envelope] = envelopes;
        const contract = await eventContract(dispensed);
        contract.parse(envelope);
        expect(envelope?.legal_entity_id).toBe(pharmacy.legalEntityId);
        expect(envelope?.org_unit_id).toBe(pharmacy.unitId);
        expect(envelope?.data).toMatchObject({
            prescription_number: data.prescription_number,
            location: { id: farmasi.id },
            pharmacist: { id: pharmacy.member.userId },
            assistant: { id: pharmacy.member.userId },
            lines: [
                {
                    prescription_line_id: data.lines[0]?.id,
                    item: { id: item.id },
                    prescribed_quantity: '6',
                    quantity: '6',
                    reason: null,
                    batches: [
                        {
                            batch_number: 'DULU',
                            expiry_date: '2027-01-31',
                            quantity: '4',
                        },
                        {
                            batch_number: 'NANTI',
                            expiry_date: '2027-12-31',
                            quantity: '2',
                        },
                    ],
                },
            ],
        });
        const current = (
            await json<{ data: { dispensing: { version: number } | null } }>(
                await pharmacy.admin.get(dispensing(id)),
                200,
            )
        ).data.dispensing;
        await json(
            await pharmacy.admin.post(dispensing(id, '/hand-over'), {
                version: current?.version,
            }),
            200,
        );
        expect(
            (await outboxEnvelopes(pool, pharmacy.tenantId, dispensed)).filter(
                (row) => row.data.prescription_id === prescriptionId,
            ).length,
        ).toBe(1);
    });

    test('a return puts the stock back with the batch, cost, and funding it left with, and never more than was handed over', async () => {
        const { id } = await handedOver('6');
        const before = await stock();
        const shown = (
            await json<{ data: Returns }>(
                await pharmacy.admin.get(returnsPath(id)),
                200,
            )
        ).data;
        expect(
            shown.returnable.map((row) => [
                row.batch?.batch_number,
                row.dispensed,
                row.returned,
            ]),
        ).toEqual([['NANTI', '6', '0']]);
        const [line] = shown.returnable;
        const body = (quantity: string) => ({
            reason: 'Pasien alergi',
            lines: [
                {
                    dispensing_line_id: line?.dispensing_line_id,
                    batch_id: line?.batch?.id ?? null,
                    quantity,
                },
            ],
        });
        expect(
            await refused(
                await pharmacy.admin.post(returnsPath(id), body('7')),
            ),
        ).toEqual({
            'lines.0.quantity': [
                'Paling banyak 6 TAB: yang diserahkan dikurangi yang sudah diretur.',
            ],
        });
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(returnsPath(id), {
                        ...body('1'),
                        reason: ' ',
                    }),
                ),
            ),
        ).toEqual(['reason']);
        const first = (
            await json<{ data: Returns }>(
                await pharmacy.admin.post(returnsPath(id), body('4')),
                200,
            )
        ).data;
        const [posted] = first.returns;
        expect(await returnEntries(posted?.id ?? '')).toEqual([
            {
                kind: 'penyerahan',
                batch: 'NANTI',
                quantity: '4',
                unit_cost: '650',
                funding: 'BLUD',
                location: farmasi.id,
            },
        ]);
        expect((await stock()).NANTI).toBe((before.NANTI ?? 0) + 4);
        expect(
            await refused(
                await pharmacy.admin.post(returnsPath(id), body('3')),
            ),
        ).toEqual({
            'lines.0.quantity': [
                'Paling banyak 2 TAB: yang diserahkan dikurangi yang sudah diretur.',
            ],
        });
        const reversed = (
            await json<{ data: Returns }>(
                await pharmacy.admin.post(
                    returnsPath(id, `/${posted?.id}/reverse`),
                    { version: posted?.version },
                ),
                200,
            )
        ).data;
        expect(reversed.returns[0]?.status).toBe('dibatalkan');
        expect(reversed.returnable[0]?.returned).toBe('0');
        expect((await stock()).NANTI).toBe(before.NANTI);
    });

    test('posting and reversing a return publish their events once, as the contracts say, with the total still returned', async () => {
        const { id, prescriptionId, data } = await handedOver('6');
        const [line] = (
            await json<{ data: Returns }>(
                await pharmacy.admin.get(returnsPath(id)),
                200,
            )
        ).data.returnable;
        const give = async (quantity: string) =>
            (
                await json<{ data: Returns }>(
                    await pharmacy.admin.post(returnsPath(id), {
                        reason: 'Pasien alergi',
                        lines: [
                            {
                                dispensing_line_id: line?.dispensing_line_id,
                                batch_id: line?.batch?.id ?? null,
                                quantity,
                            },
                        ],
                    }),
                    200,
                )
            ).data.returns;
        await give('4');
        const [first, second] = await give('1');
        const published = async (type: string) => {
            const contract = await eventContract(type);
            return (await outboxEnvelopes(pool, pharmacy.tenantId, type))
                .filter((row) => row.data.prescription_id === prescriptionId)
                .map((row) => {
                    contract.parse(row);
                    return row;
                });
        };
        const unit = { id: pharmacy.uom.id, code: pharmacy.uom.code };
        const lineOf = (quantity: string, returned: string) => ({
            prescription_line_id: data.lines[0]?.id,
            item: { id: item.id },
            unit,
            quantity,
            base_unit: unit,
            base_quantity: quantity,
            returned_base_quantity: returned,
            batches: [
                {
                    batch_number: 'NANTI',
                    expiry_date: '2027-12-31',
                    quantity,
                },
            ],
        });
        const posted = await published('pharmacy.return.posted.v1');
        expect(posted.map((row) => row.data)).toMatchObject([
            {
                return_id: first?.id,
                return_number: first?.number,
                reason: 'Pasien alergi',
                prescription_number: data.prescription_number,
                location: { id: farmasi.id },
                lines: [lineOf('4', '4')],
            },
            { return_id: second?.id, lines: [lineOf('1', '5')] },
        ]);
        expect(posted[0]?.org_unit_id).toBe(pharmacy.unitId);
        const reverse = () =>
            pharmacy.admin.post(returnsPath(id, `/${first?.id}/reverse`), {
                version: first?.version,
            });
        await json(await reverse(), 200);
        await json(await reverse(), 200);
        const reversed = await published('pharmacy.return.reversed.v1');
        expect(reversed.map((row) => row.data)).toMatchObject([
            { return_id: first?.id, lines: [lineOf('4', '1')] },
        ]);
        expect(typeof reversed[0]?.data.reversed_at).toBe('string');
    });

    test('a return spanning batches keeps each batch cost and funding', async () => {
        const fresh = await pharmacy.item('PCT-500', {
            tracking_code_id: (
                await pool.unsafe<{ id: string }[]>(
                    'select profil_pelacakan_id as id from gd_m_barang where id = $1',
                    [item.id],
                )
            )[0]?.id,
        });
        const original = item;
        item = fresh;
        try {
            await receive([
                {
                    batch: 'P-A',
                    expiry: '2027-02-28',
                    quantity: 3,
                    cost: 100,
                    funding: apbd,
                },
                {
                    batch: 'P-B',
                    expiry: '2027-09-30',
                    quantity: 10,
                    cost: 120,
                    funding: blud,
                },
            ]);
            const { id } = await handedOver('5');
            const shown = (
                await json<{ data: Returns }>(
                    await pharmacy.admin.get(returnsPath(id)),
                    200,
                )
            ).data;
            const created = (
                await json<{ data: Returns }>(
                    await pharmacy.admin.post(returnsPath(id), {
                        reason: 'Obat tidak jadi dipakai',
                        lines: shown.returnable.map((row) => ({
                            dispensing_line_id: row.dispensing_line_id,
                            batch_id: row.batch?.id ?? null,
                            quantity: row.dispensed,
                        })),
                    }),
                    200,
                )
            ).data;
            expect(
                (await returnEntries(created.returns[0]?.id ?? '')).map(
                    (row) => [
                        row.batch,
                        row.quantity,
                        row.unit_cost,
                        row.funding,
                    ],
                ),
            ).toEqual([
                ['P-A', '3', '100', 'APBD'],
                ['P-B', '2', '120', 'BLUD'],
            ]);
        } finally {
            item = original;
        }
    });

    test('strips prescribed, tablets handed over, and strips returned: events name each unit and stock moves in tablets', async () => {
        const strip = await pharmacy.created(
            `${inventoryApi}/units-of-measure`,
            { code: 'STRIP', name: 'Strip' },
        );
        const fresh = await pharmacy.item('ANT-STRIP', {
            tracking_code_id: (
                await pool.unsafe<{ id: string }[]>(
                    'select profil_pelacakan_id as id from gd_m_barang where id = $1',
                    [item.id],
                )
            )[0]?.id,
        });
        await pharmacy.created(`${inventoryApi}/item-units`, {
            item_id: fresh.id,
            unit_id: strip.id,
            quantity_per_unit: 10,
        });
        const original = item;
        item = fresh;
        try {
            await receive([
                {
                    batch: 'S-A',
                    expiry: '2027-01-31',
                    quantity: 10,
                    cost: 100,
                    funding: apbd,
                },
                {
                    batch: 'S-B',
                    expiry: '2027-12-31',
                    quantity: 30,
                    cost: 110,
                    funding: blud,
                },
            ]);
            const { prescriptionId, data } = await pharmacy.issue([
                {
                    item,
                    quantity: '3',
                    unit: strip,
                    quantity_per_unit: '10',
                },
            ]);
            const [queued] = await pharmacy.queued(prescriptionId);
            const id = queued?.id ?? '';
            const proposed = (
                await json<{
                    data: { lines: { prescription_line_id: string }[] };
                }>(await pharmacy.admin.get(dispensing(id)), 200)
            ).data;
            const prepared = await json<{
                data: { dispensing: { version: number } | null };
            }>(
                await pharmacy.admin.post(dispensing(id, '/prepare'), {
                    lines: proposed.lines.map((line) => ({
                        prescription_line_id: line.prescription_line_id,
                        quantity: '25',
                        unit_id: pharmacy.uom.id,
                        reason: 'Stok strip utuh kurang',
                    })),
                }),
                200,
            );
            await json(
                await pharmacy.admin.post(dispensing(id, '/hand-over'), {
                    version: prepared.data.dispensing?.version,
                }),
                200,
            );
            const tablet = { id: pharmacy.uom.id, code: 'TAB' };
            const [handed] = (
                await outboxEnvelopes(pool, pharmacy.tenantId, dispensed)
            ).filter((row) => row.data.prescription_id === prescriptionId);
            (await eventContract(dispensed)).parse(handed);
            expect(handed?.data.lines).toMatchObject([
                {
                    prescription_line_id: data.lines[0]?.id,
                    unit: tablet,
                    quantity: '25',
                    quantity_per_unit: '1',
                    base_unit: tablet,
                    base_quantity: '25',
                    prescribed_unit: { id: strip.id, code: 'STRIP' },
                    prescribed_quantity: '3',
                    batches: [
                        { batch_number: 'S-A', quantity: '10' },
                        { batch_number: 'S-B', quantity: '15' },
                    ],
                },
            ]);

            const shown = (
                await json<{ data: Returns }>(
                    await pharmacy.admin.get(returnsPath(id)),
                    200,
                )
            ).data;
            const row = (batch: string) =>
                shown.returnable.find(
                    (entry) => entry.batch?.batch_number === batch,
                );
            const give = (
                lines: { batch: string; quantity: string; unit: string }[],
            ) =>
                pharmacy.admin.post(returnsPath(id), {
                    reason: 'Pasien sembuh',
                    lines: lines.map((line) => ({
                        dispensing_line_id: row(line.batch)?.dispensing_line_id,
                        batch_id: row(line.batch)?.batch?.id ?? null,
                        quantity: line.quantity,
                        unit_id: line.unit,
                    })),
                });
            expect(
                await refused(
                    await give([
                        { batch: 'S-B', quantity: '2', unit: strip.id },
                    ]),
                ),
            ).toEqual({
                'lines.0.quantity': [
                    'Paling banyak 15 TAB: yang diserahkan dikurangi yang sudah diretur.',
                ],
            });
            const first = (
                await json<{ data: Returns }>(
                    await give([
                        { batch: 'S-B', quantity: '1', unit: strip.id },
                    ]),
                    200,
                )
            ).data.returns.at(-1);
            expect(await returnEntries(first?.id ?? '')).toMatchObject([
                { batch: 'S-B', quantity: '10', unit_cost: '110' },
            ]);
            const second = (
                await json<{ data: Returns }>(
                    await give([
                        { batch: 'S-A', quantity: '1', unit: strip.id },
                        { batch: 'S-B', quantity: '5', unit: pharmacy.uom.id },
                    ]),
                    200,
                )
            ).data.returns.at(-1);
            expect(
                (await returnEntries(second?.id ?? '')).map((entry) => [
                    entry.batch,
                    entry.quantity,
                ]),
            ).toEqual([
                ['S-A', '10'],
                ['S-B', '5'],
            ]);
            expect(
                await refused(
                    await give([
                        { batch: 'S-A', quantity: '1', unit: pharmacy.uom.id },
                    ]),
                ),
            ).toEqual({
                'lines.0.quantity': [
                    'Obat batch ini sudah diretur seluruhnya.',
                ],
            });
            const stored = await pool.unsafe<
                { jumlah: string; satuan: string; konversi: string }[]
            >(
                `select trim_scale(d.jumlah)::text as jumlah, s.kode as satuan,
                        trim_scale(d.konversi)::text as konversi
                 from retur_farmasi_detail d join gd_m_satuan s on s.id = d.satuan_id
                 where d.retur_farmasi_id = $1 order by d.urutan`,
                [second?.id ?? ''],
            );
            expect([...stored]).toEqual([
                { jumlah: '1', satuan: 'STRIP', konversi: '10' },
                { jumlah: '5', satuan: 'TAB', konversi: '1' },
            ]);
            const contract = await eventContract('pharmacy.return.posted.v1');
            const posted = (
                await outboxEnvelopes(
                    pool,
                    pharmacy.tenantId,
                    'pharmacy.return.posted.v1',
                )
            ).filter(
                (envelope) => envelope.data.prescription_id === prescriptionId,
            );
            for (const envelope of posted) contract.parse(envelope);
            expect(posted.map((envelope) => envelope.data.lines)).toMatchObject(
                [
                    [
                        {
                            unit: { id: strip.id, code: 'STRIP' },
                            quantity: '1',
                            base_unit: tablet,
                            base_quantity: '10',
                            returned_base_quantity: '10',
                            batches: [{ batch_number: 'S-B', quantity: '10' }],
                        },
                    ],
                    [
                        {
                            unit: tablet,
                            quantity: '15',
                            base_unit: tablet,
                            base_quantity: '15',
                            returned_base_quantity: '25',
                            batches: [
                                { batch_number: 'S-A', quantity: '10' },
                                { batch_number: 'S-B', quantity: '5' },
                            ],
                        },
                    ],
                ],
            );
        } finally {
            item = original;
        }
    });

    test('Batal retur is refused once the returned stock has been dispensed again', async () => {
        const { id } = await handedOver('2');
        const shown = (
            await json<{ data: Returns }>(
                await pharmacy.admin.get(returnsPath(id)),
                200,
            )
        ).data;
        const created = (
            await json<{ data: Returns }>(
                await pharmacy.admin.post(returnsPath(id), {
                    reason: 'Salah obat',
                    lines: shown.returnable.map((row) => ({
                        dispensing_line_id: row.dispensing_line_id,
                        batch_id: row.batch?.id ?? null,
                        quantity: row.dispensed,
                    })),
                }),
                200,
            )
        ).data;
        const [posted] = created.returns;
        const [left] = await pool.unsafe<{ stock: string }[]>(
            `select trim_scale(sum(sisa))::text as stock from gd_tr_kartu_gudang
             where tenant_id = $1 and barang_id = $2 and lokasi_id = $3`,
            [pharmacy.tenantId, item.id, farmasi.id],
        );
        await handedOver(left?.stock ?? '0');
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(
                        returnsPath(id, `/${posted?.id}/reverse`),
                        { version: posted?.version },
                    ),
                ),
            ),
        ).toEqual(['_form']);
    });

    test('returns need the pharmacist duty, a handed-over prescription, and the same legal entity', async () => {
        const assistant = await createMember(pool, pharmacy.tenantId, [
            'pharmacy.dispensing.prepare',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            assistant.membershipId,
        );
        const session = browser();
        await session.login(assistant.email, assistant.password);
        await receive([
            {
                batch: 'LAGI',
                expiry: '2028-01-31',
                quantity: 5,
                cost: 700,
                funding: apbd,
            },
        ]);
        const { id } = await handedOver('1');
        expect(
            (
                await session.post(returnsPath(id), {
                    reason: 'Uji',
                    lines: [],
                })
            ).status,
        ).toBe(403);
        const { prescriptionId } = await pharmacy.issue([
            { item, quantity: '1' },
        ]);
        const [waiting] = await pharmacy.queued(prescriptionId);
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.post(returnsPath(waiting?.id ?? ''), {
                        reason: 'Uji',
                        lines: [],
                    }),
                ),
            ),
        ).toEqual(['_form']);
        const other = await createPharmacy(
            pool,
            browser,
            'Farmasi Uji Retur Lain',
        );
        const foreign = await other.item('LAIN');
        const issued = await other.issue([{ item: foreign, quantity: '1' }]);
        const [foreignRow] = await other.queued(issued.prescriptionId);
        for (const target of [
            foreignRow?.id ?? '',
            Bun.randomUUIDv7(),
            'bukan-uuid',
        ])
            expect((await pharmacy.admin.get(returnsPath(target))).status).toBe(
                404,
            );
    });
});
