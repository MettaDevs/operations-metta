import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    Database,
    type JsonObject,
} from '../../../../../src/platform/database/index.ts';
import { publishEvent } from '../../../../../src/platform/events/index.ts';
import { eventContract } from '../../../../../test/support/event-contracts.ts';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    receiveDispensing,
    receiveReturn,
} from '../../../src/examination/medical-record/dispensing.events.ts';
import {
    api,
    createClinic,
    json,
    type Clinic,
} from '../../support/examination-fixture.ts';

type Prescription = {
    id: string;
    number: string | null;
    status: string;
    dispensed_at?: string | null;
    dispensing_number?: string | null;
    lines: {
        drug_id: string | null;
        dispensed_quantity?: string | null;
        returned_quantity?: string | null;
    }[];
};

const dispensed = 'pharmacy.prescription.dispensed.v1';
const posted = 'pharmacy.return.posted.v1';
const reversed = 'pharmacy.return.reversed.v1';

// E-Resep menampilkan obat yang sudah diserahkan farmasi, dari pharmacy.prescription.dispensed.v1 yang diterbitkan
// sesuai kontraknya: waktu, nomor penyerahan, dan jumlah per baris. Retur dan pembatalannya (pharmacy.return.posted.v1,
// pharmacy.return.reversed.v1) mengubah jumlah itu menjadi yang dipegang pasien. Event yang diantar dua kali dicatat
// sekali, dan resep yang tidak dikenal dilewati tanpa membatalkan penyerahan. Butuh PostgreSQL yang sudah dimigrasi;
// dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)(
    'dispensing shown on the prescription',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp();
        afterAll(close);
        let clinic: Clinic;
        let destination: string;
        let prescription: Prescription;
        let lineIds: { id: string; drug_id: string }[];

        beforeAll(async () => {
            clinic = await createClinic(pool, browser, 'Klinik Uji Serah');
            const drug = async (code: string) =>
                (
                    await json<{ data: { id: string } }>(
                        await clinic.admin.post(`${api}/drugs`, {
                            code,
                            name: `Obat ${code}`,
                            base_unit_id: clinic.unitTab,
                            dosage_form_id: null,
                            is_prescribable: true,
                        }),
                        201,
                    )
                ).data.id;
            const amoxicillin = await drug('AMX');
            const paracetamol = await drug('PCT');
            const metadata = await json<{
                usage_instructions: { id: string }[];
            }>(
                await clinic.admin.get(
                    `${api}/examination/medical-record/metadata`,
                ),
                200,
            );
            const visit = await clinic.visit();
            destination = visit.destinationId;
            await json(await clinic.start(destination), 200);
            const line = (drugId: string) => ({
                drug_id: drugId,
                compound: null,
                quantity: 10,
                signa: '3x1',
                usage_instruction_id: metadata.usage_instructions[0]?.id,
                ...clinic.dosage,
                notes: null,
            });
            await json(
                await clinic.save(destination, {
                    anamnesis: {
                        doctor_id: clinic.doctor,
                        nurse_id: null,
                        chief_complaint: 'Demam',
                        additional_complaint: null,
                        illness_years: null,
                        illness_months: null,
                        illness_days: null,
                    },
                    prescriptions: [
                        {
                            id: null,
                            notes: null,
                            lines: [line(amoxicillin), line(paracetamol)],
                        },
                    ],
                }),
                200,
            );
            const record = await clinic.show(destination);
            await json(
                await clinic.admin.post(
                    `${api}/examination/destinations/${destination}/prescriptions/send`,
                    {
                        version: record.data.version,
                        prescriptions: record.data.prescriptions,
                    },
                ),
                200,
            );
            prescription = (await sent())[0]!;
            lineIds = [
                ...(await pool.unsafe<{ id: string; drug_id: string }[]>(
                    `select id, obat_id as drug_id from sim_tr_resep_detail
                     where resep_id = $1 and deleted_at is null order by urutan`,
                    [prescription.id],
                )),
            ];
        });

        async function sent() {
            return (
                (
                    (await clinic.show(destination)).data.prescriptions as
                        Prescription[] | undefined
                )?.filter((row) => row.status === 'dikirim') ?? []
            );
        }

        // Diterbitkan seperti module farmasi menerbitkannya, lalu diperiksa terhadap berkas kontrak.
        async function publish(
            type: typeof dispensed | typeof posted | typeof reversed,
            data: JsonObject,
        ) {
            const connection = await pool.reserve();
            try {
                const db = new Database(
                    connection,
                    undefined,
                    Bun.randomUUIDv7(),
                );
                const envelope = await db.transaction(() =>
                    publishEvent(db, {
                        type,
                        tenantId: clinic.tenantId,
                        legalEntityId: clinic.legalEntityId,
                        orgUnitId: clinic.unit,
                        data,
                    }),
                );
                (await eventContract(type)).parse(envelope);
                return envelope;
            } finally {
                connection.release();
            }
        }

        async function hand(prescriptionId: string, quantities: string[]) {
            const data = {
                dispensing_id: Bun.randomUUIDv7(),
                dispensing_number: 'U1-FAR-00000001',
                prescription_id: prescriptionId,
                prescription_number: prescription.number ?? '',
                dispensed_at: '2026-11-13T03:20:00Z',
                location: {
                    id: Bun.randomUUIDv7(),
                    code: 'FARMASI',
                    name: 'Farmasi',
                },
                pharmacist: { id: Bun.randomUUIDv7(), name: 'Apoteker Uji' },
                assistant: null,
                lines: lineIds.map((line, index) => ({
                    prescription_line_id: line.id,
                    item: { id: line.drug_id, code: 'X', name: 'Obat' },
                    unit: { id: clinic.unitTab, code: 'TAB', name: 'Tablet' },
                    prescribed_quantity: '10',
                    quantity: quantities[index] ?? '0',
                    reason: quantities[index] === '10' ? null : 'Stok habis',
                    batches: [],
                })),
            };
            return publish(dispensed, data);
        }

        // Retur atau pembatalannya atas baris resep pertama: quantity jumlah retur itu dalam satuan dasar (tablet),
        // returned total retur yang masih berlaku sesudahnya, dan unit satuan yang dicatat farmasi bila bukan tablet.
        async function giveBack(
            type: typeof posted | typeof reversed,
            prescriptionId: string,
            returnId: string,
            quantity: string,
            returned: string,
            unit?: { code: string; name: string; quantity: string },
        ) {
            const line = lineIds[0];
            const tablet = { id: clinic.unitTab, code: 'TAB', name: 'Tablet' };
            return publish(type, {
                return_id: returnId,
                return_number: 'U1-RTR-00000001',
                return_date: '2026-11-13',
                reason: 'Pasien alergi',
                posted_at: '2026-11-13T04:00:00Z',
                ...(type === reversed
                    ? { reversed_at: '2026-11-13T04:30:00Z' }
                    : {}),
                dispensing_id: Bun.randomUUIDv7(),
                dispensing_number: 'U1-FAR-00000001',
                prescription_id: prescriptionId,
                prescription_number: prescription.number ?? '',
                location: {
                    id: Bun.randomUUIDv7(),
                    code: 'FARMASI',
                    name: 'Farmasi',
                },
                lines: [
                    {
                        prescription_line_id: line?.id ?? '',
                        item: {
                            id: line?.drug_id ?? '',
                            code: 'X',
                            name: 'Obat',
                        },
                        unit: unit
                            ? {
                                  id: Bun.randomUUIDv7(),
                                  code: unit.code,
                                  name: unit.name,
                              }
                            : tablet,
                        quantity: unit?.quantity ?? quantity,
                        base_unit: tablet,
                        base_quantity: quantity,
                        returned_base_quantity: returned,
                        batches: [
                            {
                                batch_number: 'B-1',
                                expiry_date: '2027-12-31',
                                quantity,
                            },
                        ],
                    },
                ],
            });
        }

        // Langsung dari tabel, bukan lewat API yang sedang diuji.
        async function storedReturns() {
            return (
                await pool.unsafe<{ returned: string | null }[]>(
                    `select trim_scale(jumlah_diretur)::text as returned from sim_tr_resep_detail
                     where resep_id = $1 and deleted_at is null order by urutan`,
                    [prescription.id],
                )
            ).map((row) => row.returned);
        }

        async function lines() {
            return (await sent())[0]?.lines.map((line) => [
                line.dispensed_quantity,
                line.returned_quantity,
            ]);
        }

        test('the E-Resep shows when the medicine was handed over and how much of each line', async () => {
            expect(prescription.dispensed_at).toBeNull();
            await hand(prescription.id, ['10', '4']);
            const [shown] = await sent();
            expect(shown?.dispensed_at).toBe('2026-11-13T03:20:00.000000Z');
            expect(shown?.dispensing_number).toBe('U1-FAR-00000001');
            expect(shown?.lines.map((line) => line.dispensed_quantity)).toEqual(
                ['10 TAB', '4 TAB'],
            );
        });

        test('the same event delivered twice is recorded once, and an unknown prescription is skipped', async () => {
            const envelope = await hand(prescription.id, ['10', '4']);
            const [before] = await pool.unsafe<{ version: number }[]>(
                'select version from sim_tr_resep where id = $1',
                [prescription.id],
            );
            const connection = await pool.reserve();
            try {
                const db = new Database(
                    connection,
                    undefined,
                    Bun.randomUUIDv7(),
                );
                await db.transaction(() => receiveDispensing(db, envelope));
            } finally {
                connection.release();
            }
            const [after] = await pool.unsafe<{ version: number }[]>(
                'select version from sim_tr_resep where id = $1',
                [prescription.id],
            );
            expect(after?.version).toBe(before?.version);
            const unknown = await hand(Bun.randomUUIDv7(), ['1', '1']);
            const [processed] = await pool.unsafe<{ found: number }[]>(
                'select count(*)::int as found from sim_processed_events where event_id = $1',
                [unknown.id],
            );
            expect(processed?.found).toBe(0);
        });

        test('a return shows what the patient kept, and Batal retur brings it back', async () => {
            await hand(prescription.id, ['10', '4']);
            const returnId = Bun.randomUUIDv7();
            await giveBack(posted, prescription.id, returnId, '3', '3');
            expect(await lines()).toEqual([
                ['7 TAB', '3 TAB'],
                ['4 TAB', null],
            ]);
            expect(await storedReturns()).toEqual(['3', null]);
            await giveBack(reversed, prescription.id, returnId, '3', '0');
            expect(await lines()).toEqual([
                ['10 TAB', '0 TAB'],
                ['4 TAB', null],
            ]);
            expect(await storedReturns()).toEqual(['0', null]);
        });

        test('a return delivered again after a later one is recorded once and does not roll it back', async () => {
            const first = await giveBack(
                posted,
                prescription.id,
                Bun.randomUUIDv7(),
                '2',
                '2',
            );
            await giveBack(
                posted,
                prescription.id,
                Bun.randomUUIDv7(),
                '3',
                '5',
            );
            const connection = await pool.reserve();
            try {
                const db = new Database(
                    connection,
                    undefined,
                    Bun.randomUUIDv7(),
                );
                await db.transaction(() => receiveReturn(db, first));
            } finally {
                connection.release();
            }
            expect(await storedReturns()).toEqual(['5', null]);
            expect(await lines()).toEqual([
                ['5 TAB', '5 TAB'],
                ['4 TAB', null],
            ]);
            const [processed] = await pool.unsafe<{ found: number }[]>(
                'select count(*)::int as found from sim_processed_events where event_id = $1',
                [first.id],
            );
            expect(processed?.found).toBe(1);
        });

        test('a return for a prescription not known as handed over is skipped without failing the pharmacy', async () => {
            const unknown = await giveBack(
                posted,
                Bun.randomUUIDv7(),
                Bun.randomUUIDv7(),
                '1',
                '1',
            );
            const [processed] = await pool.unsafe<{ found: number }[]>(
                'select count(*)::int as found from sim_processed_events where event_id = $1',
                [unknown.id],
            );
            expect(processed?.found).toBe(0);
            expect(await storedReturns()).toEqual(['5', null]);
        });

        test('a return recorded in another unit is subtracted in the base unit', async () => {
            await giveBack(
                posted,
                prescription.id,
                Bun.randomUUIDv7(),
                '5',
                '10',
                { code: 'STRIP', name: 'Strip isi 5', quantity: '1' },
            );
            expect(await storedReturns()).toEqual(['10', null]);
            expect(await lines()).toEqual([
                ['0 TAB', '10 TAB'],
                ['4 TAB', null],
            ]);
        });
    },
);
