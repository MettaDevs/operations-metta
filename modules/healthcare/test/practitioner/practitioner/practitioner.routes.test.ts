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

type Practitioner = {
    id: string;
    party_id: string;
    name: string;
    profession: string;
    specialization: string | null;
    license_number: string | null;
    license_valid_until: string | null;
    bpjs_doctor_code: string | null;
    user_id: string | null;
    user_name: string | null;
    is_active: boolean;
    version: number;
};

// NIK di test ini angka contoh yang jelas palsu, bukan nomor orang sungguhan.
const nik = () =>
    `98000000000${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`;
const api = '/api/modules/healthcare/v1/practitioners';

// Master tenaga kesehatan: party orang berperan nakes, dibuat baru atau dipakai ulang dari buku alamat, dengan profesi
// dari katalog kode. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('practitioner master', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);

    let tenantId: string;
    let admin: Browser;
    let adminUserId: string;

    async function json<T>(response: Response, status: number): Promise<T> {
        const text = await response.text();
        if (response.status !== status)
            throw new Error(
                `Expected ${status}, got ${response.status}: ${text}`,
            );
        return JSON.parse(text) as T;
    }

    async function created(body: Record<string, unknown>) {
        return (
            await json<{ data: Practitioner }>(await admin.post(api, body), 201)
        ).data;
    }

    async function errors(response: Response) {
        return (await json<{ errors: Record<string, string[]> }>(response, 422))
            .errors;
    }

    async function member(duties: string[]) {
        const account = await createMember(pool, tenantId, duties);
        await grantAllOrganizations(pool, tenantId, account.membershipId);
        const session = browser();
        await session.login(account.email, account.password);
        return session;
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Nakes');
        await entitle(pool, tenantId, 'healthcare');
        await recordInstallation(pool, tenantId, 'healthcare');
        const owner = await createMember(pool, tenantId, [
            'core.organization.manage',
            'healthcare.practitioner.manage',
        ]);
        adminUserId = owner.userId;
        await grantAllOrganizations(pool, tenantId, owner.membershipId);
        admin = browser();
        await admin.login(owner.email, owner.password);
        await json(
            await admin.post('/api/v1/organizations', {
                classification: 'legal_entity',
                name: 'PT Klinik Uji Nakes',
                company_code: `KN${Date.now() % 100000}`,
                country_code: 'ID',
            }),
            201,
        );
    }, 60_000);

    test('a new practitioner creates a person in the address book with the practitioner role', async () => {
        const number = nik();
        const practitioner = await created({
            name: 'Dokter Uji',
            nik: number,
            gender: 'female',
            phone: '081200000001',
            profession: 'dokter',
            specialization: 'Penyakit dalam',
            license_number: 'SIP-UJI-001',
            // SIP yang sudah lewat masa berlakunya hanya dicatat, tidak ditolak.
            license_valid_until: '2020-01-31',
            bpjs_doctor_code: 'BPJS-001',
            user_id: adminUserId,
        });
        expect(practitioner).toEqual(
            expect.objectContaining({
                name: 'Dokter Uji',
                profession: 'dokter',
                specialization: 'Penyakit dalam',
                license_number: 'SIP-UJI-001',
                license_valid_until: '2020-01-31',
                bpjs_doctor_code: 'BPJS-001',
                user_id: adminUserId,
                is_active: true,
            }),
        );
        expect(practitioner.user_name).not.toBeNull();
        const [party] = await pool.unsafe<
            {
                type: string;
                gender: string | null;
                nik: string;
                phone: string;
            }[]
        >(
            `select p.type, p.gender, i.number as nik, c.value as phone from parties p
             join party_identifications i on i.party_id = p.id and i.type_code = 'nik' and i.deleted_at is null
             join party_locations pl on pl.party_id = p.id and pl.deleted_at is null
             join electronic_addresses c on c.location_id = pl.location_id and c.type = 'phone' and c.deleted_at is null
             where p.tenant_id = $1 and p.id = $2`,
            [tenantId, practitioner.party_id],
        );
        expect(party).toEqual({
            type: 'person',
            gender: 'female',
            nik: number,
            phone: '081200000001',
        });
        const roles = await pool.unsafe<{ role_code: string }[]>(
            'select role_code from party_role_registrations where tenant_id = $1 and party_id = $2',
            [tenantId, practitioner.party_id],
        );
        expect(roles.map((row) => row.role_code)).toEqual([
            'healthcare.practitioner',
        ]);
    }, 30_000);

    test('an existing person is reused once, and an organization cannot be a practitioner', async () => {
        const person = (
            await json<{ data: { id: string } }>(
                await admin.post('/api/v1/parties', {
                    type: 'person',
                    status: 'active',
                    name: 'Bidan Buku Alamat',
                }),
                201,
            )
        ).data.id;
        const practitioner = await created({
            party_id: person,
            name: 'Diabaikan',
            profession: 'bidan',
        });
        expect(practitioner).toEqual(
            expect.objectContaining({
                party_id: person,
                name: 'Bidan Buku Alamat',
                profession: 'bidan',
            }),
        );
        expect(
            await errors(
                await admin.post(api, {
                    party_id: person,
                    profession: 'bidan',
                }),
            ),
        ).toEqual({
            party_id: ['Orang ini sudah tercatat sebagai tenaga kesehatan.'],
        });
        const organization = (
            await json<{ data: { id: string } }>(
                await admin.post('/api/v1/parties', {
                    type: 'organization',
                    status: 'active',
                    name: 'Organisasi Uji',
                }),
                201,
            )
        ).data.id;
        expect(
            await errors(
                await admin.post(api, {
                    party_id: organization,
                    profession: 'dokter',
                }),
            ),
        ).toEqual({ party_id: ['Pilih orang dari buku alamat.'] });
    }, 30_000);

    test('profession comes from the catalog, and the date and login account are checked', async () => {
        const outsider = await createMember(pool, await createTenant(pool));
        expect(
            await errors(
                await admin.post(api, {
                    name: 'Nakes Salah',
                    profession: 'dukun',
                    license_valid_until: '31-01-2026',
                    user_id: outsider.userId,
                }),
            ),
        ).toEqual({
            profession: ['Pilih profesi dari daftar.'],
            license_valid_until: ['Isi tanggal yang sah.'],
            user_id: ['Pilih akun dari daftar.'],
        });
        expect(
            await errors(await admin.post(api, { profession: 'perawat' })),
        ).toEqual({ name: ['Isi nama tenaga kesehatan.'] });
        const [count] = await pool.unsafe<{ count: number }[]>(
            "select count(*)::int as count from parties where tenant_id = $1 and name = 'Nakes Salah'",
            [tenantId],
        );
        expect(count?.count).toBe(0);
    }, 30_000);

    test('changing a practitioner keeps the person, rejects a stale version, and delete archives the row', async () => {
        const practitioner = await created({
            name: 'Perawat Uji',
            profession: 'perawat',
        });
        const changed = (
            await json<{ data: Practitioner }>(
                await admin.patch(`${api}/${practitioner.id}`, {
                    profession: 'bidan',
                    license_number: 'SIP-UJI-002',
                    is_active: false,
                    version: practitioner.version,
                }),
                200,
            )
        ).data;
        expect(changed).toEqual(
            expect.objectContaining({
                party_id: practitioner.party_id,
                name: 'Perawat Uji',
                profession: 'bidan',
                license_number: 'SIP-UJI-002',
                is_active: false,
                version: practitioner.version + 1,
            }),
        );
        expect(
            (
                await admin.patch(`${api}/${practitioner.id}`, {
                    profession: 'perawat',
                    version: practitioner.version,
                })
            ).status,
        ).toBe(409);
        expect(
            (
                await admin.delete(`${api}/${practitioner.id}`, {
                    version: changed.version,
                })
            ).status,
        ).toBe(204);
        const [row] = await pool.unsafe<{ archived: boolean }[]>(
            'select deleted_at is not null as archived from sim_m_nakes where id = $1',
            [practitioner.id],
        );
        expect(row?.archived).toBe(true);
        // Orang yang catatan nakesnya dihapus boleh dicatat lagi.
        const again = await created({
            party_id: practitioner.party_id,
            profession: 'perawat',
        });
        expect(again.id).not.toBe(practitioner.id);
    }, 30_000);

    test('the list searches name and license number and filters profession and status', async () => {
        await created({
            name: 'Apoteker Cari',
            profession: 'apoteker',
            license_number: 'SIP-CARI-77',
        });
        const list = async (query: string) =>
            (
                await json<{ data: Practitioner[] }>(
                    await admin.get(`${api}?${query}`),
                    200,
                )
            ).data.map((row) => row.name);
        expect(await list('q=apoteker%20cari')).toEqual(['Apoteker Cari']);
        expect(await list('q=SIP-CARI-77')).toEqual(['Apoteker Cari']);
        expect(await list('profession=apoteker')).toEqual(['Apoteker Cari']);
        expect(await list('status=inactive')).not.toContain('Apoteker Cari');
        const metadata = await json<{
            genders: { code: string }[];
            can_manage: boolean;
            can_pick_party: boolean;
        }>(await admin.get(`${api}/metadata`), 200);
        expect(metadata.can_manage).toBe(true);
        expect(metadata.can_pick_party).toBe(true);
        expect(metadata.genders.map((gender) => gender.code)).toContain(
            'female',
        );
        const users = await json<{ data: { id: string }[] }>(
            await admin.get(`${api}/users?per_page=100`),
            200,
        );
        expect(users.data.map((user) => user.id)).toContain(adminUserId);
    }, 30_000);

    test('permissions decide who reads and changes practitioners, inside one tenant', async () => {
        const reader = await member(['healthcare.practitioner.inquire']);
        expect((await reader.get(api)).status).toBe(200);
        const readerMetadata = await json<{
            can_manage: boolean;
            can_pick_party: boolean;
        }>(await reader.get(`${api}/metadata`), 200);
        expect(readerMetadata).toEqual(
            expect.objectContaining({
                can_manage: false,
                can_pick_party: false,
            }),
        );
        expect(
            (
                await reader.post(api, {
                    name: 'Tidak boleh',
                    profession: 'dokter',
                })
            ).status,
        ).toBe(403);
        expect((await reader.get(`${api}/users`)).status).toBe(403);
        const clerk = await member(['healthcare.patient.manage']);
        expect((await clerk.get(api)).status).toBe(403);
        const otherTenant = await createTenant(pool, 'Klinik Lain');
        await entitle(pool, otherTenant, 'healthcare');
        await recordInstallation(pool, otherTenant, 'healthcare');
        const stranger = await createMember(pool, otherTenant, [
            'healthcare.practitioner.manage',
        ]);
        await grantAllOrganizations(pool, otherTenant, stranger.membershipId);
        const session = browser();
        await session.login(stranger.email, stranger.password);
        const theirs = await json<{ data: Practitioner[] }>(
            await session.get(api),
            200,
        );
        expect(theirs.data).toEqual([]);
        const [mine] = await pool.unsafe<{ id: string; version: number }[]>(
            'select id, version from sim_m_nakes where tenant_id = $1 and deleted_at is null limit 1',
            [tenantId],
        );
        expect(
            (
                await session.patch(`${api}/${mine?.id}`, {
                    profession: 'dokter',
                    version: mine?.version,
                })
            ).status,
        ).toBe(404);
    }, 30_000);

    test('the practitioner role is registered for the module, readable with the practitioner permission', async () => {
        const [role] = await pool.unsafe<Record<string, unknown>[]>(
            "select name, owning_app_id, view_permission_code from party_roles where code = 'healthcare.practitioner'",
        );
        expect(role).toEqual({
            name: 'Tenaga kesehatan',
            owning_app_id: 'healthcare',
            view_permission_code: 'healthcare.practitioner.read',
        });
    });
});
