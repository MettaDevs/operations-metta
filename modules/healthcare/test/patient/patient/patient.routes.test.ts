import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    createTenant,
    grantAllOrganizations,
} from '../../../../../test/support/tenant-fixtures.ts';

type Patient = {
    id: string;
    version: number;
    party_id: string;
    nrm: string;
    org_unit_id: string;
    nrm_unit_id: string;
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

// Master pasien: party + peran pasien + cara bayar dalam satu transaksi, NRM dari sequence unit kepala kelompok
// berbagi, visibilitas per kelompok, kepemilikan tetap, izin per unit, dan isolasi tenant. Butuh PostgreSQL yang sudah
// dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('patient master', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let tenantId: string;
    let admin: Browser;
    let company: string;
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

    // Petugas pendaftaran dengan duty pasien, dibatasi ke satu unit kerja lewat kebijakan data pasien.
    async function clerk(
        unitIds: string[],
        duties = ['healthcare.patient.manage'],
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
                    company,
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
        const owner = await createMember(pool, tenantId, [
            'core.organization.manage',
            'healthcare.patient.manage',
            'healthcare.payment-setup.manage',
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
        // Kelompok 1: Induk dengan Pustu di bawahnya. Kelompok 2: Barat sendiri. Lepas tidak ditempatkan.
        for (const name of [
            'Induk',
            'Pustu',
            'Barat',
            'Lepas',
            'Tanpa nomor',
            'Gagal',
        ])
            await unit(name);
        const hierarchy = await json<{
            savedHierarchy: { versions: { id: string }[] };
        }>(
            await admin.post('/api/v1/settings/organization/hierarchies', {
                name: 'Kelompok berbagi pasien uji',
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
                    uses_guarantor: true,
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
    }, 60_000);

    const sequenceOf = async (unitId: string) =>
        pool.unsafe<{ id: string; status: string; segments: unknown }[]>(
            `select s.id, s.status, s.segments from tenant_number_sequences s
             join app_number_sequence_references r on r.id = s.reference_id
             where s.tenant_id = $1 and r.code = 'healthcare.medical-record-number'
               and s.scope_type = 'operating_unit' and s.operating_unit_id = $2`,
            [tenantId, unitId],
        );

    test('a new operating unit gets its own medical record number sequence', async () => {
        const sequences = await sequenceOf(unitId('Induk'));
        expect(sequences).toHaveLength(1);
        expect(sequences[0]).toMatchObject({
            status: 'active',
            segments: [{ type: 'number', length: 6, mask: '##.##.##' }],
        });
        // Setiap unit punya sequence sendiri dengan format yang sama; reference ini unik per unit, jadi tidak ditolak.
        expect(await sequenceOf(unitId('Barat'))).toHaveLength(1);
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
            `NIK ini sudah terdaftar sebagai pasien dengan NRM ${reused.data.nrm}.`,
        ]);
        const lookup = await json<{
            data: { id: string; patient: { nrm: string } | null } | null;
        }>(
            await clerks.pustu!.post(`${api}/patients/party-lookup`, {
                nik: nik(10),
            }),
            200,
        );
        expect(lookup.data).toMatchObject({
            id: first.data.party_id,
            patient: { nrm: reused.data.nrm },
        });
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
            'select count(*)::int as patients from kes_pasien where tenant_id = $1 and org_unit_id = $2',
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
                    (select count(*)::int from kes_pasien where tenant_id = $1 and org_unit_id = $2) as patients
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
            'select deleted_at is not null as archived from kes_pasien where id = $1',
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
            'select org_unit_id, nrm_unit_id, legal_entity_id, nrm from kes_pasien where id = $1',
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
                'update kes_pasien set org_unit_id = $1 where id = $2',
                [unitId('Barat'), data.id],
            );
        } catch (error) {
            refused = error instanceof Error ? error.message : String(error);
        }
        expect(refused).toBe(
            'Kepemilikan dan nomor rekam medis pasien tidak dapat diubah.',
        );
    }, 30_000);
});
