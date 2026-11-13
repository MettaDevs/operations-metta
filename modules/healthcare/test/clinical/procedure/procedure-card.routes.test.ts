import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { operationsTestApp } from '../../../../../test/support/operations-app.ts';
import {
    createTenant,
    entitle,
    recordInstallation,
} from '../../../../../test/support/tenant-fixtures.ts';
import {
    api,
    createClinic,
    json,
    login,
    refused,
    type Clinic,
} from '../../support/examination-fixture.ts';

type Procedure = {
    id: string;
    code: string;
    international_name: string | null;
    icd9cm_code: string | null;
    category_id: string | null;
    category_name: string | null;
    benefit_limit_category_id: string | null;
    benefit_limit_category_name: string | null;
    supporting_device_id: string | null;
    supporting_device_name: string | null;
    hospital_cost_percent: string;
    hospital_cost_amount: string;
    posting_group: string;
    incentive_source: string;
    polyclinic: string;
    varies_by_cito: boolean;
    requires_doctor: boolean;
    sections: { id: string; name: string }[];
    version: number;
};

// Isian kartu Jasa sistem lama di tindakan: nama internasional, kategori milik kelompoknya, kategori plafon, alat, Cost
// RS, tiga pilihan tetap, centang status, dan section yang menawarkan tindakan. Pilihan Biaya Tindakan pemeriksaan
// memakai `section` untuk menampilkan tindakan section itu saja, dan tanpa `section` (Tampil semua) menampilkan semuanya.
describe.skipIf(!process.env.DB_HOST)('procedure card fields', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let clinic: Clinic;
    let groups: { medical: string; lab: string };
    let categories: { action: string; hematology: string };

    const created = async <T = { id: string }>(
        path: string,
        body: Record<string, unknown>,
    ) =>
        (await json<{ data: T }>(await clinic.admin.post(path, body), 201))
            .data;
    const codes = async (query: string) =>
        (
            await json<{ data: Procedure[] }>(
                await clinic.admin.get(`${api}/procedures?${query}`),
                200,
            )
        ).data
            .map((row) => row.code)
            .sort();

    beforeAll(async () => {
        clinic = await createClinic(pool, browser, 'Klinik Uji Kartu Jasa');
        const group = async (code: string) =>
            (
                await created(`${api}/procedure-groups`, {
                    code,
                    name: code,
                })
            ).id;
        groups = { medical: await group('TM'), lab: await group('LAB') };
        categories = {
            action: (
                await created(`${api}/procedure-categories`, {
                    group_id: groups.medical,
                    code: 'KB046',
                    name: 'Tindakan',
                })
            ).id,
            hematology: (
                await created(`${api}/procedure-categories`, {
                    group_id: groups.lab,
                    code: 'HEM',
                    name: 'Hematologi',
                })
            ).id,
        };
    }, 120_000);

    test('a procedure without the legacy header fields gets the values every Kuta service holds', async () => {
        const procedure = await created<Procedure>(`${api}/procedures`, {
            code: 'J-BAWAAN',
            name: 'Bawaan',
        });
        expect(procedure).toMatchObject({
            hospital_cost_percent: '0',
            hospital_cost_amount: '0',
            posting_group: 'GROUP JASA',
            incentive_source: 'NONE',
            polyclinic: 'NONE',
            varies_by_cito: false,
            requires_doctor: false,
            sections: [],
        });
    });

    test('the legacy header fields are saved as typed and read back', async () => {
        const procedure = await created<Procedure>(`${api}/procedures`, {
            code: 'J-LENGKAP',
            name: 'Jahit luka',
            international_name: 'Wound suturing',
            group_id: groups.medical,
            category_id: categories.action,
            hospital_cost_percent: '12.5',
            hospital_cost_amount: '25000',
            posting_group: 'KOMPONEN',
            incentive_source: 'DETAIL',
            polyclinic: 'SPESIALIS',
            varies_by_cito: true,
            requires_doctor: true,
        });
        expect(procedure).toMatchObject({
            international_name: 'Wound suturing',
            category_name: 'Tindakan',
            hospital_cost_percent: '12.5',
            hospital_cost_amount: '25000',
            posting_group: 'KOMPONEN',
            incentive_source: 'DETAIL',
            polyclinic: 'SPESIALIS',
            varies_by_cito: true,
            requires_doctor: true,
        });
        const [row] = await pool.unsafe<
            { cyto: boolean; dokter: boolean; posting: string }[]
        >(
            'select variabel_cyto as cyto, harus_dengan_dokter as dokter, kelompok_posting as posting from sim_m_tindakan where id = $1',
            [procedure.id],
        );
        expect(row).toEqual({ cyto: true, dokter: true, posting: 'KOMPONEN' });
    });

    test('the ICD-9-CM code is saved trimmed, read back, cleared, and refused unless it has the volume 3 shape', async () => {
        const procedure = await created<Procedure>(`${api}/procedures`, {
            code: 'ICD-1',
            name: 'Nebulisasi',
            icd9cm_code: ' 93.94 ',
        });
        expect(procedure.icd9cm_code).toBe('93.94');
        const change = async (current: Procedure, icd9cm_code: unknown) =>
            (
                await json<{ data: Procedure }>(
                    await clinic.admin.patch(
                        `${api}/procedures/${current.id}`,
                        {
                            code: 'ICD-1',
                            name: 'Nebulisasi',
                            icd9cm_code,
                            version: current.version,
                        },
                    ),
                    200,
                )
            ).data;
        const shortened = await change(procedure, '89.7');
        expect(shortened.icd9cm_code).toBe('89.7');
        const cleared = await change(shortened, null);
        expect(cleared.icd9cm_code).toBeNull();
        const [stored] = await pool.unsafe<{ kode_icd9cm: string | null }[]>(
            'select kode_icd9cm from sim_m_tindakan where id = $1',
            [procedure.id],
        );
        expect(stored).toEqual({ kode_icd9cm: null });
        for (const icd9cm_code of ['8', '89.', '89.123', '8970', 'A9.7'])
            expect(
                await refused(
                    await clinic.admin.post(`${api}/procedures`, {
                        code: 'ICD-SALAH',
                        name: 'Salah',
                        icd9cm_code,
                    }),
                ),
            ).toEqual({
                icd9cm_code: ['Isi kode ICD-9-CM seperti 89.7 atau 96.04.'],
            });
    });

    test('a category of another group, an unknown option code, and a negative cost are refused per field', async () => {
        const errors = await refused(
            await clinic.admin.post(`${api}/procedures`, {
                code: 'J-SALAH',
                name: 'Salah',
                group_id: groups.medical,
                category_id: categories.hematology,
                posting_group: 'GROUP',
                hospital_cost_amount: '-1',
            }),
        );
        expect(Object.keys(errors).sort()).toEqual([
            'category_id',
            'hospital_cost_amount',
            'posting_group',
        ]);
    });

    test('Cost RS takes the one percent scale and the amount precision of the currency', async () => {
        expect(
            await refused(
                await clinic.admin.post(`${api}/procedures`, {
                    code: 'COSTRS-1',
                    name: 'Presisi',
                    hospital_cost_percent: '12.12345',
                    hospital_cost_amount: '25000.5',
                }),
            ),
        ).toEqual({
            hospital_cost_percent: [
                'Isi persen 0 sampai 999,9999, paling banyak empat angka di belakang koma.',
            ],
            hospital_cost_amount: [
                'Isi angka 0 atau lebih, tanpa angka di belakang koma.',
            ],
        });
        const procedure = await created<Procedure>(`${api}/procedures`, {
            code: 'COSTRS-1',
            name: 'Presisi',
            hospital_cost_percent: '150.1234',
            hospital_cost_amount: '25000',
        });
        expect([
            procedure.hospital_cost_percent,
            procedure.hospital_cost_amount,
        ]).toEqual(['150.1234', '25000']);
    });

    test('Kategori Plafon and Menggunakan Alat are saved and read back, and an inactive or foreign row is refused per field', async () => {
        const entry = async (list: string, code: string) =>
            created<{ id: string; version: number }>(
                `${api}/diagnosis-references/${list}`,
                { code, name: `Nama ${code}` },
            );
        const outpatient = await entry('benefit-limit-categories', 'RJ');
        const nebulizer = await entry('supporting-devices', 'NEB');
        const procedure = await created<Procedure>(`${api}/procedures`, {
            code: 'J-NEBU',
            name: 'Nebulisasi',
            benefit_limit_category_id: outpatient.id,
            supporting_device_id: nebulizer.id,
        });
        expect(procedure).toMatchObject({
            benefit_limit_category_id: outpatient.id,
            benefit_limit_category_name: 'Nama RJ',
            supporting_device_id: nebulizer.id,
            supporting_device_name: 'Nama NEB',
        });
        const [row] = await pool.unsafe<
            { plafon: string | null; alat: string | null }[]
        >(
            'select kategori_plafon_id as plafon, alat_penunjang_id as alat from sim_m_tindakan where id = $1',
            [procedure.id],
        );
        expect(row).toEqual({ plafon: outpatient.id, alat: nebulizer.id });

        // Kategori plafon nonaktif tetap boleh dipegang tindakan yang sudah memakainya, tetapi tidak dipilih tindakan lain.
        await json(
            await clinic.admin.patch(
                `${api}/diagnosis-references/benefit-limit-categories/${outpatient.id}`,
                {
                    code: 'RJ',
                    name: 'Nama RJ',
                    is_active: false,
                    version: outpatient.version,
                },
            ),
            200,
        );
        await json(
            await clinic.admin.patch(`${api}/procedures/${procedure.id}`, {
                code: 'J-NEBU',
                name: 'Nebulisasi diulang',
                benefit_limit_category_id: outpatient.id,
                supporting_device_id: nebulizer.id,
                version: procedure.version,
            }),
            200,
        );
        const other = await createTenant(pool, 'Klinik Kartu Jasa Lain');
        await entitle(pool, other, 'healthcare');
        await recordInstallation(pool, other, 'healthcare');
        const stranger = await login(pool, browser, other, [
            'healthcare.clinical-setup.manage',
        ]);
        const foreignDevice = (
            await json<{ data: { id: string } }>(
                await stranger.post(
                    `${api}/diagnosis-references/supporting-devices`,
                    { code: 'EKG', name: 'EKG' },
                ),
                201,
            )
        ).data.id;
        expect(
            await refused(
                await clinic.admin.post(`${api}/procedures`, {
                    code: 'J-NEBU2',
                    name: 'Nebulisasi lain',
                    benefit_limit_category_id: outpatient.id,
                    supporting_device_id: foreignDevice,
                }),
            ),
        ).toEqual({
            benefit_limit_category_id: ['Pilih dari daftar.'],
            supporting_device_id: ['Pilih dari daftar.'],
        });
    }, 30_000);

    test('the examination lookup shows only the procedures of its section, and all of them when the section is left out', async () => {
        const offered = await created<Procedure>(`${api}/procedures`, {
            code: 'J-UMUM',
            name: 'Konsultasi umum',
            section_ids: [clinic.general],
        });
        await created(`${api}/procedures`, {
            code: 'J-GIGI',
            name: 'Cabut gigi',
            section_ids: [clinic.dental],
        });
        expect(await codes(`section=${clinic.general}&q=J-`)).toEqual([
            'J-UMUM',
        ]);
        expect(await codes(`section=${clinic.dental}&q=J-`)).toEqual([
            'J-GIGI',
        ]);
        expect(await codes('q=J-')).toEqual([
            'J-BAWAAN',
            'J-GIGI',
            'J-LENGKAP',
            'J-NEBU',
            'J-UMUM',
        ]);
        await json(
            await clinic.admin.patch(`${api}/procedures/${offered.id}`, {
                code: 'J-UMUM',
                name: 'Konsultasi umum',
                section_ids: [clinic.dental],
                version: offered.version,
            }),
            200,
        );
        expect(await codes(`section=${clinic.general}&q=J-`)).toEqual([]);
        const links = await pool.unsafe<
            { section_id: string; live: boolean }[]
        >(
            `select section_id, deleted_at is null as live from sim_m_tindakan_section
             where tindakan_id = $1 order by created_at, live`,
            [offered.id],
        );
        expect([...links]).toEqual([
            { section_id: clinic.general, live: false },
            { section_id: clinic.dental, live: true },
        ]);
    });

    test('a section of another unit is offered, but an unknown section is refused', async () => {
        const procedure = await created<Procedure>(`${api}/procedures`, {
            code: 'J-PUSTU',
            name: 'Tindakan pustu',
            section_ids: [clinic.otherSection],
        });
        expect(procedure.sections.map((section) => section.id)).toEqual([
            clinic.otherSection,
        ]);
        const errors = await refused(
            await clinic.admin.post(`${api}/procedures`, {
                code: 'J-ASING',
                name: 'Asing',
                section_ids: [Bun.randomUUIDv7()],
            }),
        );
        expect(Object.keys(errors)).toEqual(['section_ids']);
    });
});
