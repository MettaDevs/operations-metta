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
type Allergy = {
    id: string | null;
    category: string | null;
    allergen_id: string | null;
    allergen_name: string | null;
    drug_id: string | null;
    drug_code: string | null;
    drug_name: string | null;
    name: string | null;
    reaction: string | null;
    status: string;
    recorded_at: string | null;
    recorded_by: string | null;
};
type Record_ = {
    id: string | null;
    version: number | null;
    anamnesis: Record<string, string | number | null>;
    history: Record<string, string | boolean | null>;
    allergy: { none: boolean; items: Allergy[] };
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
        physical_measured_at: string | null;
        physical_measured_by_name: string | null;
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
        drug_classes: { id: string; code: string; name: string }[];
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
// pesan sistem lama, setelan isian wajib, alergi per pasien, batas ubah sebelum mulai, Update sesudah selesai, penghapusan
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
    let adminName: string;
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
        [{ name: adminName }] = await pool.unsafe<[{ name: string }]>(
            'select name from users where id = $1',
            [owner.userId],
        );
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
                code: 'UMUM',
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
        // Kode 00 "Tidak Ada" bukan alergen, jadi tidak ditawarkan.
        expect(
            metadata.allergies.food.map((row) => [row.code, row.name]),
        ).toEqual([
            ['01', 'Seafood'],
            ['02', 'Gandum'],
            ['03', 'Susu Sapi'],
            ['04', 'Kacang-Kacangan'],
            ['05', 'Makanan Lain'],
        ]);
        expect(metadata.allergies.airborne).toHaveLength(3);
        expect(metadata.allergies.drug_classes.map((row) => row.name)).toEqual([
            'Antibiotik',
            'Antiinflamasi',
            'Non Steroid',
            'Aspirin',
            'Kortikosteroid',
            'Insulin',
            'Obat-Obatan Lain',
        ]);
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
        expect(opened.data.allergy).toEqual({ none: false, items: [] });
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

    const allergy = (values: Partial<Allergy>): Allergy => ({
        id: null,
        category: null,
        allergen_id: null,
        allergen_name: null,
        drug_id: null,
        drug_code: null,
        drug_name: null,
        name: null,
        reaction: null,
        status: 'aktif',
        recorded_at: null,
        recorded_by: null,
        ...values,
    });

    async function storedAllergies() {
        return pool.unsafe<
            {
                id: string;
                alergi_id: string | null;
                nama: string | null;
                reaksi: string | null;
                status: string;
                pemeriksaan_id: string | null;
                dicatat_pada: Date;
                dicatat_oleh: string | null;
                deleted_at: Date | null;
            }[]
        >(
            `select id, alergi_id, nama, reaksi, status, pemeriksaan_id, dicatat_pada, dicatat_oleh, deleted_at
             from sim_m_pasien_alergi where pasien_id = $1 order by dicatat_pada, id`,
            [patientId],
        );
    }

    test('allergies are a list per patient that carries over, and a later Simpan never overwrites what was recorded', async () => {
        const [seafood, peanuts] = [
            metadata.allergies.food[0]!,
            metadata.allergies.food[3]!,
        ];
        const antibiotics = metadata.allergies.drug_classes[0]!;
        const first = await visit();
        await start(first);
        const opened = await show(admin, first);
        const saved = await json<Shown>(
            await save(admin, first, {
                ...opened.data,
                physical: { ...opened.data.physical, ...vitals },
                allergy: {
                    none: false,
                    items: [
                        allergy({
                            category: 'makanan',
                            allergen_id: seafood.id,
                            reaction: 'Gatal',
                        }),
                        allergy({
                            category: 'makanan',
                            allergen_id: peanuts.id,
                        }),
                        allergy({
                            category: 'obat',
                            allergen_id: antibiotics.id,
                            status: 'sembuh',
                        }),
                        allergy({ category: 'lainnya', name: 'Lateks' }),
                    ],
                },
            }),
            200,
        );
        expect(
            saved.data.allergy.items.map((row) => [
                row.category,
                row.allergen_name ?? row.name,
                row.reaction,
                row.status,
                row.recorded_by,
            ]),
        ).toEqual([
            ['makanan', 'Seafood', 'Gatal', 'aktif', adminName],
            ['makanan', 'Kacang-Kacangan', null, 'aktif', adminName],
            ['obat', 'Antibiotik', null, 'sembuh', adminName],
            ['lainnya', 'Lateks', null, 'aktif', adminName],
        ]);
        const recorded = await storedAllergies();
        expect(
            recorded.map((row) => row.pemeriksaan_id === saved.data.id),
        ).toEqual([true, true, true, true]);

        const second = await visit();
        await start(second);
        const carried = await show(admin, second);
        expect(carried.data.allergy).toEqual(saved.data.allergy);

        // Reaksi dan status diubah di tempat; alergen kiriman baris tersimpan diabaikan. Lateks dibuang, udara ditambah.
        const [seafoodRow, peanutsRow, antibioticsRow] =
            carried.data.allergy.items;
        const changed = await json<Shown>(
            await save(admin, second, {
                ...carried.data,
                physical: { ...carried.data.physical, ...vitals },
                allergy: {
                    none: false,
                    items: [
                        {
                            ...seafoodRow!,
                            allergen_id: metadata.allergies.food[1]!.id,
                            reaction: 'Gatal dan bengkak',
                        },
                        { ...peanutsRow!, status: 'tidak_aktif' },
                        antibioticsRow!,
                        allergy({
                            category: 'udara',
                            allergen_id: metadata.allergies.airborne[0]!.id,
                        }),
                    ],
                },
            }),
            200,
        );
        expect(
            changed.data.allergy.items.map((row) => [
                row.id,
                row.allergen_name ?? row.name,
                row.reaction,
                row.status,
            ]),
        ).toEqual([
            [seafoodRow!.id, 'Seafood', 'Gatal dan bengkak', 'aktif'],
            [peanutsRow!.id, 'Kacang-Kacangan', null, 'tidak_aktif'],
            [antibioticsRow!.id, 'Antibiotik', null, 'sembuh'],
            [changed.data.allergy.items[3]!.id, 'Udara Panas', null, 'aktif'],
        ]);
        const after = await storedAllergies();
        expect(after).toHaveLength(5);
        for (const before of recorded) {
            const row = after.find((item) => item.id === before.id)!;
            expect([
                row.alergi_id,
                row.nama,
                row.pemeriksaan_id,
                row.dicatat_pada,
                row.dicatat_oleh,
            ]).toEqual([
                before.alergi_id,
                before.nama,
                before.pemeriksaan_id,
                before.dicatat_pada,
                before.dicatat_oleh,
            ]);
        }
        expect(
            after.map((row) => [
                row.nama ?? row.reaksi ?? row.status,
                row.deleted_at !== null,
                row.pemeriksaan_id === changed.data.id,
            ]),
        ).toEqual([
            ['Gatal dan bengkak', false, false],
            ['tidak_aktif', false, false],
            ['sembuh', false, false],
            ['Lateks', true, false],
            ['aktif', false, true],
        ]);
    });

    test('Tidak ada alergi belongs to the examination and is refused while the patient has an active allergy', async () => {
        const id = await visit();
        await start(id);
        const opened = await show(admin, id);
        const base = {
            ...opened.data,
            physical: { ...opened.data.physical, ...vitals },
        };
        const current = opened.data.allergy.items;
        const added = current.length;
        const [noneCode] = await pool.unsafe<[{ id: string }]>(
            `select id from sim_m_alergi where tenant_id = $1 and jenis = 'makanan' and kode = '00'`,
            [tenantId],
        );
        const refusal = await refused(
            await save(admin, id, {
                ...base,
                allergy: {
                    none: true,
                    items: [
                        ...current.map((row) => ({
                            ...row,
                            status: 'tidak_aktif',
                        })),
                        allergy({ category: 'lainnya', name: 'Debu rumah' }),
                        allergy({
                            category: 'makanan',
                            allergen_id: metadata.allergies.food[1]!.id,
                        }),
                        allergy({
                            category: 'makanan',
                            allergen_id: metadata.allergies.food[1]!.id,
                        }),
                        allergy({
                            category: 'makanan',
                            allergen_id: noneCode.id,
                        }),
                        allergy({ category: 'lainnya', status: 'kambuh' }),
                    ],
                },
            }),
        );
        expect(refusal.errors).toEqual({
            'allergy.none': [
                'Tidak ada alergi tidak bisa dipilih selama pasien punya alergi aktif.',
            ],
            [`allergy.items.${added + 2}.allergen_id`]: [
                'Gandum sudah ada di daftar alergi.',
            ],
            [`allergy.items.${added + 3}.allergen_id`]: ['Pilih dari daftar.'],
            [`allergy.items.${added + 4}.status`]: ['Pilih status alergi.'],
            [`allergy.items.${added + 4}.name`]: ['Isi nama alergi.'],
        });

        const quiet = await json<Shown>(
            await save(admin, id, {
                ...base,
                allergy: {
                    none: true,
                    items: current.map((row) => ({
                        ...row,
                        status:
                            row.status === 'aktif' ? 'tidak_aktif' : row.status,
                    })),
                },
            }),
            200,
        );
        expect(quiet.data.allergy.none).toBe(true);
        expect(
            quiet.data.allergy.items.filter((row) => row.status === 'aktif'),
        ).toEqual([]);
        const statement = await pool.unsafe<{ alergi_tidak_ada: boolean }[]>(
            `select alergi_tidak_ada from sim_tr_pemeriksaan_riwayat_penyakit
             where pemeriksaan_id = $1 and deleted_at is null`,
            [quiet.data.id],
        );
        expect([...statement]).toEqual([{ alergi_tidak_ada: true }]);
        const next = await visit();
        expect((await show(admin, next)).data.allergy).toEqual({
            none: false,
            items: quiet.data.allergy.items,
        });
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
                    anamnesis: { ...opened.data.anamnesis, doctor_id: doctor },
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
            // Sesudah Selesai periksa isinya tetap bisa diubah (Update sistem lama), dengan isian wajib dan dokter yang
            // memeriksa tetap dituntut.
            const finished = await show(admin, id);
            expect([
                finished.context.status,
                finished.context.editable,
            ]).toEqual(['selesai', true]);
            expect(
                (
                    await refused(
                        await save(admin, id, {
                            ...finished.data,
                            physical: {
                                ...finished.data.physical,
                                temperature: null,
                            },
                            anamnesis: {
                                ...finished.data.anamnesis,
                                doctor_id: null,
                            },
                        }),
                    )
                ).errors,
            ).toEqual({
                'anamnesis.doctor_id': [
                    'Pilih dokter / tenaga medis yang memeriksa sebelum menyelesaikan pemeriksaan.',
                ],
                'physical.temperature': [
                    'Field Suhu pada periksa fisik harus di isi',
                ],
            });
            const updated = await json<Shown>(
                await save(admin, id, {
                    ...finished.data,
                    anamnesis: {
                        ...finished.data.anamnesis,
                        chief_complaint: 'Demam sejak kemarin',
                    },
                }),
                200,
            );
            expect(updated.data.anamnesis.chief_complaint).toBe(
                'Demam sejak kemarin',
            );
            expect(updated.context.status).toBe('selesai');
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

    test('the vital signs keep their measured time and measurer until a value changes', async () => {
        const id = await visit();
        await start(id);
        const nurse = await createMember(pool, tenantId, [
            'healthcare.examination.manage',
        ]);
        await grantAllOrganizations(pool, tenantId, nurse.membershipId);
        await pool.unsafe(
            `insert into role_assignment_data_policy_scopes
                 (id, tenant_id, role_assignment_id, policy_code, include_descendants, valid_from, created_at, updated_at)
             select $1, $2, id, 'healthcare.patient-unit', false, now() - interval '1 day', now(), now()
             from role_assignments where membership_id = $3`,
            [Bun.randomUUIDv7(), tenantId, nurse.membershipId],
        );
        const measurer = browser();
        await measurer.login(nurse.email, nurse.password);
        const opened = await show(measurer, id);
        expect(opened.context.physical_measured_at).toBeNull();
        const measured = await json<Shown>(
            await save(measurer, id, {
                ...opened.data,
                physical: { ...opened.data.physical, ...vitals },
            }),
            200,
        );
        expect(measured.context.physical_measured_at).not.toBeNull();
        const physical = async () =>
            (
                await pool.unsafe<
                    {
                        measured_at: string;
                        measured_by: string | null;
                        updated_at: string;
                    }[]
                >(
                    `select f.diukur_pada::text as measured_at, f.diukur_oleh as measured_by, f.updated_at::text
                     from sim_tr_pemeriksaan_fisik f
                     where f.pemeriksaan_id = $1 and f.deleted_at is null`,
                    [String(measured.data.id)],
                )
            )[0]!;
        expect((await physical()).measured_by).toBe(nurse.userId);

        // Simpan lain oleh dokter tanpa mengubah Periksa fisik tidak menggeser waktu ukur maupun pengukurnya.
        await pool.unsafe(
            `update sim_tr_pemeriksaan_fisik set diukur_pada = '2026-01-02 03:04:05'
             where pemeriksaan_id = $1`,
            [String(measured.data.id)],
        );
        const kept = await json<Shown>(
            await save(admin, id, {
                ...measured.data,
                anamnesis: {
                    ...measured.data.anamnesis,
                    chief_complaint: 'Batuk',
                },
            }),
            200,
        );
        expect(await physical()).toMatchObject({
            measured_at: '2026-01-02 03:04:05',
            measured_by: nurse.userId,
        });
        expect(kept.context.physical_measured_at).toBe('2026-01-02T03:04:05Z');

        // Nilai yang berubah mencatat waktu ukur dan pengukur baru.
        await json(
            await save(admin, id, {
                ...kept.data,
                physical: { ...kept.data.physical, pulse_rate: 96 },
            }),
            200,
        );
        const remeasured = await physical();
        expect(remeasured.measured_at).not.toBe('2026-01-02 03:04:05');
        expect(remeasured.measured_at).toBe(remeasured.updated_at);
        expect(remeasured.measured_by).not.toBe(nurse.userId);
    });

    test('the practitioner who measured the vital signs and recorded an allergy is the account link at that moment', async () => {
        const id = await visit();
        await start(id);
        const staff = await createMember(pool, tenantId, [
            'healthcare.examination.manage',
        ]);
        await grantAllOrganizations(pool, tenantId, staff.membershipId);
        await pool.unsafe(
            `insert into role_assignment_data_policy_scopes
                 (id, tenant_id, role_assignment_id, policy_code, include_descendants, valid_from, created_at, updated_at)
             select $1, $2, id, 'healthcare.patient-unit', false, now() - interval '1 day', now(), now()
             from role_assignments where membership_id = $3`,
            [Bun.randomUUIDv7(), tenantId, staff.membershipId],
        );
        const link = (...practitioners: string[]) =>
            pool.unsafe(
                `update sim_m_nakes set user_id = case when id = any($2::uuid[]) then $1::uuid end
                 where tenant_id = $3 and (user_id = $1 or id = any($2::uuid[]))`,
                [staff.userId, practitioners, tenantId],
            );
        const user = browser();
        await user.login(staff.email, staff.password);
        await link(nurse);
        const opened = await show(user, id);
        const saved = await json<Shown>(
            await save(user, id, {
                ...opened.data,
                physical: { ...opened.data.physical, ...vitals },
                allergy: {
                    none: false,
                    items: [
                        ...opened.data.allergy.items,
                        allergy({ category: 'lainnya', name: 'Plester' }),
                    ],
                },
            }),
            200,
        );
        const recorded = async () => ({
            measured: (
                await pool.unsafe<{ id: string | null }[]>(
                    `select diukur_oleh_nakes_id as id from sim_tr_pemeriksaan_fisik
                     where pemeriksaan_id = $1 and deleted_at is null`,
                    [String(saved.data.id)],
                )
            )[0]?.id,
            allergy: (
                await pool.unsafe<{ id: string | null }[]>(
                    `select dicatat_oleh_nakes_id as id from sim_m_pasien_alergi
                     where pasien_id = $1 and nama = 'Plester' and deleted_at is null`,
                    [patientId],
                )
            )[0]?.id,
        });
        expect(await recorded()).toEqual({ measured: nurse, allergy: nurse });

        // Akun yang sesudahnya ditautkan ke nakes lain tidak mengubah catatan lama.
        await link(doctor);
        const plaster = saved.data.allergy.items.find(
            (item) => item.name === 'Plester',
        )!;
        const edited = await json<Shown>(
            await save(user, id, {
                ...saved.data,
                anamnesis: {
                    ...saved.data.anamnesis,
                    chief_complaint: 'Pusing',
                },
                allergy: {
                    none: false,
                    items: saved.data.allergy.items.map((item) =>
                        item.id === plaster.id
                            ? { ...item, reaction: 'Kemerahan' }
                            : item,
                    ),
                },
            }),
            200,
        );
        expect(await recorded()).toEqual({ measured: nurse, allergy: nurse });

        // Pengukuran baru memakai tautan saat itu, dan akun yang tertaut ke dua nakes aktif tidak punya nakes yang pasti.
        const remeasured = await json<Shown>(
            await save(user, id, {
                ...edited.data,
                physical: { ...edited.data.physical, pulse_rate: 91 },
            }),
            200,
        );
        expect((await recorded()).measured).toBe(doctor);
        await link(doctor, nurse);
        await json(
            await save(user, id, {
                ...remeasured.data,
                physical: { ...remeasured.data.physical, pulse_rate: 92 },
            }),
            200,
        );
        expect((await recorded()).measured).toBeNull();
        await link();
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
