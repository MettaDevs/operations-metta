import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { createMember, createTenant } from '../../support/tenant-fixtures.ts';

type Address = Record<string, unknown> & {
    id: string;
    version: number;
    location_id: string;
    is_primary: boolean;
    formatted: string;
};
type Contact = Record<string, unknown> & {
    id: string;
    version: number;
    is_primary: boolean;
};

// Perilaku acuan: OrganizationAddressBookTest, SharedLocationTest, dan GlobalAddressBookTest CoreERP, ditambah
// dusun/banjar, alamat privat, dan masa berlaku tautan. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST
// kosong.
describe.skipIf(!process.env.DB_HOST)('party addresses', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let tenantId: string;
    let manager: Browser;
    let reader: Browser;
    let privateReader: Browser;
    let member: Browser;
    let privateManager: Browser;
    const region: Record<string, string> = {};
    let hamlet: string;
    afterAll(close);

    async function login(duties: string[]) {
        const created = await createMember(pool, tenantId, duties);
        const session = browser();
        await session.login(created.email, created.password);
        return session;
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Alamat');
        manager = await login(['core.organization.manage']);
        reader = await login(['core.organization.inquire']);
        privateReader = await login([
            'core.organization.inquire',
            'core.private-location.inquire',
        ]);
        member = await login([]);
        privateManager = await login([
            'core.organization.manage',
            'core.private-location.inquire',
        ]);
        const [row] = await pool.unsafe(`
            select p.id as province, r.id as regency, d.id as district, v.id as village, pc.id as postal,
                   jakarta.id as other_regency
            from ref_villages v
            join ref_districts d on d.id = v.district_id
            join ref_regencies r on r.id = d.regency_id
            join ref_provinces p on p.id = r.province_id
            join ref_postal_codes pc on pc.village_id = v.id
            cross join (select id from ref_regencies where code = '3171') jakarta
            where v.code = '5103051004'`);
        Object.assign(region, row);
        hamlet = Bun.randomUUIDv7();
        await pool.unsafe(
            "insert into ref_group_of_houses (id, tenant_id, village_id, name, created_at, updated_at) values ($1, $2, $3, 'Banjar Uji', now(), now())",
            [hamlet, tenantId, region.village!],
        );
    });

    async function party(name: string) {
        const response = await manager.post('/api/v1/parties', {
            type: 'person',
            status: 'active',
            name,
        });
        expect(response.status).toBe(201);
        return ((await response.json()) as { data: { id: string } }).data.id;
    }

    const balinese = (extra: Record<string, unknown> = {}) => ({
        name: 'Rumah',
        purposes: ['identity_card', 'domicile'],
        country_region_code: 'id',
        province_id: region.province,
        regency_id: region.regency,
        district_id: region.district,
        village_id: region.village,
        postal_code_id: region.postal,
        group_of_houses_id: hamlet,
        street: 'Jl. Uji No. 1',
        rt: '001',
        rw: '002',
        ...extra,
    });

    async function addressOf(response: Response, status = 201) {
        expect(response.status).toBe(status);
        return ((await response.json()) as { data: Address }).data;
    }

    async function errors(response: Response) {
        expect(response.status).toBe(422);
        return ((await response.json()) as { errors: Record<string, string[]> })
            .errors;
    }

    test('region ids resolve names from the master, including the hamlet, into the printed form', async () => {
        const id = await party('Made Alamat');
        const saved = await addressOf(
            await manager.post(`/api/v1/parties/${id}/locations`, balinese()),
        );
        expect(saved).toMatchObject({
            is_primary: true,
            is_private: false,
            purposes: ['identity_card', 'domicile'],
            country_region_code: 'ID',
            province: 'Bali',
            city: 'Kabupaten Badung',
            district: 'Kuta Selatan',
            village: 'Benoa',
            group_of_houses_id: hamlet,
            group_of_houses: 'Banjar Uji',
            postal_code: '80362',
        });
        expect(saved.formatted).toBe(
            [
                'Jl. Uji No. 1',
                'RT 001 / RW 002',
                'Banjar Uji',
                'Benoa',
                'Kuta Selatan',
                'Kabupaten Badung, Bali 80362',
            ].join('\n'),
        );

        expect(
            await errors(
                await manager.post(
                    `/api/v1/parties/${id}/locations`,
                    balinese({ regency_id: region.other_regency }),
                ),
            ),
        ).toEqual({
            regency_id: [
                'Pilih wilayah yang sesuai dengan pilihan sebelumnya.',
            ],
        });
        expect(
            await errors(
                await manager.post(
                    `/api/v1/parties/${id}/locations`,
                    balinese({ group_of_houses_id: Bun.randomUUIDv7() }),
                ),
            ),
        ).toEqual({
            group_of_houses_id: [
                'Pilih dari daftar di bawah kelurahan atau desa yang dipilih.',
            ],
        });
        const [count] = await pool.unsafe(
            'select count(*)::int as count from party_locations where party_id = $1',
            [id],
        );
        expect(count?.count).toBe(1);
    });

    test('the first address is primary, a new primary takes over, and archiving promotes the oldest', async () => {
        const id = await party('Utama Uji');
        const first = await addressOf(
            await manager.post(`/api/v1/parties/${id}/locations`, balinese()),
        );
        const second = await addressOf(
            await manager.post(
                `/api/v1/parties/${id}/locations`,
                balinese({
                    name: 'Kantor',
                    purposes: ['business'],
                    is_primary: true,
                }),
            ),
        );
        expect(second.is_primary).toBe(true);
        const listed = await manager.get(`/api/v1/parties/${id}/locations`);
        const rows = ((await listed.json()) as { data: Address[] }).data;
        expect(rows.map((row) => [row.name, row.is_primary])).toEqual([
            ['Kantor', true],
            ['Rumah', false],
        ]);
        expect(
            (
                await manager.delete(
                    `/api/v1/parties/${id}/locations/${second.id}`,
                    { version: rows[0]!.version },
                )
            ).status,
        ).toBe(204);
        const after = await manager.get(`/api/v1/parties/${id}/locations`);
        expect(
            ((await after.json()) as { data: Address[] }).data.map((row) => [
                row.id,
                row.is_primary,
            ]),
        ).toEqual([[first.id, true]]);
        const [archived] = await pool.unsafe(
            'select deleted_at is not null as deleted from party_locations where id = $1',
            [second.id],
        );
        expect(archived?.deleted).toBe(true);
    });

    test('a private address and its contacts are hidden without the private address duty', async () => {
        const id = await party('Privat Uji');
        const hidden = await addressOf(
            await privateManager.post(
                `/api/v1/parties/${id}/locations`,
                balinese({ is_private: true }),
            ),
        );
        const contact = await privateManager.post(
            `/api/v1/parties/${id}/contacts`,
            {
                type: 'phone',
                value: '0812 0000 0001',
                address_id: hidden.id,
            },
        );
        expect(contact.status).toBe(201);

        const seen = async (as: Browser) => ({
            locations: (
                (await (
                    await as.get(`/api/v1/parties/${id}/locations`)
                ).json()) as { data: Address[] }
            ).data.length,
            contacts: (
                (await (
                    await as.get(`/api/v1/parties/${id}/contacts`)
                ).json()) as { data: Contact[] }
            ).data.length,
            address: (
                (await (await as.get(`/api/v1/parties/${id}`)).json()) as {
                    data: { address: string | null };
                }
            ).data.address,
        });
        expect(await seen(reader)).toEqual({
            locations: 0,
            contacts: 0,
            address: null,
        });
        expect(await seen(privateReader)).toEqual({
            locations: 1,
            contacts: 1,
            address: hidden.formatted,
        });
    });

    test('the link carries its validity dates', async () => {
        const id = await party('Riwayat Uji');
        const old = await addressOf(
            await manager.post(
                `/api/v1/parties/${id}/locations`,
                balinese({ valid_from: '2015-01-01', valid_to: '2020-12-31' }),
            ),
        );
        expect(old).toMatchObject({
            valid_from: '2015-01-01',
            valid_to: '2020-12-31',
        });
        expect(
            await errors(
                await manager.post(
                    `/api/v1/parties/${id}/locations`,
                    balinese({
                        valid_from: '2021-01-01',
                        valid_to: '2020-01-01',
                    }),
                ),
            ),
        ).toEqual({
            valid_to: ['Tanggal akhir tidak boleh sebelum tanggal mulai.'],
        });
    });

    test('a shared place is changed only through its owner', async () => {
        const owner = await party('Pemilik Tempat');
        const guest = await party('Penumpang Tempat');
        const own = await addressOf(
            await manager.post(
                `/api/v1/parties/${owner}/locations`,
                balinese(),
            ),
        );
        const linked = await addressOf(
            await manager.post(`/api/v1/parties/${guest}/locations`, {
                location_id: own.location_id,
                purposes: ['delivery'],
            }),
        );
        expect(linked).toMatchObject({
            location_id: own.location_id,
            is_location_owner: false,
            owner_party_name: 'Pemilik Tempat',
            shared_with: 1,
        });
        expect(
            await errors(
                await manager.request(
                    'PUT',
                    `/api/v1/parties/${guest}/locations/${linked.id}`,
                    { body: { ...balinese(), version: linked.version } },
                ),
            ),
        ).toEqual({
            address_id: [
                'Alamat dan kontak bersama hanya dapat diubah melalui pihak pemiliknya. Buka pihak pemilik di buku alamat, atau tambahkan alamat baru untuk pihak ini.',
            ],
        });
    });

    test('contacts: the first of a type is primary and a new primary takes over', async () => {
        const id = await party('Kontak Uji');
        const first = await manager.post(`/api/v1/parties/${id}/contacts`, {
            type: 'email',
            value: 'pertama@example.com',
        });
        expect(
            ((await first.json()) as { data: Contact }).data.is_primary,
        ).toBe(true);
        const second = await manager.post(`/api/v1/parties/${id}/contacts`, {
            type: 'email',
            value: 'kedua@example.com',
            is_primary: true,
        });
        expect(
            ((await second.json()) as { data: Contact }).data.is_primary,
        ).toBe(true);
        const listed = await manager.get(`/api/v1/parties/${id}/contacts`);
        expect(
            ((await listed.json()) as { data: Contact[] }).data.map((row) => [
                row.value,
                row.is_primary,
            ]),
        ).toEqual([
            ['kedua@example.com', true],
            ['pertama@example.com', false],
        ]);
        expect(
            await errors(
                await manager.post(`/api/v1/parties/${id}/contacts`, {
                    type: 'email',
                    value: 'bukan email',
                }),
            ),
        ).toEqual({ value: ['Isi alamat email yang benar.'] });
    });

    test('a new organization saves its addresses and contacts with it, and members read them', async () => {
        const response = await manager.post('/api/v1/organizations', {
            classification: 'operating_unit',
            name: 'Poli Alamat',
            operating_unit_type: 'cost_center',
            party_details: {
                locations: [{ key: 'kantor', ...balinese({ name: 'Gedung' }) }],
                contacts: [
                    {
                        type: 'phone',
                        value: '0361 000000',
                        address_key: 'kantor',
                    },
                ],
            },
        });
        expect(response.status).toBe(201);
        const organization = (
            (await response.json()) as { data: { id: string } }
        ).data;
        const path = `/api/v1/organizations/${organization.id}`;
        const locations = await member.get(`${path}/locations`);
        expect(locations.status).toBe(200);
        const [address] = ((await locations.json()) as { data: Address[] })
            .data;
        expect(address).toMatchObject({ name: 'Gedung', is_primary: true });
        const contacts = await member.get(`${path}/contacts`);
        expect(
            ((await contacts.json()) as { data: Contact[] }).data.map((row) => [
                row.value,
                row.address_id,
            ]),
        ).toEqual([['0361 000000', address!.id]]);
        expect(
            (
                await member.post(`${path}/contacts`, {
                    type: 'phone',
                    value: '1',
                })
            ).status,
        ).toBe(403);

        // Satu baris yang salah membatalkan seluruh organisasi beserta alamatnya.
        expect(
            await errors(
                await manager.post('/api/v1/organizations', {
                    classification: 'operating_unit',
                    name: 'Poli Gagal',
                    operating_unit_type: 'cost_center',
                    party_details: {
                        locations: [
                            balinese({ name: 'Benar' }),
                            balinese({
                                name: 'Salah',
                                province_id: region.other_regency,
                            }),
                        ],
                    },
                }),
            ),
        ).toEqual({
            'party_details.locations.1.province_id': [
                'Pilih wilayah yang sesuai dengan pilihan sebelumnya.',
            ],
        });
        const [count] = await pool.unsafe(
            "select count(*)::int as count from organizations where tenant_id = $1 and name = 'Poli Gagal'",
            [tenantId],
        );
        expect(count?.count).toBe(0);

        const otherTenant = await createTenant(pool, 'Klinik Lain Alamat');
        const other = await createMember(pool, otherTenant);
        const stranger = browser();
        await stranger.login(other.email, other.password);
        expect((await stranger.get(`${path}/locations`)).status).toBe(404);
    });
});
