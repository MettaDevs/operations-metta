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

type Data = Record<string, unknown> & {
    id: string | null;
    version: number | null;
    dental?: Record<string, string | null>;
    diagnoses?: Record<string, string | null>[];
};
type Shown = { data: Data; context: { editable: boolean } };
type Section = {
    id: string;
    operating_unit_id: string;
    name: string;
    kind: string;
    examination_panels: string[];
    version: number;
};
type Reference = { id: string; code: string; name: string };
type Metadata = {
    options: Record<string, { code: string; name: string }[]>;
    diagnosis_types: Reference[];
    diagnosis_cases: Reference[];
};

const api = '/api/modules/healthcare/v1';
const everyPanel = [
    'anamnesis',
    'history',
    'status',
    'physical',
    'pain',
    'fall_risk',
    'dental',
    'findings',
    'anatomy',
    'other',
    'diagnoses',
    'prognosis',
    'procedures',
    'prescriptions',
    'discharge',
    'cppt',
];
const defaultPanels = everyPanel.filter((panel) => panel !== 'dental');
const dentalPanels = everyPanel.filter(
    (panel) => panel !== 'findings' && panel !== 'anatomy',
);
const vitals = {
    pulse_rate: 88,
    respiratory_rate: 20,
    consciousness: 'COMPOS MENTIS',
    systolic: 120,
    diastolic: 80,
    height: 158.5,
    weight: 52,
    waist_circumference: 71,
};
const dental = {
    swelling: 'Ya',
    consistency: 'Kenyal',
    skin_color: 'Merah Kebiruan',
    skin_temperature: 'Panas',
    mobility: 'Tidak',
    gum_color: 'Kemerahan',
    caries: 'Disto Oklusal',
    intraoral_swelling: 'Ada',
    percussion: 'Sakit',
    pressure: 'Tidak',
    palpation: 'Sakit',
    caries_status: 'Plus',
};

