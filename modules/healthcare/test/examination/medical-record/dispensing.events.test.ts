import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from '../../../../../src/platform/database/index.ts';
import { publishEvent } from '../../../../../src/platform/events/index.ts';
import { eventContract } from '../../../../../test/support/event-contracts.ts';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import { receiveDispensing } from '../../../src/examination/medical-record/dispensing.events.ts';
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
    lines: { drug_id: string | null; dispensed_quantity?: number | null }[];
};

const dispensed = 'pharmacy.prescription.dispensed.v1';

// E-Resep menampilkan obat yang sudah diserahkan farmasi, dari pharmacy.prescription.dispensed.v1 yang diterbitkan
// sesuai kontraknya: waktu, nomor penyerahan, dan jumlah per baris. Event yang diantar dua kali dicatat sekali, dan
// resep yang tidak dikenal dilewati tanpa membatalkan penyerahan. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila
// DB_HOST kosong.
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
            const connection = await pool.reserve();
            try {
                const db = new Database(
                    connection,
                    undefined,
                    Bun.randomUUIDv7(),
                );
                const envelope = await db.transaction(() =>
                    publishEvent(db, {
                        type: dispensed,
                        tenantId: clinic.tenantId,
                        legalEntityId: clinic.legalEntityId,
                        orgUnitId: clinic.unit,
                        data,
                    }),
                );
                (await eventContract(dispensed)).parse(envelope);
                return envelope;
            } finally {
                connection.release();
            }
        }

        test('the E-Resep shows when the medicine was handed over and how much of each line', async () => {
            expect(prescription.dispensed_at).toBeNull();
            await hand(prescription.id, ['10', '4']);
            const [shown] = await sent();
            expect(shown?.dispensed_at).toBe('2026-11-13T03:20:00.000000Z');
            expect(shown?.dispensing_number).toBe('U1-FAR-00000001');
            expect(shown?.lines.map((line) => line.dispensed_quantity)).toEqual(
                [10, 4],
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
    },
);
