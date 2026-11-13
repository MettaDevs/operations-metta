import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { onEvent } from '../../../../../src/platform/events/index.ts';
import {
    eventContract,
    outboxEnvelopes,
} from '../../../../../test/support/event-contracts.ts';
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

type ProcedureLine = {
    procedure_id: string | null;
    procedure_code?: string | null;
    procedure_name?: string | null;
    quantity: number | string | null;
    doctor_id: string | null;
    added_by?: string | null;
    added_at?: string | null;
};
type Line = {
    drug_id: string | null;
    unit_id?: string | null;
    unit_code?: string | null;
    quantity_per_unit?: string | null;
    units?: { id: string; code: string; quantity_per_unit: string }[];
    compound: number | null;
    quantity: number | string | null;
    requested_quantity?: number | string | null;
    signa?: string | null;
    usage_instruction_id?: string | null;
    frequency_per_day?: number | string | null;
    dose?: number | string | null;
    dose_unit_id?: string | null;
    dose_unit_code?: string | null;
    route_id?: string | null;
    duration_days?: number | string | null;
    notes?: string | null;
    drug_name?: string | null;
    unit_name?: string | null;
};
type Dosage = Required<
    Pick<
        Line,
        | 'frequency_per_day'
        | 'dose'
        | 'dose_unit_id'
        | 'route_id'
        | 'duration_days'
    >
>;
type Prescription = {
    id: string | null;
    number?: string | null;
    status?: string;
    notes: string | null;
    lines: Line[];
    doctor_name?: string | null;
};
type Record_ = {
    version: number | null;
    physical: Record<string, number | string | null>;
    procedures?: ProcedureLine[];
    prescriptions?: Prescription[];
    drug_allergies?: {
        drug_id: string;
        drug_code?: string | null;
        drug_name?: string;
    }[];
} & Record<string, unknown>;
type Shown = { data: Record_; context: { editable: boolean } };
type Reference = { id: string; code: string; name: string; active: boolean };
type Metadata = {
    usage_instructions: Reference[];
    medication_routes: Reference[];
    permissions: { create_procedure: boolean; create_drug: boolean };
};
type Section = {
    id: string;
    operating_unit_id: string;
    name: string;
    kind: string;
    version: number;
};

const api = '/api/modules/healthcare/v1';
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
const notStarted = 'Silahkan Klik Tombol Mulai Untuk Memulai Pemeriksaan !';
const finished =
    'Pemeriksaan ini sudah selesai, jadi isinya tidak dapat diubah lagi.';

