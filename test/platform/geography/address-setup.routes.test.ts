import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { createMember, createTenant } from '../../support/tenant-fixtures.ts';

type Row = Record<string, unknown> & { id: string; name: string };
type Batch = { data: Row[]; next_cursor: string | null };

// UUID versi 3 (RFC 9562) dari namespace wilayah di migration 0006, dihitung terpisah dari SQL-nya.
function regionId(name: string): string {
    const hash = createHash('md5')
        .update(
            Buffer.concat([
                Buffer.from('b28ef6ffc67047d4a2362e85b9c3ef80', 'hex'),
                Buffer.from(name, 'utf8'),
            ]),
        )
        .digest();
    hash[6] = (hash[6]! & 0x0f) | 0x30;
    hash[8] = (hash[8]! & 0x3f) | 0x80;
    const hex = hash.toString('hex');
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
    ].join('-');
}

// Perilaku acuan: AddressHierarchyTest dan AddressSetupController CoreERP. Butuh PostgreSQL yang sudah dimigrasi;
// CI selalu menyediakannya, dan di laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('address setup', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let member: Browser;
    let reader: Browser;
    afterAll(close);

    beforeAll(async () => {
        const tenantId = await createTenant(pool, 'Klinik Uji Wilayah');
        const plain = await createMember(pool, tenantId);
        member = browser();
        await member.login(plain.email, plain.password);
        const inquirer = await createMember(pool, tenantId, [
            'core.reference-data.inquire',
        ]);
        reader = browser();
        await reader.login(inquirer.email, inquirer.password);
    });

    async function json<T>(response: Response, status = 200): Promise<T> {
        expect(response.status).toBe(status);
        return (await response.json()) as T;
    }

    const lookup = (query: string) =>
        member.get(`/api/v1/settings/address-setup/lookup/top-down?${query}`);
    const named = (rows: Row[], name: string) => {
        const row = rows.find((item) => item.name === name);
        expect(row).toBeDefined();
        return row!;
    };

    test('the Kepmendagri data is loaded at every level with deterministic ids', async () => {
        const [counts] = await pool.unsafe<Record<string, number>[]>(`
            select (select count(*) from ref_provinces where country_code = 'ID' and tenant_id is null)::int as provinces,
                   (select count(*) from ref_regencies where tenant_id is null)::int as regencies,
                   (select count(*) from ref_regencies where tenant_id is null and type = 'kota')::int as cities,
                   (select count(*) from ref_districts where tenant_id is null)::int as districts,
                   (select count(*) from ref_villages where tenant_id is null)::int as villages,
                   (select count(*) from ref_villages where tenant_id is null and type = 'kelurahan')::int as urban,
                   (select count(*) from ref_postal_codes where tenant_id is null and country_code = 'ID')::int as postal,
                   (select count(*) from country_regions)::int as countries`);
        expect({ ...counts }).toEqual({
            provinces: 38,
            regencies: 514,
            cities: 98,
            districts: 7285,
            villages: 83762,
            urban: 8496,
            postal: 83762,
            countries: 249,
        });
        const [bali] = await pool.unsafe(
            "select id from ref_provinces where country_code = 'ID' and code = '51'",
        );
        expect(bali?.id).toBe(regionId('ID:51'));
        const [benoa] = await pool.unsafe<Record<string, string>[]>(
            "select id, name, type, postal_code from ref_villages where code = '5103051004'",
        );
        expect({ ...benoa }).toEqual({
            id: regionId('ID:51.03.05.1004'),
            name: 'Benoa',
            type: 'kelurahan',
            postal_code: '80362',
        });
        // Nama diambil dari wilayah.sql, bukan dari JSON CoreERP yang memotong apostrof dan angka Romawi.
        const names = await pool.unsafe<{ name: string }[]>(
            "select name from ref_villages where code in ('7318022004', '1101052001') order by code",
        );
        expect(names.map((row) => row.name)).toEqual([
            'Kuta Buloh II',
            "Pali'",
        ]);
    });

    test('choices cascade from country to postal code', async () => {
        const provinces = await json<Row[]>(
            await lookup('parent_type=country&parent_id=ID'),
        );
        expect(provinces).toHaveLength(38);
        const bali = named(provinces, 'Bali');
        expect(Object.keys(bali)).toEqual([
            'id',
            'tenant_id',
            'country_code',
            'code',
            'name',
            'active',
            'timezone',
            'intrastat',
            'it_state_code',
            'state_code',
            'default_state',
            'union_territory',
            'display_code',
            'description',
            'created_at',
            'updated_at',
            'created_by_user_id',
            'updated_by_user_id',
            'version',
        ]);
        expect(bali).toMatchObject({ code: '51', country_code: 'ID' });
        expect(bali.created_at).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000000Z$/,
        );

        const regencies = await json<Row[]>(
            await lookup(`parent_type=province&parent_id=${bali.id}`),
        );
        expect(regencies.map((row) => row.name)).toContain('Kota Denpasar');
        expect(named(regencies, 'Kota Denpasar').type).toBe('kota');
        const badung = named(regencies, 'Kabupaten Badung');
        expect(badung.type).toBe('kabupaten');

        const districts = await json<Row[]>(
            await lookup(`parent_type=regency&parent_id=${badung.id}`),
        );
        const kutaSelatan = named(districts, 'Kuta Selatan');

        const villages = await json<Row[]>(
            await lookup(`parent_type=district&parent_id=${kutaSelatan.id}`),
        );
        expect(villages.map((row) => row.name)).toEqual([
            'Benoa',
            'Jimbaran',
            'Kutuh',
            'Pecatu',
            'Tanjung Benoa',
            'Ungasan',
        ]);
        const benoa = named(villages, 'Benoa');

        const postal = await json<Record<string, unknown>[]>(
            await lookup(`parent_type=village&parent_id=${benoa.id}`),
        );
        expect(postal).toEqual([
            {
                id: regionId('ID:51.03.05.1004:80362'),
                postal_code: '80362',
                area_name: null,
            },
        ]);

        // Satu permintaan untuk semua tingkat yang induknya sudah dipilih, dipakai saat membuka alamat tersimpan.
        const all = await json<Record<string, Row[]>>(
            await lookup(
                `country_code=ID&province_id=${bali.id}&regency_id=${badung.id}`,
            ),
        );
        expect(Object.keys(all)).toEqual([
            'provinces',
            'regencies',
            'districts',
            'villages',
        ]);
        expect(all.provinces).toHaveLength(38);
        expect(all.regencies).toHaveLength(regencies.length);
        expect(all.districts!.map((row) => row.id)).toEqual(
            districts.map((row) => row.id),
        );
        expect(all.villages).toEqual([]);
    });

    test('a parent that is not a region id finds nothing, and postal choices need a village', async () => {
        expect(
            await json(await lookup('parent_type=province&parent_id=bali')),
        ).toEqual([]);
        expect(await json(await lookup('parent_type=district'))).toEqual([]);
        expect(
            await json(await lookup('parent_type=village'), 422),
        ).toMatchObject({
            errors: { parent_id: ['The parent id field is required.'] },
        });
        expect(
            await json(await lookup('parent_type=village&parent_id=x'), 422),
        ).toMatchObject({
            errors: {
                parent_id: ['The parent id field must be a valid UUID.'],
            },
        });
        const fallback = await json<{ provinces: Row[] }>(
            await lookup('country_code=SG'),
        );
        expect(fallback).toEqual({ provinces: [] });
    });

    test('region data needs a signed-in tenant member', async () => {
        const stranger = browser();
        expect(
            (
                await stranger.get(
                    '/api/v1/settings/address-setup/lookup/top-down',
                )
            ).status,
        ).toBe(401);
    });

    test('searching regions needs the reference data duty', async () => {
        expect(
            (
                await member.get(
                    '/api/v1/settings/address-setup/divisions?section=villages&q=benoa',
                )
            ).status,
        ).toBe(403);

        const found = await json<Batch>(
            await reader.get(
                '/api/v1/settings/address-setup/divisions?section=villages&q=benoa&country=ID',
            ),
        );
        const benoa = named(found.data, 'Benoa');
        expect(benoa).toMatchObject({
            code: '5103051004',
            list_code: '5103051004',
            list_name: 'Benoa',
            country_name: 'Indonesia',
            province_name: 'Bali',
            regency_name: 'Kabupaten Badung',
            district_name: 'Kuta Selatan',
            village_name: 'Benoa',
        });
        expect(found.data.map((row) => row.name)).toContain('Tanjung Benoa');
        expect(
            found.data.every((row) => row.name.toLowerCase().includes('benoa')),
        ).toBe(true);

        // Kata yang bukan awalan tidak cocok, dan beberapa kata harus semuanya ditemukan.
        const words = await json<Batch>(
            await reader.get(
                '/api/v1/settings/address-setup/divisions?section=villages&q=tanjung%20kuta%20sel',
            ),
        );
        expect(words.data.map((row) => row.name)).toContain('Tanjung Benoa');
        expect(words.data.map((row) => row.name)).not.toContain('Benoa');
    });

    test('regencies and cities are separate sections under one province', async () => {
        const [bali] = await pool.unsafe(
            "select id from ref_provinces where country_code = 'ID' and code = '51'",
        );
        const section = async (name: string, extra = '') =>
            (
                await json<Batch>(
                    await reader.get(
                        `/api/v1/settings/address-setup/divisions?section=${name}&province_id=${bali?.id}${extra}`,
                    ),
                )
            ).data.map((row) => row.name);
        expect(await section('cities')).toEqual(['Kota Denpasar']);
        expect(await section('regencies')).toHaveLength(8);
        expect(await section('regencies', '&include_cities=1')).toHaveLength(9);
        expect(
            await json(
                await reader.get(
                    '/api/v1/settings/address-setup/divisions?section=streets',
                ),
                422,
            ),
        ).toMatchObject({
            errors: { section: ['The selected section is invalid.'] },
        });
        expect(
            await json(
                await reader.get(
                    '/api/v1/settings/address-setup/divisions?section=villages&district_id=x',
                ),
                422,
            ),
        ).toMatchObject({
            errors: {
                district_id: ['The district id field must be a valid UUID.'],
            },
        });
    });

    test('countries page through their ISO codes', async () => {
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
            const page: Batch = await json<Batch>(
                await reader.get(
                    `/api/v1/settings/address-setup/divisions?section=countries&per_page=100${cursor ? `&cursor=${cursor}` : ''}`,
                ),
            );
            seen.push(...page.data.map((row) => row.id));
            cursor = page.next_cursor;
        } while (cursor);
        expect(seen).toHaveLength(249);
        expect(new Set(seen).size).toBe(249);
        expect(seen).toContain('ID');
    });

    test('level names come from the database, including the hamlet level', async () => {
        const { data } = await json<{ data: Row[] }>(
            await member.get(
                '/api/v1/settings/address-setup/hierarchy-levels?country_code=id',
            ),
        );
        expect(data.map((row) => [row.level, row.level_code])).toEqual([
            [1, 'province'],
            [2, 'regency'],
            [3, 'district'],
            [4, 'village'],
            [5, 'group_of_houses'],
        ]);
        expect(data.at(-1)?.level_name).toBe('Dusun/Banjar');
        expect(
            (
                await member.get(
                    '/api/v1/settings/address-setup/hierarchy-levels',
                )
            ).status,
        ).toBe(422);
    });
});
