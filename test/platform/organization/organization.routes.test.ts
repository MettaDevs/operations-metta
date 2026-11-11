import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { createMember, createTenant } from '../../support/tenant-fixtures.ts';

// Perilaku acuan: OrganizationHierarchyTest, OperatingUnitNumberTest, SettingsRowVersionTest, dan
// CoreScreenPermissionTest di CoreERP. Butuh PostgreSQL yang sudah dimigrasi; CI selalu menyediakannya, dan di
// laptop test ini dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('organization directory', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let tenantId: string;
    let owner: Browser;
    afterAll(close);

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'PT Uji Organisasi');
        const member = await createMember(pool, tenantId, [
            'core.organization.manage',
        ]);
        owner = browser();
        await owner.login(member.email, member.password);
    });

    async function create(body: Record<string, unknown>, as = owner) {
        return as.post('/api/v1/organizations', body);
    }

    async function unit(
        name: string,
        type: string,
        number: string,
    ): Promise<{ id: string; version: number }> {
        const response = await create({
            classification: 'operating_unit',
            name,
            operating_unit_type: type,
            operating_unit_number: number,
        });
        expect(response.status).toBe(201);
        const { data } = (await response.json()) as { data: { id: string } };
        return { id: data.id, version: await versionOf(data.id) };
    }

    async function versionOf(id: string): Promise<number> {
        const [row] = await pool.unsafe(
            'select version from organizations where id = $1',
            [id],
        );
        return Number(row?.version);
    }

    async function errors(response: Response) {
        expect(response.status).toBe(422);
        return ((await response.json()) as { errors: Record<string, string[]> })
            .errors;
    }

    test('legal entity needs a tenant-unique company code, operating unit does not', async () => {
        const base = {
            classification: 'legal_entity',
            name: 'Legal entity',
            country_code: 'id',
        };
        expect(await errors(await create(base))).toEqual({
            company_code: ['Isi kode legal entity.'],
        });

        const created = await create({ ...base, company_code: 'asset-01' });
        expect(created.status).toBe(201);
        const body = (await created.json()) as {
            data: Record<string, unknown> & {
                id: string;
                legal_entity: Record<string, unknown>;
            };
        };
        expect(created.headers.get('location')).toBe(
            `/api/v1/organizations/${body.data.id}`,
        );
        expect(body.data).toMatchObject({
            tenant_id: tenantId,
            classification: 'legal_entity',
            name: 'Legal entity',
            status: 'active',
            operating_unit: null,
        });
        expect(Object.keys(body.data)).toEqual([
            'tenant_id',
            'classification',
            'name',
            'status',
            'id',
            'updated_at',
            'created_at',
            'legal_entity',
            'operating_unit',
        ]);
        expect(body.data.created_at).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000000Z$/,
        );
        expect(body.data.legal_entity).toMatchObject({
            organization_id: body.data.id,
            company_code: 'ASSET-01',
            country_code: 'ID',
            tenant_id: tenantId,
            timezone: 'Asia/Jakarta',
            version: 1,
        });

        expect(
            await errors(await create({ ...base, company_code: 'ASSET-01' })),
        ).toEqual({
            company_code: [
                'Kode legal entity sudah digunakan pada tenant ini.',
            ],
        });
        expect(
            (
                await create({
                    classification: 'operating_unit',
                    name: 'Asset operations',
                    operating_unit_type: 'department',
                    operating_unit_number: 'ASSET-OPS',
                })
            ).status,
        ).toBe(201);
    });

    test('operating unit is created without legal entity fields and a trimmed upper-case number', async () => {
        const response = await create({
            classification: 'operating_unit',
            name: 'Klinik A',
            operating_unit_type: 'business_unit',
            operating_unit_number: ' kln-a ',
            timezone: '',
        });
        expect(response.status).toBe(201);
        const { data } = (await response.json()) as {
            data: {
                id: string;
                legal_entity: null;
                operating_unit: Record<string, unknown>;
            };
        };
        expect(data.legal_entity).toBeNull();
        expect(data.operating_unit).toMatchObject({
            type: 'business_unit',
            number: 'KLN-A',
            tenant_id: tenantId,
        });
        const [row] = await pool.unsafe<
            { number: string; tenant_id: string }[]
        >(
            'select number, tenant_id from operating_units where organization_id = $1',
            [data.id],
        );
        expect({ ...row }).toEqual({ number: 'KLN-A', tenant_id: tenantId });
    });

    test('unit number is unique per tenant but may repeat in another tenant', async () => {
        await unit('Klinik B1', 'business_unit', 'KLN-B');
        expect(
            await errors(
                await create({
                    classification: 'operating_unit',
                    name: 'Klinik B2',
                    operating_unit_type: 'business_unit',
                    operating_unit_number: 'KLN-B',
                }),
            ),
        ).toEqual({
            operating_unit_number: [
                'Kode unit sudah dipakai unit lain dalam bisnis ini.',
            ],
        });
        const [missing] = await pool.unsafe(
            "select count(*)::int as count from organizations where tenant_id = $1 and name = 'Klinik B2'",
            [tenantId],
        );
        expect(missing?.count).toBe(0);

        const otherTenant = await createTenant(pool, 'PT Lain');
        const otherMember = await createMember(pool, otherTenant, [
            'core.organization.manage',
        ]);
        const other = browser();
        await other.login(otherMember.email, otherMember.password);
        expect(
            (
                await create(
                    {
                        classification: 'operating_unit',
                        name: 'Klinik Lain',
                        operating_unit_type: 'business_unit',
                        operating_unit_number: 'KLN-B',
                    },
                    other,
                )
            ).status,
        ).toBe(201);
        const [both] = await pool.unsafe(
            "select count(*)::int as count from operating_units where number = 'KLN-B' and tenant_id in ($1, $2)",
            [tenantId, otherTenant],
        );
        expect(both?.count).toBe(2);
    });

    test('the unique index stops a duplicate number that passed the application check', async () => {
        const first = await unit('Klinik C', 'business_unit', 'KLN-C');
        const second = await unit('Klinik D', 'business_unit', 'KLN-D');
        expect(first.id).not.toBe(second.id);
        expect(
            pool.unsafe(
                "update operating_units set number = 'KLN-C' where organization_id = $1",
                [second.id],
            ),
        ).rejects.toThrow('operating_units_tenant_number_unique');
    });

    test('numbers with spaces or other punctuation are refused', async () => {
        for (const number of [
            'KLN A',
            'KLN_A',
            '-KLN',
            'KLN-',
            'KLN--A',
            'A'.repeat(31),
        ]) {
            const response = await create({
                classification: 'operating_unit',
                name: `Unit salah ${number}`,
                operating_unit_type: 'department',
                operating_unit_number: number,
            });
            expect(Object.keys(await errors(response))).toEqual([
                'operating_unit_number',
            ]);
        }
        expect(
            await errors(
                await create({
                    classification: 'operating_unit',
                    name: 'Unit spasi',
                    operating_unit_type: 'department',
                    operating_unit_number: 'KLN A',
                }),
            ),
        ).toEqual({
            operating_unit_number: [
                'Kode unit hanya boleh huruf besar, angka, dan tanda hubung, tanpa spasi.',
            ],
        });
        const [count] = await pool.unsafe(
            "select count(*)::int as count from organizations where tenant_id = $1 and name like 'Unit salah%'",
            [tenantId],
        );
        expect(count?.count).toBe(0);
    });

    test('unit numbers and time zones belong to one classification only', async () => {
        expect(
            await errors(
                await create({
                    classification: 'legal_entity',
                    name: 'PT Nomor',
                    company_code: 'NOMOR',
                    country_code: 'ID',
                    operating_unit_number: 'NOMOR',
                }),
            ),
        ).toEqual({
            operating_unit_number: ['Kode unit hanya untuk operating unit.'],
        });
        expect(
            await errors(
                await create({
                    classification: 'operating_unit',
                    name: 'Unit zona',
                    operating_unit_type: 'cost_center',
                    timezone: 'Asia/Jakarta',
                }),
            ),
        ).toEqual({ timezone: ['Zona waktu hanya untuk legal entity.'] });
        expect(
            await errors(
                await create({
                    classification: 'legal_entity',
                    name: 'PT Zona',
                    company_code: 'ZONA',
                    country_code: 'ID',
                    timezone: 'Mars/Olympus',
                }),
            ),
        ).toEqual({ timezone: ['Pilih zona waktu dari daftar.'] });
        const makassar = await create({
            classification: 'legal_entity',
            name: 'PT Makassar',
            company_code: 'MKS',
            country_code: 'ID',
            timezone: 'Asia/Makassar',
        });
        expect(
            ((await makassar.json()) as { data: { legal_entity: unknown } })
                .data.legal_entity,
        ).toMatchObject({ timezone: 'Asia/Makassar' });
    });

    test('business units and departments need a code, other unit types do not', async () => {
        for (const type of ['business_unit', 'department'])
            for (const number of [{}, { operating_unit_number: '   ' }])
                expect(
                    await errors(
                        await create({
                            classification: 'operating_unit',
                            name: 'Unit tanpa kode',
                            operating_unit_type: type,
                            ...number,
                        }),
                    ),
                ).toEqual({
                    operating_unit_number: [
                        'Isi kode unit untuk Business unit atau Department.',
                    ],
                });
        for (const type of ['cost_center', 'value_stream', 'retail_channel']) {
            const response = await create({
                classification: 'operating_unit',
                name: type,
                operating_unit_type: type,
            });
            expect(response.status).toBe(201);
            expect(
                (
                    (await response.json()) as {
                        data: { operating_unit: { number: null } };
                    }
                ).data.operating_unit.number,
            ).toBeNull();
        }
    });

    test('establishment is a hierarchy purpose, not an operating unit type', async () => {
        expect(
            await errors(
                await create({
                    classification: 'operating_unit',
                    name: 'Main establishment',
                    operating_unit_type: 'establishment',
                }),
            ),
        ).toEqual({
            operating_unit_type: ['Pilih tipe operating unit dari daftar.'],
        });
        const [purpose] = await pool.unsafe(
            "select name from hierarchy_purposes where code = 'establishment'",
        );
        expect(purpose?.name).toBe('Enterprise establishment structure');
    });

    // Alamat dan kontak organisasi baru diuji di test/platform/address-book/party-address.routes.test.ts.
    test('print identity is refused until it moves', async () => {
        const saved = await unit('Unit cetak', 'department', 'CETAK');
        expect(
            await errors(
                await owner.patch(`/api/v1/organizations/${saved.id}`, {
                    version: saved.version,
                    name: 'Unit cetak',
                    operating_unit_type: 'department',
                    print_identity: { version: 0 },
                }),
            ),
        ).toEqual({
            print_identity: ['Identitas cetak belum dapat diubah dari sini.'],
        });
    });

    test('renaming without sending the number keeps it; the number can change but not be cleared', async () => {
        const poli = await unit('Poli Umum', 'department', 'POLI-UMUM');
        const renamed = await owner.patch(`/api/v1/organizations/${poli.id}`, {
            version: poli.version,
            name: 'Poli Umum Lantai 2',
            operating_unit_type: 'department',
        });
        expect(renamed.status).toBe(200);
        expect(
            ((await renamed.json()) as { data: Record<string, unknown> }).data,
        ).toMatchObject({
            id: poli.id,
            name: 'Poli Umum Lantai 2',
            classification: 'operating_unit',
            operating_unit: { number: 'POLI-UMUM', type: 'department' },
        });

        const renumbered = await owner.patch(
            `/api/v1/organizations/${poli.id}`,
            {
                version: await versionOf(poli.id),
                name: 'Poli Umum',
                operating_unit_type: 'business_unit',
                operating_unit_number: 'PU-01',
            },
        );
        expect(renumbered.status).toBe(200);
        expect(
            (
                (await renumbered.json()) as {
                    data: { operating_unit: Record<string, unknown> };
                }
            ).data.operating_unit,
        ).toMatchObject({ number: 'PU-01', type: 'business_unit' });

        expect(
            await errors(
                await owner.patch(`/api/v1/organizations/${poli.id}`, {
                    version: await versionOf(poli.id),
                    name: 'Poli Umum',
                    operating_unit_type: 'department',
                    operating_unit_number: '',
                }),
            ),
        ).toEqual({
            operating_unit_number: [
                'Isi kode unit untuk Business unit atau Department.',
            ],
        });

        const other = await unit('Poli Gigi', 'department', 'POLI-GIGI');
        expect(
            await errors(
                await owner.patch(`/api/v1/organizations/${other.id}`, {
                    version: other.version,
                    name: 'Poli Gigi',
                    operating_unit_type: 'department',
                    operating_unit_number: 'PU-01',
                }),
            ),
        ).toEqual({
            operating_unit_number: [
                'Kode unit sudah dipakai unit lain dalam bisnis ini.',
            ],
        });
        const [row] = await pool.unsafe(
            'select number from operating_units where organization_id = $1',
            [poli.id],
        );
        expect(row?.number).toBe('PU-01');
    });

    test('an unnumbered unit from an earlier release needs a code and gets the tenant copy', async () => {
        const legacy = await create({
            classification: 'operating_unit',
            name: 'Poli Lama',
            operating_unit_type: 'cost_center',
        });
        const { data } = (await legacy.json()) as { data: { id: string } };
        // Data lama: department tanpa kode dan tanpa salinan tenant, seperti yang ditinggalkan rilis sebelumnya.
        await pool.unsafe(
            "update operating_units set type = 'department', tenant_id = null where organization_id = $1",
            [data.id],
        );
        expect(
            await errors(
                await owner.patch(`/api/v1/organizations/${data.id}`, {
                    version: await versionOf(data.id),
                    name: 'Poli Lama diganti',
                    operating_unit_type: 'department',
                }),
            ),
        ).toEqual({
            operating_unit_number: [
                'Isi kode unit untuk Business unit atau Department.',
            ],
        });
        const saved = await owner.patch(`/api/v1/organizations/${data.id}`, {
            version: await versionOf(data.id),
            name: 'Poli Lama',
            operating_unit_type: 'department',
            operating_unit_number: 'POLI-LAMA',
        });
        expect(saved.status).toBe(200);
        const [row] = await pool.unsafe<
            { number: string; tenant_id: string }[]
        >(
            'select number, tenant_id from operating_units where organization_id = $1',
            [data.id],
        );
        expect({ ...row }).toEqual({
            number: 'POLI-LAMA',
            tenant_id: tenantId,
        });
    });

    test('a legal entity update upper-cases its codes and keeps the company code unique', async () => {
        const first = await create({
            classification: 'legal_entity',
            name: 'PT Satu',
            company_code: 'SATU',
            country_code: 'ID',
        });
        const second = await create({
            classification: 'legal_entity',
            name: 'PT Dua',
            company_code: 'DUA',
            country_code: 'ID',
        });
        const { data: one } = (await first.json()) as { data: { id: string } };
        const { data: two } = (await second.json()) as { data: { id: string } };
        expect(
            await errors(
                await owner.patch(`/api/v1/organizations/${two.id}`, {
                    version: await versionOf(two.id),
                    name: 'PT Dua',
                    company_code: 'SATU',
                    country_code: 'ID',
                }),
            ),
        ).toEqual({
            company_code: [
                'Kode legal entity sudah dipakai legal entity lain dalam bisnis ini.',
            ],
        });
        const updated = await owner.patch(`/api/v1/organizations/${one.id}`, {
            version: await versionOf(one.id),
            name: 'PT Satu Sehat',
            company_code: 'satu-2',
            country_code: 'sg',
            timezone: 'Asia/Singapore',
        });
        expect(updated.status).toBe(200);
        expect(
            ((await updated.json()) as { data: Record<string, unknown> }).data,
        ).toMatchObject({
            name: 'PT Satu Sehat',
            legal_entity: {
                company_code: 'SATU-2',
                country_code: 'SG',
                timezone: 'Asia/Singapore',
            },
        });
    });

    test('a second save from the same version is refused and the first save stays', async () => {
        const poli = await unit('Poli Versi', 'department', 'POLI-VERSI');
        const saved = await owner.patch(`/api/v1/organizations/${poli.id}`, {
            name: 'Dari tab pertama',
            operating_unit_type: 'department',
            version: poli.version,
        });
        expect(saved.status).toBe(200);
        expect(
            ((await saved.json()) as { data: { version: number } }).data
                .version,
        ).toBe(await versionOf(poli.id));

        const stale = await owner.patch(`/api/v1/organizations/${poli.id}`, {
            name: 'Dari tab kedua',
            operating_unit_type: 'department',
            version: poli.version,
        });
        expect(stale.status).toBe(409);
        expect(
            ((await stale.json()) as { error: { code: string } }).error.code,
        ).toBe('stale_version');
        const unversioned = await owner.patch(
            `/api/v1/organizations/${poli.id}`,
            { name: 'Tanpa versi', operating_unit_type: 'department' },
        );
        expect(unversioned.status).toBe(428);
        const etag = await owner.request(
            'PATCH',
            `/api/v1/organizations/${poli.id}`,
            {
                body: {
                    name: 'Lewat If-Match',
                    operating_unit_type: 'department',
                },
                headers: { 'if-match': `W/"${await versionOf(poli.id)}"` },
            },
        );
        expect(etag.status).toBe(200);
        const [row] = await pool.unsafe(
            'select name from organizations where id = $1',
            [poli.id],
        );
        expect(row?.name).toBe('Lewat If-Match');
        expect(
            (
                await owner.patch(
                    `/api/v1/organizations/${Bun.randomUUIDv7()}`,
                    {},
                )
            ).status,
        ).toBe(404);
    });

    test('the screen reads the full record it just created through the directory batch', async () => {
        const created = await create({
            classification: 'legal_entity',
            name: 'PT Layar',
            company_code: 'LAYAR',
            country_code: 'ID',
        });
        const { data } = (await created.json()) as {
            data: Record<string, unknown> & { id: string };
        };
        // Jawaban pembuatan tidak membawa versi, padahal layar butuh versi untuk mengubahnya.
        expect(data).not.toHaveProperty('version');
        const batch = (await (
            await owner.get(
                `/api/v1/settings/legal-entities?incremental=1&record_id=${data.id}`,
            )
        ).json()) as { data: Record<string, unknown>[]; next_cursor: null };
        expect(batch.data).toHaveLength(1);
        expect(batch.data[0]).toMatchObject({
            id: data.id,
            name: 'PT Layar',
            version: await versionOf(data.id),
            legal_entity: { company_code: 'LAYAR' },
        });
        const elsewhere = (await (
            await owner.get(
                `/api/v1/settings/operating-units?incremental=1&record_id=${data.id}`,
            )
        ).json()) as { data: unknown[] };
        expect(elsewhere.data).toEqual([]);
    });

    test('directory batches search every record and keep the classification scope', async () => {
        const batchTenant = await createTenant(pool, 'PT Daftar');
        const member = await createMember(pool, batchTenant, [
            'core.organization.manage',
        ]);
        const lister = browser();
        await lister.login(member.email, member.password);
        const ids: string[] = [];
        for (let number = 1; number <= 45; number++) {
            const response = await create(
                {
                    classification: 'operating_unit',
                    name: `Unit ${String(number).padStart(3, '0')}`,
                    operating_unit_type: 'department',
                    operating_unit_number: `UNIT-${String(number).padStart(3, '0')}`,
                },
                lister,
            );
            ids.push(
                ((await response.json()) as { data: { id: string } }).data.id,
            );
        }
        const first = (await (
            await lister.get('/api/v1/settings/operating-units?incremental=1')
        ).json()) as { data: { id: string }[]; next_cursor: string };
        expect(first.data).toHaveLength(40);
        const second = (await (
            await lister.get(
                `/api/v1/settings/operating-units?incremental=1&cursor=${first.next_cursor}`,
            )
        ).json()) as { data: { id: string }[]; next_cursor: null };
        expect(second.data).toHaveLength(5);
        expect(second.next_cursor).toBeNull();
        expect(
            new Set([...first.data, ...second.data].map((row) => row.id)).size,
        ).toBe(45);

        const searched = (await (
            await lister.get(
                '/api/v1/settings/operating-units?incremental=1&q=UNIT-045',
            )
        ).json()) as { data: Record<string, unknown>[] };
        expect(searched.data).toHaveLength(1);
        expect(searched.data[0]).toMatchObject({
            id: ids.at(-1),
            tenant_id: batchTenant,
            classification: 'operating_unit',
            legal_entity: null,
            operating_unit: { number: 'UNIT-045' },
        });
        expect(Object.keys(searched.data[0] ?? {})).toEqual([
            'id',
            'tenant_id',
            'name',
            'classification',
            'status',
            'created_at',
            'updated_at',
            'created_by_user_id',
            'updated_by_user_id',
            'version',
            'legal_entity',
            'operating_unit',
        ]);
        expect(searched.data[0]?.created_by_user_id).toBe(member.userId);

        const companies = (await (
            await lister.get('/api/v1/settings/legal-entities?incremental=1')
        ).json()) as { data: unknown[] };
        expect(companies.data).toHaveLength(0);
        expect(
            (
                await lister.get(
                    '/api/v1/settings/operating-units?incremental=1&sort=tenant_id',
                )
            ).status,
        ).toBe(422);

        const list = (await (
            await lister.get('/api/v1/organizations')
        ).json()) as {
            data: { name: string; tenant_id: string }[];
        };
        expect(list.data).toHaveLength(45);
        expect(list.data[0]?.name).toBe('Unit 001');
        expect(new Set(list.data.map((row) => row.tenant_id))).toEqual(
            new Set([batchTenant]),
        );
    });

    test('page data answers under /api/v1 with the props CoreERP gave its pages', async () => {
        const page = await owner.get('/api/v1/settings/operating-units');
        expect(page.status).toBe(200);
        const props = (await page.json()) as Record<string, unknown> & {
            timezones: { value: string; label: string }[];
        };
        expect(props).toMatchObject({
            scopeKey: tenantId,
            canManage: true,
            operatingUnitTypes: {
                business_unit: 'Business unit',
                department: 'Department',
                cost_center: 'Cost center',
                value_stream: 'Value stream',
                retail_channel: 'Retail channel',
            },
            organizations: [],
        });
        expect(props.timezones).toContainEqual({
            value: 'Asia/Jakarta',
            label: 'Asia/Jakarta · UTC+07:00',
        });
        expect(props).not.toHaveProperty('hierarchies');

        const hierarchies = (await (
            await owner.get('/api/v1/settings/organization-hierarchies')
        ).json()) as Record<string, unknown>;
        expect(hierarchies).toMatchObject({ hierarchies: [] });
        expect(hierarchies).not.toHaveProperty('timezones');
        expect(hierarchies.purposes).toContainEqual({
            code: 'establishment',
            name: 'Enterprise establishment structure',
            description:
                'Struktur operating unit yang berperan sebagai establishment di bawah legal entity.',
        });
    });

    test('screen permissions follow the core organization duties', async () => {
        const outsider = await createMember(pool, tenantId);
        const plain = browser();
        await plain.login(outsider.email, outsider.password);
        expect(
            (await plain.get('/api/v1/settings/legal-entities')).status,
        ).toBe(403);
        expect(
            (
                await create(
                    {
                        classification: 'operating_unit',
                        name: 'Finance',
                        operating_unit_type: 'department',
                    },
                    plain,
                )
            ).status,
        ).toBe(403);
        // Daftar API CoreERP cukup keanggotaan aktif.
        expect((await plain.get('/api/v1/organizations')).status).toBe(200);

        const reader = await createMember(pool, tenantId, [
            'core.organization.inquire',
        ]);
        const viewer = browser();
        await viewer.login(reader.email, reader.password);
        const page = await viewer.get('/api/v1/settings/legal-entities');
        expect(page.status).toBe(200);
        expect(((await page.json()) as { canManage: boolean }).canManage).toBe(
            false,
        );
        expect(
            (
                await create(
                    {
                        classification: 'operating_unit',
                        name: 'Finance',
                        operating_unit_type: 'department',
                    },
                    viewer,
                )
            ).status,
        ).toBe(403);

        const anonymous = browser();
        expect((await anonymous.get('/api/v1/organizations')).status).toBe(401);
        const forged = await owner.request('POST', '/api/v1/organizations', {
            body: { classification: 'operating_unit' },
            headers: { 'x-xsrf-token': 'palsu' },
        });
        expect(forged.status).toBe(419);
    });

    test('an organization of another tenant cannot be changed or listed', async () => {
        const otherTenant = await createTenant(pool, 'PT Tetangga');
        const otherMember = await createMember(pool, otherTenant, [
            'core.organization.manage',
        ]);
        const neighbour = browser();
        await neighbour.login(otherMember.email, otherMember.password);
        const foreign = await create(
            {
                classification: 'operating_unit',
                name: 'Unit tetangga',
                operating_unit_type: 'cost_center',
            },
            neighbour,
        );
        const { data } = (await foreign.json()) as { data: { id: string } };
        const attempt = await owner.patch(`/api/v1/organizations/${data.id}`, {
            version: await versionOf(data.id),
            name: 'Diambil alih',
            operating_unit_type: 'cost_center',
        });
        expect(attempt.status).toBe(403);
        const [row] = await pool.unsafe(
            'select name from organizations where id = $1',
            [data.id],
        );
        expect(row?.name).toBe('Unit tetangga');
        const list = (await (
            await owner.get('/api/v1/organizations')
        ).json()) as {
            data: { id: string }[];
        };
        expect(list.data.map((item) => item.id)).not.toContain(data.id);
    });
});
