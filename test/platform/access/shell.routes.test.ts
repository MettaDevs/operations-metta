import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import {
    createMember,
    createTenant,
    createUser,
    grantAllOrganizations,
} from '../../support/tenant-fixtures.ts';

type Organization = { id: string; name: string; classification: string };
type Shell = {
    auth: {
        user: { id: string; name: string; email: string };
        membership: {
            id: string;
            tenant_id: string;
            tenant_name: string;
        } | null;
    };
    workspace: {
        memberships: { id: string; tenant_id: string; tenant_name: string }[];
        active_legal_entity: Organization | null;
        active_org_unit: Organization | null;
        legal_entities: Organization[];
        org_units: Organization[];
    };
    navigation: {
        id: string;
        label: string;
        icon: string | null;
        href: string;
        groups: {
            id: string;
            label: string;
            icon: string | null;
            items: {
                id: string;
                label: string;
                href: string;
                section: string | null;
            }[];
        }[];
    }[];
    uninstalled_apps: { id: string; label: string; icon: string | null }[];
    environment: null;
};

// Pengganti shared props HandleInertiaRequests CoreERP: satu endpoint untuk data yang dipakai Shell di setiap layar.
describe.skipIf(!process.env.DB_HOST)('shell data', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let tenantId: string;
    let member: Awaited<ReturnType<typeof createMember>>;
    let owner: Browser;
    afterAll(close);

    async function organization(body: Record<string, unknown>) {
        const response = await owner.post('/api/v1/organizations', body);
        expect(response.status).toBe(201);
        return ((await response.json()) as { data: { id: string } }).data.id;
    }

    async function shell(as: Browser): Promise<Shell> {
        const response = await as.get('/api/v1/shell');
        expect(response.status).toBe(200);
        return (await response.json()) as Shell;
    }

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'Klinik Uji Shell');
        member = await createMember(pool, tenantId, [
            'core.organization.manage',
        ]);
        await grantAllOrganizations(pool, tenantId, member.membershipId);
        owner = browser();
        await owner.login(member.email, member.password);
    });

    test('without a session the shell answers 401, which sends the screen to login', async () => {
        const anonymous = browser();
        const response = await anonymous.get('/api/v1/shell');
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ message: 'Unauthenticated.' });
    });

    test('a member gets the user, the workspace and its choices, and the menu', async () => {
        const second = await organization({
            classification: 'legal_entity',
            name: 'PT Kedua',
            company_code: 'KEDUA',
            country_code: 'ID',
        });
        const first = await organization({
            classification: 'legal_entity',
            name: 'PT Pertama',
            company_code: 'PERTAMA',
            country_code: 'ID',
        });
        const unit = await organization({
            classification: 'operating_unit',
            name: 'Poli Umum',
            operating_unit_type: 'department',
            operating_unit_number: 'POLI-UMUM',
        });

        const data = await shell(owner);
        expect(Object.keys(data)).toEqual([
            'auth',
            'workspace',
            'navigation',
            'uninstalled_apps',
            'environment',
        ]);
        expect(data.auth).toEqual({
            user: {
                id: member.userId,
                name: 'Anggota uji',
                email: member.email,
            },
            membership: {
                id: member.membershipId,
                tenant_id: tenantId,
                tenant_name: 'Klinik Uji Shell',
            },
        });
        expect(data.workspace).toEqual({
            memberships: [
                {
                    id: member.membershipId,
                    tenant_id: tenantId,
                    tenant_name: 'Klinik Uji Shell',
                },
            ],
            // Urut nama, dan yang pertama aktif selama sesi belum memilih.
            active_legal_entity: {
                id: second,
                name: 'PT Kedua',
                classification: 'legal_entity',
            },
            active_org_unit: {
                id: unit,
                name: 'Poli Umum',
                classification: 'operating_unit',
            },
            legal_entities: [
                {
                    id: second,
                    name: 'PT Kedua',
                    classification: 'legal_entity',
                },
                {
                    id: first,
                    name: 'PT Pertama',
                    classification: 'legal_entity',
                },
            ],
            org_units: [
                {
                    id: unit,
                    name: 'Poli Umum',
                    classification: 'operating_unit',
                },
            ],
        });
        // Satu area Sys Admin, kelompoknya sama dengan folder kode. Tautan area adalah halaman awal anggota ini.
        expect(data.navigation).toEqual([
            {
                id: 'sysadmin',
                label: 'Sys Admin',
                icon: 'settings',
                href: '/sysadmin/dashboard',
                groups: [
                    {
                        id: 'dashboard',
                        label: 'Dashboard',
                        icon: 'layout-dashboard',
                        items: [
                            {
                                id: 'dashboard',
                                label: 'Dashboard',
                                href: '/sysadmin/dashboard',
                                section: null,
                            },
                        ],
                    },
                    {
                        id: 'organization',
                        label: 'Organisasi',
                        icon: 'building-2',
                        items: [
                            {
                                id: 'legal-entities',
                                label: 'Legal entity',
                                href: '/sysadmin/organization/legal-entities',
                                section: null,
                            },
                            {
                                id: 'operating-units',
                                label: 'Operating unit',
                                href: '/sysadmin/organization/operating-units',
                                section: null,
                            },
                            {
                                id: 'hierarchies',
                                label: 'Hierarki organisasi',
                                href: '/sysadmin/organization/hierarchies',
                                section: null,
                            },
                        ],
                    },
                    {
                        id: 'address-book',
                        label: 'Buku alamat',
                        icon: 'contact',
                        items: [
                            {
                                id: 'parties',
                                label: 'Pihak',
                                href: '/sysadmin/address-book/parties',
                                section: null,
                            },
                            {
                                id: 'occupations',
                                label: 'Pekerjaan',
                                href: '/sysadmin/address-book/occupations',
                                section: null,
                            },
                            {
                                id: 'duplicate-check',
                                label: 'Cek data ganda',
                                href: '/sysadmin/address-book/duplicate-check',
                                section: null,
                            },
                        ],
                    },
                ],
            },
        ]);
        expect(data.environment).toBeNull();
        expect(data.uninstalled_apps).toEqual([]);

        const switched = await owner.put('/api/v1/workspace-context', {
            membership_id: member.membershipId,
            legal_entity_id: first,
            org_unit_id: unit,
        });
        expect(switched.status).toBe(200);
        expect((await shell(owner)).workspace.active_legal_entity?.id).toBe(
            first,
        );
    });

    test('the Sys Admin area and its groups show only to members who may open one of their pages', async () => {
        const viewers = [
            [
                ['core.organization.inquire'],
                [['sysadmin', ['dashboard', 'organization', 'address-book']]],
            ],
            [
                ['core.organization.manage'],
                [['sysadmin', ['dashboard', 'organization', 'address-book']]],
            ],
            [
                ['core.reference-data.inquire'],
                [['sysadmin', ['dashboard', 'geography']]],
            ],
            // Tanpa halaman yang boleh dibuka tidak ada area, jadi tidak ada halaman awal.
            [[], []],
        ] as const;
        for (const [duties, areas] of viewers) {
            const member = await createMember(pool, tenantId, [...duties]);
            const viewer = browser();
            await viewer.login(member.email, member.password);
            expect(
                (await shell(viewer)).navigation.map((area) => [
                    area.id,
                    area.groups.map((group) => group.id),
                ]),
            ).toEqual(areas.map(([area, groups]) => [area, [...groups]]));
        }
    });

    test('every member who may open a Sys Admin page starts at the Sys Admin dashboard', async () => {
        const member = await createMember(pool, tenantId, [
            'core.reference-data.inquire',
        ]);
        const viewer = browser();
        await viewer.login(member.email, member.password);
        expect((await shell(viewer)).navigation[0]?.href).toBe(
            '/sysadmin/dashboard',
        );
    });

    test('organizations outside the data policy are not offered', async () => {
        const unscoped = await createMember(pool, tenantId, [
            'core.organization.inquire',
        ]);
        const viewer = browser();
        await viewer.login(unscoped.email, unscoped.password);
        const data = await shell(viewer);
        expect(data.auth.membership?.id).toBe(unscoped.membershipId);
        expect(data.workspace.legal_entities).toEqual([]);
        expect(data.workspace.org_units).toEqual([]);
        expect(data.workspace.active_legal_entity).toBeNull();
    });

    test('a member of two tenants sees both, each under its own name', async () => {
        const other = await createTenant(pool, 'Klinik Uji Kedua');
        const [row] = await pool.unsafe<{ id: string }[]>(
            'select id from tenant_memberships where user_id = $1',
            [member.userId],
        );
        const otherMembership = Bun.randomUUIDv7();
        await pool.unsafe(
            "insert into tenant_memberships (id, tenant_id, user_id, status, created_at, updated_at) values ($1, $2, $3, 'active', now() + interval '1 second', now())",
            [otherMembership, other, member.userId],
        );
        const data = await shell(owner);
        expect(data.auth.membership?.id).toBe(row?.id);
        expect(data.workspace.memberships).toEqual([
            {
                id: member.membershipId,
                tenant_id: tenantId,
                tenant_name: 'Klinik Uji Shell',
            },
            {
                id: otherMembership,
                tenant_id: other,
                tenant_name: 'Klinik Uji Kedua',
            },
        ]);
    });

    test('a user without any tenant still gets the shell, with no workspace', async () => {
        const loner = await createUser(pool, 'Tanpa Tenant');
        const alone = browser();
        await alone.login(loner.email, loner.password);
        const data = await shell(alone);
        expect(data.auth).toEqual({
            user: {
                id: loner.userId,
                name: 'Tanpa Tenant',
                email: loner.email,
            },
            membership: null,
        });
        expect(data.workspace).toEqual({
            memberships: [],
            active_legal_entity: null,
            active_org_unit: null,
            legal_entities: [],
            org_units: [],
        });
        expect(data.navigation).toEqual([]);
    });
});
