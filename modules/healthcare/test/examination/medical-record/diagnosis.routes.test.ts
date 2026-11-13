import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    createTenant,
    entitle,
    grantAllOrganizations,
    recordInstallation,
} from '../../../../../test/support/tenant-fixtures.ts';

type Diagnosis = {
    icd10_id: string | null;
    icd10_code?: string | null;
    icd10_name?: string | null;
    type_id: string | null;
    case_id: string | null;
    doctor_id: string | null;
    nurse_id: string | null;
};
type Record_ = {
    version: number | null;
    physical: Record<string, number | string | null>;
    diagnoses: Diagnosis[];
    prognosis_id: string | null;
    chronic_disease_ids: string[];
} & Record<string, unknown>;
type Shown = { data: Record_; context: { editable: boolean } };
type Reference = { id: string; code: string; name: string; active: boolean };
type Metadata = {
    diagnosis_types: Reference[];
    diagnosis_cases: Reference[];
    prognoses: Reference[];
    chronic_diseases: Reference[];
    permissions: { manage: boolean; create_icd10: boolean };
};
type Icd10 = {
    id: string;
    code: string;
    name: string;
    is_active: boolean;
    version: number;
};
type History = {
    date: string;
    icd10_code: string;
    type_name: string;
    case_name: string;
    doctor_name: string | null;
};

const api = '/api/modules/healthcare/v1';
const incomplete = 'Field Kasus dan Jenis pada diagnosa harus di isi';
const vitals = {
    pulse_rate: 88,
    respiratory_rate: 20,
    consciousness: 'COMPOS MENTIS',
    systolic: 120,
    diastolic: 80,
    height: 158,
    weight: 52,
    waist_circumference: 71,
};