// Panel Biaya Tindakan dan E-Resep halaman pemeriksaan: data acuan dari sistem lama, pesan sistem lama untuk tindakan
// ganda, obat ganda, obat alergi, dan racikan tidak valid, baris diubah di tempat dan dihapus lunak, obat dari legal
// entity kunjungan yang boleh diresepkan, Kirim ke farmasi dengan nomor resep dan event
// healthcare.prescription.issued.v1 di transaksi yang sama, batas ubah, bagian per section, batas tenant, dan izin.
// Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
const issued = 'healthcare.prescription.issued.v1';
// Penerima uji yang gagal hanya untuk tenant yang disebut, dipakai untuk membuktikan event dan resep batal bersama.
const failingTenants = new Set<string>();
onEvent(issued, 'healthcare', (_db, envelope) =>
    failingTenants.has(envelope.tenant_id)
        ? Promise.reject(new Error('Penerima uji gagal.'))
        : Promise.resolve(),
);
describe.skipIf(!process.env.DB_HOST)(
    'examination procedures and prescriptions',
    () => {
        if (!process.env.DB_HOST) return;
        const { pool, browser, close } = operationsTestApp();
        afterAll(close);

        let tenantId: string;
        let admin: Browser;
        let umum: string;
        let patientId: string;
        let unit: string;
        let room: string;
        let section: Section;
        let doctor: string;
        let nurse: string;
        let unitTab: string;
        let unitStrip: string;
        let legalEntityId: string;
        let metadata: Metadata;
        let dosage: Dosage;
        let drugCount = 0;

        async function json<T>(response: Response, status: number): Promise<T> {
            const text = await response.text();
            if (response.status !== status)
                throw new Error(
                    `Expected ${status}, got ${response.status}: ${text}`,
                );
            return JSON.parse(text) as T;
        }

        async function refused(response: Response) {
            return (
                await json<{ errors: Record<string, string[]> }>(response, 422)
            ).errors;
        }

        async function created<T = { id: string }>(
            as: Browser,
            path: string,
            body: Record<string, unknown>,
        ) {
            return (await json<{ data: T }>(await as.post(path, body), 201))
                .data;
        }

        async function login(tenant: string, duties: string[]) {
            const account = await createMember(pool, tenant, duties);
            await grantAllOrganizations(pool, tenant, account.membershipId);
            await pool.unsafe(
                `insert into role_assignment_data_policy_scopes
                 (id, tenant_id, role_assignment_id, policy_code, legal_entity_id, organization_id,
                  include_descendants, valid_from, created_at, updated_at)
             select $1, $2, id, 'healthcare.patient-unit', null, null, false, now() - interval '1 day', now(), now()
             from role_assignments where membership_id = $3`,
                [Bun.randomUUIDv7(), tenant, account.membershipId],
            );
            const session = browser();
            await session.login(account.email, account.password);
            return session;
        }

        async function visit(at: Section = section) {
            const registered = await json<{
                data: { destinations: { id: string }[] };
            }>(
                await admin.post(`${api}/visits`, {
                    patient_id: patientId,
                    patient_type_id: umum,
                    visit_condition: 'sakit',
                    section_id: at.id,
                }),
                201,
            );
            return registered.data.destinations[0]!.id;
        }

        async function start(id: string) {
            await json(
                await admin.post(
                    `${api}/examination/destinations/${id}/start`,
                    {
                        room_id: room,
                    },
                ),
                200,
            );
        }

        async function started(at: Section = section) {
            const id = await visit(at);
            await start(id);
            return id;
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

        const sendPath = (id: string) =>
            `${api}/examination/destinations/${id}/prescriptions/send`;

        // Kirim ke farmasi seperti layar: resep yang tampil beserta dokter dan perawat Anamnesa.
        async function send(as: Browser, id: string, version?: number | null) {
            const current = await show(as, id);
            const anamnesis = current.data.anamnesis as
                | { doctor_id?: string | null; nurse_id?: string | null }
                | undefined;
            return as.post(sendPath(id), {
                version: version === undefined ? current.data.version : version,
                doctor_id: anamnesis?.doctor_id ?? null,
                nurse_id: anamnesis?.nurse_id ?? null,
                prescriptions: current.data.prescriptions,
            });
        }

        async function procedure(code: string, name: string, as = admin) {
            return created<{ id: string; name: string }>(
                as,
                `${api}/procedures`,
                {
                    code,
                    name,
                },
            );
        }

        async function drug(
            name: string,
            as = admin,
            overrides: Record<string, unknown> = {},
        ) {
            drugCount += 1;
            return created<{
                id: string;
                code: string;
                name: string;
                version: number;
            }>(as, `${api}/drugs`, {
                code: `RSP${drugCount}`,
                name,
                base_unit_id: unitTab,
                dosage_form_id: null,
                is_prescribable: true,
                ...overrides,
            });
        }

        async function packaged(name: string) {
            const item = await drug(name);
            const entry = await created<{ entry_id: string; version: number }>(
                admin,
                '/api/v1/inventory/item-units',
                {
                    item_id: item.id,
                    unit_id: unitStrip,
                    quantity_per_unit: 10,
                },
            );
            await json(
                await admin.patch(`/api/v1/inventory/items/${item.id}`, {
                    code: item.code,
                    name: item.name,
                    base_unit_id: unitTab,
                    category_id: null,
                    version: item.version,
                    sales_unit_id: unitStrip,
                }),
                200,
            );
            return { ...item, entry };
        }

        const single = (
            drugId: string,
            quantity: number | string = 10,
        ): Line => ({
            drug_id: drugId,
            compound: null,
            quantity,
            signa: '3x1',
            usage_instruction_id: metadata.usage_instructions[1]!.id,
            ...dosage,
            notes: null,
        });

        const draft = (
            lines: Line[],
            notes: string | null = null,
        ): Prescription => ({
            id: null,
            notes,
            lines,
        });

        async function recordId(destination: string) {
            const [row] = await pool.unsafe<{ id: string }[]>(
                'select id from sim_tr_pemeriksaan where tujuan_id = $1 and deleted_at is null',
                [destination],
            );
            return row!.id;
        }

        beforeAll(async () => {
            tenantId = await createTenant(pool, 'Klinik Uji Resep');
            await entitle(pool, tenantId, 'healthcare');
            await recordInstallation(pool, tenantId, 'healthcare');
            admin = await login(tenantId, [
                'core.organization.manage',
                'core.inventory-setup.manage',
                'core.inventory-item.manage',
                'healthcare.patient.manage',
                'healthcare.payment-setup.manage',
                'healthcare.service-setup.manage',
                'healthcare.practitioner.manage',
                'healthcare.visit.manage',
                'healthcare.examination.manage',
                'healthcare.clinical-setup.manage',
                'core.pricing-setup.manage',
            ]);
            legalEntityId = (
                await created(admin, '/api/v1/organizations', {
                    classification: 'legal_entity',
                    name: 'PT Klinik Uji Resep',
                    company_code: `KR${Date.now() % 100000}`,
                    country_code: 'ID',
                })
            ).id;
            unit = (
                await created(admin, '/api/v1/organizations', {
                    classification: 'operating_unit',
                    name: 'Puskesmas Resep',
                    operating_unit_type: 'department',
                    operating_unit_number: 'PR1',
                })
            ).id;
            room = (
                await created(admin, `${api}/rooms`, {
                    operating_unit_id: unit,
                    code: 'RR1',
                    name: 'Ruang Resep',
                })
            ).id;
            section = await created<Section>(admin, `${api}/sections`, {
                operating_unit_id: unit,
                code: 'RESEP',
                name: 'Poli Umum Resep',
                kind: 'rawat_jalan',
                room_ids: [room],
            });
            umum = (
                await created(admin, `${api}/patient-types`, {
                    code: 'UMUM',
                    name: 'Umum',
                })
            ).id;
            patientId = (
                await created(admin, `${api}/patients`, {
                    name: 'Pasien Resep',
                    nationality_country_code: 'AU',
                    passport_number: `PR${Math.floor(Math.random() * 1e8)}`,
                    gender: 'female',
                    birth_date: '1985-02-03',
                    phone: '081200000031',
                    domicile_address: { street: 'Jl. Resep No. 1' },
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
                    name: 'Dokter Resep',
                    nik: String(Date.now()).slice(-12).padStart(16, '6'),
                    gender: 'male',
                    phone: '081200000032',
                    profession_id: professions.dokter,
                })
            ).id;
            nurse = (
                await created(admin, `${api}/practitioners`, {
                    name: 'Perawat Resep',
                    nik: String(Date.now() + 7)
                        .slice(-12)
                        .padStart(16, '5'),
                    gender: 'female',
                    phone: '081200000033',
                    profession_id: professions.perawat,
                })
            ).id;
            metadata = await json<Metadata>(
                await admin.get(`${api}/examination/medical-record/metadata`),
                200,
            );
            unitTab = (
                await created(admin, '/api/v1/inventory/units-of-measure', {
                    code: 'TAB',
                    name: 'Tablet',
                })
            ).id;
            unitStrip = (
                await created(admin, '/api/v1/inventory/units-of-measure', {
                    code: 'STRIP',
                    name: 'Strip',
                })
            ).id;
            dosage = {
                frequency_per_day: 3,
                dose: 1,
                dose_unit_id: unitTab,
                route_id: metadata.medication_routes.find(
                    (row) => row.code === 'O',
                )!.id,
                duration_days: 5,
            };
        }, 120_000);

        test('aturan pakai is seeded from the old system, drug units are not, and both panels are on by default', async () => {
            expect(metadata.usage_instructions.map((row) => row.name)).toEqual([
                'Sebelum Makan',
                'Setelah Makan',
                'Pemakaian Luar',
                'Jika Diperlukan',
                'Saat Makan',
            ]);
            const [units] = await pool.unsafe<
                { core: number; module: number }[]
            >(
                `select (select count(*)::int from gd_m_satuan where tenant_id = $1) as core,
                        (select count(*)::int from sim_m_satuan_obat where tenant_id = $1) as module`,
                [tenantId],
            );
            expect(units).toEqual({ core: 2, module: 0 });
            const id = await visit();
            const shown = await show(admin, id);
            expect(shown.data.procedures).toEqual([]);
            expect(shown.data.prescriptions).toEqual([]);
            expect(shown.data.drug_allergies).toEqual([]);
            expect(metadata.permissions).toMatchObject({
                create_procedure: true,
                create_drug: true,
            });
        });

        test('Biaya Tindakan keeps one row per procedure with the old message and updates rows in place', async () => {
            const id = await started();
            const injection = await procedure('J001', 'Injeksi');
            const wound = await procedure('J002', 'Rawat Luka');
            const line = (
                procedureId: string,
                quantity: number | string = 1,
            ) => ({
                procedure_id: procedureId,
                quantity,
                doctor_id: doctor,
            });
            expect(
                await refused(
                    await save(admin, id, {
                        procedures: [
                            line(injection.id),
                            line(injection.id),
                            line(wound.id, 0),
                            {
                                procedure_id: null,
                                quantity: 1,
                                doctor_id: nurse,
                            },
                        ],
                    }),
                ),
            ).toEqual({
                'procedures.1.procedure_id': [
                    'Biaya Tindakan Injeksi sudah ada pada daftar Jasa',
                ],
                'procedures.2.quantity': ['Isi jumlah 1 atau lebih.'],
                'procedures.3.procedure_id': ['Pilih tindakan.'],
                'procedures.3.doctor_id': [
                    'Pilih tenaga kesehatan dari daftar.',
                ],
            });
            const first = await json<Shown>(
                await save(admin, id, {
                    procedures: [line(injection.id, '2'), line(wound.id)],
                }),
                200,
            );
            expect(first.data.procedures).toMatchObject([
                {
                    procedure_code: 'J001',
                    procedure_name: 'Injeksi',
                    quantity: 2,
                    doctor_id: doctor,
                },
                { procedure_code: 'J002', quantity: 1 },
            ]);
            expect(first.data.procedures?.[0]?.added_at).toBeTruthy();
            const record = await recordId(id);
            const before = await pool.unsafe<
                { id: string; tindakan_id: string }[]
            >(
                'select id, tindakan_id from sim_tr_pemeriksaan_tindakan where pemeriksaan_id = $1 and deleted_at is null',
                [record],
            );
            await json(
                await save(admin, id, { procedures: [line(injection.id, 3)] }),
                200,
            );
            const after = await pool.unsafe<
                { id: string; jumlah: number; deleted_at: Date | null }[]
            >(
                'select id, jumlah, deleted_at from sim_tr_pemeriksaan_tindakan where pemeriksaan_id = $1 order by created_at, id',
                [record],
            );
            expect(after).toHaveLength(2);
            const kept = before.find(
                (row) => row.tindakan_id === injection.id,
            )!;
            expect(after.find((row) => row.id === kept.id)).toMatchObject({
                jumlah: 3,
                deleted_at: null,
            });
            expect(after.filter((row) => row.deleted_at)).toHaveLength(1);
            await pool.unsafe(
                'update sim_m_tindakan set aktif = false where id = $1',
                [injection.id],
            );
            await json(
                await save(admin, id, { procedures: [line(injection.id, 4)] }),
                200,
            );
            expect(
                await refused(
                    await save(admin, await started(), {
                        procedures: [line(injection.id)],
                    }),
                ),
            ).toEqual({
                'procedures.0.procedure_id': ['Pilih tindakan dari daftar.'],
            });
        });

        test('an examiner adds a procedure and a drug on the fly but cannot change the masters', async () => {
            const examiner = await login(tenantId, [
                'healthcare.examination.manage',
            ]);
            const added = await procedure('J900', 'Nebulizer', examiner);
            const tablet = await drug('Ambroxol 30 mg', examiner);
            expect(
                (
                    await examiner.patch(`${api}/procedures/${added.id}`, {
                        code: 'J900',
                        name: 'Ganti',
                        version: 1,
                    })
                ).status,
            ).toBe(403);
            expect(
                (
                    await examiner.patch(`${api}/drugs/${tablet.id}`, {
                        name: 'Ganti',
                        unit_id: unitTab,
                        version: 1,
                    })
                ).status,
            ).toBe(403);
            const reader = await login(tenantId, [
                'healthcare.examination.inquire',
            ]);
            const id = await started();
            expect(
                (await reader.put(path(id), (await show(reader, id)).data))
                    .status,
            ).toBe(403);
            expect((await send(reader, id)).status).toBe(403);
            expect(
                (
                    await reader.post(`${api}/drugs`, {
                        name: 'Tidak boleh',
                        unit_id: unitTab,
                    })
                ).status,
            ).toBe(403);
        });

        test('a prescription draft is saved with the page, rows are kept in place, and the old messages guard each line', async () => {
            const id = await started();
            const paracetamol = await drug('Paracetamol 500 mg');
            const amoxicillin = await drug('Amoxicillin 500 mg');
            const ctm = await drug('CTM 4 mg');
            expect(
                await refused(
                    await save(admin, id, {
                        prescriptions: [
                            draft([
                                single(paracetamol.id),
                                single(paracetamol.id),
                                { drug_id: null, compound: null, quantity: 1 },
                                { drug_id: ctm.id, compound: 2, quantity: 1 },
                                {
                                    drug_id: amoxicillin.id,
                                    compound: null,
                                    quantity: 0,
                                    ...dosage,
                                },
                            ]),
                        ],
                    }),
                ),
            ).toEqual({
                'prescriptions.0.lines.1.drug_id': [
                    'Tidak dapat menambahkan obat "Paracetamol 500 mg", karena obat ini sudah ada dalam resep!',
                ],
                'prescriptions.0.lines.2.drug_id': [
                    'Pilih Obat Sebelum ditambahkan kedalam resep',
                ],
                'prescriptions.0.lines.3.compound': ['Racikan tidak valid!'],
                'prescriptions.0.lines.4.quantity': [
                    'Isi jumlah lebih dari 0, paling banyak empat angka di belakang koma.',
                ],
            });
            const compounded: Line[] = [
                single(paracetamol.id, '10'),
                {
                    drug_id: null,
                    compound: 1,
                    quantity: null,
                    requested_quantity: 10,
                    signa: '3x1',
                    usage_instruction_id: metadata.usage_instructions[0]!.id,
                    ...dosage,
                },
                { drug_id: amoxicillin.id, compound: 1, quantity: 0.5 },
                { drug_id: ctm.id, compound: 1, quantity: 1 },
            ];
            expect(
                await refused(
                    await save(admin, id, {
                        prescriptions: [
                            draft([
                                ...compounded.slice(0, 3),
                                {
                                    drug_id: ctm.id,
                                    compound: 1,
                                    quantity: 1,
                                    signa: '1x1',
                                },
                                single(paracetamol.id),
                            ]),
                        ],
                    }),
                ),
            ).toEqual({
                'prescriptions.0.lines.3.signa': [
                    'Signa dan aturan pakai komponen racikan diisi pada baris racikannya.',
                ],
                'prescriptions.0.lines.4.drug_id': [
                    'Tidak dapat menambahkan obat "Paracetamol 500 mg", karena obat ini sudah ada dalam resep!',
                ],
            });
            const saved = await json<Shown>(
                await save(admin, id, {
                    prescriptions: [draft(compounded, 'Habiskan antibiotik')],
                }),
                200,
            );
            const [prescription] = saved.data.prescriptions!;
            expect(prescription).toMatchObject({
                number: null,
                status: 'draf',
                notes: 'Habiskan antibiotik',
            });
            expect(prescription!.lines).toMatchObject([
                {
                    drug_name: 'Paracetamol 500 mg',
                    unit_name: 'Tablet',
                    quantity: 10,
                },
                {
                    drug_id: null,
                    compound: 1,
                    requested_quantity: 10,
                    quantity: null,
                },
                { drug_name: 'Amoxicillin 500 mg', compound: 1, quantity: 0.5 },
                { drug_name: 'CTM 4 mg', compound: 1, quantity: 1 },
            ]);
            const rows = async () =>
                pool.unsafe<
                    {
                        id: string;
                        obat_id: string | null;
                        deleted_at: Date | null;
                    }[]
                >(
                    'select id, obat_id, deleted_at from sim_tr_resep_detail where resep_id = $1 order by created_at, id',
                    [prescription!.id],
                );
            const before = await rows();
            expect(
                await refused(
                    await save(admin, id, {
                        prescriptions: [prescription!, draft([single(ctm.id)])],
                    }),
                ),
            ).toEqual({
                'prescriptions.1.id': [
                    'Kirim resep yang masih draf lebih dulu sebelum membuat resep baru.',
                ],
            });
            await json(
                await save(admin, id, {
                    prescriptions: [
                        {
                            ...prescription!,
                            lines: prescription!.lines.filter(
                                (line) => line.drug_id !== ctm.id,
                            ),
                        },
                    ],
                }),
                200,
            );
            const after = await rows();
            expect(after.map((row) => row.id)).toEqual(
                before.map((row) => row.id),
            );
            expect(
                after.filter((row) => row.deleted_at).map((row) => row.obat_id),
            ).toEqual([ctm.id]);
        });

        test('single drugs and racikan carry a full dosage, components carry none, and amounts keep four decimals', async () => {
            const id = await started();
            const syrup = await drug('Parasetamol sirup dosis');
            const ctm = await drug('CTM 4 mg dosis');
            const none = {
                frequency_per_day: null,
                dose: null,
                dose_unit_id: null,
                route_id: null,
                duration_days: null,
            };
            const header: Line = {
                drug_id: null,
                compound: 1,
                quantity: null,
                requested_quantity: 10,
            };
            const component: Line = {
                drug_id: ctm.id,
                compound: 1,
                quantity: 1,
            };
            const errors = (line: number, messages: Record<string, string>) =>
                Object.fromEntries(
                    Object.entries(messages).map(([name, message]) => [
                        `prescriptions.0.lines.${line}.${name}`,
                        [message],
                    ]),
                );
            const required = {
                frequency_per_day: 'Isi berapa kali sehari.',
                dose: 'Isi dosis sekali pakai.',
                dose_unit_id: 'Pilih satuan dosis.',
                route_id: 'Pilih rute pemberian.',
                duration_days: 'Isi lama pemberian (hari).',
            };
            const onHeader =
                'Dosis komponen racikan diisi pada baris racikannya.';
            expect(
                await refused(
                    await save(admin, id, {
                        prescriptions: [
                            draft([
                                { ...single(syrup.id), ...none },
                                { ...header, ...none },
                                { ...component, ...dosage },
                            ]),
                        ],
                    }),
                ),
            ).toEqual({
                ...errors(0, required),
                ...errors(1, required),
                ...errors(2, {
                    frequency_per_day: onHeader,
                    dose: onHeader,
                    dose_unit_id: onHeader,
                    route_id: onHeader,
                    duration_days: onHeader,
                }),
            });

            const unknown = Bun.randomUUIDv7();
            expect(
                await refused(
                    await save(admin, id, {
                        prescriptions: [
                            draft([
                                {
                                    ...single(syrup.id, '1.23456'),
                                    frequency_per_day: 1.5,
                                    dose: '0.00001',
                                    dose_unit_id: unknown,
                                    route_id: unknown,
                                    duration_days: 0,
                                },
                                {
                                    ...header,
                                    ...dosage,
                                    requested_quantity: '2.00001',
                                },
                                component,
                            ]),
                        ],
                    }),
                ),
            ).toEqual({
                ...errors(0, {
                    quantity:
                        'Isi jumlah lebih dari 0, paling banyak empat angka di belakang koma.',
                    frequency_per_day:
                        'Isi berapa kali sehari dengan bilangan bulat 1 atau lebih.',
                    dose: 'Isi dosis lebih dari 0, paling banyak empat angka di belakang koma.',
                    dose_unit_id: 'Pilih satuan dosis dari daftar.',
                    route_id: 'Pilih rute pemberian dari daftar.',
                    duration_days:
                        'Isi lama pemberian dengan bilangan bulat 1 hari atau lebih.',
                }),
                ...errors(1, {
                    requested_quantity:
                        'Isi jumlah lebih dari 0, paling banyak empat angka di belakang koma.',
                }),
            });

            const rectal = metadata.medication_routes.find(
                (row) => row.code === 'R',
            )!;
            const saved = await json<Shown>(
                await save(admin, id, {
                    prescriptions: [
                        draft([
                            {
                                ...single(syrup.id, '1.2345'),
                                dose: '0.1234',
                                dose_unit_id: unitStrip,
                                duration_days: '7',
                            },
                            {
                                ...header,
                                requested_quantity: '2.5',
                                frequency_per_day: '2',
                                dose: 1,
                                dose_unit_id: unitTab,
                                route_id: rectal.id,
                                duration_days: 3,
                            },
                            component,
                        ]),
                    ],
                }),
                200,
            );
            const [prescription] = saved.data.prescriptions!;
            expect(prescription!.lines).toMatchObject([
                {
                    quantity: 1.2345,
                    frequency_per_day: 3,
                    dose: 0.1234,
                    dose_unit_id: unitStrip,
                    dose_unit_code: 'STRIP',
                    route_id: dosage.route_id,
                    duration_days: 7,
                },
                {
                    requested_quantity: 2.5,
                    frequency_per_day: 2,
                    dose: 1,
                    dose_unit_id: unitTab,
                    dose_unit_code: 'TAB',
                    route_id: rectal.id,
                    duration_days: 3,
                },
                { quantity: 1, ...none },
            ]);
            const stored = async () =>
                pool.unsafe<
                    {
                        jumlah: string | null;
                        jumlah_permintaan: string | null;
                        frekuensi: number | null;
                        dosis: string | null;
                        dosis_satuan_id: string | null;
                        rute_id: string | null;
                        lama_hari: number | null;
                        version: number;
                    }[]
                >(
                    `select jumlah::text, jumlah_permintaan::text, frekuensi, dosis::text, dosis_satuan_id, rute_id,
                            lama_hari, version
                     from sim_tr_resep_detail where resep_id = $1 and deleted_at is null order by urutan`,
                    [prescription!.id],
                );
            const before = await stored();
            expect(before.map(({ version: _, ...row }) => row)).toEqual([
                {
                    jumlah: '1.2345',
                    jumlah_permintaan: null,
                    frekuensi: 3,
                    dosis: '0.1234',
                    dosis_satuan_id: unitStrip,
                    rute_id: dosage.route_id,
                    lama_hari: 7,
                },
                {
                    jumlah: null,
                    jumlah_permintaan: '2.5000',
                    frekuensi: 2,
                    dosis: '1.0000',
                    dosis_satuan_id: unitTab,
                    rute_id: rectal.id,
                    lama_hari: 3,
                },
                {
                    jumlah: '1.0000',
                    jumlah_permintaan: null,
                    frekuensi: null,
                    dosis: null,
                    dosis_satuan_id: null,
                    rute_id: null,
                    lama_hari: null,
                },
            ]);
            await json(
                await save(admin, id, { prescriptions: [prescription!] }),
                200,
            );
            expect(await stored()).toEqual(before);
        });

        test('a dosage keeps its route after the route is turned off, but new lines cannot choose it', async () => {
            const id = await started();
            const ointment = await drug('Salep kulit');
            const cream = await drug('Krim kulit');
            const routes = `${api}/diagnosis-references/medication-routes`;
            const topical = await created<{ id: string; version: number }>(
                admin,
                routes,
                { code: 'TOP', name: 'Topikal' },
            );
            const onSkin = (drugId: string) => ({
                ...single(drugId),
                route_id: topical.id,
            });
            const saved = await json<Shown>(
                await save(admin, id, {
                    prescriptions: [draft([onSkin(ointment.id)])],
                }),
                200,
            );
            await json(
                await admin.patch(`${routes}/${topical.id}`, {
                    code: 'TOP',
                    name: 'Topikal',
                    is_active: false,
                    version: topical.version,
                }),
                200,
            );
            const [prescription] = saved.data.prescriptions!;
            expect(
                await refused(
                    await save(admin, id, {
                        prescriptions: [
                            {
                                ...prescription!,
                                lines: [
                                    ...prescription!.lines,
                                    onSkin(cream.id),
                                ],
                            },
                        ],
                    }),
                ),
            ).toEqual({
                'prescriptions.0.lines.1.route_id': [
                    'Pilih rute pemberian dari daftar.',
                ],
            });
            await json(
                await save(admin, id, { prescriptions: [prescription!] }),
                200,
            );
        });

        test('a drug line takes the sales unit unless another unit of that drug is chosen, and keeps the isi copied when its unit was chosen', async () => {
            const id = await started();
            const antacid = await packaged('Antasida tablet kunyah');
            const ctm = await drug('CTM 4 mg dalam strip');
            const offered = await json<{
                data: {
                    id: string;
                    sales_unit_id: string;
                    units: { code: string; quantity_per_unit: string }[];
                }[];
            }>(
                await admin.get(
                    `${api}/drugs?prescribable=true&q=${encodeURIComponent('Antasida tablet')}`,
                ),
                200,
            );
            expect(offered.data).toMatchObject([
                {
                    id: antacid.id,
                    sales_unit_id: unitStrip,
                    units: [
                        { code: 'TAB', quantity_per_unit: '1' },
                        { code: 'STRIP', quantity_per_unit: '10' },
                    ],
                },
            ]);
            expect(
                await refused(
                    await save(admin, id, {
                        prescriptions: [
                            draft([
                                single(antacid.id, 2),
                                { ...single(ctm.id, 2), unit_id: unitStrip },
                            ]),
                        ],
                    }),
                ),
            ).toEqual({
                'prescriptions.0.lines.1.unit_id': [
                    'Pilih satuan obat ini dari daftar.',
                ],
            });
            const saved = await json<Shown>(
                await save(admin, id, {
                    prescriptions: [draft([single(antacid.id, 2)])],
                }),
                200,
            );
            const prescription = saved.data.prescriptions![0]!;
            expect(prescription.lines[0]).toMatchObject({
                unit_id: unitStrip,
                unit_code: 'STRIP',
                quantity: 2,
                quantity_per_unit: '10',
                units: [
                    { id: unitTab, code: 'TAB', quantity_per_unit: '1' },
                    { id: unitStrip, code: 'STRIP', quantity_per_unit: '10' },
                ],
            });
            const stored = async () =>
                (
                    await pool.unsafe<
                        { satuan_id: string; konversi: string }[]
                    >(
                        `select satuan_id, trim_scale(konversi)::text as konversi from sim_tr_resep_detail
                         where resep_id = $1 and deleted_at is null`,
                        [prescription.id],
                    )
                )[0];
            expect(await stored()).toEqual({
                satuan_id: unitStrip,
                konversi: '10',
            });
            await json(
                await admin.patch(
                    `/api/v1/inventory/item-units/${antacid.entry.entry_id}`,
                    {
                        item_id: antacid.id,
                        unit_id: unitStrip,
                        quantity_per_unit: 12,
                        version: antacid.entry.version,
                    },
                ),
                200,
            );
            await json(
                await save(admin, id, { prescriptions: [prescription] }),
                200,
            );
            expect(await stored()).toEqual({
                satuan_id: unitStrip,
                konversi: '10',
            });
            const withUnit = (row: Prescription, unitId: string) => ({
                ...row,
                lines: row.lines.map((line) => ({ ...line, unit_id: unitId })),
            });
            const inTablets = await json<Shown>(
                await save(admin, id, {
                    prescriptions: [withUnit(prescription, unitTab)],
                }),
                200,
            );
            expect(await stored()).toEqual({
                satuan_id: unitTab,
                konversi: '1',
            });
            await json(
                await save(admin, id, {
                    prescriptions: [
                        withUnit(inTablets.data.prescriptions![0]!, unitStrip),
                    ],
                }),
                200,
            );
            expect(await stored()).toEqual({
                satuan_id: unitStrip,
                konversi: '12',
            });
        });

        test('a drug allergy belongs to the patient and blocks that drug with the old message, also in the same Simpan', async () => {
            const id = await started();
            const ibuprofen = await drug('Ibuprofen 400 mg');
            const aspirin = await drug('Asam Asetilsalisilat 80 mg');
            expect(
                await refused(
                    await save(admin, id, {
                        drug_allergies: [{ drug_id: ibuprofen.id }],
                        prescriptions: [draft([single(ibuprofen.id)])],
                    }),
                ),
            ).toEqual({
                'prescriptions.0.lines.0.drug_id': [
                    'Tidak dapat menambahkan obat "Ibuprofen 400 mg", karena pasien alergi terhadap obat ini!',
                ],
            });
            await json(
                await save(admin, id, {
                    drug_allergies: [
                        { drug_id: ibuprofen.id },
                        { drug_id: ibuprofen.id },
                    ],
                }),
                200,
            );
            const next = await started();
            expect((await show(admin, next)).data.drug_allergies).toEqual([
                {
                    drug_id: ibuprofen.id,
                    drug_code: ibuprofen.code,
                    drug_name: 'Ibuprofen 400 mg',
                },
            ]);
            expect(
                await refused(
                    await save(admin, next, {
                        prescriptions: [
                            draft([
                                {
                                    drug_id: null,
                                    compound: 1,
                                    quantity: null,
                                    ...dosage,
                                },
                                {
                                    drug_id: ibuprofen.id,
                                    compound: 1,
                                    quantity: 1,
                                },
                            ]),
                        ],
                    }),
                ),
            ).toEqual({
                'prescriptions.0.lines.1.drug_id': [
                    'Tidak dapat menambahkan obat "Ibuprofen 400 mg", karena pasien alergi terhadap obat ini!',
                ],
            });
            await json(
                await save(admin, next, {
                    drug_allergies: [{ drug_id: aspirin.id }],
                    prescriptions: [draft([single(ibuprofen.id)])],
                }),
                200,
            );
            const allergies = await pool.unsafe<
                { obat_id: string; deleted_at: Date | null }[]
            >(
                'select obat_id, deleted_at from sim_m_pasien_alergi_obat where pasien_id = $1 order by created_at, id',
                [patientId],
            );
            expect(
                allergies.map((row) => [row.obat_id, row.deleted_at === null]),
            ).toEqual([
                [ibuprofen.id, false],
                [aspirin.id, true],
            ]);
        });

        test('Kirim ke farmasi numbers the prescription, locks it, and leaves room for a new draft', async () => {
            const id = await started();
            const vitaminC = await drug('Vitamin C 50 mg');
            const zinc = await drug('Zinc 20 mg');
            await json(
                await save(admin, id, {
                    anamnesis: {
                        ...((await show(admin, id)).data.anamnesis as Record<
                            string,
                            unknown
                        >),
                        doctor_id: doctor,
                        nurse_id: nurse,
                    },
                    prescriptions: [draft([])],
                }),
                200,
            );
            expect(await refused(await send(admin, id))).toEqual({
                prescription: ['Resep belum berisi obat.'],
            });
            const stale = (await show(admin, id)).data.version;
            await json(
                await save(admin, id, {
                    prescriptions: [draft([], 'Catatan saja')],
                }),
                200,
            );
            expect((await send(admin, id, stale)).status).toBe(409);
            expect(await refused(await send(admin, id))).toEqual({
                prescription: ['Resep belum berisi obat.'],
            });
            const current = (await show(admin, id)).data.prescriptions![0]!;
            await json(
                await save(admin, id, {
                    prescriptions: [
                        { ...current, lines: [single(vitaminC.id)] },
                    ],
                }),
                200,
            );
            const sentShown = await json<Shown>(await send(admin, id), 200);
            const [sent] = sentShown.data.prescriptions!;
            expect(sent).toMatchObject({
                number: 'PR1-RSP-00000001',
                status: 'dikirim',
                doctor_name: 'Dokter Resep',
            });
            const resend = await admin.post(sendPath(id), {
                version: sentShown.data.version,
                prescriptions: sentShown.data.prescriptions,
            });
            expect(await refused(resend)).toEqual({
                prescription: ['Resep belum berisi obat.'],
            });
            await json(
                await save(admin, id, {
                    prescriptions: [
                        { ...sent!, lines: [single(zinc.id)] },
                        draft([single(zinc.id)]),
                    ],
                }),
                200,
            );
            const after = (await show(admin, id)).data.prescriptions!;
            expect(
                after.map((row) => [
                    row.status,
                    row.lines.map((line) => line.drug_name),
                ]),
            ).toEqual([
                ['dikirim', ['Vitamin C 50 mg']],
                ['draf', ['Zinc 20 mg']],
            ]);
            expect(
                (
                    await json<Shown>(await send(admin, id), 200)
                ).data.prescriptions!.map((row) => row.number),
            ).toEqual(['PR1-RSP-00000001', 'PR1-RSP-00000002']);
        });

        test('Kirim ke farmasi saves and sends the prescription alone, without saving or checking the rest of the record', async () => {
            const id = await started();
            const amoxicillin = await drug('Amoxicillin kirim sendiri');
            const opened = await show(admin, id);
            const prescription = draft([single(amoxicillin.id)]);
            expect(
                (
                    await admin.put(path(id), {
                        ...opened.data,
                        prescriptions: [prescription],
                    })
                ).status,
            ).toBe(422);

            const withoutDrug = await refused(
                await admin.post(sendPath(id), {
                    version: opened.data.version,
                    doctor_id: doctor,
                    prescriptions: [
                        draft([{ ...single(amoxicillin.id), drug_id: null }]),
                    ],
                }),
            );
            expect(Object.keys(withoutDrug).length).toBeGreaterThan(0);
            expect(
                Object.keys(withoutDrug).filter(
                    (field) => !field.startsWith('prescriptions.0.'),
                ),
            ).toEqual([]);

            const sent = await json<Shown>(
                await admin.post(sendPath(id), {
                    version: opened.data.version,
                    doctor_id: doctor,
                    nurse_id: nurse,
                    prescriptions: [prescription],
                }),
                200,
            );
            expect(sent.data.prescriptions).toMatchObject([
                { status: 'dikirim', doctor_name: 'Dokter Resep' },
            ]);
            expect(sent.data.version).not.toBe(opened.data.version);
            const [unsaved] = await pool.unsafe<{ panels: number }[]>(
                `select (select count(*) from sim_tr_pemeriksaan_fisik f where f.pemeriksaan_id = p.id)::int as panels
                 from sim_tr_pemeriksaan p where p.id = $1 and p.keluhan_utama is null and p.dokter_id is null`,
                [String(sent.data.id)],
            );
            expect(unsaved).toEqual({ panels: 0 });
        });

        test('procedures and prescriptions are locked before Mulai periksa and after Selesai periksa', async () => {
            const id = await visit();
            const salbutamol = await drug('Salbutamol 2 mg');
            expect(
                (
                    await refused(
                        await admin.put(path(id), {
                            ...(await show(admin, id)).data,
                            prescriptions: [draft([single(salbutamol.id)])],
                        }),
                    )
                ).status,
            ).toEqual([notStarted]);
            await start(id);
            const opened = await show(admin, id);
            await json(
                await save(admin, id, {
                    anamnesis: {
                        ...(opened.data.anamnesis as object),
                        doctor_id: doctor,
                    },
                    prescriptions: [draft([single(salbutamol.id)])],
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
            expect((await refused(await send(admin, id))).status).toEqual([
                finished,
            ]);
            expect(
                (await refused(await save(admin, id, { procedures: [] })))
                    .status,
            ).toEqual([finished]);
        });

        test('a section without the panels neither shows nor accepts them', async () => {
            const plain = await created<Section>(admin, `${api}/sections`, {
                operating_unit_id: unit,
                code: 'TANPA-RESEP',
                name: 'Poli Tanpa Resep',
                kind: 'rawat_jalan',
                room_ids: [room],
                examination_panels: [
                    'anamnesis',
                    'history',
                    'physical',
                    'diagnoses',
                    'prognosis',
                ],
            });
            const id = await started(plain);
            const shown = await show(admin, id);
            expect(shown.data.procedures).toBeUndefined();
            expect(shown.data.prescriptions).toBeUndefined();
            expect(
                await refused(
                    await admin.put(path(id), {
                        ...shown.data,
                        physical: { ...shown.data.physical, ...vitals },
                        procedures: [],
                        prescriptions: [],
                    }),
                ),
            ).toEqual({
                procedures: [
                    'Bagian Biaya Tindakan tidak dipakai di poli ini. Muat ulang halaman pemeriksaan.',
                ],
                prescriptions: [
                    'Bagian E-Resep tidak dipakai di poli ini. Muat ulang halaman pemeriksaan.',
                ],
            });
            expect(await refused(await send(admin, id))).toEqual({
                prescriptions: [
                    'Bagian E-Resep tidak dipakai di poli ini. Muat ulang halaman pemeriksaan.',
                ],
            });
        });

        test('another tenant cannot use this tenant’s drugs and procedures or see its records', async () => {
            const id = await started();
            const own = await drug('Obat Milik Klinik');
            const ownProcedure = await procedure(
                'J777',
                'Tindakan Milik Klinik',
            );
            const other = await createTenant(pool, 'Klinik Lain Resep');
            await entitle(pool, other, 'healthcare');
            await recordInstallation(pool, other, 'healthcare');
            const outsider = await login(other, [
                'core.organization.manage',
                'healthcare.examination.manage',
                'healthcare.clinical-setup.manage',
            ]);
            await created(outsider, '/api/v1/organizations', {
                classification: 'legal_entity',
                name: 'PT Klinik Lain Resep',
                company_code: `KL${Date.now() % 100000}`,
                country_code: 'ID',
            });
            expect((await outsider.get(path(id))).status).toBe(404);
            const list = await json<{ data: { id: string }[] }>(
                await outsider.get(`${api}/drugs?q=Milik`),
                200,
            );
            expect(list.data).toEqual([]);
            expect(
                (await outsider.post(sendPath(id), { version: 1 })).status,
            ).toBe(404);
            expect(
                (
                    await json<{ data: { id: string }[] }>(
                        await outsider.get(`${api}/procedures?q=Milik`),
                        200,
                    )
                ).data,
            ).toEqual([]);
            expect(
                (
                    await outsider.patch(`${api}/drugs/${own.id}`, {
                        name: 'Diambil',
                        unit_id: unitTab,
                        version: 1,
                    })
                ).status,
            ).toBe(404);
            expect(
                (
                    await outsider.delete(
                        `${api}/procedures/${ownProcedure.id}`,
                        { version: 1 },
                    )
                ).status,
            ).toBe(404);
            const theirs = await json<Metadata>(
                await outsider.get(
                    `${api}/examination/medical-record/metadata`,
                ),
                200,
            );
            expect(theirs.usage_instructions).toHaveLength(5);
            expect(
                theirs.usage_instructions.some((row) =>
                    metadata.usage_instructions.some(
                        (mine) => mine.id === row.id,
                    ),
                ),
            ).toBe(false);
        });
        test('E-Resep offers and accepts only prescribable, unblocked drugs of the visit legal entity', async () => {
            const offered = await drug('Cetirizine 10 mg');
            const resting = await drug('Cetirizine sirup', admin, {
                is_prescribable: false,
            });
            const blocked = await drug('Cetirizine tetes');
            const item = (
                await json<{
                    data: {
                        id: string;
                        code: string;
                        name: string;
                        version: number;
                    }[];
                }>(
                    await admin.get(
                        `/api/v1/inventory/items?q=${blocked.code}`,
                    ),
                    200,
                )
            ).data[0]!;
            await json(
                await admin.patch(`/api/v1/inventory/items/${blocked.id}`, {
                    code: item.code,
                    name: item.name,
                    base_unit_id: unitTab,
                    is_blocked: true,
                    version: item.version,
                }),
                200,
            );
            const elsewhere = (
                await created(admin, '/api/v1/organizations', {
                    classification: 'legal_entity',
                    name: 'PT Klinik Uji Resep Kedua',
                    company_code: `KS${Date.now() % 100000}`,
                    country_code: 'ID',
                })
            ).id;
            const workspace = async (legalEntity: string) => {
                const [membership] = await pool.unsafe<{ id: string }[]>(
                    `select m.id from tenant_memberships m join users u on u.id = m.user_id
                     where m.tenant_id = $1 order by m.created_at limit 1`,
                    [tenantId],
                );
                await json(
                    await admin.put('/api/v1/workspace-context', {
                        membership_id: membership!.id,
                        legal_entity_id: legalEntity,
                    }),
                    200,
                );
            };
            await workspace(elsewhere);
            const otherUnit = (
                await created(admin, '/api/v1/inventory/units-of-measure', {
                    code: 'TAB',
                    name: 'Tablet',
                })
            ).id;
            const foreign = await drug('Cetirizine kedua', admin, {
                base_unit_id: otherUnit,
            });
            await workspace(legalEntityId);

            const lookup = await json<{ data: { id: string }[] }>(
                await admin.get(`${api}/drugs?q=Cetirizine&prescribable=true`),
                200,
            );
            expect(lookup.data.map((row) => row.id)).toEqual([offered.id]);

            const id = await started();
            expect(
                await refused(
                    await save(admin, id, {
                        prescriptions: [
                            draft([
                                single(offered.id),
                                single(resting.id),
                                single(blocked.id),
                                single(foreign.id),
                            ]),
                        ],
                    }),
                ),
            ).toEqual({
                'prescriptions.0.lines.1.drug_id': ['Pilih obat dari daftar.'],
                'prescriptions.0.lines.2.drug_id': ['Pilih obat dari daftar.'],
                'prescriptions.0.lines.3.drug_id': ['Pilih obat dari daftar.'],
            });
            await json(
                await save(admin, id, {
                    prescriptions: [draft([single(offered.id)])],
                }),
                200,
            );
        });

        test('Kirim ke farmasi writes one issued event with the prescription snapshot, matching its contract', async () => {
            const id = await started();
            const amoxicillin = await drug('Amoxicillin 500 mg kapsul');
            const ctm = await drug('CTM 4 mg tablet');
            const antacid = await packaged('Antasida DOEN');
            await json(
                await save(admin, id, {
                    anamnesis: {
                        ...((await show(admin, id)).data.anamnesis as Record<
                            string,
                            unknown
                        >),
                        doctor_id: doctor,
                        nurse_id: nurse,
                    },
                    prescriptions: [
                        draft(
                            [
                                single(amoxicillin.id, '15'),
                                {
                                    drug_id: null,
                                    compound: 1,
                                    quantity: null,
                                    requested_quantity: '10',
                                    signa: '3x1 bungkus',
                                    usage_instruction_id: null,
                                    frequency_per_day: 2,
                                    dose: '1.25',
                                    dose_unit_id: unitStrip,
                                    route_id: dosage.route_id,
                                    duration_days: 3,
                                    notes: 'Puyer',
                                },
                                {
                                    drug_id: ctm.id,
                                    compound: 1,
                                    quantity: '2.5',
                                    signa: null,
                                    usage_instruction_id: null,
                                    notes: null,
                                },
                                single(antacid.id, '2'),
                            ],
                            'Habiskan antibiotik',
                        ),
                    ],
                }),
                200,
            );
            const before = await outboxEnvelopes(pool, tenantId, issued);
            const sentShown = await json<Shown>(await send(admin, id), 200);
            const sent = sentShown.data.prescriptions!.find(
                (row) => row.status === 'dikirim',
            )!;
            const events = (
                await outboxEnvelopes(pool, tenantId, issued)
            ).filter((row) => !before.some((old) => old.id === row.id));
            expect(events).toHaveLength(1);
            const [event] = events;
            const contract = await eventContract(issued);
            expect(contract.safeParse(event).error).toBeUndefined();

            const [visit] = await pool.unsafe<
                {
                    registration_number: string;
                    operating_unit_id: string;
                    nrm: string;
                }[]
            >(
                `select g.no_reg as registration_number, g.operating_unit_id, k.nrm
                 from sim_tr_registrasi_tujuan t
                 join sim_tr_registrasi g on g.id = t.registrasi_id
                 join sim_m_pasien k on k.id = g.pasien_id
                 where t.id = $1`,
                [id],
            );
            expect(event).toMatchObject({
                legal_entity_id: legalEntityId,
                org_unit_id: visit!.operating_unit_id,
                data: {
                    prescription_id: sent.id,
                    prescription_number: sent.number,
                    registration_number: visit!.registration_number,
                    notes: 'Habiskan antibiotik',
                    patient: {
                        id: patientId,
                        medical_record_number: visit!.nrm,
                        name: 'Pasien Resep',
                        birth_date: '1985-02-03',
                        ktp: true,
                    },
                    doctor: { id: doctor, name: 'Dokter Resep' },
                    section: { id: section.id, name: 'Poli Umum Resep' },
                    price_group: null,
                    lines: [
                        {
                            order: 1,
                            item: {
                                id: amoxicillin.id,
                                code: amoxicillin.code,
                                name: 'Amoxicillin 500 mg kapsul',
                            },
                            compound: null,
                            quantity: '15',
                            unit: { id: unitTab, code: 'TAB', name: 'Tablet' },
                            quantity_per_unit: '1',
                            base_unit: {
                                id: unitTab,
                                code: 'TAB',
                                name: 'Tablet',
                            },
                            base_quantity: '15',
                            requested_quantity: null,
                            signa: '3x1',
                            usage_instruction: 'Setelah Makan',
                            frequency_per_day: 3,
                            dose: '1',
                            dose_unit: {
                                id: unitTab,
                                code: 'TAB',
                                name: 'Tablet',
                            },
                            route: { code: 'O', name: 'Oral' },
                            duration_days: 5,
                            notes: null,
                        },
                        {
                            order: 2,
                            item: null,
                            compound: 1,
                            quantity: null,
                            unit: null,
                            quantity_per_unit: null,
                            base_unit: null,
                            base_quantity: null,
                            requested_quantity: '10',
                            signa: '3x1 bungkus',
                            usage_instruction: null,
                            frequency_per_day: 2,
                            dose: '1.25',
                            dose_unit: {
                                id: unitStrip,
                                code: 'STRIP',
                                name: 'Strip',
                            },
                            route: { code: 'O', name: 'Oral' },
                            duration_days: 3,
                            notes: 'Puyer',
                        },
                        {
                            order: 3,
                            item: {
                                id: ctm.id,
                                code: ctm.code,
                                name: 'CTM 4 mg tablet',
                            },
                            compound: 1,
                            quantity: '2.5',
                            base_quantity: '2.5',
                            requested_quantity: null,
                            signa: null,
                            frequency_per_day: null,
                            dose: null,
                            dose_unit: null,
                            route: null,
                            duration_days: null,
                        },
                        {
                            order: 4,
                            item: { id: antacid.id, name: 'Antasida DOEN' },
                            compound: null,
                            quantity: '2',
                            unit: {
                                id: unitStrip,
                                code: 'STRIP',
                                name: 'Strip',
                            },
                            quantity_per_unit: '10',
                            base_unit: {
                                id: unitTab,
                                code: 'TAB',
                                name: 'Tablet',
                            },
                            base_quantity: '20',
                        },
                    ],
                },
            });
        });

        test('a double Kirim publishes once, and a failure after publishing keeps neither the event nor the sent status', async () => {
            const twice = await started();
            const zinc = await drug('Zinc sirup');
            await json(
                await save(admin, twice, {
                    prescriptions: [draft([single(zinc.id)])],
                }),
                200,
            );
            const before = (await outboxEnvelopes(pool, tenantId, issued))
                .length;
            const shown = await show(admin, twice);
            const click = () =>
                admin.post(sendPath(twice), {
                    version: shown.data.version,
                    prescriptions: shown.data.prescriptions,
                });
            const clicks = await Promise.all([click(), click()]);
            expect(clicks.map((response) => response.status).sort()).toEqual([
                200, 409,
            ]);
            expect((await outboxEnvelopes(pool, tenantId, issued)).length).toBe(
                before + 1,
            );

            const failing = await started();
            await json(
                await save(admin, failing, {
                    prescriptions: [draft([single(zinc.id)])],
                }),
                200,
            );
            failingTenants.add(tenantId);
            try {
                expect((await send(admin, failing)).status).toBe(500);
            } finally {
                failingTenants.delete(tenantId);
            }
            const [kept] = await pool.unsafe<
                { status: string; nomor: string | null }[]
            >(
                `select status, nomor from sim_tr_resep where pemeriksaan_id = $1 and deleted_at is null`,
                [await recordId(failing)],
            );
            expect(kept).toEqual({ status: 'draf', nomor: null });
            expect((await outboxEnvelopes(pool, tenantId, issued)).length).toBe(
                before + 1,
            );
            expect((await send(admin, failing)).status).toBe(200);
            expect((await outboxEnvelopes(pool, tenantId, issued)).length).toBe(
                before + 2,
            );
        });

        test("Kirim carries the price group of the visit's patient type for pharmacy prices", async () => {
            const priceGroup = await created<{
                id: string;
                code: string;
                name: string;
            }>(admin, '/api/v1/pricing/price-groups', {
                code: 'UMUM-RSP',
                name: 'Umum resep',
            });
            const patientType = async () => {
                const listed = await json<{
                    data: {
                        id: string;
                        code: string;
                        name: string;
                        version: number;
                    }[];
                }>(await admin.get(`${api}/patient-types?q=UMUM`), 200);
                const type = listed.data.find((row) => row.id === umum)!;
                return type;
            };
            const assign = async (priceGroupId: string | null) => {
                const type = await patientType();
                await json(
                    await admin.patch(`${api}/patient-types/${umum}`, {
                        code: type.code,
                        name: type.name,
                        price_group_id: priceGroupId,
                        version: type.version,
                    }),
                    200,
                );
            };
            await assign(priceGroup.id);
            try {
                const id = await started();
                const zinc = await drug('Zinc tablet harga');
                await json(
                    await save(admin, id, {
                        prescriptions: [draft([single(zinc.id)])],
                    }),
                    200,
                );
                const before = await outboxEnvelopes(pool, tenantId, issued);
                await json(await send(admin, id), 200);
                const [event] = (
                    await outboxEnvelopes(pool, tenantId, issued)
                ).filter((row) => !before.some((old) => old.id === row.id));
                expect(
                    (await eventContract(issued)).safeParse(event).error,
                ).toBeUndefined();
                expect(event?.data.price_group).toEqual({
                    id: priceGroup.id,
                    code: 'UMUM-RSP',
                    name: 'Umum resep',
                });
            } finally {
                await assign(null);
            }
        });

        test('Kirim carries the Patient KTP of the visit, not the value the patient has when the prescription is sent', async () => {
            const setKtp = async (ktp: boolean) => {
                const current = await json<{ data: { version: number } }>(
                    await admin.get(`${api}/patients/${patientId}`),
                    200,
                );
                await json(
                    await admin.patch(`${api}/patients/${patientId}`, {
                        version: current.data.version,
                        name: 'Pasien Resep',
                        nationality_country_code: 'AU',
                        gender: 'female',
                        phone: '081200000031',
                        domicile_address: { street: 'Jl. Resep No. 1' },
                        payment_methods: [{ patient_type_id: umum }],
                        ktp_patient: ktp,
                    }),
                    200,
                );
            };
            await setKtp(false);
            try {
                const id = await visit();
                await setKtp(true);
                await start(id);
                const zinc = await drug('Zinc tablet KTP');
                await json(
                    await save(admin, id, {
                        prescriptions: [draft([single(zinc.id)])],
                    }),
                    200,
                );
                const before = await outboxEnvelopes(pool, tenantId, issued);
                await json(await send(admin, id), 200);
                const [event] = (
                    await outboxEnvelopes(pool, tenantId, issued)
                ).filter((row) => !before.some((old) => old.id === row.id));
                expect(
                    (await eventContract(issued)).safeParse(event).error,
                ).toBeUndefined();
                expect(event?.data.patient).toMatchObject({
                    id: patientId,
                    ktp: false,
                });
            } finally {
                await setKtp(true);
            }
        });
    },
);
