import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { pageFiles, readPage } from '../../../../../scripts/generate-client.ts';
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

type Patient = {
    id: string;
    version: number;
    party_id: string;
    nrm: string;
    org_unit_id: string;
    nrm_unit_id: string | null;
    legal_entity_id: string;
    name: string;
    nik: { number: string | null; masked: boolean };
    phone: string | null;
    email: string | null;
    identity_address: {
        street: string | null;
        village_id: string | null;
    } | null;
    domicile_address: { street: string | null } | null;
    payment_methods: {
        patient_type_id: string;
        guarantor_id: string | null;
        card_number: string | null;
        is_primary: boolean;
    }[];
};
type Row = { id: string; nrm: string; nik: string | null };

// NIK di test ini angka contoh yang jelas palsu, bukan nomor orang sungguhan.
const nik = (suffix: number) => `99000000000${String(suffix).padStart(5, '0')}`;
const api = '/api/modules/healthcare/v1';

// Master pasien: party + peran pasien + cara bayar dalam satu transaksi, NRM dari sequence legal entity atau unit
// kepala kelompok berbagi, visibilitas pola F&O (legal entity, kebijakan berbagi, kelompok), kepemilikan tetap, izin
// per unit, dan isolasi tenant. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('patient master', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let tenantId: string;
    let admin: Browser;
    let company: string;
    let otherCompany: string;
    const units: Record<string, string> = {};
    let hierarchyVersion: string;
    let umum: string;
    let bpjs: string;
    let bpjsKesehatan: string;
    const region: Record<string, string> = {};
    const clerks: Record<string, Browser> = {};

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function organization(body: Record<string, unknown>) {
        return (
            await json<{ data: { id: string } }>(
                await admin.post('/api/v1/organizations', body),
                201,
            )
        ).data.id;
    }

    function unitId(name: string): string {
        const id = units[name];
        if (!id) throw new Error(`Unit ${name} belum dibuat.`);
        return id;
    }

    let unitCounter = 0;
    async function unit(name: string) {
        unitCounter++;
        const id = await organization({
            classification: 'operating_unit',
            name,
            operating_unit_type: 'department',
            operating_unit_number: `PKM-${unitCounter}`,
        });
        units[name] = id;
        return id;
    }

    // Petugas pendaftaran dengan duty pasien, dibatasi ke unit kerja di satu legal entity lewat kebijakan data pasien.
    async function clerk(
        unitIds: string[],
        duties = ['healthcare.patient.manage'],
        legalEntity = company,
    ) {
        const member = await createMember(pool, tenantId, duties);
        for (const unitId of unitIds)
            await pool.unsafe(
                `insert into role_assignment_data_policy_scopes
                     (id, tenant_id, role_assignment_id, policy_code, legal_entity_id, organization_id,
                      include_descendants, valid_from, created_at, updated_at)
                 select $1, $2, id, 'healthcare.patient-unit', $3, $4, false, now() - interval '1 day', now(), now()
                 from role_assignments where membership_id = $5`,
                [
                    Bun.randomUUIDv7(),
                    tenantId,
                    legalEntity,
                    unitId,
                    member.membershipId,
                ],
            );
        const session = browser();
        await session.login(member.email, member.password);
        return session;
    }

    const identityAddress = () => ({
        province_id: region.province,
        regency_id: region.regency,
        district_id: region.district,
        village_id: region.village,
        group_of_houses: 'Banjar Uji',
        street: 'Jl. Uji No. 1',
        rt: '001',
        rw: '002',
    });

    function patientBody(extra: Record<string, unknown> = {}) {
        return {
            name: 'Pasien Uji',
            nationality_country_code: 'ID',
            nik: nik(Math.floor(Math.random() * 99999)),
            gender: 'female',
            birth_date: '1990-05-12',
            birth_place: 'Kota Uji',
            phone: '081200000000',
            identity_address: identityAddress(),
            blood_type: 'O+',
            family_status: 'head',
            payment_methods: [{ patient_type_id: umum }],
            ...extra,
        };
    }

    async function register(as: Browser, body: Record<string, unknown>) {
        return as.post(`${api}/patients`, body);
    }

    async function created(as: Browser, body: Record<string, unknown>) {
        return json<{ data: Patient; party_reused: boolean }>(
            await register(as, body),
            201,
        );
    }

    async function rowVersion(versionId: string): Promise<number> {
        const [row] = await pool.unsafe(
            'select h.version from organization_hierarchies h join organization_hierarchy_versions v on v.hierarchy_id = h.id where v.id = $1',
            [versionId],
        );
        return Number(row?.version);
    }

    const versionPath = (id: string) =>
        `/api/v1/settings/organization/hierarchy-versions/${id}`;

    async function place(versionId: string, child: string, parent: string) {
        await json(
            await admin.post(`${versionPath(versionId)}/placements`, {
                version: await rowVersion(versionId),
                organization_id: child,
                parent_organization_id: parent,
            }),
            200,
        );
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Pasien');
        // Sequence NRM hanya untuk tenant yang berhak memakai module healthcare.
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        const owner = await createMember(pool, tenantId, [
            'core.organization.manage',
            'healthcare.patient.manage',
            'healthcare.payment-setup.manage',
            'core.data-sharing.manage',
            'core.number-sequence.inquire',
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
        company = await organization({
            classification: 'legal_entity',
            name: 'PT Klinik Uji',
            company_code: `KU${Date.now() % 100000}`,
            country_code: 'ID',
        });
        // Legal entity kedua. Namanya diurutkan sesudah yang pertama, jadi admin bekerja di PT Klinik Uji.
        otherCompany = await organization({
            classification: 'legal_entity',
            name: 'PT Klinik Uji Kedua',
            company_code: `KD${Date.now() % 100000}`,
            country_code: 'ID',
        });
        // Kelompok 1: Induk dengan Pustu di bawahnya. Kelompok 2: Barat sendiri. Tanpa nomor dan Gagal masing-masing
        // kelompok sendiri. Lepas dan Timur tidak ditempatkan: keduanya memakai bawaan legal entity. Kedua bekerja
        // untuk legal entity kedua.
        for (const name of [
            'Induk',
            'Pustu',
            'Barat',
            'Lepas',
            'Timur',
            'Kedua',
            'Tanpa nomor',
            'Gagal',
        ])
            await unit(name);
        const hierarchy = await json<{
            savedHierarchy: { versions: { id: string }[] };
        }>(
            await admin.post('/api/v1/settings/organization/hierarchies', {
                name: 'Tidak sharing master pasien uji',
                purpose_codes: ['healthcare.patient-sharing'],
                root_organization_id: company,
                effective_from: '2026-01-01',
            }),
            200,
        );
        hierarchyVersion = hierarchy.savedHierarchy.versions[0]?.id ?? '';
        await place(hierarchyVersion, unitId('Induk'), company);
        await place(hierarchyVersion, unitId('Pustu'), unitId('Induk'));
        await place(hierarchyVersion, unitId('Barat'), company);
        await place(hierarchyVersion, unitId('Tanpa nomor'), company);
        await place(hierarchyVersion, unitId('Gagal'), company);
        await json(
            await admin.post(`${versionPath(hierarchyVersion)}/publish`, {
                version: await rowVersion(hierarchyVersion),
            }),
            200,
        );
        umum = (
            await json<{ data: { id: string } }>(
                await admin.post(`${api}/patient-types`, {
                    code: 'UMUM',
                    name: 'Umum',
                }),
                201,
            )
        ).data.id;
        bpjs = (
            await json<{ data: { id: string } }>(
                await admin.post(`${api}/patient-types`, {
                    code: 'BPJS',
                    name: 'BPJS',
                    behaviors: ['requires_guarantor', 'requires_card_number'],
                }),
                201,
            )
        ).data.id;
        bpjsKesehatan = (
            await json<{ data: { id: string } }>(
                await admin.post(`${api}/guarantors`, {
                    name: 'Penjamin Uji',
                    patient_type_id: bpjs,
                }),
                201,
            )
        ).data.id;
        const [row] = await pool.unsafe(`
            select p.id as province, r.id as regency, d.id as district, v.id as village
            from ref_villages v
            join ref_districts d on d.id = v.district_id
            join ref_regencies r on r.id = d.regency_id
            join ref_provinces p on p.id = r.province_id
            where v.code = '5103051004'`);
        Object.assign(region, row);
        clerks.induk = await clerk([unitId('Induk')]);
        clerks.pustu = await clerk([unitId('Pustu')]);
        clerks.barat = await clerk([unitId('Barat')]);
        clerks.lepas = await clerk([unitId('Lepas')]);
        clerks.timur = await clerk([unitId('Timur')]);
        clerks.kedua = await clerk(
            [unitId('Kedua')],
            ['healthcare.patient.manage'],
            otherCompany,
        );
    }, 60_000);

    const sequenceOf = async (unitId: string) =>
        pool.unsafe<{ id: string; status: string; segments: unknown }[]>(
            `select s.id, s.status, s.segments from tenant_number_sequences s
             join app_number_sequence_references r on r.id = s.reference_id
             where s.tenant_id = $1 and r.code = 'healthcare.medical-record-number'
               and s.scope_type = 'operating_unit' and s.operating_unit_id = $2`,
            [tenantId, unitId],
        );

    const legalEntitySequenceOf = async (legalEntityId: string) =>
        pool.unsafe<{ id: string; status: string; segments: unknown }[]>(
            `select s.id, s.status, s.segments from tenant_number_sequences s
             join app_number_sequence_references r on r.id = s.reference_id
             where s.tenant_id = $1 and r.code = 'healthcare.medical-record-number'
               and s.scope_type = 'legal_entity' and s.legal_entity_id = $2`,
            [tenantId, legalEntityId],
        );

    test('a new legal entity and a new operating unit each get a medical record number sequence', async () => {
        for (const sequences of [
            await legalEntitySequenceOf(company),
            await legalEntitySequenceOf(otherCompany),
            await sequenceOf(unitId('Induk')),
        ]) {
            expect(sequences).toHaveLength(1);
            expect(sequences[0]).toMatchObject({
                status: 'active',
                segments: [{ type: 'number', length: 6, mask: '##.##.##' }],
            });
        }
        // Setiap unit punya sequence sendiri dengan format yang sama; reference ini unik per scope, jadi tidak ditolak.
        expect(await sequenceOf(unitId('Barat'))).toHaveLength(1);
    }, 30_000);

    test('a tenant without the healthcare entitlement gets no medical record number sequence or reference', async () => {
        const outsiderTenant = await createTenant(pool, 'Klinik Tanpa Hak');
        const manager = await createMember(pool, outsiderTenant, [
            'core.organization.manage',
            'core.number-sequence.manage',
        ]);
        await grantAllOrganizations(pool, outsiderTenant, manager.membershipId);
        const session = browser();
        await session.login(manager.email, manager.password);
        const created = async (body: Record<string, unknown>) =>
            (
                await json<{ data: { id: string } }>(
                    await session.post('/api/v1/organizations', body),
                    201,
                )
            ).data.id;
        await created({
            classification: 'legal_entity',
            name: 'PT Tanpa Hak',
            company_code: `TH${Date.now() % 100000}`,
            country_code: 'ID',
        });
        await created({
            classification: 'operating_unit',
            name: 'Unit tanpa hak',
            operating_unit_type: 'department',
            operating_unit_number: `TH-${Date.now() % 100000}`,
        });
        const [count] = await pool.unsafe(
            `select count(*)::int as sequences from tenant_number_sequences s
             join app_number_sequence_references r on r.id = s.reference_id
             where s.tenant_id = $1 and r.code = 'healthcare.medical-record-number'`,
            [outsiderTenant],
        );
        expect(count?.sequences).toBe(0);
        const metadata = await json<{
            data: { references: { code: string }[] };
        }>(await session.get('/api/v1/number-sequences/metadata'), 200);
        expect(metadata.data.references.map((item) => item.code)).not.toContain(
            'healthcare.medical-record-number',
        );
        const entitled = await json<{
            data: { references: { code: string }[] };
        }>(await admin.get('/api/v1/number-sequences/metadata'), 200);
        expect(entitled.data.references.map((item) => item.code)).toContain(
            'healthcare.medical-record-number',
        );
    }, 30_000);

    test('a patient registered in a branch unit gets the number of the head of its sharing group', async () => {
        const { data, party_reused } = await created(
            clerks.pustu!,
            patientBody({
                name: 'Ayu Lestari',
                nik: nik(1),
                email: 'ayu@example.com',
                family_card_number: '9900000000009999',
                payment_methods: [
                    {
                        patient_type_id: bpjs,
                        guarantor_id: bpjsKesehatan,
                        card_number: '0001234567890',
                        class: '3',
                    },
                ],
            }),
        );
        expect(party_reused).toBe(false);
        expect(data).toMatchObject({
            nrm: '00.00.01',
            org_unit_id: unitId('Pustu'),
            nrm_unit_id: unitId('Induk'),
            legal_entity_id: company,
            name: 'Ayu Lestari',
            phone: '081200000000',
            email: 'ayu@example.com',
            identity_address: {
                street: 'Jl. Uji No. 1',
                village_id: region.village,
            },
            domicile_address: null,
            payment_methods: [
                {
                    patient_type_id: bpjs,
                    guarantor_id: bpjsKesehatan,
                    card_number: '0001234567890',
                    is_primary: true,
                },
            ],
        });
        // Pemegang izin pasien tanpa izin Core Lihat nomor identitas utuh melihat NIK tersamar.
        expect(data.nik).toEqual({ number: '************0001', masked: true });
        const [role] = await pool.unsafe<Record<string, unknown>[]>(
            "select legal_entity_id, owning_app_id from party_role_registrations where tenant_id = $1 and party_id = $2 and role_code = 'healthcare.patient'",
            [tenantId, data.party_id],
        );
        expect(role).toEqual({
            legal_entity_id: company,
            owning_app_id: 'healthcare',
        });
        const second = await created(
            clerks.induk!,
            patientBody({ nik: nik(2) }),
        );
        expect(second.data.nrm).toBe('00.00.02');
    }, 30_000);

    test('a patient registered in a unit outside any group gets the number of its legal entity', async () => {
        const first = await created(
            clerks.lepas!,
            patientBody({ nik: nik(3) }),
        );
        expect(first.data).toMatchObject({
            nrm: '00.00.01',
            org_unit_id: unitId('Lepas'),
            nrm_unit_id: null,
            legal_entity_id: company,
        });
        // Unit lain yang juga tidak ditempatkan memakai sequence legal entity yang sama.
        const second = await created(
            clerks.timur!,
            patientBody({ nik: nik(4) }),
        );
        expect(second.data.nrm).toBe('00.00.02');
        // Legal entity lain punya sequence sendiri.
        const other = await created(
            clerks.kedua!,
            patientBody({ nik: nik(5) }),
        );
        expect(other.data).toMatchObject({
            nrm: '00.00.01',
            nrm_unit_id: null,
            legal_entity_id: otherCompany,
        });
    }, 30_000);

    test('a party that already exists by NIK only gains the patient role, once per sharing group', async () => {
        const first = await created(
            clerks.barat!,
            patientBody({ nik: nik(10) }),
        );
        const reused = await created(
            clerks.induk!,
            patientBody({
                nik: nik(10),
                // Isian identitas tidak dipakai bila party sudah ada: yang ditambahkan hanya perannya.
                name: '',
                phone: null,
            }),
        );
        expect(reused.party_reused).toBe(true);
        expect(reused.data.party_id).toBe(first.data.party_id);
        expect(reused.data.name).toBe('Pasien Uji');
        expect(reused.data.nrm_unit_id).toBe(unitId('Induk'));
        const [count] = await pool.unsafe(
            "select count(*)::int as parties from party_identifications where tenant_id = $1 and type_code = 'nik' and number = $2",
            [tenantId, nik(10)],
        );
        expect(count?.parties).toBe(1);
        const again = await register(
            clerks.pustu!,
            patientBody({ nik: nik(10) }),
        );
        expect(again.status).toBe(422);
        expect(
            ((await again.json()) as { errors: Record<string, string[]> })
                .errors.nik,
        ).toEqual([
            // Pesan form lama persis (common/controllers/Patients.php, create).
            `NIK sudah terdaftar! dengan NRM: ${reused.data.nrm} dan Nama: Pasien Uji`,
        ]);
        // Pencarian NIK saat mengetik dicabut; form lama tidak punya.
        expect(
            (
                await clerks.pustu!.post(`${api}/patients/party-lookup`, {
                    nik: nik(10),
                })
            ).status,
        ).toBe(404);
    }, 30_000);

    test('NIK follows the old form: digits of any length, required for citizens, and a shared placeholder for foreigners', async () => {
        const missing = await register(
            clerks.lepas!,
            patientBody({ nik: null }),
        );
        expect(
            ((await missing.json()) as { errors: Record<string, string[]> })
                .errors.nik,
        ).toEqual(['No Identitas harus diisi!']);
        // Panjang tidak diperiksa, seperti input angka form lama: isian pengganti bayi diterima.
        const baby = await created(
            clerks.lepas!,
            patientBody({ nik: '00000000', name: 'Bayi Uji' }),
        );
        expect(baby.data.nik.number).toBe('****0000');
        const letters = await register(
            clerks.lepas!,
            patientBody({ nik: '12AB' }),
        );
        expect(letters.status).toBe(422);
        // Warga negara asing mendapat NIK pengganti, dan banyak orang boleh memakainya.
        const foreigner = () =>
            created(
                clerks.lepas!,
                patientBody({
                    nationality_country_code: 'AU',
                    nik: null,
                    identity_address: null,
                    passport_number: `PA${Math.floor(Math.random() * 1e6)}`,
                    domicile_address: { street: 'Jl. Tinggal No. 9' },
                }),
            );
        const first = await foreigner();
        const second = await foreigner();
        expect(second.data.party_id).not.toBe(first.data.party_id);
        const [placeholders] = await pool.unsafe(
            "select count(*)::int as count from party_identifications where tenant_id = $1 and type_code = 'nik' and number = '9999999999999999' and deleted_at is null",
            [tenantId],
        );
        expect(Number(placeholders?.count)).toBeGreaterThanOrEqual(2);
    }, 30_000);

    test('the form rules of the old patient form are required', async () => {
        const response = await register(
            clerks.lepas!,
            patientBody({
                name: '',
                gender: null,
                phone: '',
                nik: null,
                identity_address: { street: '' },
                payment_methods: [],
            }),
        );
        expect(response.status).toBe(422);
        const { errors } = (await response.json()) as {
            errors: Record<string, string[]>;
        };
        expect(Object.keys(errors).sort()).toEqual([
            'gender',
            'identity_address.district_id',
            'identity_address.province_id',
            'identity_address.regency_id',
            'identity_address.street',
            'identity_address.village_id',
            'name',
            'nik',
            'payment_methods',
            'phone',
        ]);
        const foreigner = await register(
            clerks.lepas!,
            patientBody({
                nationality_country_code: 'AU',
                nik: null,
                identity_address: null,
            }),
        );
        expect(
            Object.keys(
                (
                    (await foreigner.json()) as {
                        errors: Record<string, string[]>;
                    }
                ).errors,
            ).sort(),
        ).toEqual(['domicile_address', 'passport_number']);
        const accepted = await created(
            clerks.lepas!,
            patientBody({
                nationality_country_code: 'AU',
                nik: null,
                identity_address: null,
                passport_number: 'PA1234567',
                domicile_address: { street: 'Jl. Tinggal No. 2' },
            }),
        );
        expect(accepted.data.domicile_address?.street).toBe(
            'Jl. Tinggal No. 2',
        );
    }, 30_000);

    test('a unit without a medical record number sequence is refused without falling back', async () => {
        const unit = unitId('Tanpa nomor');
        await pool.unsafe(
            "update tenant_number_sequences set status = 'stopped' where tenant_id = $1 and operating_unit_id = $2",
            [tenantId, unit],
        );
        const session = await clerk([unit]);
        const response = await register(session, patientBody());
        expect(response.status).toBe(422);
        expect(await response.text()).toContain(
            'belum diatur untuk unit Tanpa nomor',
        );
        const [count] = await pool.unsafe(
            'select count(*)::int as patients from sim_m_pasien where tenant_id = $1 and org_unit_id = $2',
            [tenantId, unit],
        );
        expect(count?.patients).toBe(0);
    }, 30_000);

    test('a failed save issues no number', async () => {
        const unit = unitId('Gagal');
        const session = await clerk([unit]);
        // Penjamin BPJS untuk tipe Umum ditolak setelah nomor diambil di dalam transaksi pendaftaran.
        const failed = await register(
            session,
            patientBody({
                payment_methods: [
                    { patient_type_id: umum, guarantor_id: bpjsKesehatan },
                ],
            }),
        );
        expect(failed.status).toBe(422);
        const [state] = await pool.unsafe<Record<string, unknown>[]>(
            `select (select count(*)::int from number_sequence_issues i where i.sequence_id = s.id) as issues,
                    (select count(*)::int from sim_m_pasien where tenant_id = $1 and org_unit_id = $2) as patients
             from tenant_number_sequences s where s.tenant_id = $1 and s.operating_unit_id = $2`,
            [tenantId, unit],
        );
        expect(state).toEqual({ issues: 0, patients: 0 });
        const saved = await created(session, patientBody());
        expect(saved.data.nrm).toBe('00.00.01');
    }, 30_000);

    test('patients are visible only inside the sharing group of the units a user was given', async () => {
        const pustu = await created(
            clerks.pustu!,
            patientBody({ name: 'Pasien Pustu' }),
        );
        const barat = await created(
            clerks.barat!,
            patientBody({ name: 'Pasien Barat' }),
        );
        const listed = async (as: Browser) =>
            (
                await json<{ data: Row[] }>(
                    await as.get(`${api}/patients?per_page=100`),
                    200,
                )
            ).data.map((row) => row.id);
        expect(await listed(clerks.induk!)).toContain(pustu.data.id);
        expect(await listed(clerks.induk!)).not.toContain(barat.data.id);
        expect(await listed(clerks.barat!)).toContain(barat.data.id);
        expect(await listed(clerks.barat!)).not.toContain(pustu.data.id);
        expect(await listed(admin)).toEqual(
            expect.arrayContaining([pustu.data.id, barat.data.id]),
        );
        expect(
            (await clerks.barat!.get(`${api}/patients/${pustu.data.id}`))
                .status,
        ).toBe(404);
        expect(
            (
                await clerks.barat!.patch(`${api}/patients/${pustu.data.id}`, {
                    ...patientBody(),
                    version: pustu.data.version,
                })
            ).status,
        ).toBe(404);
        expect(
            (await clerks.induk!.get(`${api}/patients/${pustu.data.id}`))
                .status,
        ).toBe(200);
    }, 30_000);

    test('permissions decide who reads, registers, and changes patients', async () => {
        const reader = await clerk(
            [unitId('Induk')],
            ['healthcare.patient.inquire'],
        );
        expect((await reader.get(`${api}/patients`)).status).toBe(200);
        expect((await register(reader, patientBody())).status).toBe(403);
        const outsider = await clerk(
            [unitId('Induk')],
            ['core.organization.inquire'],
        );
        expect((await outsider.get(`${api}/patients`)).status).toBe(403);
        const { data } = await created(clerks.induk!, patientBody());
        expect(
            (
                await reader.patch(`${api}/patients/${data.id}`, {
                    ...patientBody(),
                    version: data.version,
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await reader.delete(`${api}/patients/${data.id}`, {
                    version: data.version,
                })
            ).status,
        ).toBe(403);
    }, 30_000);

    test('searching finds a patient by name, NRM, NIK, birth date, and card number', async () => {
        const { data } = await created(
            clerks.barat!,
            patientBody({
                name: 'Komang Cari Saja',
                nik: nik(77),
                birth_date: '1985-03-07',
                payment_methods: [
                    {
                        patient_type_id: bpjs,
                        guarantor_id: bpjsKesehatan,
                        card_number: '0009988776655',
                    },
                ],
            }),
        );
        for (const q of [
            'komang cari',
            data.nrm,
            nik(77),
            '07-03-1985',
            '07031985',
            '1985-03-07',
            '0009988776655',
        ]) {
            const rows = (
                await json<{ data: Row[] }>(
                    await clerks.barat!.get(
                        `${api}/patients?q=${encodeURIComponent(q)}`,
                    ),
                    200,
                )
            ).data;
            expect(rows.map((row) => row.id)).toContain(data.id);
        }
    }, 30_000);

    test('changing a patient updates the party and the payment methods, and rejects a stale version', async () => {
        const { data } = await created(
            clerks.barat!,
            patientBody({ nik: nik(88) }),
        );
        const updated = await json<{ data: Patient }>(
            await clerks.barat!.patch(`${api}/patients/${data.id}`, {
                version: data.version,
                name: 'Nama Diubah',
                nationality_country_code: 'ID',
                gender: 'female',
                phone: '081300000000',
                email: 'baru@example.com',
                identity_address: identityAddress(),
                domicile_address: {
                    ...identityAddress(),
                    street: 'Jl. Domisili 3',
                },
                payment_methods: [
                    { patient_type_id: umum },
                    {
                        patient_type_id: bpjs,
                        guarantor_id: bpjsKesehatan,
                        card_number: '0001112223334',
                        is_primary: true,
                    },
                ],
            }),
            200,
        );
        expect(updated.data).toMatchObject({
            name: 'Nama Diubah',
            phone: '081300000000',
            email: 'baru@example.com',
            nrm: data.nrm,
            domicile_address: { street: 'Jl. Domisili 3' },
        });
        expect(
            updated.data.payment_methods.map((method) => method.is_primary),
        ).toEqual([true, false]);
        // NIK tidak dikirim, jadi tidak diubah.
        expect(updated.data.nik.number).toBe('************0088');
        expect(
            (
                await clerks.barat!.patch(`${api}/patients/${data.id}`, {
                    ...patientBody(),
                    version: data.version,
                })
            ).status,
        ).toBe(409);
        expect(
            (
                await clerks.barat!.delete(`${api}/patients/${data.id}`, {
                    version: updated.data.version,
                })
            ).status,
        ).toBe(204);
        expect(
            (await clerks.barat!.get(`${api}/patients/${data.id}`)).status,
        ).toBe(404);
        const [row] = await pool.unsafe(
            'select deleted_at is not null as archived from sim_m_pasien where id = $1',
            [data.id],
        );
        expect(row?.archived).toBe(true);
    }, 30_000);

    test('another tenant cannot see or change these patients', async () => {
        const { data } = await created(clerks.barat!, patientBody());
        const otherTenant = await createTenant(pool, 'Klinik Lain');
        const stranger = await createMember(pool, otherTenant, [
            'healthcare.patient.manage',
        ]);
        await pool.unsafe(
            `insert into role_assignment_data_policy_scopes
                 (id, tenant_id, role_assignment_id, policy_code, include_descendants, valid_from, created_at, updated_at)
             select $1, $2, id, 'healthcare.patient-unit', false, now() - interval '1 day', now(), now()
             from role_assignments where membership_id = $3`,
            [Bun.randomUUIDv7(), otherTenant, stranger.membershipId],
        );
        const session = browser();
        await session.login(stranger.email, stranger.password);
        expect((await session.get(`${api}/patients/${data.id}`)).status).toBe(
            404,
        );
        const listed = await json<{ data: Row[] }>(
            await session.get(`${api}/patients`),
            200,
        );
        expect(listed.data).toEqual([]);
        expect(
            (
                await session.delete(`${api}/patients/${data.id}`, {
                    version: data.version,
                })
            ).status,
        ).toBe(404);
    }, 30_000);

    const listed = async (as: Browser) =>
        (
            await json<{ data: Row[] }>(
                await as.get(`${api}/patients?per_page=100`),
                200,
            )
        ).data.map((row) => row.id);

    test('by default a patient is shared by every unit of its legal entity outside a group, and groups narrow it', async () => {
        const lepas = await created(
            clerks.lepas!,
            patientBody({ name: 'Pasien Lepas' }),
        );
        // Timur juga tidak ditempatkan di kelompok: ia melihat pasien Lepas, termasuk kartunya.
        expect(await listed(clerks.timur!)).toContain(lepas.data.id);
        expect(
            (await clerks.timur!.get(`${api}/patients/${lepas.data.id}`))
                .status,
        ).toBe(200);
        // Unit yang ditempatkan di kelompok hanya berbagi dengan kelompoknya.
        expect(await listed(clerks.induk!)).not.toContain(lepas.data.id);
        expect(await listed(clerks.barat!)).not.toContain(lepas.data.id);
        const pustu = await created(
            clerks.pustu!,
            patientBody({ name: 'Pasien Kelompok Induk' }),
        );
        expect(await listed(clerks.timur!)).not.toContain(pustu.data.id);
        // Batas data "seluruh organisasi" melihat semua pasien legal entity aktifnya.
        expect(await listed(admin)).toEqual(
            expect.arrayContaining([lepas.data.id, pustu.data.id]),
        );
    }, 30_000);

    test('a patient of another legal entity is not visible, not even by NIK', async () => {
        const lepas = await created(
            clerks.lepas!,
            patientBody({ name: 'Pasien Legal Entity Satu', nik: nik(20) }),
        );
        expect(await listed(clerks.kedua!)).not.toContain(lepas.data.id);
        expect(
            (await clerks.kedua!.get(`${api}/patients/${lepas.data.id}`))
                .status,
        ).toBe(404);
        const other = await created(
            clerks.kedua!,
            patientBody({ name: 'Pasien Legal Entity Dua' }),
        );
        expect(await listed(clerks.lepas!)).not.toContain(other.data.id);
        expect(await listed(admin)).not.toContain(other.data.id);
        // NIK yang hanya dipakai pasien di luar cakupan berbagi tidak ditolak dan tidak disebut: party yang sama dipakai
        // ulang, dan orang itu didaftarkan di legal entity kedua dengan NRM-nya sendiri.
        const reused = await created(
            clerks.kedua!,
            patientBody({ nik: nik(20), name: '' }),
        );
        expect(reused.party_reused).toBe(true);
        expect(reused.data.party_id).toBe(lepas.data.party_id);
        expect(reused.data.legal_entity_id).toBe(otherCompany);
        // Kelompok lain di legal entity yang sama juga di luar cakupan berbagi Lepas.
        const group = await created(
            clerks.barat!,
            patientBody({ nik: nik(20), name: '' }),
        );
        expect(group.data.party_id).toBe(lepas.data.party_id);
    }, 30_000);

    // Kebijakan sharing ada di Core (Sys Admin → Data sharing); module ini mendaftarkan "Master pasien" dan membaca
    // kebijakannya lewat layanan Core saat menyaring pasien.
    const policies = '/api/v1/data-sharing-policies';

    test('a data sharing policy for the patient master lets companies see each other, one active policy per company', async () => {
        const lepas = await created(
            clerks.lepas!,
            patientBody({ name: 'Pasien Dibagi' }),
        );
        const pustu = await created(
            clerks.pustu!,
            patientBody({ name: 'Pasien Kelompok Tetap' }),
        );
        const other = await created(
            clerks.kedua!,
            patientBody({ name: 'Pasien Kedua Dibagi' }),
        );
        // Master pasien terdaftar sebagai data yang boleh di-share, karena module terpasang.
        const types = await json<{
            data: { code: string; name: string; description: string | null }[];
        }>(await admin.get(`${policies}/data-types`), 200);
        expect(types.data).toContainEqual({
            code: 'healthcare.patient',
            name: 'Master pasien',
            description: expect.any(String),
        });
        // Kebijakan untuk jenis data lain tidak membuka pasien, walau legal entity-nya sama.
        await pool.unsafe(
            `insert into data_sharing_types (code, app_id, name, created_at, updated_at)
             values ('test.other', 'core', 'Data uji lain', now(), now()) on conflict (code) do nothing`,
        );
        await json(
            await admin.post(policies, {
                name: 'Data lain',
                data_type_code: 'test.other',
                effective_from: '2026-01-01',
                legal_entity_ids: [company, otherCompany],
            }),
            201,
        );
        expect(await listed(clerks.kedua!)).not.toContain(lepas.data.id);
        // Satu legal entity saja tidak cukup untuk sharing.
        expect(
            (
                await admin.post(policies, {
                    name: 'Satu saja',
                    data_type_code: 'healthcare.patient',
                    effective_from: '2026-01-01',
                    legal_entity_ids: [company],
                })
            ).status,
        ).toBe(422);
        // Kebijakan yang baru berlaku kelak belum membuka apa pun.
        const future = await json<{ data: { id: string; version: number } }>(
            await admin.post(policies, {
                name: 'Grup klinik',
                data_type_code: 'healthcare.patient',
                effective_from: '2999-01-01',
                legal_entity_ids: [company, otherCompany],
            }),
            201,
        );
        expect(await listed(clerks.kedua!)).not.toContain(lepas.data.id);
        // Kebijakan kedua yang aktif untuk legal entity dan data yang sama ditolak.
        const second = await admin.post(policies, {
            name: 'Grup lain',
            data_type_code: 'healthcare.patient',
            effective_from: '2026-01-01',
            legal_entity_ids: [company, otherCompany],
        });
        expect(second.status).toBe(422);
        expect(
            (
                (await second.json()) as {
                    errors: Record<string, string[]>;
                }
            ).errors.legal_entity_ids?.[0],
        ).toContain('sudah ikut kebijakan aktif "Grup klinik"');
        const effective = await json<{
            data: { version: number; legal_entities: { id: string }[] };
        }>(
            await admin.patch(`${policies}/${future.data.id}`, {
                name: 'Grup klinik',
                data_type_code: 'healthcare.patient',
                effective_from: '2026-01-01',
                legal_entity_ids: [company, otherCompany],
                version: future.data.version,
            }),
            200,
        );
        expect(
            effective.data.legal_entities.map((entity) => entity.id).sort(),
        ).toEqual([company, otherCompany].sort());
        // Kedua legal entity saling melihat pasien unit yang tidak ditempatkan.
        expect(await listed(clerks.kedua!)).toContain(lepas.data.id);
        expect(await listed(clerks.lepas!)).toContain(other.data.id);
        expect(
            (await clerks.kedua!.get(`${api}/patients/${lepas.data.id}`))
                .status,
        ).toBe(200);
        // Kelompok yang mempersempit tetap berlaku.
        expect(await listed(clerks.kedua!)).not.toContain(pustu.data.id);
        // Orang yang sudah terlihat lewat kebijakan tidak didaftarkan kedua kali.
        const [lepasNik] = await pool.unsafe<{ number: string }[]>(
            "select number from party_identifications where party_id = $1 and type_code = 'nik'",
            [lepas.data.party_id],
        );
        const duplicate = await register(
            clerks.kedua!,
            patientBody({ nik: lepasNik?.number ?? '' }),
        );
        expect(duplicate.status).toBe(422);
        // Pasien itu terlihat lewat kebijakan, jadi pesan form lama menyebut NRM dan namanya.
        expect(
            ((await duplicate.json()) as { errors: Record<string, string[]> })
                .errors.nik,
        ).toEqual([
            `NIK sudah terdaftar! dengan NRM: ${lepas.data.nrm} dan Nama: Pasien Dibagi`,
        ]);
        // Kebijakan yang dinonaktifkan menutup lagi, dan perubahannya tercatat.
        await json(
            await admin.patch(`${policies}/${future.data.id}`, {
                name: 'Grup klinik',
                data_type_code: 'healthcare.patient',
                is_active: false,
                effective_from: '2026-01-01',
                legal_entity_ids: [company, otherCompany],
                version: effective.data.version,
            }),
            200,
        );
        expect(await listed(clerks.kedua!)).not.toContain(lepas.data.id);
        const [log] = await pool.unsafe(
            "select count(distinct changed_at)::int as changes from change_log_entries where table_name = 'data_sharing_policies' and record_id = $1",
            [future.data.id],
        );
        expect(Number(log?.changes)).toBeGreaterThanOrEqual(1);
        const list = await json<{ data: { id: string }[] }>(
            await admin.get(
                `${policies}?status=inactive&data_type=healthcare.patient&q=grup`,
            ),
            200,
        );
        expect(list.data.map((policy) => policy.id)).toContain(future.data.id);
        // Petugas pendaftaran tidak boleh membuka Data sharing: izinnya milik Core, bukan izin pasien.
        expect((await clerks.lepas!.get(policies)).status).toBe(403);
    }, 30_000);

    test('the module migration moves the old patient sharing policies to Core, with their roles', async () => {
        const migration = await Bun.file(
            new URL(
                '../../../database/migrations/0008_data_sharing_to_core.sql',
                import.meta.url,
            ),
        ).text();
        // Kebijakan lama yang masih tersimpan di tabel module sebelum pemindahan: satu aktif, satu sudah diarsipkan.
        const active = Bun.randomUUIDv7();
        const archived = Bun.randomUUIDv7();
        await pool.unsafe(
            `insert into sim_m_kebijakan_berbagi (id, tenant_id, nama, aktif, berlaku_mulai, created_at, updated_at, deleted_at)
             values ($1, $3, 'Kebijakan lama', true, '2026-01-01', now(), now(), null),
                    ($2, $3, 'Kebijakan lama diarsipkan', true, '2026-01-01', now(), now(), now())`,
            [active, archived, tenantId],
        );
        await pool.unsafe(
            `insert into sim_m_kebijakan_berbagi_perusahaan (id, tenant_id, kebijakan_id, legal_entity_id, created_at, updated_at)
             values ($1, $4, $3, $5, now(), now()), ($2, $4, $3, $6, now(), now())`,
            [
                Bun.randomUUIDv7(),
                Bun.randomUUIDv7(),
                active,
                tenantId,
                company,
                otherCompany,
            ],
        );
        // Role yang dulu hanya boleh melihat kebijakan lama.
        const viewer = await clerk(
            [unitId('Induk')],
            ['healthcare.patient-sharing.inquire'],
        );
        expect((await viewer.get(policies)).status).toBe(403);
        const lepas = await created(
            clerks.lepas!,
            patientBody({ name: 'Pasien Kebijakan Lama' }),
        );
        expect(await listed(clerks.kedua!)).not.toContain(lepas.data.id);
        // 0008 juga menulis menu module; migration sesudahnya mengubah menu itu lagi, jadi menu terkini dikembalikan.
        const [menuBefore] = await pool.unsafe<{ navigation: string }[]>(
            "select navigation::text as navigation from apps where id = 'healthcare'",
        );
        try {
            // Dijalankan dua kali: pemindahan aman diulang.
            await pool.unsafe(migration);
            await pool.unsafe(migration);
            const moved = await pool.unsafe<
                {
                    id: string;
                    name: string;
                    data_type_code: string;
                    archived: boolean;
                    companies: number;
                }[]
            >(
                `select p.id, p.name, p.data_type_code, p.deleted_at is not null as archived,
                        (select count(*)::int from data_sharing_policy_companies m
                         where m.policy_id = p.id and m.deleted_at is null) as companies
                 from data_sharing_policies p where p.id in ($1, $2) order by p.name`,
                [active, archived],
            );
            expect([...moved]).toEqual([
                {
                    id: active,
                    name: 'Kebijakan lama',
                    data_type_code: 'healthcare.patient',
                    archived: false,
                    companies: 2,
                },
                {
                    id: archived,
                    name: 'Kebijakan lama diarsipkan',
                    data_type_code: 'healthcare.patient',
                    archived: true,
                    companies: 0,
                },
            ]);
            // Kebijakan yang dipindah langsung berlaku untuk pasien, dan role lama mendapat duty Core yang setara.
            expect(await listed(clerks.kedua!)).toContain(lepas.data.id);
            expect((await viewer.get(policies)).status).toBe(200);
            const [orphan] = await pool.unsafe<{ note: string | null }[]>(
                "select obj_description('public.sim_m_kebijakan_berbagi'::regclass, 'pg_class') as note",
            );
            expect(orphan?.note).toContain('Yatim');
        } finally {
            await pool.unsafe(
                "update apps set navigation = $1::text::jsonb where id = 'healthcare'",
                [menuBefore?.navigation ?? null],
            );
            await pool.unsafe(
                'update data_sharing_policy_companies set deleted_at = now() where policy_id = $1 and deleted_at is null',
                [active],
            );
            await pool.unsafe(
                'update data_sharing_policies set deleted_at = now() where id = $1',
                [active],
            );
        }
        expect(await listed(clerks.kedua!)).not.toContain(lepas.data.id);
    }, 30_000);

    test('the role scope per unit still applies on top of the sharing rules', async () => {
        const lepas = await created(
            clerks.lepas!,
            patientBody({ name: 'Pasien Batas Role' }),
        );
        // Petugas Induk tidak diberi unit yang tidak ditempatkan, jadi pasien bawaan legal entity tidak terlihat
        // walau aturan berbagi membukanya bagi unit-unit itu.
        expect(await listed(clerks.induk!)).not.toContain(lepas.data.id);
        // Diberi Induk dan Timur sekaligus: melihat keduanya.
        const both = await clerk(
            [unitId('Induk'), unitId('Timur')],
            ['healthcare.patient.inquire'],
        );
        expect(await listed(both)).toContain(lepas.data.id);
        // Pengguna tanpa unit apa pun tidak melihat pasien.
        const none = await clerk([], ['healthcare.patient.inquire']);
        expect(await listed(none)).toEqual([]);
    }, 30_000);

    test('a default patient type with its default guarantor is used for a new patient', async () => {
        const type = await json<{
            data: { id: string; is_default: boolean; version: number };
        }>(
            await admin.post(`${api}/patient-types`, {
                code: 'BAWAAN',
                name: 'Tipe bawaan uji',
                behaviors: ['requires_guarantor'],
                is_default: true,
            }),
            201,
        );
        expect(type.data.is_default).toBe(true);
        const guarantor = await json<{ data: { id: string } }>(
            await admin.post(`${api}/guarantors`, {
                name: 'Penjamin bawaan uji',
                patient_type_id: type.data.id,
                is_default: true,
            }),
            201,
        );
        const metadata = await json<{
            default_payment_method: Record<string, unknown> | null;
        }>(await clerks.lepas!.get(`${api}/patients/metadata`), 200);
        expect(metadata.default_payment_method).toMatchObject({
            patient_type_id: type.data.id,
            guarantor_id: guarantor.data.id,
            behaviors: ['requires_guarantor'],
        });
        const body = patientBody();
        delete (body as Record<string, unknown>).payment_methods;
        const patient = await created(clerks.lepas!, body);
        expect(patient.data.payment_methods).toEqual([
            expect.objectContaining({
                patient_type_id: type.data.id,
                guarantor_id: guarantor.data.id,
                is_primary: true,
            }),
        ]);
        // Tipe lain yang dijadikan bawaan memindahkan tandanya; paling banyak satu bawaan per tenant.
        await json(
            await admin.patch(`${api}/patient-types/${umum}`, {
                code: 'UMUM',
                name: 'Umum',
                is_default: true,
                version: (
                    await json<{ data: { id: string; version: number }[] }>(
                        await admin.get(`${api}/patient-types?q=UMUM`),
                        200,
                    )
                ).data.find((row) => row.id === umum)?.version,
            }),
            200,
        );
        const [defaults] = await pool.unsafe(
            'select count(*)::int as defaults from sim_m_tipe_pasien where tenant_id = $1 and bawaan and deleted_at is null',
            [tenantId],
        );
        expect(defaults?.defaults).toBe(1);
        let refused = '';
        try {
            await pool.unsafe(
                'update sim_m_tipe_pasien set bawaan = true where id = $1',
                [type.data.id],
            );
        } catch (error) {
            refused = error instanceof Error ? error.message : String(error);
        }
        expect(refused).toContain('sim_m_tipe_pasien_bawaan_unique');
        await json(
            await admin.patch(`${api}/patient-types/${umum}`, {
                code: 'UMUM',
                name: 'Umum',
                is_default: false,
                version: (
                    await json<{ data: { id: string; version: number }[] }>(
                        await admin.get(`${api}/patient-types?q=UMUM`),
                        200,
                    )
                ).data.find((row) => row.id === umum)?.version,
            }),
            200,
        );
    }, 30_000);

    test('the API does not require a guarantor or card number, even for a type that shows them', async () => {
        const { data } = await created(
            clerks.lepas!,
            patientBody({ payment_methods: [{ patient_type_id: bpjs }] }),
        );
        expect(data.payment_methods).toEqual([
            expect.objectContaining({
                patient_type_id: bpjs,
                guarantor_id: null,
                card_number: null,
            }),
        ]);
    }, 30_000);

    // Terakhir, karena mengubah susunan kelompok yang dipakai test lain.
    test('moving a unit to another sharing group keeps the patient ownership and moves its visibility', async () => {
        const { data } = await created(
            clerks.pustu!,
            patientBody({ name: 'Pasien Pindah' }),
        );
        const draft = await json<{
            savedHierarchy: { versions: { id: string }[] };
        }>(
            await admin.post(`${versionPath(hierarchyVersion)}/drafts`, {
                version: await rowVersion(hierarchyVersion),
                effective_from: '2026-06-01',
            }),
            200,
        );
        const next = draft.savedHierarchy.versions[0]?.id ?? '';
        const [node] = await pool.unsafe(
            'select id from organization_hierarchy_nodes where version_id = $1 and organization_id = $2 and deleted_at is null',
            [next, unitId('Pustu')],
        );
        await json(
            await admin.delete(
                `${versionPath(next)}/placements/${String(node?.id)}`,
                {
                    version: await rowVersion(next),
                },
            ),
            200,
        );
        await place(next, unitId('Pustu'), unitId('Barat'));
        await json(
            await admin.post(`${versionPath(next)}/publish`, {
                version: await rowVersion(next),
            }),
            200,
        );
        const [row] = await pool.unsafe<Record<string, unknown>[]>(
            'select org_unit_id, nrm_unit_id, legal_entity_id, nrm from sim_m_pasien where id = $1',
            [data.id],
        );
        expect(row).toEqual({
            org_unit_id: unitId('Pustu'),
            nrm_unit_id: unitId('Induk'),
            legal_entity_id: company,
            nrm: data.nrm,
        });
        expect(
            (await clerks.induk!.get(`${api}/patients/${data.id}`)).status,
        ).toBe(404);
        expect(
            (await clerks.barat!.get(`${api}/patients/${data.id}`)).status,
        ).toBe(200);
        // Pendaftaran baru di unit yang pindah memakai nomor kepala kelompok barunya.
        const moved = await created(clerks.pustu!, patientBody());
        expect(moved.data.nrm_unit_id).toBe(unitId('Barat'));
        // Kepemilikan juga dijaga database.
        let refused = '';
        try {
            await pool.unsafe(
                'update sim_m_pasien set org_unit_id = $1 where id = $2',
                [unitId('Barat'), data.id],
            );
        } catch (error) {
            refused = error instanceof Error ? error.message : String(error);
        }
        expect(refused).toBe(
            'Kepemilikan dan nomor rekam medis pasien tidak dapat diubah.',
        );
    }, 30_000);

    test('the module is one rail area named in the database, grouped by its feature folders, and follows permissions', async () => {
        const [app] = await pool.unsafe<
            { name: string; icon: string | null; navigation: unknown }[]
        >("select name, icon, navigation from apps where id = 'healthcare'");
        const groups = z
            .array(
                z.object({
                    id: z.string(),
                    label: z.string(),
                    icon: z.string().optional(),
                    items: z.array(
                        z.object({
                            label: z.string(),
                            href: z.string(),
                            section: z.string().optional(),
                            permission: z.string().optional(),
                        }),
                    ),
                }),
            )
            .parse(app?.navigation);
        // Ikon module dan ikon grupnya ditulis migration module, bukan kode Core.
        expect(app?.icon).toBe('heart-pulse');
        expect(groups.map((group) => [group.id, group.icon])).toEqual([
            ['dashboard', 'layout-dashboard'],
            ['patient', 'users'],
            ['setup', 'settings'],
        ]);
        expect(
            groups
                .find((group) => group.id === 'patient')
                ?.items.map((item) => item.label),
        ).toEqual(['Pasien']);
        // Teks layar fitur ini memakai "sharing", bukan "berbagi": tujuan hierarki dan katalog izin di layar role.
        const [purpose] = await pool.unsafe<{ name: string }[]>(
            "select name from hierarchy_purposes where code = 'healthcare.patient-sharing'",
        );
        expect(purpose?.name).toBe('Tidak sharing master pasien');
        const labels = await pool.unsafe<{ name: string }[]>(
            `select name from security_duties where code like 'healthcare.patient-sharing.%'
             union all select name from security_privileges where code like 'healthcare.patient-sharing.%'
             union all select name from permissions where code like 'healthcare.patient-sharing.%'
             union all select name from app_entry_points where code like 'healthcare.patient-sharing.%'
             union all select table_caption from change_log_setup_tables
                       where tenant_id is null and table_name like 'sim_m_kebijakan_berbagi%'`,
        );
        expect(labels.length).toBe(9);
        for (const label of labels) {
            expect(label.name).toContain('sharing');
            expect(label.name).not.toContain('berbagi');
        }
        // Kelompok sidebar sama dengan folder area di src/ module, dan URL halamannya berawalan folder itu. Rail Setup
        // mengumpulkan halaman pengaturan dari beberapa folder domain; di sana judul bagian yang mengikuti foldernya.
        expect(groups.map((group) => [group.id, group.label])).toEqual([
            ['dashboard', 'Dashboard'],
            ['patient', 'Pasien'],
            ['setup', 'Setup'],
        ]);
        // Setiap bagian rail Setup memakai satu folder domain. Bagian yang ditambahkan fitur lain cukup memenuhi aturan
        // itu; peta ini memeriksa judul bagian yang sudah dikenal.
        const sectionFolders = new Map([
            ['Penjaminan', 'coverage'],
            ['Tenaga kesehatan', 'practitioner'],
        ]);
        const pages = new Map(
            pageFiles().map((file) => [readPage(file).path, file]),
        );
        const foundSections = new Map<string, string>();
        for (const group of groups)
            for (const item of group.items) {
                const folder =
                    group.id === 'setup' ? item.href.split('/')[2] : group.id;
                if (group.id === 'setup') {
                    expect(item.section).toBeDefined();
                    const section = item.section ?? '';
                    expect(foundSections.get(section) ?? folder).toBe(folder);
                    foundSections.set(section, folder ?? '');
                }
                const file = pages.get(item.href)?.split(/[\\/]/) ?? [];
                expect(file[file.lastIndexOf('src') + 1]).toBe(folder);
                expect(item.href.startsWith(`/healthcare/${folder}`)).toBe(
                    true,
                );
            }
        for (const [section, folder] of sectionFolders)
            expect(foundSections.get(section)).toBe(folder);
        const shell = async (as: Browser) =>
            json<{
                navigation: {
                    id: string;
                    label: string;
                    icon: string | null;
                    href: string;
                    groups: {
                        id: string;
                        icon: string | null;
                        items: { href: string }[];
                    }[];
                }[];
                uninstalled_apps: {
                    id: string;
                    label: string;
                    icon: string | null;
                }[];
            }>(await as.get('/api/v1/shell'), 200);
        const menu = async (as: Browser) => (await shell(as)).navigation;
        // Petugas pendaftaran tidak melihat Sys Admin, dan halaman awalnya dashboard area module ini.
        const clerkMenu = await menu(clerks.induk!);
        expect(clerkMenu.map((area) => [area.id, area.label])).toEqual([
            ['healthcare', String(app?.name)],
        ]);
        expect(clerkMenu[0]?.href).toBe('/healthcare/dashboard');
        expect(
            clerkMenu[0]?.groups.map((group) => [
                group.id,
                group.items.map((item) => item.href),
            ]),
        ).toEqual([
            ['dashboard', ['/healthcare/dashboard']],
            ['patient', ['/healthcare/patient/patients']],
        ]);
        // Admin melihat Sys Admin lebih dulu, lalu area module dengan kedua kelompoknya.
        const adminMenu = await menu(admin);
        expect(adminMenu.map((area) => area.id)).toEqual([
            'sysadmin',
            'healthcare',
        ]);
        expect(adminMenu[0]?.href).toBe('/sysadmin/dashboard');
        expect(adminMenu[1]?.groups.map((group) => group.id)).toEqual([
            'dashboard',
            'patient',
            'setup',
        ]);
        // Shell meneruskan ikon area dan grup dari data module.
        expect(adminMenu[1]?.icon).toBe('heart-pulse');
        expect(adminMenu[1]?.groups.map((group) => group.icon)).toEqual([
            'layout-dashboard',
            'users',
            'settings',
        ]);
        expect((await shell(admin)).uninstalled_apps).toEqual([]);
        // Dibeli tetapi belum terpasang: module tidak bisa dibuka, tetapi tetap tampil di katalog sebagai aplikasi
        // nonaktif, dengan nama dan ikonnya, bagi setiap anggota tenant.
        await pool.unsafe(
            "update core_module_installations set status = 'uninstalled' where tenant_id = $1 and module_id = 'healthcare'",
            [tenantId],
        );
        try {
            const pending = await shell(admin);
            expect(pending.navigation.map((area) => area.id)).toEqual([
                'sysadmin',
            ]);
            expect(pending.uninstalled_apps).toEqual([
                {
                    id: 'healthcare',
                    label: String(app?.name),
                    icon: 'heart-pulse',
                },
            ]);
            expect(
                (await shell(clerks.induk!)).uninstalled_apps.map(
                    (item) => item.id,
                ),
            ).toEqual(['healthcare']);
            // Tidak dibeli (entitlement tidak aktif): module tidak tampil sama sekali.
            await pool.unsafe(
                "update tenant_app_entitlements set status = 'inactive' where tenant_id = $1 and app_id = 'healthcare'",
                [tenantId],
            );
            const notBought = await shell(admin);
            expect(notBought.navigation.map((area) => area.id)).toEqual([
                'sysadmin',
            ]);
            expect(notBought.uninstalled_apps).toEqual([]);
        } finally {
            await pool.unsafe(
                "update tenant_app_entitlements set status = 'active' where tenant_id = $1 and app_id = 'healthcare'",
                [tenantId],
            );
            await pool.unsafe(
                "update core_module_installations set status = 'installed' where tenant_id = $1 and module_id = 'healthcare'",
                [tenantId],
            );
        }
        // Anggota tanpa duty module tidak mendapat area module, walau dashboard-nya tanpa permission; halaman awalnya
        // dashboard Sys Admin.
        const outsider = await clerk(
            [unitId('Induk')],
            ['core.organization.inquire'],
        );
        const outsiderMenu = await menu(outsider);
        expect(outsiderMenu.map((area) => area.id)).toEqual(['sysadmin']);
        expect(outsiderMenu[0]?.href).toBe('/sysadmin/dashboard');
    }, 30_000);

    test('a patient type turns behaviours from the catalog on and off, without its name deciding anything', async () => {
        const created = await json<{
            data: { id: string; behaviors: string[]; version: number };
        }>(
            await admin.post(`${api}/patient-types`, {
                code: 'KHUSUS',
                name: 'Tipe uji',
                behaviors: ['requires_card_number'],
            }),
            201,
        );
        expect(created.data.behaviors).toEqual(['requires_card_number']);
        const refused = await admin.post(`${api}/patient-types`, {
            code: 'SALAH',
            name: 'Tipe salah',
            behaviors: ['bpjs'],
        });
        expect(refused.status).toBe(422);
        const updated = await json<{
            data: { behaviors: string[]; is_active: boolean };
        }>(
            await admin.patch(`${api}/patient-types/${created.data.id}`, {
                code: 'KHUSUS',
                name: 'Tipe uji',
                behaviors: ['requires_guarantor'],
                is_active: false,
                version: created.data.version,
            }),
            200,
        );
        expect(updated.data).toEqual(
            expect.objectContaining({
                behaviors: ['requires_guarantor'],
                is_active: false,
            }),
        );
        const [rows] = await pool.unsafe<Record<string, unknown>[]>(
            `select count(*) filter (where deleted_at is null)::int as live,
                    count(*) filter (where deleted_at is not null)::int as archived
             from sim_m_tipe_pasien_perilaku where tipe_pasien_id = $1`,
            [created.data.id],
        );
        expect(rows).toEqual({ live: 1, archived: 1 });
        const active = await json<{ data: { id: string }[] }>(
            await admin.get(`${api}/patient-types?active=1&per_page=100`),
            200,
        );
        expect(active.data.map((type) => type.id)).not.toContain(
            created.data.id,
        );
    }, 30_000);

    test('patient types and guarantors are listed in batches with search', async () => {
        const types = await json<{
            data: { id: string }[];
            can_manage: boolean;
        }>(await admin.get(`${api}/patient-types?q=bpjs&per_page=1`), 200);
        expect(types.data.map((type) => type.id)).toEqual([bpjs]);
        expect(types.can_manage).toBe(true);
        const guarantors = await json<{ data: { id: string }[] }>(
            await clerks.induk!.get(
                `${api}/guarantors?patient_type_id=${bpjs}&active=1`,
            ),
            200,
        );
        expect(guarantors.data.map((row) => row.id)).toEqual([bpjsKesehatan]);
        expect(
            (
                await json<{ data: unknown[] }>(
                    await clerks.induk!.get(
                        `${api}/guarantors?patient_type_id=${umum}`,
                    ),
                    200,
                )
            ).data,
        ).toEqual([]);
    }, 30_000);
});
