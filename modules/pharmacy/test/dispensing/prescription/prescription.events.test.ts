import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from '../../../../../src/platform/database/index.ts';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import { receivePrescription } from '../../../src/dispensing/prescription/prescription.events.ts';
import {
    api,
    createPharmacy,
    issuedType,
    json,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

// Resep yang dikirim dokter masuk antrean farmasi lewat healthcare.prescription.issued.v1: hanya untuk tenant yang
// memasang module ini, sekali per event dan sekali per resep, dan isi yang tidak cocok dilewati tanpa membatalkan
// resep dokter. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)(
    'prescriptions arriving from healthcare',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp();
        afterAll(close);
        let pharmacy: Pharmacy;
        let amoxicillin: { id: string; code: string; name: string };

        beforeAll(async () => {
            pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Event');
            amoxicillin = await pharmacy.item('AMX-500');
        });

        const outbox = async (eventId: string) =>
            (
                await pool.unsafe<{ found: number }[]>(
                    'select count(*)::int as found from outbox_events where id = $1',
                    [eventId],
                )
            )[0]?.found;
        const processed = async (eventId: string) =>
            (
                await pool.unsafe<{ found: number }[]>(
                    'select count(*)::int as found from far_processed_events where event_id = $1',
                    [eventId],
                )
            )[0]?.found;

        test('a sent prescription is queued with every line, including the compound header and its components', async () => {
            const { envelope, prescriptionId } = await pharmacy.issue([
                { item: amoxicillin, quantity: '10', signa: '3x1' },
                { compound: 1, requested_quantity: '12', signa: '2x1' },
                { item: amoxicillin, compound: 1, quantity: '2.5' },
            ]);
            const [row] = await pharmacy.queued(prescriptionId);
            expect(row?.lines).toBe(3);
            expect(await processed(envelope.id)).toBe(1);
            const lines = await pool.unsafe<
                {
                    barang_id: string | null;
                    racikan_ke: number | null;
                    jumlah: string | null;
                    jumlah_permintaan: string | null;
                    signa: string | null;
                }[]
            >(
                `select barang_id, racikan_ke, trim_scale(jumlah)::text as jumlah,
                        trim_scale(jumlah_permintaan)::text as jumlah_permintaan, signa
                 from far_tr_resep_detail where resep_id = $1 order by urutan`,
                [row?.id ?? null],
            );
            expect([...lines]).toEqual([
                {
                    barang_id: amoxicillin.id,
                    racikan_ke: null,
                    jumlah: '10',
                    jumlah_permintaan: null,
                    signa: '3x1',
                },
                {
                    barang_id: null,
                    racikan_ke: 1,
                    jumlah: null,
                    jumlah_permintaan: '12',
                    signa: '2x1',
                },
                {
                    barang_id: amoxicillin.id,
                    racikan_ke: 1,
                    jumlah: '2.5',
                    jumlah_permintaan: null,
                    signa: null,
                },
            ]);
        });

        test('a line keeps the unit the doctor wrote and its isi, and an older message without the isi counts in the base unit', async () => {
            const strip = await pharmacy.created(
                '/api/v1/inventory/units-of-measure',
                { code: 'STRIP', name: 'Strip' },
            );
            const { prescriptionId } = await pharmacy.issue([
                {
                    item: amoxicillin,
                    quantity: '2',
                    unit: strip,
                    quantity_per_unit: '10',
                },
            ]);
            const older = await pharmacy.issue([], {
                data: {
                    lines: [
                        {
                            id: Bun.randomUUIDv7(),
                            order: 1,
                            item: {
                                id: amoxicillin.id,
                                code: amoxicillin.code,
                                name: amoxicillin.name,
                            },
                            compound: null,
                            quantity: '15',
                            unit: {
                                id: pharmacy.uom.id,
                                code: pharmacy.uom.code,
                                name: pharmacy.uom.name,
                            },
                            requested_quantity: null,
                            signa: null,
                            usage_instruction: null,
                            notes: null,
                        },
                    ],
                },
            });
            const stored = async (id: string) =>
                pool.unsafe<
                    { jumlah: string; kode_satuan: string; konversi: string }[]
                >(
                    `select trim_scale(d.jumlah)::text as jumlah, d.kode_satuan, trim_scale(d.konversi)::text as konversi
                     from far_tr_resep_detail d join far_tr_resep r on r.id = d.resep_id
                     where r.tenant_id = $1 and r.resep_sumber_id = $2`,
                    [pharmacy.tenantId, id],
                );
            expect([...(await stored(prescriptionId))]).toEqual([
                { jumlah: '2', kode_satuan: 'STRIP', konversi: '10' },
            ]);
            expect([...(await stored(older.prescriptionId))]).toEqual([
                { jumlah: '15', kode_satuan: 'TAB', konversi: '1' },
            ]);
        });

        test('a line keeps the dosage the doctor wrote, an older message shows none, and a dose unit the legal entity does not have is skipped', async () => {
            const oral = { code: 'O', name: 'Oral' };
            const { prescriptionId } = await pharmacy.issue([
                {
                    item: amoxicillin,
                    quantity: '15',
                    dosage: {
                        frequency_per_day: 3,
                        dose: '0.5',
                        dose_unit: pharmacy.uom,
                        route: oral,
                        duration_days: 5,
                    },
                },
                {
                    compound: 1,
                    requested_quantity: '10',
                    dosage: {
                        frequency_per_day: 2,
                        dose: '1',
                        dose_unit: pharmacy.uom,
                        route: oral,
                        duration_days: 3,
                    },
                },
                {
                    item: amoxicillin,
                    compound: 1,
                    quantity: '1',
                    dosage: {
                        frequency_per_day: null,
                        dose: null,
                        dose_unit: null,
                        route: null,
                        duration_days: null,
                    },
                },
            ]);
            const older = await pharmacy.issue([
                { item: amoxicillin, quantity: '1' },
            ]);
            const stored = async (id: string) =>
                pool.unsafe<
                    {
                        frekuensi: number | null;
                        dosis: string | null;
                        dosis_satuan_id: string | null;
                        rute_kode: string | null;
                        rute_nama: string | null;
                        lama_hari: number | null;
                    }[]
                >(
                    `select d.frekuensi, trim_scale(d.dosis)::text as dosis, d.dosis_satuan_id, d.rute_kode,
                            d.rute_nama, d.lama_hari
                     from far_tr_resep_detail d join far_tr_resep r on r.id = d.resep_id
                     where r.tenant_id = $1 and r.resep_sumber_id = $2 order by d.urutan`,
                    [pharmacy.tenantId, id],
                );
            const none = {
                frekuensi: null,
                dosis: null,
                dosis_satuan_id: null,
                rute_kode: null,
                rute_nama: null,
                lama_hari: null,
            };
            expect([...(await stored(prescriptionId))]).toEqual([
                {
                    frekuensi: 3,
                    dosis: '0.5',
                    dosis_satuan_id: pharmacy.uom.id,
                    rute_kode: 'O',
                    rute_nama: 'Oral',
                    lama_hari: 5,
                },
                {
                    frekuensi: 2,
                    dosis: '1',
                    dosis_satuan_id: pharmacy.uom.id,
                    rute_kode: 'O',
                    rute_nama: 'Oral',
                    lama_hari: 3,
                },
                none,
            ]);
            expect([...(await stored(older.prescriptionId))]).toEqual([none]);

            const [queued] = await pharmacy.queued(prescriptionId);
            const shown = (
                await json<{
                    data: {
                        lines: {
                            frequency_per_day: number | null;
                            dose: string | null;
                            dose_unit: { id: string; code: string } | null;
                            route: { code: string; name: string } | null;
                            duration_days: number | null;
                        }[];
                    };
                }>(
                    await pharmacy.admin.get(
                        `${api}/prescriptions/${queued?.id}`,
                    ),
                    200,
                )
            ).data;
            expect(shown.lines[0]).toMatchObject({
                frequency_per_day: 3,
                dose: '0.5',
                dose_unit: { id: pharmacy.uom.id, code: 'TAB' },
                route: oral,
                duration_days: 5,
            });
            expect(shown.lines[2]).toMatchObject({
                frequency_per_day: null,
                dose: null,
                dose_unit: null,
                route: null,
                duration_days: null,
            });

            const other = await createPharmacy(
                pool,
                browser,
                'Farmasi Uji Satuan Lain',
            );
            const { envelope, prescriptionId: foreignUnit } =
                await pharmacy.issue([
                    {
                        item: amoxicillin,
                        quantity: '1',
                        dosage: {
                            frequency_per_day: 1,
                            dose: '1',
                            dose_unit: other.uom,
                            route: oral,
                            duration_days: 1,
                        },
                    },
                ]);
            expect(await pharmacy.queued(foreignUnit)).toEqual([]);
            expect(await processed(envelope.id)).toBe(0);
        });

        test('the queue keeps the Patient KTP of the visit, and an older message without it counts as KTP', async () => {
            const withoutKtp = await pharmacy.issue(
                [{ item: amoxicillin, quantity: '1' }],
                {
                    data: {
                        patient: {
                            id: Bun.randomUUIDv7(),
                            medical_record_number: '00.00.77',
                            name: 'Pasien Tanpa KTP',
                            birth_date: null,
                            ktp: false,
                        },
                    },
                },
            );
            const older = await pharmacy.issue([
                { item: amoxicillin, quantity: '1' },
            ]);
            expect(older.data.patient).not.toHaveProperty('ktp');
            const stored = await pool.unsafe<
                { resep_sumber_id: string; pasien_ktp: boolean }[]
            >(
                `select resep_sumber_id, pasien_ktp from far_tr_resep
                 where tenant_id = $1 and resep_sumber_id in ($2, $3)`,
                [
                    pharmacy.tenantId,
                    withoutKtp.prescriptionId,
                    older.prescriptionId,
                ],
            );
            expect(
                Object.fromEntries(
                    stored.map((row) => [row.resep_sumber_id, row.pasien_ktp]),
                ),
            ).toEqual({
                [withoutKtp.prescriptionId]: false,
                [older.prescriptionId]: true,
            });
        });

        test('the same event delivered twice, or the same prescription in a second event, is queued once', async () => {
            const { envelope, prescriptionId, data } = await pharmacy.issue([
                { item: amoxicillin, quantity: '6' },
            ]);
            const connection = await pool.reserve();
            try {
                const db = new Database(
                    connection,
                    undefined,
                    Bun.randomUUIDv7(),
                );
                await db.transaction(() => receivePrescription(db, envelope));
            } finally {
                connection.release();
            }
            const again = await pharmacy.issue([], {
                data: { ...data },
            });
            expect(await outbox(again.envelope.id)).toBe(1);
            const rows = await pharmacy.queued(prescriptionId);
            expect(rows.length).toBe(1);
            expect(rows[0]?.lines).toBe(1);
            expect(await processed(envelope.id)).toBe(1);
        });

        test('a payload that does not match the contract is skipped: the doctor still sends, the queue stays clean, and the event is not marked processed', async () => {
            const before = await pool.unsafe<{ found: number }[]>(
                'select count(*)::int as found from far_tr_resep where tenant_id = $1',
                [pharmacy.tenantId],
            );
            for (const broken of [
                { lines: [] },
                { patient: { id: 'bukan-uuid', name: 'Tanpa NRM' } },
                { issued_at: '13/11/2026 09:15' },
                {
                    lines: [
                        {
                            id: Bun.randomUUIDv7(),
                            order: 1,
                            item: amoxicillin,
                            compound: null,
                            quantity: 'sepuluh',
                            unit: null,
                            requested_quantity: null,
                            signa: null,
                            usage_instruction: null,
                            notes: null,
                        },
                    ],
                },
            ]) {
                const { envelope } = await pharmacy.issue(
                    [{ item: amoxicillin, quantity: '1' }],
                    { data: broken, validate: false },
                );
                expect(await outbox(envelope.id)).toBe(1);
                expect(await processed(envelope.id)).toBe(0);
            }
            const after = await pool.unsafe<{ found: number }[]>(
                'select count(*)::int as found from far_tr_resep where tenant_id = $1',
                [pharmacy.tenantId],
            );
            expect(after[0]?.found).toBe(before[0]?.found);
        });

        test('a prescription naming items the legal entity does not have is skipped', async () => {
            const other = await createPharmacy(
                pool,
                browser,
                'Farmasi Uji Event Lain',
            );
            const foreign = await other.item('LAIN-1');
            const { envelope, prescriptionId } = await pharmacy.issue([
                { item: foreign, quantity: '1' },
            ]);
            expect(await outbox(envelope.id)).toBe(1);
            expect(await pharmacy.queued(prescriptionId)).toEqual([]);
            expect(await processed(envelope.id)).toBe(0);
        });

        test('a tenant that has not installed the pharmacy module receives nothing', async () => {
            const clinic = await createPharmacy(
                pool,
                browser,
                'Klinik Tanpa Farmasi',
                { installed: false },
            );
            const item = await clinic.item('PCT-500');
            const { envelope, prescriptionId } = await clinic.issue([
                { item, quantity: '10' },
            ]);
            expect(envelope.type).toBe(issuedType);
            expect(await outbox(envelope.id)).toBe(1);
            expect(await clinic.queued(prescriptionId)).toEqual([]);
            expect(await processed(envelope.id)).toBe(0);
        });
    },
);
