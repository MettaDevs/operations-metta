import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { registerPartyRole } from '../../../src/platform/address-book/index.ts';
import { Database } from '../../../src/platform/database/index.ts';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { createMember, createTenant } from '../../support/tenant-fixtures.ts';

type Party = Record<string, unknown> & {
    id: string;
    version: number;
    roles: { code: string }[];
};
type Identification = {
    id: string;
    type_code: string;
    number: string;
    masked: boolean;
    version: number;
};

// NIK dan No. KK di test ini angka contoh yang jelas palsu, bukan nomor orang sungguhan.
const nik = (suffix: string) => `990000000000${suffix.padStart(4, '0')}`;
const familyCard = '9900000000009999';

// Perilaku acuan: GlobalAddressBookTest CoreERP, ditambah keputusan pemilik produk 9 November 2026 (party tanpa nomor,
// nomor identitas, visibilitas per peran, cek data ganda, hubungan bertanggal). Butuh PostgreSQL yang sudah
// dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('party directory', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let tenantId: string;
    let legalEntityId: string;
    let manager: Browser;
    let reader: Browser;
    let trusted: Browser;
    let clinician: Browser;
    let clinicManager: Browser;
    let patientRole: string;
    afterAll(close);

    async function login(duties: string[]) {
        const member = await createMember(pool, tenantId, duties);
        const session = browser();
        await session.login(member.email, member.password);
        return session;
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Party');
        manager = await login(['core.organization.manage']);
        reader = await login(['core.organization.inquire']);
        trusted = await login([
            'core.organization.inquire',
            'core.party-identification.inquire',
        ]);
        // Peran milik module sintetis, dijaga izin milik module itu: party berperan ini hanya terlihat bagi pemegang
        // izinnya.
        const app = `uji-${Bun.randomUUIDv7().slice(-12)}`;
        patientRole = `${app}-patient`;
        await pool.unsafe(
            "insert into apps (id, name, version, status, created_at, updated_at) values ($1, 'Module uji', '1.0.0', 'internal', now(), now())",
            [app],
        );
        await pool.unsafe(
            "insert into app_entry_points (code, app_id, name, type, created_at, updated_at) values ($1, $2, 'Layar uji', 'form', now(), now())",
            [`${app}.patient.form`, app],
        );
        await pool.unsafe(
            "insert into permissions (code, app_id, entry_point_code, access_level, name, created_at, updated_at) values ($1, $2, $3, 'read', 'Lihat pasien uji', now(), now())",
            [`${app}.patient.read`, app, `${app}.patient.form`],
        );
        await pool.unsafe(
            "insert into security_privileges (code, app_id, name, created_at, updated_at) values ($1, $2, 'Melihat pasien uji', now(), now())",
            [`${app}.patient.view`, app],
        );
        await pool.unsafe(
            'insert into security_privilege_permissions (privilege_code, permission_code) values ($1, $2)',
            [`${app}.patient.view`, `${app}.patient.read`],
        );
        await pool.unsafe(
            "insert into security_duties (code, app_id, name, created_at, updated_at) values ($1, $2, 'Lihat pasien uji', now(), now())",
            [`${app}.patient.inquire`, app],
        );
        await pool.unsafe(
            'insert into security_duty_privileges (duty_code, privilege_code) values ($1, $2)',
            [`${app}.patient.inquire`, `${app}.patient.view`],
        );
        await pool.unsafe(
            "insert into party_roles (code, name, owning_app_id, view_permission_code, sort_order, created_at, updated_at) values ($1, 'Pasien uji', $2, $3, 90, now(), now())",
            [patientRole, app, `${app}.patient.read`],
        );
        clinician = await login([
            'core.organization.inquire',
            `${app}.patient.inquire`,
        ]);
        clinicManager = await login([
            'core.organization.manage',
            `${app}.patient.inquire`,
        ]);
        const company = await manager.post('/api/v1/organizations', {
            classification: 'legal_entity',
            name: 'Klinik Uji',
            company_code: `KU${Date.now() % 100000}`,
            country_code: 'ID',
        });
        expect(company.status).toBe(201);
        legalEntityId = ((await company.json()) as { data: { id: string } })
            .data.id;
    });

    async function created(
        body: Record<string, unknown>,
        key = `uji-${Bun.randomUUIDv7()}`,
        as = manager,
    ) {
        const response = await as.request('POST', '/api/v1/parties', {
            body: { type: 'person', status: 'active', ...body },
            headers: { 'idempotency-key': key },
        });
        expect(response.status).toBe(201);
        return (await response.json()) as {
            data: Party;
            duplicates: { id: string }[];
        };
    }

    async function errors(response: Response) {
        expect(response.status).toBe(422);
        return ((await response.json()) as { errors: Record<string, string[]> })
            .errors;
    }

    async function show(id: string, as = manager) {
        const response = await as.get(`/api/v1/parties/${id}`);
        return {
            status: response.status,
            data:
                response.status === 200
                    ? (
                          (await response.json()) as {
                              data: Party & {
                                  identifications: Identification[];
                              };
                          }
                      ).data
                    : null,
        };
    }

    async function assignRole(partyId: string, roleCode: string, app: string) {
        const connection = await pool.reserve();
        try {
            await registerPartyRole(
                new Database(connection, undefined, 'uji'),
                {
                    tenantId,
                    partyId,
                    roleCode,
                    legalEntityId,
                    owningAppId: app,
                },
            );
        } finally {
            connection.release();
        }
    }

    test('a party has no number, and replaying the same creation key returns the same party', async () => {
        const key = `uji-${Bun.randomUUIDv7()}`;
        const first = await created(
            {
                name: 'Siti  Uji',
                birth_place: 'Denpasar',
                nationality_country_code: 'id',
                religion: 'hindu',
                education: 'bachelor',
                gender: 'female',
                birth_date: '1990-01-31',
            },
            key,
        );
        expect(first.data).not.toHaveProperty('number');
        expect(first.data).toMatchObject({
            name: 'Siti  Uji',
            search_name: 'siti uji',
            birth_place: 'Denpasar',
            nationality_country_code: 'ID',
            religion: 'hindu',
            education: 'bachelor',
            language: 'id',
        });
        const replay = await manager.request('POST', '/api/v1/parties', {
            body: { type: 'person', status: 'active', name: 'Siti  Uji' },
            headers: { 'idempotency-key': key },
        });
        expect(replay.status).toBe(200);
        expect(((await replay.json()) as { data: Party }).data.id).toBe(
            first.data.id,
        );
        const [row] = await pool.unsafe(
            'select number from parties where id = $1',
            [first.data.id],
        );
        expect(row?.number).toBeNull();
        expect(
            await errors(
                await manager.post('/api/v1/parties', {
                    type: 'person',
                    status: 'active',
                    name: 'Agama salah',
                    religion: 'unknown',
                    nationality_country_code: 'ZZ',
                }),
            ),
        ).toEqual({
            religion: ['Pilih dari daftar.'],
            nationality_country_code: ['Pilih negara dari daftar.'],
        });
    });

    test('the party type cannot be changed once saved', async () => {
        const { data } = await created({ name: 'Budi Tetap' });
        expect(
            await errors(
                await manager.patch(`/api/v1/parties/${data.id}`, {
                    type: 'organization',
                    status: 'active',
                    name: 'Budi Tetap',
                    version: data.version,
                }),
            ),
        ).toEqual({
            type: [
                'Jenis pihak yang sudah tersimpan tidak dapat diganti. Buat pihak yang sesuai dan tautkan akun bisnisnya.',
            ],
        });
        const renamed = await manager.patch(`/api/v1/parties/${data.id}`, {
            type: 'person',
            status: 'active',
            name: 'Budi Diubah',
            version: data.version,
        });
        expect(renamed.status).toBe(200);
        expect(
            (
                await manager.patch(`/api/v1/parties/${data.id}`, {
                    type: 'person',
                    status: 'active',
                    name: 'Budi Lagi',
                    version: data.version,
                })
            ).status,
        ).toBe(409);
    });

    test('a NIK is unique in the tenant while a family card number may repeat', async () => {
        const first = await created({
            name: 'Ayah Uji',
            identifications: [
                { type_code: 'nik', number: nik('1') },
                { type_code: 'family_card', number: familyCard },
            ],
        });
        await created({
            name: 'Anak Uji',
            identifications: [{ type_code: 'family_card', number: familyCard }],
        });
        expect(
            await errors(
                await manager.post('/api/v1/parties', {
                    type: 'person',
                    status: 'active',
                    name: 'Peniru Uji',
                    identifications: [{ type_code: 'nik', number: nik('1') }],
                }),
            ),
        ).toEqual({
            'identifications.0.number': [
                'NIK ini sudah tercatat pada pihak lain.',
            ],
        });
        const [count] = await pool.unsafe(
            "select count(*)::int as count from parties where tenant_id = $1 and name = 'Peniru Uji'",
            [tenantId],
        );
        expect(count?.count).toBe(0);
        expect(
            await errors(
                await manager.post('/api/v1/parties', {
                    type: 'person',
                    status: 'active',
                    name: 'Format Salah',
                    identifications: [{ type_code: 'nik', number: '123' }],
                }),
            ),
        ).toEqual({ 'identifications.0.number': ['Format NIK tidak sesuai.'] });

        // Indeks unik parsial menolak NIK kedua yang lolos pemeriksaan aplikasi.
        const other = await created({ name: 'Tanpa NIK' });
        await expect(
            pool.unsafe(
                "insert into party_identifications (id, tenant_id, party_id, type_code, number) values ($1, $2, $3, 'nik', $4)",
                [Bun.randomUUIDv7(), tenantId, other.data.id, nik('1')],
            ),
        ).rejects.toThrow('party_identifications_nik_unique');

        // NIK yang dihapus boleh dipakai lagi.
        const { data } = await show(first.data.id);
        const own = data!.identifications.find(
            (item) => item.type_code === 'nik',
        )!;
        expect(
            (
                await manager.delete(
                    `/api/v1/parties/${first.data.id}/identifications/${own.id}`,
                    { version: own.version },
                )
            ).status,
        ).toBe(204);
        const reuse = await manager.post(
            `/api/v1/parties/${other.data.id}/identifications`,
            { type_code: 'nik', number: nik('1') },
        );
        expect(reuse.status).toBe(201);
    });

    test('sensitive numbers are masked unless the user may see them in full', async () => {
        const { data } = await created({
            name: 'Rahasia Uji',
            identifications: [
                { type_code: 'nik', number: nik('22') },
                { type_code: 'passport', number: 'x1234567' },
            ],
        });
        const numbers = async (as: Browser) =>
            Object.fromEntries(
                (await show(data.id, as)).data!.identifications.map((item) => [
                    item.type_code,
                    [item.number, item.masked],
                ]),
            );
        expect(await numbers(reader)).toEqual({
            nik: ['************0022', true],
            passport: ['X1234567', false],
        });
        expect(await numbers(trusted)).toEqual({
            nik: [nik('22'), false],
            passport: ['X1234567', false],
        });
    });

    test('a party with a role is visible only to holders of a role it carries', async () => {
        const patient = await created({ name: 'Pasien Tersembunyi' });
        const vendor = await created(
            { name: 'Pemasok Uji', type: 'organization' },
            undefined,
        );
        const plain = await created({ name: 'Tanpa Peran' });
        await assignRole(
            patient.data.id,
            patientRole,
            patientRole.replace(/-patient$/, ''),
        );
        await assignRole(vendor.data.id, 'vendor', 'core');
        await assignRole(vendor.data.id, 'vendor', 'core');
        await expect(
            assignRole(plain.data.id, 'vendor', 'other-app'),
        ).rejects.toThrow('milik core');

        expect((await show(patient.data.id, reader)).status).toBe(404);
        expect((await show(vendor.data.id, reader)).status).toBe(404);
        expect((await show(plain.data.id, reader)).status).toBe(200);
        const seen = await clinician.get('/api/v1/parties?q=tersembunyi');
        const listed = ((await seen.json()) as { data: Party[] }).data;
        expect(listed.map((party) => party.id)).toEqual([patient.data.id]);
        expect(listed[0]!.roles.map((role) => role.code)).toEqual([
            patientRole,
        ]);
        const hidden = await reader.get('/api/v1/parties?q=tersembunyi');
        expect(((await hidden.json()) as { data: Party[] }).data).toEqual([]);
        // Party yang masih memegang peran tidak bisa diarsipkan dari direktori.
        const current = (await show(patient.data.id, clinicManager)).data!;
        expect(
            await errors(
                await clinicManager.delete(
                    `/api/v1/parties/${patient.data.id}`,
                    {
                        version: current.version,
                    },
                ),
            ),
        ).toEqual({
            party: [
                'Pihak ini masih dipakai akun bisnis atau organisasi. Nonaktifkan untuk menghentikan pemakaian baru.',
            ],
        });
    });

    test('duplicate candidates follow the search hit ratio and skip pairs marked separate', async () => {
        const original = await created({
            name: 'Wayan Kembar Ganda',
            birth_date: '1985-07-17',
            party_details: {
                contacts: [{ type: 'phone', value: '+62 812-0000-1717' }],
            },
        });
        const candidates = async (body: Record<string, unknown>) => {
            const response = await manager.post(
                '/api/v1/parties/duplicate-check',
                body,
            );
            expect(response.status).toBe(200);
            return (
                (await response.json()) as { data: Record<string, unknown>[] }
            ).data;
        };
        expect(
            await candidates({
                name: 'Wayan Kembar Ganda',
                birth_date: '1985-07-17',
            }),
        ).toEqual([
            {
                id: original.data.id,
                name: 'Wayan Kembar Ganda',
                birth_date: '1985-07-17',
                matches: 4,
            },
        ]);
        expect(
            (
                await candidates({
                    name: 'wayan kembar-ganda',
                    phone: '081200001717',
                })
            ).map((row) => row.id),
        ).toEqual([original.data.id]);
        expect(await candidates({ name: 'Wayan Kembar Ganda' })).toEqual([]);

        const twin = await created({
            name: 'Wayan Kembar Ganda',
            birth_date: '1985-07-17',
        });
        expect(twin.duplicates.map((row) => row.id)).toEqual([
            original.data.id,
        ]);
        expect(
            (
                await manager.post(
                    `/api/v1/parties/${twin.data.id}/separations`,
                    {
                        party_id: original.data.id,
                    },
                )
            ).status,
        ).toBe(204);
        const after = await manager.get(
            `/api/v1/parties/${twin.data.id}/duplicates`,
        );
        expect(((await after.json()) as { data: unknown[] }).data).toEqual([]);

        // Ambang 100 % menuntut keenam search string cocok.
        const settings = await manager.put(
            '/api/v1/parties/duplicate-settings',
            {
                search_hit_percent: 100,
            },
        );
        expect(settings.status).toBe(200);
        expect(
            await candidates({
                name: 'Wayan Kembar Ganda',
                birth_date: '1985-07-17',
            }),
        ).toEqual([]);
        const { data: current } = (await settings.json()) as {
            data: { version: number };
        };
        expect(
            (
                await manager.put('/api/v1/parties/duplicate-settings', {
                    search_hit_percent: 60,
                    version: current.version,
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await manager.delete(
                    `/api/v1/parties/${twin.data.id}/separations/${original.data.id}`,
                )
            ).status,
        ).toBe(204);
        const restored = await manager.get(
            `/api/v1/parties/${twin.data.id}/duplicates`,
        );
        expect(
            ((await restored.json()) as { data: { id: string }[] }).data.map(
                (row) => row.id,
            ),
        ).toEqual([original.data.id]);
    });

    test('relationships are dated, typed, and may not overlap', async () => {
        const parent = await created({ name: 'Ibu Uji' });
        const child = await created({ name: 'Anak Hubungan' });
        const employer = await created({
            name: 'Instansi Uji',
            type: 'organization',
        });
        const path = `/api/v1/parties/${child.data.id}/relationships`;
        const relation = await manager.post(path, {
            from_party_id: parent.data.id,
            to_party_id: child.data.id,
            relationship_type_code: 'parent',
            valid_from: '2010-01-01',
        });
        expect(relation.status).toBe(201);
        const { data: saved } = (await relation.json()) as {
            data: { id: string; version: number };
        };
        expect(
            await errors(
                await manager.post(path, {
                    from_party_id: parent.data.id,
                    to_party_id: child.data.id,
                    relationship_type_code: 'parent',
                    valid_from: '2015-01-01',
                    valid_to: '2016-01-01',
                }),
            ),
        ).toEqual({
            valid_from: [
                'Hubungan yang sama sudah berlaku pada rentang tanggal ini.',
            ],
        });
        expect(
            await errors(
                await manager.post(path, {
                    from_party_id: child.data.id,
                    to_party_id: employer.data.id,
                    relationship_type_code: 'spouse',
                    valid_from: '2020-01-01',
                }),
            ),
        ).toEqual({
            relationship_type_code: [
                'Jenis kedua pihak tidak sesuai dengan hubungan yang dipilih.',
            ],
        });
        expect(
            (
                await manager.post(path, {
                    from_party_id: child.data.id,
                    to_party_id: employer.data.id,
                    relationship_type_code: 'employed_by',
                    valid_from: '2020-01-01',
                    valid_to: '2021-12-31',
                })
            ).status,
        ).toBe(201);
        const { data } = await show(child.data.id);
        expect(
            (
                data!.relationships as {
                    relationship_type_code: string;
                    from_name: string;
                }[]
            ).map((row) => [row.relationship_type_code, row.from_name]),
        ).toEqual([
            ['parent', 'Ibu Uji'],
            ['employed_by', 'Anak Hubungan'],
        ]);
        expect(
            (
                await manager.delete(`${path}/${saved.id}`, {
                    version: saved.version,
                })
            ).status,
        ).toBe(204);
        const [row] = await pool.unsafe(
            'select deleted_at is not null as deleted from party_relationships where id = $1',
            [saved.id],
        );
        expect(row?.deleted).toBe(true);
    });

    test('occupations are a tenant master chosen by id', async () => {
        const response = await manager.post('/api/v1/occupations', {
            name: 'Petani',
        });
        expect(response.status).toBe(201);
        const { data: occupation } = (await response.json()) as {
            data: { id: string };
        };
        expect(
            await errors(
                await manager.post('/api/v1/occupations', { name: 'petani' }),
            ),
        ).toEqual({ name: ['Pekerjaan dengan nama ini sudah ada.'] });
        const { data } = await created({
            name: 'Pak Tani',
            occupation_id: occupation.id,
        });
        expect(data).toMatchObject({
            occupation_id: occupation.id,
            occupation_name: 'Petani',
        });
        expect(
            (await reader.post('/api/v1/occupations', { name: 'Nelayan' }))
                .status,
        ).toBe(403);
    });

    test('only the address book manager writes, and another tenant sees nothing', async () => {
        expect(
            (
                await reader.post('/api/v1/parties', {
                    type: 'person',
                    status: 'active',
                    name: 'Dilarang',
                })
            ).status,
        ).toBe(403);
        const { data } = await created({ name: 'Milik Tenant Ini' });
        const otherTenant = await createTenant(pool, 'Klinik Lain Party');
        const other = await createMember(pool, otherTenant, [
            'core.organization.manage',
        ]);
        const stranger = browser();
        await stranger.login(other.email, other.password);
        expect((await show(data.id, stranger)).status).toBe(404);
        expect(
            (
                await stranger.patch(`/api/v1/parties/${data.id}`, {
                    type: 'person',
                    status: 'active',
                    name: 'Diambil',
                    version: data.version,
                })
            ).status,
        ).toBe(404);
    });

    test('archiving keeps the row and restoring brings it back', async () => {
        const { data } = await created({ name: 'Diarsipkan Uji' });
        expect(
            (
                await manager.delete(`/api/v1/parties/${data.id}`, {
                    version: data.version,
                })
            ).status,
        ).toBe(204);
        expect((await show(data.id)).status).toBe(404);
        const [row] = await pool.unsafe(
            'select version from parties where id = $1',
            [data.id],
        );
        const restored = await manager.post(
            `/api/v1/parties/${data.id}/restore`,
            {
                version: row?.version,
            },
        );
        expect(restored.status).toBe(200);
        expect((await show(data.id)).status).toBe(200);
    });
});
