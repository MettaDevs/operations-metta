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

type Physical = Record<string, number | string | null>;
type Record_ = {
    id: string | null;
    version: number | null;
    anamnesis: Record<string, string | number | null>;
    history: Record<string, string | boolean | null>;
    allergy: {
        none: boolean;
        food_allergy_id: string | null;
        airborne_allergy_id: string | null;
        other: string | null;
    };
    status: Record<string, string | boolean | null>;
    physical: Physical;
    pain: Record<string, string | number | boolean | null>;
    fall_risk: Record<string, boolean | null>;
    findings: { aspect_id: string; result: string | null }[];
    anatomy: {
        id: string | null;
        body_part: string | null;
        description: string | null;
    }[];
    other: Record<string, string | boolean | null>;
};
type Shown = {
    data: Record_;
    context: {
        status: string;
        editable: boolean;
        gender: string | null;
        guarantee: string;
    };
};
type Metadata = {
    options: Record<string, { code: string; name: string }[]>;
    allergies: {
        food: { id: string; code: string; name: string }[];
        airborne: { id: string; code: string; name: string }[];
    };
    findings: {
        id: string;
        name: string;
        gender: string | null;
        aspects: { id: string; name: string; normal_text: string | null }[];
    }[];
    required: { field: string; label: string }[];
    practitioners: {
        id: string;
        name: string;
        profession: string;
        fills_medical_staff: boolean;
        fills_nurse: boolean;
    }[];
};

const api = '/api/modules/healthcare/v1';
const notStarted = 'Silahkan Klik Tombol Mulai Untuk Memulai Pemeriksaan !';
const vitals: Physical = {
    pulse_rate: 88,
    respiratory_rate: 20,
    consciousness: 'COMPOS MENTIS',
    systolic: 120,
    diastolic: 80,
    height: 158.5,
    weight: 52,
    waist_circumference: 71,
};