// Bagian pemeriksaan per section: bawaan tanpa pengaturan, susunan yang diatur di kartu section, Pemeriksaan dasar gigi,
// penolakan isi bagian yang tidak dipakai, isian wajib periksa fisik, posisi gigi, batas tenant, dan izin. Butuh
// PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('examination panels per section', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let tenantId: string;
    let admin: Browser;
    let unit: string;
    let umum: string;
    let patientId: string;
    let room: string;
    let doctor: string;
    let general: Section;
    let dentistry: Section;
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
        path: string,
        body: Record<string, unknown>,
    ) {
        return (await json<{ data: T }>(await admin.post(path, body), 201))
            .data;
    }

    async function configure(section: Section, panels: string[]) {
        return (
            await json<{ data: Section }>(
                await admin.patch(`${api}/sections/${section.id}`, {
                    operating_unit_id: section.operating_unit_id,
                    name: section.name,
                    kind: section.kind,
                    examination_panels: panels,
                    version: section.version,
                }),
                200,
            )
        ).data;
    }

    async function visit(section: Section) {
        const registered = await json<{
            data: { destinations: { id: string }[] };
        }>(
            await admin.post(`${api}/visits`, {
                patient_id: patientId,
                patient_type_id: umum,
                visit_condition: 'sakit',
                section_id: section.id,
            }),
            201,
        );
        const id = registered.data.destinations[0]!.id;
        await json(
            await admin.post(`${api}/examination/destinations/${id}/start`, {
                room_id: room,
            }),
            200,
        );
        return id;
    }

    const path = (id: string) =>
        `${api}/examination/destinations/${id}/medical-record`;

    async function show(as: Browser, id: string) {
        return json<Shown>(await as.get(path(id)), 200);
    }

    async function recordRows(table: string, destination: string) {
        return pool.unsafe<Record<string, unknown>[]>(
            `select t.* from ${table} t
             join sim_tr_pemeriksaan p on p.id = t.pemeriksaan_id
             where p.tujuan_id = $1 order by t.created_at, t.id`,
            [destination],
        );
    }

    async function icd10(code: string, name: string) {
        return created(`${api}/icd10`, { code, name });
    }

    const reference = (list: Reference[], value: string) =>
        list.find((row) => row.code === value)!.id;

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Bagian Pemeriksaan');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        const owner = await createMember(pool, tenantId, [
            'core.organization.manage',
            'healthcare.patient.manage',
            'healthcare.payment-setup.manage',
            'healthcare.service-setup.manage',
            'healthcare.visit.manage',
            'healthcare.examination.manage',
            'healthcare.practitioner.manage',
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
            name: 'PT Klinik Uji Bagian Pemeriksaan',
            company_code: `KB${Date.now() % 100000}`,
            country_code: 'ID',
        });
        unit = (
            await created('/api/v1/organizations', {
                classification: 'operating_unit',
                name: 'Puskesmas Bagian Pemeriksaan',
                operating_unit_type: 'department',
                operating_unit_number: 'PBP',
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
                name: 'Pasien Bagian Pemeriksaan',
                nationality_country_code: 'AU',
                passport_number: `PB${Math.floor(Math.random() * 1e8)}`,
                gender: 'male',
                birth_date: '1990-05-06',
                phone: '081200000021',
                domicile_address: { street: 'Jl. Bagian No. 1' },
                payment_methods: [{ patient_type_id: umum }],
            })
        ).id;
        const [doctorProfession] = await pool.unsafe<{ id: string }[]>(
            `select id from sim_m_profesi where tenant_id = $1 and kode = 'dokter' and deleted_at is null`,
            [tenantId],
        );
        doctor = (
            await created(`${api}/practitioners`, {
                name: 'Dokter Bagian',
                nik: String(Date.now()).slice(-12).padStart(16, '4'),
                gender: 'male',
                phone: '081200000024',
                profession_id: doctorProfession!.id,
            })
        ).id;
        room = (
            await created(`${api}/rooms`, {
                operating_unit_id: unit,
                code: 'BP1',
                name: 'Ruang BP1',
            })
        ).id;
        general = await created<Section>(`${api}/sections`, {
            operating_unit_id: unit,
            code: 'UMUM',
            name: 'Poli Umum',
            kind: 'rawat_jalan',
            room_ids: [room],
        });
        dentistry = await created<Section>(`${api}/sections`, {
            operating_unit_id: unit,
            code: 'GIGI',
            name: 'Poli Gigi',
            kind: 'rawat_jalan',
            room_ids: [room],
        });
        metadata = await json<Metadata>(
            await admin.get(`${api}/examination/medical-record/metadata`),
            200,
        );
    }, 120_000);

    test('a section without settings uses every panel except Pemeriksaan dasar gigi, and stores no rows', async () => {
        expect(general.examination_panels).toEqual(defaultPanels);
        const [settings] = await pool.unsafe<{ count: number }[]>(
            'select count(*)::int as count from sim_m_section_panel_pemeriksaan where tenant_id = $1',
            [tenantId],
        );
        expect(settings?.count).toBe(0);
        const sectionMetadata = await json<{
            examination_panels: {
                code: string;
                label: string;
                by_default: boolean;
            }[];
        }>(await admin.get(`${api}/sections/metadata`), 200);
        expect(
            sectionMetadata.examination_panels.map((panel) => panel.code),
        ).toEqual(everyPanel);
        expect(
            sectionMetadata.examination_panels.find(
                (panel) => panel.code === 'dental',
            ),
        ).toEqual({
            code: 'dental',
            label: 'Pemeriksaan dasar gigi',
            by_default: false,
        });

        const id = await visit(general);
        const { data } = await show(admin, id);
        expect(Object.keys(data)).toEqual([
            'id',
            'version',
            'anamnesis',
            'history',
            'allergy',
            'drug_allergies',
            'status',
            'physical',
            'pain',
            'fall_risk',
            'findings',
            'anatomy',
            'other',
            'diagnoses',
            'prognosis_id',
            'chronic_disease_ids',
            'procedures',
            'prescriptions',
            'discharge',
        ]);
    });

    test('the section card stores one row per panel, and the examination follows it', async () => {
        dentistry = await configure(dentistry, [
            'dental',
            ...dentalPanels.filter((panel) => panel !== 'dental'),
        ]);
        expect(dentistry.examination_panels).toEqual(dentalPanels);
        const stored = await pool.unsafe<{ code: string; active: boolean }[]>(
            `select panel_kode as code, aktif as active from sim_m_section_panel_pemeriksaan
             where section_id = $1 and deleted_at is null order by panel_kode`,
            [dentistry.id],
        );
        expect(stored).toHaveLength(everyPanel.length);
        expect(
            stored.filter((row) => !row.active).map((row) => row.code),
        ).toEqual(['anatomy', 'findings']);
        const listed = await json<{ data: Section[] }>(
            await admin.get(`${api}/sections?q=Poli%20Gigi`),
            200,
        );
        expect(listed.data[0]?.examination_panels).toEqual(dentalPanels);

        const id = await visit(dentistry);
        const { data } = await show(admin, id);
        expect(data.dental).toEqual(
            Object.fromEntries(Object.keys(dental).map((key) => [key, null])),
        );
        expect(data.findings).toBeUndefined();
        expect(data.anatomy).toBeUndefined();

        expect(
            await refused(
                await admin.patch(`${api}/sections/${dentistry.id}`, {
                    operating_unit_id: unit,
                    name: dentistry.name,
                    kind: dentistry.kind,
                    examination_panels: ['odontogram'],
                    version: dentistry.version,
                }),
            ),
        ).toEqual({
            examination_panels: ['Pilih bagian pemeriksaan dari daftar.'],
        });
    });

    test('Pemeriksaan dasar gigi saves the old codes, reads them back, and writes no empty row', async () => {
        expect(
            metadata.options.gigi_status_karies?.map((row) => [
                row.code,
                row.name,
            ]),
        ).toEqual([
            ['Plus', '+'],
            ['Minus', '-'],
        ]);
        expect(metadata.options.gigi_karies).toHaveLength(16);

        const id = await visit(dentistry);
        const opened = await show(admin, id);
        await json(
            await admin.put(path(id), {
                ...opened.data,
                physical: { ...vitals },
            }),
            200,
        );
        expect(
            await recordRows('sim_tr_pemeriksaan_gigi_dasar', id),
        ).toHaveLength(0);

        const before = await show(admin, id);
        const saved = await json<Shown>(
            await admin.put(path(id), { ...before.data, dental }),
            200,
        );
        expect(saved.data.dental).toEqual(dental);
        const [row] = await recordRows('sim_tr_pemeriksaan_gigi_dasar', id);
        expect([row?.bengkak, row?.karies_gigi, row?.status_karies]).toEqual([
            'Ya',
            'Disto Oklusal',
            'Plus',
        ]);

        expect(
            await refused(
                await admin.put(path(id), {
                    ...saved.data,
                    dental: { ...dental, caries_status: '+' },
                }),
            ),
        ).toEqual({ 'dental.caries_status': ['Pilih dari daftar.'] });

        await json(
            await admin.put(path(id), {
                ...saved.data,
                dental: Object.fromEntries(
                    Object.keys(dental).map((key) => [key, null]),
                ),
            }),
            200,
        );
        const rows = await recordRows('sim_tr_pemeriksaan_gigi_dasar', id);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.deleted_at).not.toBeNull();
    });

    test('content for a panel the section does not use is refused, and its stored rows stay', async () => {
        const dentalVisit = await visit(dentistry);
        const opened = await show(admin, dentalVisit);
        expect(
            await refused(
                await admin.put(path(dentalVisit), {
                    ...opened.data,
                    physical: { ...vitals },
                    findings: [],
                    anatomy: [
                        { id: null, body_part: 'Gigi', description: 'x' },
                    ],
                }),
            ),
        ).toEqual({
            findings: [
                'Bagian Keadaan fisik tidak dipakai di poli ini. Muat ulang halaman pemeriksaan.',
            ],
            anatomy: [
                'Bagian Anatomi tubuh tidak dipakai di poli ini. Muat ulang halaman pemeriksaan.',
            ],
        });

        const generalVisit = await visit(general);
        const general_ = await show(admin, generalVisit);
        expect(
            await refused(
                await admin.put(path(generalVisit), {
                    ...general_.data,
                    physical: { ...vitals },
                    dental,
                }),
            ),
        ).toEqual({
            dental: [
                'Bagian Pemeriksaan dasar gigi tidak dipakai di poli ini. Muat ulang halaman pemeriksaan.',
            ],
        });

        // Bagian yang dimatikan sesudah diisi: isinya tetap tersimpan dan tidak ikut terhapus oleh Simpan berikutnya.
        const saved = await json<Shown>(
            await admin.put(path(generalVisit), {
                ...general_.data,
                physical: { ...vitals },
                pain: { ...(general_.data.pain as object), location: 'Gusi' },
            }),
            200,
        );
        general = await configure(
            general,
            defaultPanels.filter((panel) => panel !== 'pain'),
        );
        const { pain, ...withoutPain } = saved.data;
        expect(pain).toMatchObject({ location: 'Gusi' });
        expect((await show(admin, generalVisit)).data).toEqual(withoutPain);
        await json(
            await admin.put(path(generalVisit), {
                ...withoutPain,
                physical: { ...vitals },
            }),
            200,
        );
        const painRows = await recordRows(
            'sim_tr_pemeriksaan_nyeri',
            generalVisit,
        );
        expect(painRows.map((row) => row.deleted_at)).toEqual([null]);
        general = await configure(general, defaultPanels);
    });

    test('the required physical fields apply only where Periksa fisik is used', async () => {
        const id = await visit(dentistry);
        const opened = await show(admin, id);
        expect(
            Object.keys(await refused(await admin.put(path(id), opened.data))),
        ).toContain('physical.pulse_rate');

        dentistry = await configure(
            dentistry,
            dentalPanels.filter((panel) => panel !== 'physical'),
        );
        try {
            const withoutPhysical = await show(admin, id);
            expect(withoutPhysical.data.physical).toBeUndefined();
            await json(
                await admin.put(path(id), {
                    ...withoutPhysical.data,
                    anamnesis: {
                        ...(withoutPhysical.data.anamnesis as object),
                        doctor_id: doctor,
                    },
                    dental,
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
        } finally {
            dentistry = await configure(dentistry, dentalPanels);
        }
    });

    test('a poli without Anamnesa cannot record the examining doctor, so Selesai periksa says how to fix it', async () => {
        const id = await visit(general);
        general = await configure(
            general,
            defaultPanels.filter(
                (panel) => panel !== 'anamnesis' && panel !== 'physical',
            ),
        );
        try {
            expect(
                await refused(
                    await admin.post(
                        `${api}/examination/destinations/${id}/finish`,
                        {},
                    ),
                ),
            ).toEqual({
                status: [
                    'Dokter / tenaga medis yang memeriksa belum tercatat, karena poli ini tidak memakai bagian Anamnesa. Aktifkan Anamnesa di kartu section.',
                ],
            });
        } finally {
            general = await configure(general, defaultPanels);
        }
    });

    test('posisi gigi is kept only on a section that uses Pemeriksaan dasar gigi', async () => {
        const caries = await icd10('K02.1', 'Caries of dentine');
        const line = (toothPosition?: string | null) => ({
            icd10_id: caries.id,
            type_id: reference(metadata.diagnosis_types, 'PRIMER'),
            case_id: reference(metadata.diagnosis_cases, 'BARU'),
            doctor_id: null,
            nurse_id: null,
            ...(toothPosition === undefined
                ? {}
                : { tooth_position: toothPosition }),
        });

        const dentalVisit = await visit(dentistry);
        const opened = await show(admin, dentalVisit);
        const saved = await json<Shown>(
            await admin.put(path(dentalVisit), {
                ...opened.data,
                physical: { ...vitals },
                diagnoses: [line('36 oklusal')],
            }),
            200,
        );
        expect(saved.data.diagnoses?.[0]?.tooth_position).toBe('36 oklusal');
        expect(
            await refused(
                await admin.put(path(dentalVisit), {
                    ...saved.data,
                    physical: { ...vitals },
                    diagnoses: [line('x'.repeat(51))],
                }),
            ),
        ).toEqual({
            'diagnoses.0.tooth_position': ['Paling banyak 50 karakter.'],
        });

        const generalVisit = await visit(general);
        const general_ = await show(admin, generalVisit);
        expect(general_.data.diagnoses).toEqual([]);
        expect(
            await refused(
                await admin.put(path(generalVisit), {
                    ...general_.data,
                    physical: { ...vitals },
                    diagnoses: [line('36')],
                }),
            ),
        ).toEqual({
            'diagnoses.0.tooth_position': [
                'Posisi gigi hanya diisi di poli yang memakai Pemeriksaan dasar gigi.',
            ],
        });
        const plain = await json<Shown>(
            await admin.put(path(generalVisit), {
                ...general_.data,
                physical: { ...vitals },
                diagnoses: [line()],
            }),
            200,
        );
        expect(plain.data.diagnoses?.[0]).not.toHaveProperty('tooth_position');

        // Section yang berhenti memakai Pemeriksaan dasar gigi tidak menghapus posisi gigi yang sudah tersimpan.
        dentistry = await configure(dentistry, defaultPanels);
        try {
            const hidden = await show(admin, dentalVisit);
            expect(hidden.data.dental).toBeUndefined();
            await json(
                await admin.put(path(dentalVisit), {
                    ...hidden.data,
                    physical: { ...vitals },
                }),
                200,
            );
            const [stored] = await pool.unsafe<{ posisi_gigi: string }[]>(
                `select dg.posisi_gigi from sim_tr_pemeriksaan_diagnosa dg
                 join sim_tr_pemeriksaan p on p.id = dg.pemeriksaan_id
                 where p.tujuan_id = $1 and dg.deleted_at is null`,
                [dentalVisit],
            );
            expect(stored?.posisi_gigi).toBe('36 oklusal');
        } finally {
            dentistry = await configure(dentistry, dentalPanels);
        }
    });

    test('only section managers change the panels, and another tenant neither sees nor shares them', async () => {
        const viewer = await createMember(pool, tenantId, [
            'healthcare.service-setup.inquire',
        ]);
        const reader = browser();
        await reader.login(viewer.email, viewer.password);
        const seen = await json<{ data: Section[] }>(
            await reader.get(`${api}/sections?q=Poli%20Gigi`),
            200,
        );
        expect(seen.data[0]?.examination_panels).toEqual(dentalPanels);
        expect(
            (
                await reader.patch(`${api}/sections/${dentistry.id}`, {
                    operating_unit_id: unit,
                    name: dentistry.name,
                    kind: dentistry.kind,
                    examination_panels: defaultPanels,
                    version: dentistry.version,
                })
            ).status,
        ).toBe(403);

        const otherTenant = await createTenant(pool, 'Klinik Lain Bagian');
        await entitle(pool, otherTenant, 'healthcare');
        await recordInstallation(pool, otherTenant, 'healthcare');
        const stranger = await createMember(pool, otherTenant, [
            'core.organization.manage',
            'healthcare.service-setup.manage',
        ]);
        await grantAllOrganizations(pool, otherTenant, stranger.membershipId);
        const outsider = browser();
        await outsider.login(stranger.email, stranger.password);
        expect(
            (
                await outsider.patch(`${api}/sections/${dentistry.id}`, {
                    operating_unit_id: unit,
                    name: dentistry.name,
                    kind: dentistry.kind,
                    examination_panels: defaultPanels,
                    version: dentistry.version,
                })
            ).status,
        ).toBe(404);
        const theirs = await json<{ data: Section[] }>(
            await outsider.get(`${api}/sections`),
            200,
        );
        expect(theirs.data).toEqual([]);
        const [settings] = await pool.unsafe<{ count: number }[]>(
            'select count(*)::int as count from sim_m_section_panel_pemeriksaan where tenant_id = $1',
            [otherTenant],
        );
        expect(settings?.count).toBe(0);
        const options = await pool.unsafe<{ count: number }[]>(
            `select count(*)::int as count from sim_m_pemeriksaan_pilihan
             where tenant_id = $1 and kelompok = 'gigi_karies'`,
            [otherTenant],
        );
        expect(options[0]?.count).toBe(16);
    });
});
