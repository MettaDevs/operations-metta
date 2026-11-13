import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    Database,
    type JsonObject,
} from '../../../../../src/platform/database/index.ts';
import { publishEvent } from '../../../../../src/platform/events/index.ts';
import {
    eventContract,
    outboxEnvelopes,
} from '../../../../../test/support/event-contracts.ts';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    api,
    createClinic,
    json,
    login,
    type Clinic,
} from '../../support/examination-fixture.ts';

type Reference = { id: string; code: string };
type HistoryRow = {
    id: string;
    date: string;
    section_name: string;
    examination_number: string;
    doctor_name: string | null;
    diagnoses: string | null;
};

// CPPT halaman pemeriksaan: S/O/A/P disusun dari rekam medis terstruktur seperti collection_history_cppt sistem lama,
// dan Riwayat kunjungan pasien dengan batas yang sama dengan Riwayat diagnosa. Butuh PostgreSQL yang sudah dimigrasi;
// dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('examination CPPT', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let clinic: Clinic;
    let current: string;
    let earlier: string;
    let elsewhere: string;

    const cppt = (id: string, as = clinic.admin) =>
        as.get(`${api}/examination/destinations/${id}/cppt`);
    const history = (id: string, as = clinic.admin) =>
        as.get(
            `${api}/examination/destinations/${id}/visit-history?per_page=100`,
        );

    beforeAll(async () => {
        clinic = await createClinic(pool, browser, 'Klinik Uji CPPT');
        const created = async (path: string, body: Record<string, unknown>) =>
            (
                await json<{ data: { id: string } }>(
                    await clinic.admin.post(path, body),
                    201,
                )
            ).data.id;
        const icd = await created(`${api}/icd10`, {
            code: 'J06.9',
            name: 'Infeksi saluran napas atas akut',
        });
        const procedure = await created(`${api}/procedures`, {
            code: 'T01',
            name: 'Nebulisasi',
        });
        const drug = await created(`${api}/drugs`, {
            code: 'PCT500',
            name: 'Parasetamol 500 mg',
            base_unit_id: clinic.unitTab,
            dosage_form_id: null,
            is_prescribable: true,
        });
        const metadata = await json<{
            diagnosis_types: Reference[];
            diagnosis_cases: Reference[];
            usage_instructions: Reference[];
        }>(
            await clinic.admin.get(
                `${api}/examination/medical-record/metadata`,
            ),
            200,
        );

        // Kunjungan sebelumnya di unit lain, lalu kunjungan sebelumnya di unit yang sama, lalu kunjungan sekarang.
        elsewhere = (await clinic.visit(clinic.otherSection)).destinationId;
        await json(
            await clinic.start(elsewhere, clinic.admin, clinic.otherRoom),
            200,
        );
        await json(await clinic.save(elsewhere, {}), 200);
        earlier = (await clinic.visit()).destinationId;
        await json(await clinic.start(earlier), 200);
        await json(
            await clinic.save(earlier, {
                diagnoses: [
                    {
                        icd10_id: icd,
                        type_id: metadata.diagnosis_types[0]!.id,
                        case_id: metadata.diagnosis_cases[0]!.id,
                        doctor_id: clinic.doctor,
                        nurse_id: null,
                    },
                ],
            }),
            200,
        );
        await json(await clinic.examineBy(earlier), 200);
        await json(await clinic.finish(earlier), 200);

        current = (await clinic.visit()).destinationId;
        await json(await clinic.start(current), 200);
        const record = (await clinic.show(current)).data;
        const opened = (panel: string) =>
            record[panel] as Record<string, unknown>;
        await json(
            await clinic.save(current, {
                anamnesis: {
                    ...opened('anamnesis'),
                    doctor_id: clinic.doctor,
                    nurse_id: clinic.nurse,
                    chief_complaint: 'Demam tiga hari',
                    additional_complaint: 'Batuk',
                },
                history: {
                    ...opened('history'),
                    none: false,
                    present: 'Demam naik turun',
                    past: 'Asma',
                    family: null,
                },
                pain: { ...opened('pain'), has_pain: true, scale: 4 },
                fall_risk: { unsteady_gait: true, uses_support: false },
                other: {
                    ...opened('other'),
                    drug_therapy: 'Antipiretik',
                    non_drug_therapy: 'Kompres hangat',
                },
                diagnoses: [
                    {
                        icd10_id: icd,
                        type_id: metadata.diagnosis_types[0]!.id,
                        case_id: metadata.diagnosis_cases[1]!.id,
                        doctor_id: clinic.doctor,
                        nurse_id: clinic.nurse,
                    },
                ],
                procedures: [
                    {
                        procedure_id: procedure,
                        quantity: 2,
                        doctor_id: clinic.doctor,
                    },
                ],
                prescriptions: [
                    {
                        id: null,
                        notes: null,
                        lines: [
                            {
                                drug_id: drug,
                                compound: null,
                                quantity: 10,
                                signa: '3x1',
                                usage_instruction_id:
                                    metadata.usage_instructions[1]!.id,
                                ...clinic.dosage,
                                notes: null,
                            },
                        ],
                    },
                ],
            }),
            200,
        );
    }, 180_000);

    test('S/O/A/P are assembled from the structured record', async () => {
        const { data } = await json<{ data: Record<string, unknown> }>(
            await cppt(current),
            200,
        );
        expect(data).toMatchObject({
            destination_id: current,
            section_name: 'Poli Umum',
            date: clinic.today,
            status: 'diperiksa',
            doctor_name: 'Dokter Umum',
            nurse_name: 'Perawat Jaga',
            subjective: {
                chief_complaint: 'Demam tiga hari',
                additional_complaint: 'Batuk',
                history_none: false,
                present_history: 'Demam naik turun',
                past_history: 'Asma',
                family_history: null,
            },
            objective: {
                consciousness: 'COMPOS MENTIS',
                systolic: 120,
                diastolic: 80,
                height: 158,
                weight: 52,
                waist_circumference: 71,
                pulse_rate: 88,
                respiratory_rate: 20,
                pain_scale: 4,
                unsteady_gait: true,
                uses_support: false,
                dental: null,
            },
            assessment: [
                {
                    icd10_code: 'J06.9',
                    icd10_name: 'Infeksi saluran napas atas akut',
                    type_name: 'Primer',
                    case_name: 'Lama',
                },
            ],
            plan: {
                drug_therapy: 'Antipiretik',
                non_drug_therapy: 'Kompres hangat',
                procedures: [{ name: 'Nebulisasi', quantity: 2 }],
                prescriptions: [
                    {
                        number: null,
                        status: 'draf',
                        handed_over: false,
                        lines: [
                            {
                                compound: null,
                                drug_name: 'Parasetamol 500 mg',
                                quantity: '10 TAB',
                                signa: '3x1',
                                usage_instruction: 'Setelah Makan',
                            },
                        ],
                    },
                ],
            },
        });
    });

    test('a visit that has not been examined has an empty CPPT', async () => {
        const { destinationId } = await clinic.visit(clinic.lab);
        const { data } = await json<{
            data: {
                subjective: { chief_complaint: string | null };
                assessment: unknown[];
                plan: { prescriptions: unknown[] };
            };
        }>(await cppt(destinationId), 200);
        expect(data.subjective.chief_complaint).toBeNull();
        expect(data.assessment).toEqual([]);
        expect(data.plan.prescriptions).toEqual([]);
    });

    test('Riwayat kunjungan lists the other examinations the user may see, newest first', async () => {
        const all = await json<{ data: HistoryRow[] }>(
            await history(current),
            200,
        );
        expect(all.data.map((row) => row.id).sort()).toEqual(
            [earlier, elsewhere].sort(),
        );
        expect(all.data.find((row) => row.id === earlier)).toMatchObject({
            section_name: 'Poli Umum',
            date: clinic.today,
            diagnoses: 'J06.9',
        });

        const onlyMain = await login(
            pool,
            browser,
            clinic.tenantId,
            ['healthcare.examination.inquire'],
            { legalEntityId: clinic.legalEntityId, unitId: clinic.unit },
        );
        const seen = await json<{ data: HistoryRow[] }>(
            await history(current, onlyMain),
            200,
        );
        expect(seen.data.map((row) => row.id)).toEqual([earlier]);
        expect((await cppt(elsewhere, onlyMain)).status).toBe(404);
        expect((await cppt(earlier, onlyMain)).status).toBe(200);
    });

    test('another tenant and a user without examination access cannot read it', async () => {
        const other = await createClinic(pool, browser, 'Klinik Uji CPPT Lain');
        expect((await cppt(current, other.admin)).status).toBe(404);
        expect((await history(current, other.admin)).status).toBe(404);
        const outsider = await login(pool, browser, clinic.tenantId, []);
        expect((await cppt(current, outsider)).status).toBe(403);
        expect((await history(current, outsider)).status).toBe(403);
    });

    test('P writes the prescription until the pharmacy hands it over, then what the patient kept, in the written unit when it comes out whole', async () => {
        const stockKeeper = await login(pool, browser, clinic.tenantId, [
            'core.inventory-item.manage',
        ]);
        const strip = (
            await json<{ data: { id: string } }>(
                await clinic.admin.post('/api/v1/inventory/units-of-measure', {
                    code: 'STRIP',
                    name: 'Strip',
                }),
                201,
            )
        ).data.id;
        const drug = async (code: string) =>
            (
                await json<{
                    data: {
                        id: string;
                        code: string;
                        name: string;
                        version: number;
                    };
                }>(
                    await clinic.admin.post(`${api}/drugs`, {
                        code,
                        name: `Obat ${code}`,
                        base_unit_id: clinic.unitTab,
                        dosage_form_id: null,
                        is_prescribable: true,
                    }),
                    201,
                )
            ).data;
        const antacid = await drug('ANT');
        await json(
            await stockKeeper.post('/api/v1/inventory/item-units', {
                item_id: antacid.id,
                unit_id: strip,
                quantity_per_unit: 10,
            }),
            201,
        );
        await json(
            await stockKeeper.patch(`/api/v1/inventory/items/${antacid.id}`, {
                code: antacid.code,
                name: antacid.name,
                base_unit_id: clinic.unitTab,
                category_id: null,
                version: antacid.version,
                sales_unit_id: strip,
            }),
            200,
        );
        const kept = await drug('SIMPAN');
        const back = await drug('KEMBALI');
        const { destinationId } = await clinic.visit();
        await json(await clinic.start(destinationId), 200);
        const line = (drugId: string, quantity: number) => ({
            drug_id: drugId,
            compound: null,
            quantity,
            signa: '3x1',
            usage_instruction_id: null,
            ...clinic.dosage,
            notes: null,
        });
        await json(
            await clinic.save(destinationId, {
                prescriptions: [
                    {
                        id: null,
                        notes: null,
                        lines: [
                            line(antacid.id, 2),
                            line(kept.id, 10),
                            line(back.id, 5),
                        ],
                    },
                ],
            }),
            200,
        );
        type Plan = {
            status: string;
            handed_over: boolean;
            lines: { drug_name: string | null; quantity: string | null }[];
        }[];
        const plan = async () =>
            (
                await json<{ data: { plan: { prescriptions: Plan } } }>(
                    await cppt(destinationId),
                    200,
                )
            ).data.plan.prescriptions;
        const eResep = async () =>
            (
                (await clinic.show(destinationId)).data.prescriptions as {
                    lines: {
                        dispensed_quantity: string | null;
                        returned_quantity: string | null;
                    }[];
                }[]
            )[0]?.lines.map((row) => [
                row.dispensed_quantity,
                row.returned_quantity,
            ]);
        const written = [
            { drug_name: 'Obat ANT', quantity: '2 STRIP' },
            { drug_name: 'Obat SIMPAN', quantity: '10 TAB' },
            { drug_name: 'Obat KEMBALI', quantity: '5 TAB' },
        ];
        expect(await plan()).toMatchObject([
            { status: 'draf', handed_over: false, lines: written },
        ]);
        const record = await clinic.show(destinationId);
        await json(
            await clinic.admin.post(
                `${api}/examination/destinations/${destinationId}/prescriptions/send`,
                {
                    version: record.data.version,
                    prescriptions: record.data.prescriptions,
                },
            ),
            200,
        );
        expect(await plan()).toMatchObject([
            { status: 'dikirim', handed_over: false, lines: written },
        ]);

        const [sent] = await pool.unsafe<{ id: string; number: string }[]>(
            `select r.id, r.nomor as number from sim_tr_resep r
             join sim_tr_pemeriksaan p on p.id = r.pemeriksaan_id
             where p.tujuan_id = $1 and r.deleted_at is null`,
            [destinationId],
        );
        const lineIds = (
            await pool.unsafe<{ id: string }[]>(
                'select id from sim_tr_resep_detail where resep_id = $1 and deleted_at is null order by urutan',
                [sent?.id ?? ''],
            )
        ).map((row) => row.id);
        const tablet = { id: clinic.unitTab, code: 'TAB', name: 'Tablet' };
        const inStrips = { id: strip, code: 'STRIP', name: 'Strip' };
        const publish = async (
            type:
                | 'pharmacy.prescription.dispensed.v1'
                | 'pharmacy.return.posted.v1',
            data: JsonObject,
        ) => {
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
            } finally {
                connection.release();
            }
        };
        const header = {
            dispensing_id: Bun.randomUUIDv7(),
            dispensing_number: 'U1-FAR-00000009',
            prescription_id: sent?.id ?? '',
            prescription_number: sent?.number ?? '',
            location: {
                id: Bun.randomUUIDv7(),
                code: 'FARMASI',
                name: 'Farmasi',
            },
        };
        const item = (drugId: string) => ({
            id: drugId,
            code: 'X',
            name: 'Obat',
        });
        await publish('pharmacy.prescription.dispensed.v1', {
            ...header,
            dispensed_at: '2026-11-13T05:00:00Z',
            pharmacist: null,
            assistant: null,
            lines: [
                [antacid.id, inStrips, '2', '10', '20'] as const,
                [kept.id, tablet, '10', '1', '10'] as const,
                [back.id, tablet, '5', '1', '5'] as const,
            ].map(([drugId, unit, quantity, isi, base], index) => ({
                prescription_line_id: lineIds[index] ?? '',
                item: item(drugId),
                unit,
                quantity_per_unit: isi,
                base_unit: tablet,
                base_quantity: base,
                prescribed_unit: unit,
                prescribed_quantity: quantity,
                quantity,
                reason: null,
                batches: [],
            })),
        });
        expect(await plan()).toMatchObject([
            { status: 'dikirim', handed_over: true, lines: written },
        ]);
        expect(await eResep()).toEqual([
            ['2 STRIP', null],
            ['10 TAB', null],
            ['5 TAB', null],
        ]);

        await publish('pharmacy.return.posted.v1', {
            ...header,
            return_id: Bun.randomUUIDv7(),
            return_number: 'U1-RTF-00000001',
            return_date: '2026-11-13',
            reason: 'Pasien sembuh',
            posted_at: '2026-11-13T06:00:00Z',
            lines: [
                { at: 0, drugId: antacid.id },
                { at: 2, drugId: back.id },
            ].map(({ at, drugId }) => ({
                prescription_line_id: lineIds[at] ?? '',
                item: item(drugId),
                unit: tablet,
                quantity: '5',
                base_unit: tablet,
                base_quantity: '5',
                returned_base_quantity: '5',
                batches: [
                    { batch_number: null, expiry_date: null, quantity: '5' },
                ],
            })),
        });
        expect(await plan()).toMatchObject([
            {
                status: 'dikirim',
                handed_over: true,
                lines: [
                    { drug_name: 'Obat ANT', quantity: '15 TAB' },
                    { drug_name: 'Obat SIMPAN', quantity: '10 TAB' },
                ],
            },
        ]);
        expect(await eResep()).toEqual([
            ['15 TAB', '5 TAB'],
            ['10 TAB', null],
            ['0 TAB', '5 TAB'],
        ]);
    });
    test('a visit whose destinations are all finished reaches the cashier list in the shape of its contract', async () => {
        const [visit] = await pool.unsafe<{ id: string }[]>(
            'select registrasi_id as id from sim_tr_registrasi_tujuan where id = $1',
            [earlier],
        );
        const contract = await eventContract('healthcare.visit.completed.v1');
        const sent = (
            await outboxEnvelopes(
                pool,
                clinic.tenantId,
                'healthcare.visit.completed.v1',
            )
        ).filter((envelope) => envelope.data.visit_id === visit?.id);
        expect(sent).toHaveLength(1);
        expect(contract.safeParse(sent[0]).error).toBeUndefined();
        const [cashier] = await pool.unsafe<
            { status: string; pasien_nrm: string }[]
        >(
            'select status, pasien_nrm from kunjungan_kasir where tenant_id = $1 and kunjungan_id = $2',
            [clinic.tenantId, visit!.id],
        );
        expect(cashier?.status).toBe('selesai');
        expect(cashier?.pasien_nrm).toBe(
            (sent[0]?.data.patient as { medical_record_number: string })
                .medical_record_number,
        );
    });
});