// Isi tab Rekam Medis halaman pemeriksaan: simpan dan baca setiap panel, isian wajib periksa fisik di server dengan
// pesan sistem lama, setelan isian wajib, alergi per pasien, batas ubah sebelum mulai dan sesudah selesai, penghapusan
// lunak, batas tenant, dan izin. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('examination medical record', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    // Profesi bawaan tenant dari migration 0022, menurut kodenya.
    const professions: Record<string, string> = {};
    async function loadProfessions() {
        for (const row of await pool.unsafe<{ kode: string; id: string }[]>(
            'select kode, id from sim_m_profesi where tenant_id = $1 and deleted_at is null',
            [tenantId],
        ))
            professions[row.kode] = row.id;
    }

    let tenantId: string;
    let admin: Browser;
    let unit: string;
    let umum: string;
    let patientId: string;
    let section: string;
    let room: string;
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
        return json<{ message: string; errors: Record<string, string[]> }>(
            response,
            422,
        );
    }

    async function created(path: string, body: Record<string, unknown>) {
        return (
            await json<{ data: { id: string } }>(
                await admin.post(path, body),
                201,
            )
        ).data;
    }

    async function visit(height?: number) {
        const registered = await json<{
            data: { destinations: { id: string }[] };
        }>(
            await admin.post(`${api}/visits`, {
                patient_id: patientId,
                patient_type_id: umum,
                visit_condition: 'sakit',
                section_id: section,
                ...(height ? { height_cm: height, weight_kg: 50 } : {}),
            }),
            201,
        );
        return registered.data.destinations[0]!.id;
    }

    async function start(id: string) {
        await json(
            await admin.post(`${api}/examination/destinations/${id}/start`, {
                room_id: room,
            }),
            200,
        );
    }

    const path = (id: string) =>
        `${api}/examination/destinations/${id}/medical-record`;

    async function show(as: Browser, id: string) {
        return json<Shown>(await as.get(path(id)), 200);
    }

    async function save(as: Browser, id: string, body: Record_) {
        return as.put(path(id), body);
    }

    async function rows(table: string, recordId: string) {
        return pool.unsafe<{ id: string; deleted_at: Date | null }[]>(
            `select id, deleted_at from ${table} where pemeriksaan_id = $1 order by created_at, id`,
            [recordId],
        );
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Rekam Medis');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        await loadProfessions();
        const owner = await createMember(pool, tenantId, [
            'core.organization.manage',
            'healthcare.patient.manage',
            'healthcare.payment-setup.manage',
            'healthcare.service-setup.manage',
            'healthcare.practitioner.manage',
            'healthcare.visit.manage',
            'healthcare.examination.manage',
        ]);
        await grantAllOrganizations(pool, tenantId, owner.membershipId);
        await pool.unsafe(
            `insert into role_assignment_data_policy_scopes
                 (id, tenant_id, role_assignment_id, policy_code, include_descendants, valid_from, created_at, updated_at)
             select $1, $2, id, 'healthcare.patient-unit', false, now() - interval '1 day', now(), now()
             from role_assignments where membership_id = $3`,
            [Bun.randomUUIDv7(), tenantId, owner.membershipId],
        );
        admin = browser();
        await admin.login(owner.email, owner.password);
        await created('/api/v1/organizations', {
            classification: 'legal_entity',
            name: 'PT Klinik Uji Rekam Medis',
            company_code: `KR${Date.now() % 100000}`,
            country_code: 'ID',
        });
        unit = (
            await created('/api/v1/organizations', {
                classification: 'operating_unit',
                name: 'Puskesmas Rekam Medis',
                operating_unit_type: 'department',
                operating_unit_number: 'PRM',
            })
        ).id;
        umum = (
            await created(`${api}/patient-types`, {
                code: 'UMUM',
                name: 'Umum',
            })
        ).id;
        patientId = (
            await created(`${api}/patients`, {
                name: 'Pasien Rekam Medis',
                nationality_country_code: 'AU',
                passport_number: `PR${Math.floor(Math.random() * 1e8)}`,
                gender: 'female',
                birth_date: '1988-02-03',
                phone: '081200000009',
                domicile_address: { street: 'Jl. Rekam Medis No. 1' },
                payment_methods: [{ patient_type_id: umum }],
            })
        ).id;
        room = (
            await created(`${api}/rooms`, {
                operating_unit_id: unit,
                code: 'RM1',
                name: 'Ruang RM1',
            })
        ).id;
        section = (
            await created(`${api}/sections`, {
                operating_unit_id: unit,
                name: 'Poli Umum',
                kind: 'rawat_jalan',
                room_ids: [room],
            })
        ).id;
        doctor = (
            await created(`${api}/practitioners`, {
                name: 'Dokter Rekam Medis',
                nik: String(Date.now()).slice(-12).padStart(16, '5'),
                gender: 'male',
                phone: '081200000010',
                profession_id: professions.dokter,
            })
        ).id;
        nurse = (
            await created(`${api}/practitioners`, {
                name: 'Bidan Rekam Medis',
                nik: String(Date.now() + 7)
                    .slice(-12)
                    .padStart(16, '6'),
                gender: 'female',
                phone: '081200000011',
                profession_id: professions.bidan,
            })
        ).id;
        metadata = await json<Metadata>(
            await admin.get(`${api}/examination/medical-record/metadata`),
            200,
        );
    }, 120_000);

    test('reference lists are seeded for the tenant from the old system', () => {
        expect(
            metadata.allergies.food.map((row) => [row.code, row.name]),
        ).toEqual([
            ['00', 'Tidak Ada'],
            ['01', 'Seafood'],
            ['02', 'Gandum'],
            ['03', 'Susu Sapi'],
            ['04', 'Kacang-Kacangan'],
            ['05', 'Makanan Lain'],
        ]);
        expect(metadata.allergies.airborne).toHaveLength(4);
        expect(metadata.options.kesadaran?.map((row) => row.code)).toEqual([
            'COMPOS MENTIS',
            'SOMNOLEN',
            'SOPOR',
            'COMA',
        ]);
        expect(metadata.options.gcs_motorik).toHaveLength(6);
        expect(metadata.required.map((row) => row.label)).toEqual([
            'Detak Nadi',
            'Nafas',
            'Kesadaran',
            'Sistole',
            'Diastole',
            'Tinggi Badan',
            'Berat Badan',
            'Lingkar Perut',
        ]);
        expect(metadata.findings).toHaveLength(17);
        expect(
            metadata.findings.find((row) => row.name === 'Pemeriksaan Kulit')
                ?.aspects[0]?.normal_text,
        ).toBe('Normal : kulit tidak ada ikterik/pucat/sianosis');
        expect(metadata.practitioners.map((row) => row.id)).toContain(doctor);
    });

    test('the record is read-only before Mulai periksa and opens with the old form defaults', async () => {
        const id = await visit(161);
        const before = await show(admin, id);
        expect(before.context.editable).toBe(false);
        expect(before.data.id).toBeNull();
        expect(
            (await refused(await save(admin, id, before.data))).errors.status,
        ).toEqual([notStarted]);

        await start(id);
        const opened = await show(admin, id);
        expect(opened.context.editable).toBe(true);
        expect(opened.context.guarantee).toBe('Umum');
        expect([
            opened.data.physical.height,
            opened.data.physical.weight,
            opened.data.physical.height_method,
        ]).toEqual([161, 50, 'Berdiri']);
        expect(opened.data.status.emotional_expression).toBe('Tenang');
        expect(opened.data.status.uses_mobility_aid).toBe(false);
        expect(opened.data.allergy.food_allergy_id).toBe(
            metadata.allergies.food[0]!.id,
        );
    });

    test('Simpan is refused with the old messages until the required physical fields are filled', async () => {
        const id = await visit();
        await start(id);
        const opened = await show(admin, id);
        const refusal = await refused(
            await save(admin, id, {
                ...opened.data,
                physical: {
                    ...opened.data.physical,
                    pulse_rate: 88,
                    waist_circumference: 0,
                },
            }),
        );
        expect(refusal.errors).toEqual({
            'physical.respiratory_rate': [
                'Field Nafas pada periksa fisik harus di isi',
            ],
            'physical.consciousness': [
                'Field Kesadaran pada periksa fisik harus di isi',
            ],
            'physical.systolic': [
                'Field Sistole pada periksa fisik harus di isi',
            ],
            'physical.diastolic': [
                'Field Diastole pada periksa fisik harus di isi',
            ],
            'physical.height': [
                'Field Tinggi Badan pada periksa fisik harus di isi',
            ],
            'physical.weight': [
                'Field Berat Badan pada periksa fisik harus di isi',
            ],
            'physical.waist_circumference': [
                'Field Lingkar Perut pada periksa fisik harus di isi',
            ],
        });
        const headers = await pool.unsafe<{ count: number }[]>(
            'select count(*)::int as count from sim_tr_pemeriksaan where tujuan_id = $1',
            [id],
        );
        expect(headers[0]?.count).toBe(0);
    });

    test('every panel is saved and read back, empty panels write no rows, and edits never delete rows', async () => {
        const id = await visit();
        await start(id);
        const opened = await show(admin, id);
        const skin = metadata.findings.find(
            (row) => row.name === 'Pemeriksaan Kulit',
        )!;
        const genitaliaMale = metadata.findings.find(
            (row) => row.gender === 'male',
        )!;
        const filled: Record_ = {
            ...opened.data,
            anamnesis: {
                ...opened.data.anamnesis,
                doctor_id: doctor,
                nurse_id: nurse,
                chief_complaint: 'Demam tiga hari',
                additional_complaint: 'Batuk',
                illness_years: 0,
                illness_months: 0,
                illness_days: 3,
            },
            history: {
                none: false,
                present: 'Demam',
                past: 'Tifus',
                family: null,
            },
            allergy: {
                none: false,
                food_allergy_id: metadata.allergies.food[1]!.id,
                airborne_allergy_id: metadata.allergies.airborne[2]!.id,
                other: 'Debu',
            },
            status: {
                ...opened.data.status,
                uses_mobility_aid: true,
                mobility_aid_note: 'Tongkat',
                language: 'Daerah',
                lives_with: 'Lainnya',
                lives_with_note: 'Kakak',
                social_economy: 'Cukup',
                past_mental_disorder: 'TidakAda',
                economic_status: 'Baik',
                family_relationship: 'Harmonis',
            },
            physical: {
                ...opened.data.physical,
                ...vitals,
                oxygen_saturation: 98,
                temperature: '37,8',
                eye_opening: '4',
                verbal_response: '5',
                motor_response: '6',
                mobility: '0',
                toileting: '1',
                eating: '0',
                bathing: '0',
                dressing: '2',
                heart_rhythm: 'IREGULER',
                triage: 'Darurat',
            },
            pain: {
                has_pain: true,
                trigger: 'Gerak',
                quality: 'Tertusuk',
                location: 'Kepala',
                scale: 6,
                timing: '1',
            },
            fall_risk: { unsteady_gait: true, uses_support: false },
            findings: skin.aspects.map((aspect) => ({
                aspect_id: aspect.id,
                result: aspect.normal_text,
            })),
            anatomy: [
                { id: null, body_part: 'Lutut kiri', description: 'Memar' },
                { id: null, body_part: 'Siku', description: 'Lecet' },
            ],
            other: {
                ...opened.data.other,
                drug_therapy: 'Parasetamol',
                plan: 'Kontrol 3 hari',
                smoking: false,
                alcohol: false,
                low_vegetable_fruit: true,
                nursing_care_type: 'Soap',
                nursing_care_description: 'S: demam',
            },
        };
        const saved = await json<Shown>(await save(admin, id, filled), 200);
        expect(saved.data.id).not.toBeNull();
        expect(saved.data.physical.temperature).toBe(37.8);
        const reloaded = await show(admin, id);
        expect(reloaded.data).toEqual(saved.data);
        expect<Record_>({
            ...reloaded.data,
            anatomy: reloaded.data.anatomy.map((row) => ({
                ...row,
                id: null as string | null,
            })),
            id: null,
            version: null,
            physical: { ...reloaded.data.physical, temperature: '37,8' },
        }).toEqual({ ...filled, id: null, version: null });
        const recordId = saved.data.id!;
        // Satu baris per panel yang berisi; status fisik ikut karena nilai awal Tidak juga nilai.
        for (const table of [
            'sim_tr_pemeriksaan_riwayat_penyakit',
            'sim_tr_pemeriksaan_status_fisik',
            'sim_tr_pemeriksaan_fisik',
            'sim_tr_pemeriksaan_nyeri',
            'sim_tr_pemeriksaan_risiko_jatuh',
            'sim_tr_pemeriksaan_lainnya',
        ])
            expect(await rows(table, recordId)).toHaveLength(1);
        expect(
            await rows('sim_tr_pemeriksaan_keadaan_fisik', recordId),
        ).toHaveLength(skin.aspects.length);

        // Ubah: kosongkan riwayat dan nyeri, buang satu baris anatomi, pindah keadaan fisik ke bagian lain.
        const edited = await json<Shown>(
            await save(admin, id, {
                ...saved.data,
                history: {
                    none: false,
                    present: null,
                    past: null,
                    family: null,
                },
                pain: {
                    has_pain: null,
                    trigger: null,
                    quality: null,
                    location: null,
                    scale: null,
                    timing: null,
                },
                anatomy: [
                    {
                        ...saved.data.anatomy[1]!,
                        description: 'Lecet ringan',
                    },
                ],
                findings: genitaliaMale.aspects.map((aspect) => ({
                    aspect_id: aspect.id,
                    result: 'Normal',
                })),
            }),
            200,
        );
        expect(edited.data.version).toBeGreaterThan(saved.data.version!);
        expect(edited.data.history.present).toBeNull();
        expect(edited.data.pain.has_pain).toBeNull();
        expect(edited.data.anatomy).toEqual([
            {
                id: saved.data.anatomy[1]!.id,
                body_part: 'Siku',
                description: 'Lecet ringan',
            },
        ]);
        const history = await rows(
            'sim_tr_pemeriksaan_riwayat_penyakit',
            recordId,
        );
        expect(history.map((row) => row.deleted_at !== null)).toEqual([true]);
        const anatomy = await rows('sim_tr_pemeriksaan_anatomi', recordId);
        expect(anatomy.map((row) => row.deleted_at !== null)).toEqual([
            true,
            false,
        ]);
        const findings = await rows(
            'sim_tr_pemeriksaan_keadaan_fisik',
            recordId,
        );
        expect(findings.filter((row) => row.deleted_at === null)).toHaveLength(
            genitaliaMale.aspects.length,
        );
        expect(findings.filter((row) => row.deleted_at !== null)).toHaveLength(
            skin.aspects.length,
        );

        // Versi lama ditolak.
        expect(
            (
                await save(admin, id, {
                    ...saved.data,
                    physical: filled.physical,
                })
            ).status,
        ).toBe(409);

        // Isian yang tidak sah menunjuk isiannya.
        const invalid = await refused(
            await save(admin, id, {
                ...edited.data,
                anamnesis: { ...edited.data.anamnesis, doctor_id: room },
                physical: {
                    ...edited.data.physical,
                    systolic: 'seratus',
                    triage: 'Biru',
                },
                anatomy: [{ id: null, body_part: 'Dada', description: null }],
            }),
        );
        expect(invalid.errors).toEqual({
            'anamnesis.doctor_id': ['Pilih tenaga kesehatan dari daftar.'],
            'physical.systolic': [
                'Isi bilangan bulat.',
                'Field Sistole pada periksa fisik harus di isi',
            ],
            'physical.triage': ['Pilih dari daftar.'],
            'anatomy.0.description': ['Isi keterangan.'],
        });
    });

    test('the profession flags decide who can be picked as doctor or nurse', async () => {
        const id = await visit();
        await start(id);
        const opened = await show(admin, id);
        const swapped = {
            ...opened.data,
            anamnesis: {
                ...opened.data.anamnesis,
                doctor_id: nurse,
                nurse_id: doctor,
            },
            physical: { ...opened.data.physical, ...vitals },
        };
        expect((await refused(await save(admin, id, swapped))).errors).toEqual({
            'anamnesis.doctor_id': ['Pilih tenaga kesehatan dari daftar.'],
            'anamnesis.nurse_id': ['Pilih tenaga kesehatan dari daftar.'],
        });
        // Satu profesi boleh mengisi kedua peran, seperti kategori V-004 sistem lama.
        await pool.unsafe(
            'update sim_m_profesi set isi_perawat = true where id = $1',
            [professions.dokter!],
        );
        try {
            const roles = (
                await json<Metadata>(
                    await admin.get(
                        `${api}/examination/medical-record/metadata`,
                    ),
                    200,
                )
            ).practitioners.find((row) => row.id === doctor);
            expect(roles).toEqual(
                expect.objectContaining({
                    profession: 'Dokter',
                    fills_medical_staff: true,
                    fills_nurse: true,
                }),
            );
            const saved = await json<Shown>(
                await save(admin, id, {
                    ...swapped,
                    anamnesis: { ...swapped.anamnesis, doctor_id: doctor },
                }),
                200,
            );
            expect([
                saved.data.anamnesis.doctor_id,
                saved.data.anamnesis.nurse_id,
            ]).toEqual([doctor, doctor]);
        } finally {
            await pool.unsafe(
                'update sim_m_profesi set isi_perawat = false where id = $1',
                [professions.dokter!],
            );
        }
    });

    test('allergies belong to the patient and carry over to the next visit', async () => {
        const first = await visit();
        await start(first);
        const opened = await show(admin, first);
        await json(
            await save(admin, first, {
                ...opened.data,
                physical: { ...opened.data.physical, ...vitals },
                allergy: {
                    none: false,
                    food_allergy_id: metadata.allergies.food[4]!.id,
                    airborne_allergy_id: metadata.allergies.airborne[1]!.id,
                    other: 'Lateks',
                },
            }),
            200,
        );
        const next = await visit();
        const later = await show(admin, next);
        expect(later.data.allergy).toEqual({
            none: false,
            food_allergy_id: metadata.allergies.food[4]!.id,
            airborne_allergy_id: metadata.allergies.airborne[1]!.id,
            other: 'Lateks',
        });
        const stored = await pool.unsafe<{ count: number }[]>(
            'select count(*)::int as count from sim_m_pasien_alergi where pasien_id = $1 and deleted_at is null',
            [patientId],
        );
        expect(stored[0]?.count).toBe(1);
    });

    test('changing the required-field setting changes what Simpan and Selesai periksa demand', async () => {
        await pool.unsafe(
            `update sim_m_pemeriksaan_wajib set deleted_at = now() where tenant_id = $1 and isian = 'waist_circumference'`,
            [tenantId],
        );
        await pool.unsafe(
            `insert into sim_m_pemeriksaan_wajib (id, tenant_id, isian, urutan, created_at, updated_at)
             values ($1, $2, 'temperature', 9, now(), now())`,
            [Bun.randomUUIDv7(), tenantId],
        );
        try {
            const id = await visit();
            await start(id);
            const opened = await show(admin, id);
            const physical = {
                ...opened.data.physical,
                ...vitals,
                waist_circumference: null,
            };
            expect(
                (
                    await refused(
                        await save(admin, id, { ...opened.data, physical }),
                    )
                ).errors,
            ).toEqual({
                'physical.temperature': [
                    'Field Suhu pada periksa fisik harus di isi',
                ],
            });
            const saved = await json<Shown>(
                await save(admin, id, {
                    ...opened.data,
                    physical: { ...physical, temperature: 36.5 },
                }),
                200,
            );
            expect(saved.data.physical.waist_circumference).toBeNull();
            await json(
                await admin.post(
                    `${api}/examination/destinations/${id}/finish`,
                    {},
                ),
                200,
            );
            const finished = await show(admin, id);
            expect(finished.context.editable).toBe(false);
            expect(
                (await refused(await save(admin, id, finished.data))).errors
                    .status,
            ).toEqual([
                'Pemeriksaan ini sudah selesai, jadi isinya tidak dapat diubah lagi.',
            ]);
        } finally {
            await pool.unsafe(
                `update sim_m_pemeriksaan_wajib set deleted_at = null where tenant_id = $1 and isian = 'waist_circumference'`,
                [tenantId],
            );
            await pool.unsafe(
                `update sim_m_pemeriksaan_wajib set deleted_at = now() where tenant_id = $1 and isian = 'temperature'`,
                [tenantId],
            );
        }
    });

    test('a viewer reads but cannot save, and another tenant cannot see the record', async () => {
        const id = await visit();
        await start(id);
        const viewer = await createMember(pool, tenantId, [
            'healthcare.examination.inquire',
        ]);
        await grantAllOrganizations(pool, tenantId, viewer.membershipId);
        await pool.unsafe(
            `insert into role_assignment_data_policy_scopes
                 (id, tenant_id, role_assignment_id, policy_code, include_descendants, valid_from, created_at, updated_at)
             select $1, $2, id, 'healthcare.patient-unit', false, now() - interval '1 day', now(), now()
             from role_assignments where membership_id = $3`,
            [Bun.randomUUIDv7(), tenantId, viewer.membershipId],
        );
        const reader = browser();
        await reader.login(viewer.email, viewer.password);
        const seen = await show(reader, id);
        expect(seen.context.editable).toBe(false);
        expect((await save(reader, id, seen.data)).status).toBe(403);

        const otherTenant = await createTenant(pool, 'Klinik Lain');
        await entitle(pool, otherTenant, 'healthcare');
        await recordInstallation(pool, otherTenant, 'healthcare');
        const stranger = await createMember(pool, otherTenant, [
            'healthcare.examination.manage',
        ]);
        await grantAllOrganizations(pool, otherTenant, stranger.membershipId);
        const outsider = browser();
        await outsider.login(stranger.email, stranger.password);
        expect((await outsider.get(path(id))).status).toBe(404);
        expect((await save(outsider, id, seen.data)).status).toBe(404);
        const theirs = await json<Metadata>(
            await outsider.get(`${api}/examination/medical-record/metadata`),
            200,
        );
        expect(theirs.allergies.food[0]?.id).not.toBe(
            metadata.allergies.food[0]?.id,
        );
        expect(theirs.practitioners).toEqual([]);
    });
});
