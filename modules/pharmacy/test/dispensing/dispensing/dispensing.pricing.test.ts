import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    api,
    createPharmacy,
    inventoryApi,
    json,
    pharmacyDuties,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

type Reference = { id: string; code: string; name: string };
type Price = { unit_price: string; discount_percent: string; amount: string };
type Dispensing = {
    dispensing: {
        id: string;
        status: string;
        total_amount: string | null;
        version: number;
    } | null;
    lines: { price: Price | null }[];
};
type StoredLine = {
    harga_dasar: string;
    grading_harga_id: string | null;
    persen_naik: string;
    harga_satuan: string;
    persen_diskon: string;
};

// Harga obat di penyerahan: dihitung saat Siapkan dari harga dasar barang, kelompok harga pembeli di resep (dari event
// resep), kelompok grading obat, dan grading harga obat, lalu disalin ke bill_farmasi_detail dan tidak berubah saat
// grading diubah sesudahnya. Batal siapkan lalu Siapkan lagi menghitung ulang. Harga satuan dibulatkan menurut setelan
// farmasi saat disiapkan. Isi baris dibaca lewat SQL. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST
// kosong.
describe.skipIf(!process.env.DB_HOST)('dispensing prices', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let item: Reference;
    let strip: Reference;
    let umum: Reference;
    let oral: Reference;
    let groupRow: { id: string; version: number };
    let reasonId: string;

    const path = (prescriptionId: string, action = '') =>
        `${api}/prescriptions/${prescriptionId}/dispensing${action}`;

    async function stored(billId: string): Promise<StoredLine[]> {
        return [
            ...(await pool.unsafe<StoredLine[]>(
                `select trim_scale(harga_dasar)::text as harga_dasar, grading_harga_id,
                        trim_scale(persen_naik)::text as persen_naik, trim_scale(harga_satuan)::text as harga_satuan,
                        trim_scale(persen_diskon)::text as persen_diskon
                 from bill_farmasi_detail where bill_farmasi_id = $1 order by urutan`,
                [billId],
            )),
        ];
    }

    async function prescribe(priceGroup: Reference | null) {
        const { prescriptionId } = await pharmacy.issue(
            [{ item, quantity: '2', unit: strip, quantity_per_unit: '10' }],
            {
                data: {
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
        return row.id;
    }

    const prepare = async (id: string) =>
        (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.post(path(id, '/prepare')),
                200,
            )
        ).data;

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Harga', {
            duties: [
                ...pharmacyDuties,
                'pharmacy.dispensing.manage',
                'core.pricing-setup.manage',
            ],
        });
        const farmasi = await pharmacy.location('FARMASI');
        await pharmacy.created(`${api}/service-locations`, {
            operating_unit_id: pharmacy.unitId,
            section_id: null,
            location_id: farmasi.id,
        });
        reasonId =
            (
                await json<{ data: Reference[] }>(
                    await pharmacy.admin.get(`${inventoryApi}/reason-codes`),
                    200,
                )
            ).data.find((reason) => reason.code === 'SALDO-AWAL')?.id ?? '';
        item = await pharmacy.item('HRG-1', { base_price: '84.38' });
        strip = await pharmacy.created(`${inventoryApi}/units-of-measure`, {
            code: 'STRIP',
            name: 'Strip',
        });
        await pharmacy.created(`${inventoryApi}/item-units`, {
            item_id: item.id,
            unit_id: strip.id,
            quantity_per_unit: 10,
        });
        const draft = await pharmacy.created<{ id: string; version: number }>(
            `${inventoryApi}/adjustments`,
            {
                direction: 'masuk',
                location_id: farmasi.id,
                posting_date: '2026-11-01',
                reason_id: reasonId,
                lines: [{ item_id: item.id, quantity: 200, unit_cost: 50 }],
            },
        );
        await json(
            await pharmacy.admin.post(
                `${inventoryApi}/adjustments/${draft.id}/post`,
                { version: draft.version },
            ),
            200,
        );
        umum = await pharmacy.created('/api/v1/pricing/price-groups', {
            code: 'UMUM',
            name: 'Umum',
        });
        oral = await pharmacy.created(`${api}/grading-groups`, {
            name: 'OBAT ORAL',
        });
        await json(
            await pharmacy.admin.put(`${api}/drugs/${item.id}`, {
                drug_class_id: null,
                grading_group_id: oral.id,
                is_generic: false,
                is_formulary: false,
                version: 0,
            }),
            200,
        );
        const gradingRow = (body: Record<string, unknown>) =>
            pharmacy.created<{ id: string; version: number }>(
                `${api}/drug-prices`,
                {
                    price_group_id: umum.id,
                    price_from: 0,
                    price_to: 1000000000,
                    effective_from: '2026-01-01',
                    ...body,
                },
            );
        groupRow = await gradingRow({
            grading_group_id: oral.id,
            markup_percent: 30,
            discount_percent: 5,
        });
        await gradingRow({ grading_group_id: null, markup_percent: 10 });
    });

    test('Siapkan stores the base price, grading row, markup, unit price for the line unit, and discount, and a later grading change leaves them', async () => {
        const id = await prescribe(umum);
        const [queued] = await pool.unsafe<{ price_group: string | null }[]>(
            'select kelompok_harga_id as price_group from far_tr_resep where id = $1',
            [id],
        );
        expect(queued?.price_group).toBe(umum.id);

        const prepared = await prepare(id);
        const billId = prepared.dispensing?.id ?? '';
        const priced: StoredLine = {
            harga_dasar: '84.38',
            grading_harga_id: groupRow.id,
            persen_naik: '30',
            harga_satuan: '1097',
            persen_diskon: '5',
        };
        expect(await stored(billId)).toEqual([priced]);
        expect(prepared.lines.map((line) => line.price)).toEqual([
            { unit_price: '1097', discount_percent: '5', amount: '2084.3' },
        ]);
        expect(prepared.dispensing?.total_amount).toBe('2084.3');

        const changed = await json<{ data: { version: number } }>(
            await pharmacy.admin.patch(`${api}/drug-prices/${groupRow.id}`, {
                price_group_id: umum.id,
                grading_group_id: oral.id,
                price_from: 0,
                price_to: 1000000000,
                markup_percent: 50,
                discount_percent: 0,
                effective_from: '2026-01-01',
                version: groupRow.version,
            }),
            200,
        );
        groupRow = { id: groupRow.id, version: changed.data.version };
        await json(
            await pharmacy.admin.patch(`${inventoryApi}/items/${item.id}`, {
                code: item.code,
                name: item.name,
                base_unit_id: pharmacy.uom.id,
                base_price: '100',
                version: (
                    await pool.unsafe<{ version: number }[]>(
                        'select version from gd_m_barang where id = $1',
                        [item.id],
                    )
                )[0]?.version,
            }),
            200,
        );
        expect(await stored(billId)).toEqual([priced]);

        await json(
            await pharmacy.admin.post(path(id, '/cancel-preparation'), {
                version: prepared.dispensing?.version,
            }),
            200,
        );
        const again = await prepare(id);
        expect(await stored(again.dispensing?.id ?? '')).toEqual([
            {
                harga_dasar: '100',
                grading_harga_id: groupRow.id,
                persen_naik: '50',
                harga_satuan: '1500',
                persen_diskon: '0',
            },
        ]);
    });

    test('a prescription without a price group is priced at the base price, and a draft has no price yet', async () => {
        const id = await prescribe(null);
        const draft = (
            await json<{ data: Dispensing }>(
                await pharmacy.admin.get(path(id)),
                200,
            )
        ).data;
        expect(draft.lines.map((line) => line.price)).toEqual([null]);
        const prepared = await prepare(id);
        const [line] = await stored(prepared.dispensing?.id ?? '');
        expect(line).toMatchObject({
            grading_harga_id: null,
            persen_naik: '0',
            persen_diskon: '0',
        });
        expect(line?.harga_satuan).toBe(
            String(Math.round(Number(line?.harga_dasar) * 10)),
        );
    });

    test('Siapkan rounds the unit price to the pharmacy setting of that time: four decimals stay, the line amount is rounded to sen, and a later setting change leaves the line', async () => {
        await json(
            await pharmacy.admin.patch(`${inventoryApi}/items/${item.id}`, {
                code: item.code,
                name: item.name,
                base_unit_id: pharmacy.uom.id,
                base_price: '84.3817',
                version: (
                    await pool.unsafe<{ version: number }[]>(
                        'select version from gd_m_barang where id = $1',
                        [item.id],
                    )
                )[0]?.version,
            }),
            200,
        );
        const setting = async (
            unit_price_decimals: number,
            version: number | null,
        ) =>
            json<{ data: { version: number } }>(
                await pharmacy.admin.put(`${api}/setup`, {
                    unit_price_decimals,
                    version,
                }),
                200,
            );
        const columns = async (billId: string) => [
            ...(await pool.unsafe<{ harga_satuan: string }[]>(
                'select harga_satuan::text as harga_satuan from bill_farmasi_detail where bill_farmasi_id = $1',
                [billId],
            )),
        ];

        const saved = await setting(4, null);
        const exact = await prepare(await prescribe(null));
        const exactBill = exact.dispensing?.id ?? '';
        expect(await columns(exactBill)).toEqual([
            { harga_satuan: '843.8170' },
        ]);
        expect(exact.lines.map((line) => line.price)).toEqual([
            { unit_price: '843.817', discount_percent: '0', amount: '1687.63' },
        ]);
        expect(exact.dispensing?.total_amount).toBe('1687.63');

        await setting(0, saved.data.version);
        expect(await columns(exactBill)).toEqual([
            { harga_satuan: '843.8170' },
        ]);
        const whole = await prepare(await prescribe(null));
        expect(await columns(whole.dispensing?.id ?? '')).toEqual([
            { harga_satuan: '844.0000' },
        ]);
        expect(whole.lines.map((line) => line.price)).toEqual([
            { unit_price: '844', discount_percent: '0', amount: '1688' },
        ]);
    });
});
