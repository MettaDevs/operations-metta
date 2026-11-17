import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { registerBillingEventHandlers } from '@core/foundation/billing/index.ts';
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
const reference = ({ id, code, name }: Reference): Reference => ({
    id,
    code,
    name,
});
type Line = {
    prescription_line_id: string;
    item: Reference;
    substitution: {
        prescribed_item: Reference;
        consent: string;
        reason: string;
        by: string | null;
        at: string | null;
    } | null;
    item_options: { item: Reference; is_prescribed: boolean }[];
    units: { id: string }[];
};
type View = {
    data: { lines: Line[]; dispensing: { version: number } | null };
    permissions: { substitute: boolean };
};
const dispensed = 'pharmacy.prescription.dispensed.v1';

// Obat resep diganti obat pengganti saat Siapkan (Item Substitution BC). Stok, tagihan kasir, dan event penyerahan memakai
// obat pengganti, resep dokter tidak berubah, dan penggantian mencatat obat resep, persetujuan, alasan, waktu, dan
// pengguna. Efeknya dibaca lewat SQL atas kartu gudang, baris kasir, baris resep, dan outbox.
describe.skipIf(!process.env.DB_HOST)('dispensing item substitution', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let brand: Reference;
    let generic: Reference;
    let unrelated: Reference;
    let assistant: Browser;

    const path = (id: string, action = '') =>
        `${api}/prescriptions/${id}/dispensing${action}`;
    const show = async (session: Browser, id: string) =>
        json<View>(await session.get(path(id)), 200);
    async function prescribe(visitId: string) {
        const { prescriptionId } = await pharmacy.issue(
            [{ item: brand, quantity: '4' }],
            { data: { visit_id: visitId } },
        );
        const [row] = await pharmacy.queued(prescriptionId);
        if (!row) throw new Error('Resep tidak masuk antrean.');
        return row.id;
    }
    const substituted = (
        line: Line,
        itemId: string,
        extra: Record<string, unknown> = {},
        version?: number,
    ) => ({
        ...(version === undefined ? {} : { version }),
        lines: [
            {
                prescription_line_id: line.prescription_line_id,
                item_id: itemId,
                substitution_consent: 'pasien',
                substitution_reason: 'Stok obat resep habis',
                quantity: '4',
                unit_id: line.units[0]?.id ?? null,
                ...extra,
            },
        ],
    });
    const ledger = (dispensingId: string) =>
        pool.unsafe<{ item_id: string; quantity: string }[]>(
            `select barang_id as item_id, trim_scale(jumlah)::text as quantity from gd_tr_kartu_gudang
             where tenant_id = $1 and sumber_jenis = 'bill_farmasi' and sumber_id = $2 order by created_at, id`,
            [pharmacy.tenantId, dispensingId],
        );
    const stored = (prescriptionId: string) =>
        pool.unsafe<
            {
                dispensing_id: string;
                item_id: string;
                prescribed_item_id: string | null;
                consent: string | null;
                reason: string | null;
                substituted: boolean;
                written_item_id: string;
            }[]
        >(
            `select d.bill_farmasi_id as dispensing_id, d.barang_id as item_id,
                    d.barang_resep_id as prescribed_item_id, d.persetujuan_ganti as consent, d.alasan_ganti as reason,
                    d.diganti_pada is not null and d.diganti_oleh_user_id is not null as substituted,
                    r.barang_id as written_item_id
             from bill_farmasi_detail d
             join bill_farmasi h on h.id = d.bill_farmasi_id
             join far_tr_resep_detail r on r.id = d.resep_detail_id
             where d.tenant_id = $1 and h.resep_id = $2 and h.status <> 'dibatalkan'`,
            [pharmacy.tenantId, prescriptionId],
        );

    beforeAll(async () => {
        registerBillingEventHandlers();
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Ganti', {
            duties: [
                ...pharmacyDuties,
                'pharmacy.dispensing.manage',
                'core.reference-data.manage',
            ],
        });
        const farmasi = await pharmacy.location('FARMASI');
        await pharmacy.created(`${api}/service-locations`, {
            operating_unit_id: pharmacy.unitId,
            section_id: null,
            location_id: farmasi.id,
        });
        brand = reference(await pharmacy.item('MERK', { base_price: '5000' }));
        generic = reference(
            await pharmacy.item('GENERIK', { base_price: '1000' }),
        );
        unrelated = reference(
            await pharmacy.item('LAIN', { base_price: '700' }),
        );
        const reasonId =
            (
                await json<{ data: Reference[] }>(
                    await pharmacy.admin.get(`${inventoryApi}/reason-codes`),
                    200,
                )
            ).data.find((reason) => reason.code === 'SALDO-AWAL')?.id ?? '';
        const draft = await pharmacy.created<{ id: string; version: number }>(
            `${inventoryApi}/adjustments`,
            {
                direction: 'masuk',
                location_id: farmasi.id,
                posting_date: '2026-11-01',
                reason_id: reasonId,
                lines: [brand, generic, unrelated].map((item) => ({
                    item_id: item.id,
                    quantity: 50,
                    unit_cost: 500,
                })),
            },
        );
        await json(
            await pharmacy.admin.post(
                `${inventoryApi}/adjustments/${draft.id}/post`,
                { version: draft.version },
            ),
            200,
        );
        await json(
            await pharmacy.admin.post(
                `${api}/drugs/${brand.id}/substitutions`,
                {
                    substitute_item_id: generic.id,
                    interchangeable: false,
                },
            ),
            200,
        );
        const account = await createMember(pool, pharmacy.tenantId, [
            'pharmacy.dispensing.prepare',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            account.membershipId,
        );
        assistant = browser();
        await assistant.login(account.email, account.password);
    });

    test('the queue card offers the prescribed drug first, then its substitutes', async () => {
        const id = await prescribe(Bun.randomUUIDv7());
        const view = await show(pharmacy.admin, id);
        expect(view.permissions.substitute).toBe(true);
        expect(view.data.lines[0]).toMatchObject({
            item: brand,
            substitution: null,
            item_options: [
                { item: brand, is_prescribed: true },
                { item: generic, is_prescribed: false },
            ],
        });
    });

    test('Siapkan with a substitute posts its stock, bills it, and hands over a dispensed event that names the prescribed drug', async () => {
        const visitId = Bun.randomUUIDv7();
        const id = await prescribe(visitId);
        const [line] = (await show(pharmacy.admin, id)).data.lines;
        if (!line) throw new Error('Resep tanpa baris obat.');
        const prepared = await json<View>(
            await pharmacy.admin.post(
                path(id, '/prepare'),
                substituted(line, generic.id),
            ),
            200,
        );
        expect(prepared.data.lines[0]).toMatchObject({
            item: generic,
            substitution: {
                prescribed_item: brand,
                consent: 'pasien',
                reason: 'Stok obat resep habis',
                by: expect.any(String),
                at: expect.any(String),
            },
            item_options: [],
        });
        const [row] = await stored(id);
        expect(row).toMatchObject({
            item_id: generic.id,
            prescribed_item_id: brand.id,
            consent: 'pasien',
            substituted: true,
            written_item_id: brand.id,
        });
        expect([...(await ledger(row?.dispensing_id ?? ''))]).toEqual([
            { item_id: generic.id, quantity: '-4' },
        ]);
        expect([
            ...(await pool.unsafe<{ item_id: string; nilai: string }[]>(
                `select jenis_biaya_id as item_id, trim_scale(nilai)::text as nilai from tagihan_kasir_detail
                 where tenant_id = $1 and tagihan_sumber_dokumen_id = $2 and group_biaya = 'OBAT'
                   and deleted_at is null`,
                [pharmacy.tenantId, visitId],
            )),
        ]).toEqual([{ item_id: generic.id, nilai: '1000' }]);
        await json(
            await pharmacy.admin.post(path(id, '/hand-over'), {
                received_by_patient: true,
                version: prepared.data.dispensing?.version,
            }),
            200,
        );
        const envelope = (
            await outboxEnvelopes(pool, pharmacy.tenantId, dispensed)
        ).at(-1);
        expect(
            (await eventContract(dispensed)).safeParse(envelope).error,
        ).toBeUndefined();
        expect(envelope?.data).toMatchObject({
            lines: [
                {
                    item: generic,
                    substitution: {
                        prescribed_item: brand,
                        consent: 'pasien',
                        reason: 'Stok obat resep habis',
                    },
                },
            ],
        });
    });

    test('a drug outside the substitute list, or a substitute without consent and reason, is refused without writing', async () => {
        const id = await prescribe(Bun.randomUUIDv7());
        const [line] = (await show(pharmacy.admin, id)).data.lines;
        if (!line) throw new Error('Resep tanpa baris obat.');
        expect(
            await refused(
                await pharmacy.admin.put(
                    path(id),
                    substituted(line, unrelated.id),
                ),
            ),
        ).toEqual({
            'lines.0.item_id': [
                'Pilih obat pengganti dari daftar obat pengganti obat resep ini.',
            ],
        });
        expect(
            Object.keys(
                await refused(
                    await pharmacy.admin.put(
                        path(id),
                        substituted(line, generic.id, {
                            substitution_consent: null,
                            substitution_reason: ' ',
                        }),
                    ),
                ),
            ).sort(),
        ).toEqual([
            'lines.0.substitution_consent',
            'lines.0.substitution_reason',
        ]);
        expect([...(await stored(id))]).toEqual([]);
    });

    test('an assistant cannot substitute, but can save a draft the pharmacist already substituted', async () => {
        const id = await prescribe(Bun.randomUUIDv7());
        const [line] = (await show(assistant, id)).data.lines;
        if (!line) throw new Error('Resep tanpa baris obat.');
        expect((await show(assistant, id)).permissions.substitute).toBe(false);
        expect(
            (await assistant.put(path(id), substituted(line, generic.id)))
                .status,
        ).toBe(403);
        await json(
            await pharmacy.admin.put(path(id), substituted(line, generic.id)),
            200,
        );
        const version = (await show(assistant, id)).data.dispensing?.version;
        await json(
            await assistant.put(
                path(id),
                substituted(
                    line,
                    generic.id,
                    { quantity: '3', reason: 'Sisa' },
                    version,
                ),
            ),
            200,
        );
        expect([...(await stored(id))]).toMatchObject([
            { item_id: generic.id, prescribed_item_id: brand.id },
        ]);
    });

    test('switching back to the prescribed drug clears the substitution record', async () => {
        const id = await prescribe(Bun.randomUUIDv7());
        const [line] = (await show(pharmacy.admin, id)).data.lines;
        if (!line) throw new Error('Resep tanpa baris obat.');
        await json(
            await pharmacy.admin.put(path(id), substituted(line, generic.id)),
            200,
        );
        const version = (await show(pharmacy.admin, id)).data.dispensing
            ?.version;
        await json(
            await pharmacy.admin.put(
                path(id),
                substituted(line, brand.id, {}, version),
            ),
            200,
        );
        expect([...(await stored(id))]).toMatchObject([
            {
                item_id: brand.id,
                prescribed_item_id: null,
                consent: null,
                reason: null,
                substituted: false,
            },
        ]);
    });
});
