import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
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
                        lines: [
                            {
                                compound: null,
                                drug_name: 'Parasetamol 500 mg',
                                unit_name: 'Tablet',
                                quantity: 10,
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
});