// Panel Diagnosa halaman pemeriksaan: data acuan per tenant dari sistem lama, ICD-10 yang dimulai kosong dan ditambah
// dari baris diagnosa, pesan jenis dan kasus sistem lama, baris diubah di tempat dan dihapus lunak, prognosa dan
// penyakit kronis, riwayat diagnosa menurut unit kerja, batas ubah, batas tenant, dan izin. Butuh PostgreSQL yang
// sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('examination diagnosis', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let tenantId: string;
    let company: string;
    let admin: Browser;
    let umum: string;
    let patientId: string;
    const units: Record<
        'a' | 'b',
        { unit: string; room: string; section: string }
    > = {
        a: { unit: '', room: '', section: '' },
        b: { unit: '', room: '', section: '' },
    };
    let doctor: string;
    let nurse: string;
    let metadata: Metadata;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function refused(response: Response) {
        return (await json<{ errors: Record<string, string[]> }>(response, 422))
            .errors;
    }

    async function created<T = { id: string }>(
        as: Browser,
        path: string,
        body: Record<string, unknown>,
    ) {
        return (await json<{ data: T }>(await as.post(path, body), 201)).data;
    }

    async function login(tenant: string, duties: string[], unit?: string) {
        const account = await createMember(pool, tenant, duties);
        await grantAllOrganizations(pool, tenant, account.membershipId);
        await pool.unsafe(
            `insert into role_assignment_data_policy_scopes
                 (id, tenant_id, role_assignment_id, policy_code, legal_entity_id, organization_id,
                  include_descendants, valid_from, created_at, updated_at)
             select $1, $2, id, 'healthcare.patient-unit', $3, $4, false, now() - interval '1 day', now(), now()
             from role_assignments where membership_id = $5`,
            [
                Bun.randomUUIDv7(),
                tenant,
                unit ? company : null,
                unit ?? null,
                account.membershipId,
            ],
        );
        const session = browser();
        await session.login(account.email, account.password);
        return session;
    }

    async function visit(at: 'a' | 'b' = 'a') {
        const registered = await json<{
            data: { destinations: { id: string }[] };
        }>(
            await admin.post(`${api}/visits`, {
                patient_id: patientId,
                patient_type_id: umum,
                visit_condition: 'sakit',
                section_id: units[at].section,
            }),
            201,
        );
        return registered.data.destinations[0]!.id;
    }

    async function start(id: string, at: 'a' | 'b' = 'a') {
        await json(
            await admin.post(`${api}/examination/destinations/${id}/start`, {
                room_id: units[at].room,
            }),
            200,
        );
    }

    const path = (id: string) =>
        `${api}/examination/destinations/${id}/medical-record`;

    async function show(as: Browser, id: string) {
        return json<Shown>(await as.get(path(id)), 200);
    }

    async function save(as: Browser, id: string, data: Partial<Record_>) {
        const current = await show(as, id);
        return as.put(path(id), {
            ...current.data,
            physical: { ...current.data.physical, ...vitals },
            ...data,
        });
    }

    async function icd10(code: string, name: string, as = admin) {
        return created<Icd10>(as, `${api}/icd10`, { code, name });
    }

    const code = (list: Reference[], value: string) =>
        list.find((row) => row.code === value)!.id;

    const line = (
        icd10Id: string,
        type: string | null = 'PRIMER',
        kind: string | null = 'BARU',
    ): Diagnosis => ({
        icd10_id: icd10Id,
        type_id: type ? code(metadata.diagnosis_types, type) : null,
        case_id: kind ? code(metadata.diagnosis_cases, kind) : null,
        doctor_id: doctor,
        nurse_id: nurse,
    });

    async function rows(recordId: string) {
        return pool.unsafe<
            { id: string; icd10_id: string; deleted_at: Date | null }[]
        >(
            `select id, icd10_id, deleted_at from sim_tr_pemeriksaan_diagnosa
             where pemeriksaan_id = $1 order by created_at, id`,
            [recordId],
        );
    }

    async function recordId(destination: string) {
        const [row] = await pool.unsafe<{ id: string }[]>(
            'select id from sim_tr_pemeriksaan where tujuan_id = $1 and deleted_at is null',
            [destination],
        );
        return row!.id;
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Diagnosa');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        admin = await login(tenantId, [
            'core.organization.manage',
            'healthcare.patient.manage',
            'healthcare.payment-setup.manage',
            'healthcare.service-setup.manage',
            'healthcare.practitioner.manage',
            'healthcare.visit.manage',
            'healthcare.examination.manage',
            'healthcare.clinical-setup.manage',
        ]);
        company = (
            await created(admin, '/api/v1/organizations', {
                classification: 'legal_entity',
                name: 'PT Klinik Uji Diagnosa',
                company_code: `KD${Date.now() % 100000}`,
                country_code: 'ID',
            })
        ).id;
        for (const key of ['a', 'b'] as const) {
            const unit = (
                await created(admin, '/api/v1/organizations', {
                    classification: 'operating_unit',
                    name: `Puskesmas Diagnosa ${key.toUpperCase()}`,
                    operating_unit_type: 'department',
                    operating_unit_number: `PD${key.toUpperCase()}`,
                })
            ).id;
            const room = (
                await created(admin, `${api}/rooms`, {
                    operating_unit_id: unit,
                    code: `RD${key.toUpperCase()}`,
                    name: `Ruang ${key.toUpperCase()}`,
                })
            ).id;
            const section = (
                await created(admin, `${api}/sections`, {
                    operating_unit_id: unit,
                    code: `UMUM-${key.toUpperCase()}`,
                    name: `Poli Umum ${key.toUpperCase()}`,
                    kind: 'rawat_jalan',
                    room_ids: [room],
                })
            ).id;
            units[key] = { unit, room, section };
        }
        umum = (
            await created(admin, `${api}/patient-types`, {
                code: 'UMUM',
                name: 'Umum',
            })
        ).id;
        patientId = (
            await created(admin, `${api}/patients`, {
                name: 'Pasien Diagnosa',
                nationality_country_code: 'AU',
                passport_number: `PD${Math.floor(Math.random() * 1e8)}`,
                gender: 'male',
                birth_date: '1979-05-06',
                phone: '081200000021',
                domicile_address: { street: 'Jl. Diagnosa No. 1' },
                payment_methods: [{ patient_type_id: umum }],
            })
        ).id;
        const professions = Object.fromEntries(
            (
                await pool.unsafe<{ kode: string; id: string }[]>(
                    'select kode, id from sim_m_profesi where tenant_id = $1 and deleted_at is null',
                    [tenantId],
                )
            ).map((row) => [row.kode, row.id]),
        );
        doctor = (
            await created(admin, `${api}/practitioners`, {
                name: 'Dokter Diagnosa',
                nik: String(Date.now()).slice(-12).padStart(16, '7'),
                gender: 'male',
                phone: '081200000022',
                profession_id: professions.dokter,
            })
        ).id;
        nurse = (
            await created(admin, `${api}/practitioners`, {
                name: 'Perawat Diagnosa',
                nik: String(Date.now() + 9)
                    .slice(-12)
                    .padStart(16, '8'),
                gender: 'female',
                phone: '081200000023',
                profession_id: professions.perawat,
            })
        ).id;
        metadata = await json<Metadata>(
            await admin.get(`${api}/examination/medical-record/metadata`),
            200,
        );
    }, 120_000);

    test('jenis, kasus, prognosa, and chronic diseases are seeded from the old system, and ICD-10 starts empty', async () => {
        const codes = (list: Reference[]) =>
            list.map((row) => [row.code, row.name]);
        expect(codes(metadata.diagnosis_types)).toEqual([
            ['PRIMER', 'Primer'],
            ['SEKUNDER', 'Sekunder'],
            ['KOMPLIKASI', 'Komplikasi'],
        ]);
        expect(codes(metadata.diagnosis_cases)).toEqual([
            ['BARU', 'Baru'],
            ['LAMA', 'Lama'],
        ]);
        expect(metadata.prognoses.map((row) => row.code)).toEqual([
            '01',
            '02',
            '03',
            '04',
            '05',
        ]);
        expect(metadata.prognoses[0]?.name).toBe('Sanam (Sembuh)');
        expect(metadata.chronic_diseases).toHaveLength(11);
        expect(metadata.chronic_diseases.map((row) => row.name)).toContain(
            'Penyakit Paru Kronis',
        );
        const fresh = await createTenant(pool, 'Klinik Uji ICD Kosong');
        await entitle(pool, fresh, 'healthcare');
        await recordInstallation(pool, fresh, 'healthcare');
        const [icd10Rows] = await pool.unsafe<{ count: number }[]>(
            'select count(*)::int as count from sim_m_icd10 where tenant_id = $1',
            [fresh],
        );
        expect(icd10Rows!.count).toBe(0);
        const [seeded] = await pool.unsafe<{ lists: number }[]>(
            `select ((select count(*) from sim_m_diagnosa_jenis where tenant_id = $1)
                  + (select count(*) from sim_m_diagnosa_kasus where tenant_id = $1)
                  + (select count(*) from sim_m_prognosa where tenant_id = $1)
                  + (select count(*) from sim_m_penyakit_kronis where tenant_id = $1))::int as lists`,
            [fresh],
        );
        expect(seeded!.lists).toBe(3 + 2 + 5 + 11);
    });

    test('an examiner adds an ICD-10 code on the fly but cannot change the master', async () => {
        const examiner = await login(tenantId, [
            'healthcare.examination.manage',
        ]);
        const meta = await json<Metadata>(
            await examiner.get(`${api}/examination/medical-record/metadata`),
            200,
        );
        expect(meta.permissions.create_icd10).toBe(true);
        const added = await icd10(
            'J06.9',
            'Acute upper respiratory infection',
            examiner,
        );
        expect([added.code, added.is_active]).toEqual(['J06.9', true]);
        expect(
            await refused(
                await examiner.post(`${api}/icd10`, {
                    code: 'j06.9',
                    name: 'Lagi',
                }),
            ),
        ).toEqual({ code: ['Kode ini sudah ada di daftar ICD-10.'] });
        const found = await json<{ data: Icd10[] }>(
            await examiner.get(`${api}/icd10?q=respiratory`),
            200,
        );
        expect(found.data.map((row) => row.id)).toEqual([added.id]);
        expect(
            (
                await examiner.patch(`${api}/icd10/${added.id}`, {
                    code: 'J06.9',
                    name: 'Diubah',
                    version: added.version,
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await examiner.delete(`${api}/icd10/${added.id}`, {
                    version: added.version,
                })
            ).status,
        ).toBe(403);

        const viewer = await login(tenantId, [
            'healthcare.examination.inquire',
        ]);
        expect((await viewer.get(`${api}/icd10`)).status).toBe(200);
        expect(
            (await viewer.post(`${api}/icd10`, { code: 'X', name: 'X' }))
                .status,
        ).toBe(403);
        expect(
            (await viewer.get(`${api}/diagnosis-references/prognoses`)).status,
        ).toBe(403);
    });

    test('Simpan follows the old rules: no diagnosis is fine, jenis and kasus are required per row', async () => {
        const id = await visit();
        await start(id);
        const flu = await icd10('J11', 'Influenza');
        expect((await save(admin, id, { diagnoses: [] })).status).toBe(200);

        const errors = await refused(
            await save(admin, id, {
                diagnoses: [
                    line(flu.id, 'PRIMER', null),
                    line(flu.id, null, null),
                ],
            }),
        );
        expect(errors['diagnoses.0.case_id']).toEqual([incomplete]);
        expect(errors['diagnoses.0.type_id']).toBeUndefined();
        expect(errors['diagnoses.1.type_id']).toEqual([incomplete]);
        expect(errors['diagnoses.1.case_id']).toEqual([incomplete]);
        expect(errors['diagnoses.1.icd10_id']).toEqual([
            'Kode ICD-10 ini sudah ada di diagnosa.',
        ]);
        expect(
            (
                await refused(
                    await save(admin, id, {
                        diagnoses: [{ ...line(flu.id), icd10_id: null }],
                    }),
                )
            )['diagnoses.0.icd10_id'],
        ).toEqual(['Pilih kode ICD-10.']);
    });

    test('diagnoses, prognosa, and chronic diseases are saved; edits update rows in place and never delete', async () => {
        const id = await visit();
        await start(id);
        const [cough, fever, headache] = [
            await icd10('R05', 'Cough'),
            await icd10('R50.9', 'Fever, unspecified'),
            await icd10('R51', 'Headache'),
        ];
        const hypertension = code(metadata.chronic_diseases, 'Hipertensi');
        const diabetes = code(metadata.chronic_diseases, 'DiabetusMilitus');
        await json(
            await save(admin, id, {
                diagnoses: [line(cough.id), line(fever.id, 'SEKUNDER', 'LAMA')],
                prognosis_id: code(metadata.prognoses, '02'),
                chronic_disease_ids: [hypertension, diabetes, hypertension],
            }),
            200,
        );
        const saved = (await show(admin, id)).data;
        expect(
            saved.diagnoses.map((row) => [
                row.icd10_code,
                row.type_id,
                row.case_id,
                row.doctor_id,
                row.nurse_id,
            ]),
        ).toEqual([
            [
                'R05',
                code(metadata.diagnosis_types, 'PRIMER'),
                code(metadata.diagnosis_cases, 'BARU'),
                doctor,
                nurse,
            ],
            [
                'R50.9',
                code(metadata.diagnosis_types, 'SEKUNDER'),
                code(metadata.diagnosis_cases, 'LAMA'),
                doctor,
                nurse,
            ],
        ]);
        expect(saved.prognosis_id).toBe(code(metadata.prognoses, '02'));
        expect([...saved.chronic_disease_ids].sort()).toEqual(
            [hypertension, diabetes].sort(),
        );
        const record = await recordId(id);
        const before = await rows(record);

        await json(
            await save(admin, id, {
                diagnoses: [
                    { ...line(cough.id, 'PRIMER', 'LAMA'), nurse_id: null },
                    line(headache.id, 'KOMPLIKASI', 'BARU'),
                ],
                prognosis_id: null,
                chronic_disease_ids: [diabetes],
            }),
            200,
        );
        const after = await rows(record);
        expect(after).toHaveLength(3);
        const kept = after.find((row) => row.icd10_id === cough.id)!;
        expect(kept.id).toBe(
            before.find((row) => row.icd10_id === cough.id)!.id,
        );
        expect(kept.deleted_at).toBeNull();
        expect(
            after.find((row) => row.icd10_id === fever.id)!.deleted_at,
        ).not.toBeNull();
        expect(
            after.find((row) => row.icd10_id === headache.id)!.deleted_at,
        ).toBeNull();
        const reloaded = (await show(admin, id)).data;
        expect(reloaded.diagnoses.map((row) => row.icd10_code)).toEqual([
            'R05',
            'R51',
        ]);
        expect(reloaded.diagnoses[0]!.nurse_id).toBeNull();
        expect(reloaded.prognosis_id).toBeNull();
        expect(reloaded.chronic_disease_ids).toEqual([diabetes]);
        const chronic = await pool.unsafe<{ deleted_at: Date | null }[]>(
            'select deleted_at from sim_tr_pemeriksaan_penyakit_kronis where pemeriksaan_id = $1',
            [record],
        );
        expect(chronic).toHaveLength(2);
        expect(chronic.filter((row) => row.deleted_at === null)).toHaveLength(
            1,
        );

        expect(
            (
                await refused(
                    await admin.delete(`${api}/icd10/${cough.id}`, {
                        version: cough.version,
                    }),
                )
            ).id,
        ).toEqual([
            'Kode ini sudah dipakai di diagnosa pemeriksaan. Nonaktifkan saja supaya tidak dipilih lagi.',
        ]);
    });

    test('an inactive code stays on the row that holds it but cannot be picked for a new row', async () => {
        const id = await visit();
        await start(id);
        const old = await icd10('A09', 'Diarrhoea');
        const other = await icd10('A01', 'Typhoid');
        await json(await save(admin, id, { diagnoses: [line(old.id)] }), 200);
        for (const row of [old, other])
            await json(
                await admin.patch(`${api}/icd10/${row.id}`, {
                    code: row.code,
                    name: row.name,
                    is_active: false,
                    version: row.version,
                }),
                200,
            );
        await json(await save(admin, id, { diagnoses: [line(old.id)] }), 200);
        expect(
            (
                await refused(
                    await save(admin, id, {
                        diagnoses: [line(old.id), line(other.id)],
                    }),
                )
            )['diagnoses.1.icd10_id'],
        ).toEqual(['Pilih kode ICD-10 dari daftar.']);
    });

    test('the record is locked before Mulai periksa and after Selesai periksa', async () => {
        const id = await visit();
        const pain = await icd10('R52', 'Pain');
        expect(
            (
                await refused(
                    await admin.put(path(id), {
                        ...(await show(admin, id)).data,
                        diagnoses: [line(pain.id)],
                    }),
                )
            ).status,
        ).toEqual(['Silahkan Klik Tombol Mulai Untuk Memulai Pemeriksaan !']);
        await start(id);
        const opened = await show(admin, id);
        await json(
            await save(admin, id, {
                anamnesis: {
                    ...(opened.data.anamnesis as object),
                    doctor_id: doctor,
                },
                diagnoses: [line(pain.id)],
            }),
            200,
        );
        await json(
            await admin.post(
                `${api}/examination/destinations/${id}/finish`,
                {},
            ),
            200,
        );
        expect(
            (await refused(await save(admin, id, { diagnoses: [] }))).status,
        ).toEqual([
            'Pemeriksaan ini sudah selesai, jadi isinya tidak dapat diubah lagi.',
        ]);
        expect((await show(admin, id)).data.diagnoses).toHaveLength(1);
    });

    test('riwayat diagnosa lists other visits of the patient that the user may see', async () => {
        const inB = await visit('b');
        await start(inB, 'b');
        const malaria = await icd10('B54', 'Malaria');
        await json(
            await save(admin, inB, {
                diagnoses: [line(malaria.id, 'PRIMER', 'BARU')],
            }),
            200,
        );
        const current = await visit('a');
        const history = async (as: Browser) =>
            (
                await json<{ data: History[] }>(
                    await as.get(
                        `${api}/examination/destinations/${current}/diagnosis-history?per_page=100`,
                    ),
                    200,
                )
            ).data;
        const all = await history(admin);
        expect(all.map((row) => row.icd10_code)).toContain('B54');
        expect(all.map((row) => row.icd10_code)).toContain('R05');
        expect(all.find((row) => row.icd10_code === 'B54')).toMatchObject({
            type_name: 'Primer',
            case_name: 'Baru',
            doctor_name: 'Dokter Diagnosa',
        });

        await start(current);
        await json(
            await save(admin, current, { diagnoses: [line(malaria.id)] }),
            200,
        );
        const onlyA = await login(
            tenantId,
            ['healthcare.examination.inquire'],
            units.a.unit,
        );
        const seen = await history(onlyA);
        expect(seen.map((row) => row.icd10_code)).not.toContain('B54');
        expect(seen.map((row) => row.icd10_code)).toContain('R05');
        expect(
            (await history(admin)).filter((row) => row.icd10_code === 'B54'),
        ).toHaveLength(1);
        expect(
            (
                await onlyA.get(
                    `${api}/examination/destinations/${inB}/diagnosis-history`,
                )
            ).status,
        ).toBe(404);
    });

    test('another tenant has its own lists and cannot use or see this tenant’s codes', async () => {
        const id = await visit();
        await start(id);
        const ours = await icd10('Z00', 'General examination');
        const other = await createTenant(pool, 'Klinik Diagnosa Lain');
        await entitle(pool, other, 'healthcare');
        await recordInstallation(pool, other, 'healthcare');
        const stranger = await login(other, [
            'healthcare.examination.manage',
            'healthcare.clinical-setup.manage',
        ]);
        const theirs = await json<Metadata>(
            await stranger.get(`${api}/examination/medical-record/metadata`),
            200,
        );
        expect(theirs.prognoses[0]?.id).not.toBe(metadata.prognoses[0]?.id);
        expect(
            (
                await json<{ data: Icd10[] }>(
                    await stranger.get(`${api}/icd10`),
                    200,
                )
            ).data,
        ).toEqual([]);
        expect(
            (
                await stranger.patch(`${api}/icd10/${ours.id}`, {
                    code: 'Z00',
                    name: 'X',
                    version: ours.version,
                })
            ).status,
        ).toBe(404);
        expect(
            (
                await refused(
                    await save(admin, id, {
                        diagnoses: [
                            {
                                ...line(ours.id),
                                type_id: theirs.diagnosis_types[0]!.id,
                            },
                        ],
                    }),
                )
            )['diagnoses.0.type_id'],
        ).toEqual(['Pilih dari daftar.']);
    });
});
