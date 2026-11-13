import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
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
type Dispensing = {
    dispensing: { id: string; version: number } | null;
};
type Returns = {
    returnable: {
        dispensing_line_id: string;
        batch: { id: string } | null;
    }[];
    returns: { id: string; version: number }[];
};

// Penyerahan dan retur farmasi memakai mesin posting stok Core, jadi periode persediaan yang ditutup menolak Siapkan,
// Batal siapkan, dan Batal retur bertanggal di dalamnya sampai periode itu dibuka lagi. Siapkan dan retur bertanggal
// hari ini, sehingga periode yang ditutup di sini berakhir jauh sesudahnya. Kartu gudang diperiksa dengan SQL langsung.
describe.skipIf(!process.env.DB_HOST)(
    'dispensing in a closed inventory period',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp();
        afterAll(close);
        let pharmacy: Pharmacy;
        let item: Reference;

        const dispensing = (id: string, action = '') =>
            `${api}/prescriptions/${id}/dispensing${action}`;
        const returnsPath = (id: string, suffix = '') =>
            `${api}/prescriptions/${id}/returns${suffix}`;

        async function entries(sourceType: string, sourceId: string) {
            return (
                await pool.unsafe<{ quantity: string; reversal: boolean }[]>(
                    `select trim_scale(jumlah)::text as quantity, dibalik_dari is not null as reversal
                 from gd_tr_kartu_gudang where tenant_id = $1 and sumber_jenis = $2 and sumber_id = $3
                 order by created_at, id`,
                    [pharmacy.tenantId, sourceType, sourceId],
                )
            ).map((row) => [Number(row.quantity), row.reversal]);
        }

        async function prescribed() {
            const { prescriptionId } = await pharmacy.issue([
                { item, quantity: '3' },
            ]);
            const [row] = await pharmacy.queued(prescriptionId);
            if (!row) throw new Error('Resep tidak masuk antrean.');
            return row.id;
        }
        const prepare = (id: string) =>
            pharmacy.admin.post(dispensing(id, '/prepare'));
        const prepared = async (id: string) => {
            const document = (
                await json<{ data: Dispensing }>(await prepare(id), 200)
            ).data.dispensing;
            if (!document) throw new Error('Penyerahan tidak dibuat.');
            return document;
        };

        beforeAll(async () => {
            pharmacy = await createPharmacy(
                pool,
                browser,
                'Farmasi Uji Periode',
                {
                    duties: [
                        ...pharmacyDuties,
                        'pharmacy.dispensing.manage',
                        'core.inventory-period.manage',
                    ],
                },
            );
            const farmasi = await pharmacy.location('FARMASI');
            await json(
                await pharmacy.admin.post(`${api}/service-locations`, {
                    operating_unit_id: pharmacy.unitId,
                    section_id: null,
                    location_id: farmasi.id,
                }),
                201,
            );
            item = await pharmacy.item('PRD-500');
            const reasons = (
                await json<{ data: Reference[] }>(
                    await pharmacy.admin.get(`${inventoryApi}/reason-codes`),
                    200,
                )
            ).data;
            const draft = (
                await json<{ data: { id: string; version: number } }>(
                    await pharmacy.admin.post(`${inventoryApi}/adjustments`, {
                        direction: 'masuk',
                        location_id: farmasi.id,
                        posting_date: '2026-11-01',
                        reason_id: reasons.find(
                            (reason) => reason.code === 'SALDO-AWAL',
                        )?.id,
                        lines: [
                            { item_id: item.id, quantity: 30, unit_cost: 500 },
                        ],
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
        });

        test('Siapkan, Batal siapkan, and Batal retur are refused while the period is closed, and work again once it is reopened', async () => {
            const waiting = await prescribed();
            const toCancel = await prescribed();
            const firstPrepared = await prepared(toCancel);
            const toReturn = await prescribed();
            await json(
                await pharmacy.admin.post(dispensing(toReturn, '/hand-over'), {
                    version: (await prepared(toReturn)).version,
                }),
                200,
            );
            const shown = (
                await json<{ data: Returns }>(
                    await pharmacy.admin.get(returnsPath(toReturn)),
                    200,
                )
            ).data;
            const returned = (
                await json<{ data: Returns }>(
                    await pharmacy.admin.post(returnsPath(toReturn), {
                        reason: 'Pasien alergi',
                        lines: shown.returnable.map((line) => ({
                            dispensing_line_id: line.dispensing_line_id,
                            batch_id: line.batch?.id ?? null,
                            quantity: '1',
                        })),
                    }),
                    200,
                )
            ).data.returns[0];
            if (!returned) throw new Error('Retur tidak dibuat.');

            const period = (
                await json<{ data: { id: string; version: number } }>(
                    await pharmacy.admin.post(`${inventoryApi}/periods`, {
                        ending_date: '2030-12-31',
                    }),
                    201,
                )
            ).data;
            const closed = (
                await json<{ data: { id: string; version: number } }>(
                    await pharmacy.admin.post(
                        `${inventoryApi}/periods/${period.id}/close`,
                        { version: period.version },
                    ),
                    200,
                )
            ).data;

            expect(
                (await refused(await prepare(waiting)))._form?.[0],
            ).toContain(
                'Periode persediaan Desember 2030 sudah ditutup, jadi stok bertanggal',
            );
            const cancel = () =>
                pharmacy.admin.post(
                    dispensing(toCancel, '/cancel-preparation'),
                    {
                        version: firstPrepared.version,
                    },
                );
            expect((await refused(await cancel()))._form?.[0]).toContain(
                'tidak bisa dibatalkan',
            );
            const reverseReturn = () =>
                pharmacy.admin.post(
                    returnsPath(toReturn, `/${returned.id}/reverse`),
                    { version: returned.version },
                );
            expect((await refused(await reverseReturn()))._form?.[0]).toContain(
                'tidak bisa dibatalkan',
            );
            expect(await entries('bill_farmasi', firstPrepared.id)).toEqual([
                [-3, false],
            ]);
            expect(await entries('retur_farmasi', returned.id)).toEqual([
                [1, false],
            ]);

            await json(
                await pharmacy.admin.post(
                    `${inventoryApi}/periods/${closed.id}/reopen`,
                    { version: closed.version },
                ),
                200,
            );
            expect((await cancel()).status).toBe(200);
            expect((await reverseReturn()).status).toBe(200);
            expect(await entries('bill_farmasi', firstPrepared.id)).toEqual([
                [-3, false],
                [3, true],
            ]);
            expect(await entries('retur_farmasi', returned.id)).toEqual([
                [1, false],
                [-1, true],
            ]);
            expect((await prepare(waiting)).status).toBe(200);
        });
    },
);
