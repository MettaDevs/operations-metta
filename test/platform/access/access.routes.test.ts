import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import {
    createMember,
    createTenant,
    createUser,
} from '../../support/tenant-fixtures.ts';

// Perilaku acuan: InvitationAccessTest (bagian keanggotaan dan penjaga Owner), RoleHierarchyTest, SodConflictTest,
// dan CoreScreenPermissionTest di CoreERP. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('access administration', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    // Kebijakan data uji: dipakai role yang memegang izin vendor, organisasi, atau data referensi, dan mewajibkan
    // perusahaan serta unit. Core sendiri belum punya kebijakan data; module yang membawanya.
    const policy = 'uji.akses-faskes';
    let tenantId: string;
    let ownerMembership: string;
    let owner: Browser;
    let legalEntity: string;
    let clinicA: string;
    let clinicB: string;
    afterAll(close);

    async function organization(
        name: string,
        classification: 'legal_entity' | 'operating_unit',
        tenant = tenantId,
    ) {
        const id = Bun.randomUUIDv7();
        await pool.unsafe(
            "insert into organizations (id, tenant_id, name, classification, status, created_at, updated_at) values ($1, $2, $3, $4, 'active', now(), now())",
            [id, tenant, name, classification],
        );
        return id;
    }

    // Anggota yang bisa login tanpa role apa pun.
    async function staff(tenant = tenantId) {
        const user = await createUser(pool, `Staf ${Bun.randomUUIDv7()}`);
        const membershipId = Bun.randomUUIDv7();
        await pool.unsafe(
            "insert into tenant_memberships (id, tenant_id, user_id, status, created_at, updated_at) values ($1, $2, $3, 'active', now(), now())",
            [membershipId, tenant, user.userId],
        );
        return { ...user, membershipId };
    }

    async function json<T = Record<string, unknown>>(
        response: Response,
        status: number,
    ): Promise<T> {
        const text = await response.text();
        expect({ status: response.status, text }).toMatchObject({ status });
        return (text ? JSON.parse(text) : null) as T;
    }

    async function errors(response: Response) {
        return (await json<{ errors: Record<string, string[]> }>(response, 422))
            .errors;
    }

    async function createRole(
        name: string,
        duties: string[],
        children: string[] = [],
        as = owner,
    ) {
        const body = await json<{ data: { id: string; version: number } }>(
            await as.post('/api/v1/roles', {
                name,
                duty_codes: duties,
                child_role_ids: children,
            }),
            201,
        );
        return body.data;
    }

    async function version(table: string, id: string) {
        const [row] = await pool.unsafe(
            `select version from ${table} where id = $1`,
            [id],
        );
        return Number(row?.version);
    }

    async function assign(
        membershipId: string,
        assignments: unknown[],
        as = owner,
    ) {
        return as.patch(`/api/v1/memberships/${membershipId}`, {
            version: await version('tenant_memberships', membershipId),
            assignments,
        });
    }

    const at = (unit: string) => [
        {
            policy_code: policy,
            legal_entity_id: legalEntity,
            organization_id: unit,
            hierarchy_id: null,
            include_descendants: false,
        },
    ];

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'PT Uji Akses');
        await pool.unsafe(
            `insert into app_data_policies (code, app_id, name, protected_permissions, requires_legal_entity,
                 requires_operating_unit, allows_descendants, created_at, updated_at)
             values ($1, 'core', 'Faskes (uji)',
                     '["core.vendor.read", "core.organization.read", "core.reference-data.read"]',
                     true, true, false, now(), now())
             on conflict (code) do nothing`,
            [policy],
        );
        // Role Owner bawaan seperti hasil provisionEnvironment: semua duty Core, penugasan otomatis.
        const member = await createMember(pool, tenantId);
        ownerMembership = member.membershipId;
        const ownerRole = Bun.randomUUIDv7();
        await pool.unsafe(
            "insert into roles (id, tenant_id, name, is_active, is_owner, created_at, updated_at) values ($1, $2, 'Pemilik', true, true, now(), now())",
            [ownerRole, tenantId],
        );
        await pool.unsafe(
            "insert into security_role_duties (role_id, duty_code) select $1, code from security_duties where app_id = 'core' and tenant_id is null",
            [ownerRole],
        );
        await pool.unsafe(
            "insert into role_assignments (id, membership_id, role_id, source, status, valid_from, created_at, updated_at) values ($1, $2, $3, 'automatic', 'active', now() - interval '1 day', now(), now())",
            [Bun.randomUUIDv7(), ownerMembership, ownerRole],
        );
        owner = browser();
        await owner.login(member.email, member.password);
        legalEntity = await organization('PT Klinik Uji', 'legal_entity');
        clinicA = await organization('Klinik Uji Timur', 'operating_unit');
        clinicB = await organization('Klinik Uji Barat', 'operating_unit');
    });

    test('a role is composed from duties the tenant may use, and the list reads it back', async () => {
        const created = await owner.post('/api/v1/roles', {
            name: 'Kasir uji',
            duty_codes: ['core.vendor.inquire'],
        });
        const body = await json<{
            data: Record<string, unknown> & { id: string };
        }>(created, 201);
        expect(created.headers.get('location')).toBe(
            `/api/v1/roles/${body.data.id}`,
        );
        expect(body.data).toMatchObject({
            name: 'Kasir uji',
            is_owner: false,
            duty_codes: ['core.vendor.inquire'],
            child_roles: [],
            data_policy_codes: [policy],
        });

        expect(
            await errors(
                await owner.post('/api/v1/roles', {
                    name: 'Tanpa duty',
                    duty_codes: [],
                }),
            ),
        ).toEqual({
            duty_codes: [
                'Pilih sedikitnya satu tanggung jawab untuk role ini.',
            ],
        });
        expect(
            await errors(
                await owner.post('/api/v1/roles', {
                    name: 'Duty karangan',
                    duty_codes: ['core.vendor.inquire', 'tidak.ada'],
                }),
            ),
        ).toEqual({
            duty_codes: [
                'Tanggung jawab harus berasal dari produk yang boleh digunakan tenant.',
            ],
        });
        expect(
            await errors(
                await owner.post('/api/v1/roles', {
                    name: 'Kasir uji',
                    duty_codes: ['core.vendor.inquire'],
                }),
            ),
        ).toEqual({ name: ['Role dengan nama ini sudah ada.'] });

        const updated = await owner.put(`/api/v1/roles/${body.data.id}`, {
            version: await version('roles', body.data.id),
            name: 'Kasir',
            duty_codes: ['core.vendor.inquire', 'core.organization.inquire'],
        });
        expect(
            (await json<{ data: { duty_codes: string[] } }>(updated, 200)).data
                .duty_codes,
        ).toEqual(['core.organization.inquire', 'core.vendor.inquire']);
        expect(
            (
                await owner.put(`/api/v1/roles/${body.data.id}`, {
                    version: 1,
                    name: 'Kasir',
                    duty_codes: ['core.vendor.inquire'],
                })
            ).status,
        ).toBe(409);

        const list = await json<{
            data: { name: string; duty_count: number }[];
        }>(await owner.get('/api/v1/roles?q=kasir'), 200);
        expect(list.data).toEqual([
            expect.objectContaining({ name: 'Kasir', duty_count: 2 }),
        ]);
    });

    test('reading roles needs access read, and changing them needs access update', async () => {
        const reader = await createMember(pool, tenantId, [
            'core.access.inquire',
        ]);
        const session = browser();
        await session.login(reader.email, reader.password);
        expect((await session.get('/api/v1/roles')).status).toBe(200);
        expect((await session.get('/api/v1/access')).status).toBe(200);
        expect(
            (
                await session.post('/api/v1/roles', {
                    name: 'Tidak boleh',
                    duty_codes: ['core.vendor.inquire'],
                })
            ).status,
        ).toBe(403);

        const outsider = await createMember(pool, tenantId, [
            'core.vendor.inquire',
        ]);
        const other = browser();
        await other.login(outsider.email, outsider.password);
        expect((await other.get('/api/v1/roles')).status).toBe(403);
        expect((await other.get('/api/v1/access/members')).status).toBe(403);
        expect((await other.get('/api/v1/security-configuration')).status).toBe(
            403,
        );
    });

    test('the owner role cannot be edited, deleted, or nested', async () => {
        const [ownerRole] = await pool.unsafe(
            'select id, version from roles where tenant_id = $1 and is_owner',
            [tenantId],
        );
        const id = String(ownerRole?.id);
        expect(
            await errors(
                await owner.put(`/api/v1/roles/${id}`, {
                    version: ownerRole?.version,
                    name: 'Owner',
                    duty_codes: ['core.vendor.inquire'],
                }),
            ),
        ).toEqual({
            name: [
                'Role Owner diatur otomatis dan selalu memegang semua duty, jadi tidak dapat diubah.',
            ],
        });
        expect(
            await errors(
                await owner.delete(`/api/v1/roles/${id}`, {
                    version: ownerRole?.version,
                }),
            ),
        ).toEqual({ role: ['Role Owner tidak dapat dihapus.'] });
        expect(
            await errors(
                await owner.post('/api/v1/roles', {
                    name: 'Super',
                    duty_codes: ['core.vendor.inquire'],
                    child_role_ids: [id],
                }),
            ),
        ).toEqual({
            child_role_ids: [
                'Role Owner tidak dapat dijadikan turunan role lain.',
            ],
        });
    });

    test('a role hierarchy rejects cycles and roles of another tenant', async () => {
        const child = await createRole('Anak uji', ['core.vendor.inquire']);
        const parent = await createRole(
            'Induk uji',
            ['core.organization.inquire'],
            [child.id],
        );
        expect(
            await errors(
                await owner.put(`/api/v1/roles/${child.id}`, {
                    version: await version('roles', child.id),
                    name: 'Anak uji',
                    duty_codes: ['core.vendor.inquire'],
                    child_role_ids: [parent.id],
                }),
            ),
        ).toEqual({
            child_role_ids: ['Susunan role tidak boleh membentuk lingkaran.'],
        });

        const otherTenant = await createTenant(pool, 'PT Lain');
        const foreign = await createMember(pool, otherTenant, [
            'core.vendor.inquire',
        ]);
        expect(
            await errors(
                await owner.post('/api/v1/roles', {
                    name: 'Asing',
                    duty_codes: ['core.vendor.inquire'],
                    child_role_ids: [foreign.roleId],
                }),
            ),
        ).toEqual({
            child_role_ids: [
                'Role turunan harus berasal dari tenant yang sama.',
            ],
        });
        // Role induk mewarisi kebijakan data turunannya.
        const shown = await json<{
            data: {
                child_roles: { id: string }[];
                data_policy_codes: string[];
            };
        }>(await owner.get(`/api/v1/roles/${parent.id}`), 200);
        expect(shown.data.child_roles.map((role) => role.id)).toEqual([
            child.id,
        ]);
        expect(shown.data.data_policy_codes).toEqual([policy]);
    });

    test('one staff member holds several roles per clinic, and the workspace offers only those clinics', async () => {
        const registration = await createRole('Pendaftaran', [
            'core.organization.inquire',
        ]);
        const pharmacy = await createRole('Farmasi', [
            'core.reference-data.inquire',
        ]);
        const cashier = await createRole('Kasir faskes', [
            'core.vendor.inquire',
        ]);
        const member = await staff();

        const saved = await json<{
            data: {
                assignments: {
                    role_name: string;
                    policy_scopes: { organization_id: string }[];
                }[];
            };
        }>(
            await assign(member.membershipId, [
                { role_id: registration.id, policy_scopes: at(clinicA) },
                { role_id: pharmacy.id, policy_scopes: at(clinicA) },
                {
                    role_id: cashier.id,
                    policy_scopes: [...at(clinicA), ...at(clinicB)],
                },
            ]),
            200,
        );
        expect(
            saved.data.assignments.map((assignment) => [
                assignment.role_name,
                assignment.policy_scopes
                    .map((scope) => scope.organization_id)
                    .sort(),
            ]),
        ).toEqual([
            ['Farmasi', [clinicA]],
            ['Kasir faskes', [clinicA, clinicB].sort()],
            ['Pendaftaran', [clinicA]],
        ]);

        const session = browser();
        await session.login(member.email, member.password);
        const shell = await json<{
            workspace: {
                legal_entities: { id: string }[];
                org_units: { id: string }[];
            };
            navigation: { id: string }[];
        }>(await session.get('/api/v1/shell'), 200);
        expect(shell.workspace.legal_entities.map((item) => item.id)).toEqual([
            legalEntity,
        ]);
        expect(shell.workspace.org_units.map((item) => item.id).sort()).toEqual(
            [clinicA, clinicB].sort(),
        );
        expect(shell.navigation.map((group) => group.id)).not.toContain(
            'access',
        );

        // Daftar staf dapat disaring per faskes dan per role.
        const atB = await json<{ data: { id: string }[] }>(
            await owner.get(
                `/api/v1/access/members?organization_id=${clinicB}`,
            ),
            200,
        );
        expect(atB.data.map((row) => row.id)).toEqual([member.membershipId]);
        const pharmacists = await json<{ data: { id: string }[] }>(
            await owner.get(`/api/v1/access/members?role_id=${pharmacy.id}`),
            200,
        );
        expect(pharmacists.data.map((row) => row.id)).toEqual([
            member.membershipId,
        ]);

        // Mencabut role Kasir menutup penugasannya: faskes B hilang seketika, dan barisnya tetap ada.
        await json(
            await assign(member.membershipId, [
                { role_id: registration.id, policy_scopes: at(clinicA) },
                { role_id: pharmacy.id, policy_scopes: at(clinicA) },
            ]),
            200,
        );
        const after = await json<{
            workspace: { org_units: { id: string }[] };
        }>(await session.get('/api/v1/shell'), 200);
        expect(after.workspace.org_units.map((item) => item.id)).toEqual([
            clinicA,
        ]);
        const [closed] = await pool.unsafe<
            { status: string; closed: boolean }[]
        >(
            'select status, valid_until is not null as closed from role_assignments where membership_id = $1 and role_id = $2',
            [member.membershipId, cashier.id],
        );
        expect({ ...closed }).toEqual({ status: 'inactive', closed: true });

        // Memberikannya lagi menghidupkan baris yang sama.
        await json(
            await assign(member.membershipId, [
                { role_id: registration.id, policy_scopes: at(clinicA) },
                { role_id: cashier.id, policy_scopes: at(clinicB) },
            ]),
            200,
        );
        const rows = await pool.unsafe<{ status: string }[]>(
            'select status from role_assignments where membership_id = $1 and role_id = $2',
            [member.membershipId, cashier.id],
        );
        expect(rows.map((row) => row.status)).toEqual(['active']);
        const [audit] = await pool.unsafe(
            "select count(*)::int as count from access_audit_events where membership_id = $1 and action = 'access.manual-assignment.updated'",
            [member.membershipId],
        );
        expect(audit?.count).toBe(3);
    });

    test('revoking a role removes its permission on the next request', async () => {
        const accessRole = await createRole('Admin faskes uji', [
            'core.access.inquire',
        ]);
        const member = await staff();
        await json(
            await assign(member.membershipId, [
                { role_id: accessRole.id, policy_scopes: [] },
            ]),
            200,
        );
        const session = browser();
        await session.login(member.email, member.password);
        expect((await session.get('/api/v1/access')).status).toBe(200);
        const menu = await json<{ navigation: { id: string }[] }>(
            await session.get('/api/v1/shell'),
            200,
        );
        expect(menu.navigation.map((group) => group.id)).toContain('access');

        await json(await assign(member.membershipId, []), 200);
        expect((await session.get('/api/v1/access')).status).toBe(403);
    });

    test('data limits are checked against the policies the role uses', async () => {
        const accessOnly = await createRole('Tanpa kebijakan', [
            'core.access.inquire',
        ]);
        const vendor = await createRole('Vendor uji', ['core.vendor.inquire']);
        const member = await staff();
        expect(
            await errors(
                await assign(member.membershipId, [
                    { role_id: accessOnly.id, policy_scopes: at(clinicA) },
                ]),
            ),
        ).toEqual({
            policy_code: [
                'Policy data tidak tersedia untuk tanggung jawab bisnis yang dipilih.',
            ],
        });
        expect(
            await errors(
                await assign(member.membershipId, [
                    {
                        role_id: vendor.id,
                        policy_scopes: [
                            {
                                ...at(clinicA)[0],
                                organization_id: legalEntity,
                            },
                        ],
                    },
                ]),
            ),
        ).toEqual({
            organization_id: [
                'Pilih unit kerja, bukan badan hukum, untuk batas akses ini.',
            ],
        });
        expect(
            await errors(
                await assign(member.membershipId, [
                    {
                        role_id: vendor.id,
                        policy_scopes: [...at(clinicA), ...at(clinicA)],
                    },
                ]),
            ),
        ).toEqual({
            assignments: [
                'Batas data yang sama atau sudah tercakup tidak boleh ditambahkan dua kali pada role yang sama.',
            ],
        });
        const empty = {
            policy_code: policy,
            legal_entity_id: null,
            organization_id: null,
            hierarchy_id: null,
            include_descendants: false,
        };
        expect(
            await errors(
                await assign(member.membershipId, [
                    { role_id: vendor.id, policy_scopes: [empty] },
                ]),
            ),
        ).toEqual({
            legal_entity_id: ['Pilih badan hukum untuk batas akses ini.'],
        });
        const unrestricted = await json<{
            data: {
                assignments: {
                    policy_scopes: { unrestricted: boolean }[];
                }[];
            };
        }>(
            await assign(member.membershipId, [
                {
                    role_id: vendor.id,
                    policy_scopes: [{ ...empty, unrestricted: true }],
                },
            ]),
            200,
        );
        expect(
            unrestricted.data.assignments[0]?.policy_scopes[0]?.unrestricted,
        ).toBe(true);
    });

    test('only an owner grants or revokes the owner role, and access management cannot lock itself out', async () => {
        const [ownerRole] = await pool.unsafe(
            'select id from roles where tenant_id = $1 and is_owner',
            [tenantId],
        );
        const managerRole = await createRole('Pengelola akses uji', [
            'core.access.manage',
        ]);
        const manager = await staff();
        await json(
            await assign(manager.membershipId, [
                { role_id: managerRole.id, policy_scopes: [] },
            ]),
            200,
        );
        const session = browser();
        await session.login(manager.email, manager.password);
        expect(
            await errors(
                await assign(
                    manager.membershipId,
                    [
                        { role_id: managerRole.id, policy_scopes: [] },
                        { role_id: ownerRole?.id, policy_scopes: [] },
                    ],
                    session,
                ),
            ),
        ).toEqual({
            role_ids: [
                'Hanya pemegang role Owner yang dapat memberikan atau mencabut role Owner.',
            ],
        });

        // Pemilik dinonaktifkan sementara, sehingga pengelola ini satu-satunya yang dapat mengelola akses.
        await pool.unsafe(
            "update role_assignments set status = 'inactive' where membership_id = $1",
            [ownerMembership],
        );
        try {
            expect(
                await errors(await assign(manager.membershipId, [], session)),
            ).toEqual({
                access: [
                    'Perubahan ini membuat tidak ada lagi anggota yang dapat mengelola akses. Sisakan minimal satu anggota aktif yang memegang duty Kelola akses.',
                ],
            });
            expect(
                await errors(
                    await session.delete(`/api/v1/roles/${managerRole.id}`, {
                        version: await version('roles', managerRole.id),
                    }),
                ),
            ).toHaveProperty('access');
        } finally {
            await pool.unsafe(
                "update role_assignments set status = 'active' where membership_id = $1",
                [ownerMembership],
            );
        }
    });

    test('segregation of duties rejects a conflicting assignment and writes nothing', async () => {
        const submitter = await createRole('Pengaju uji', [
            'core.vendor.manage',
        ]);
        const verifier = await createRole('Verifikator uji', [
            'core.reference-data.manage',
        ]);
        await pool.unsafe(
            `insert into sod_rules (id, tenant_id, first_duty_code, second_duty_code, severity, risk, allows_mitigation,
                 is_active, created_at, updated_at)
             values ($1, $2, 'core.vendor.manage', 'core.reference-data.manage', 'high',
                     'Pengaju dan verifikator harus berbeda.', false, true, now(), now())`,
            [Bun.randomUUIDv7(), tenantId],
        );
        const member = await staff();
        expect(
            await errors(
                await assign(member.membershipId, [
                    { role_id: submitter.id },
                    { role_id: verifier.id },
                ]),
            ),
        ).toEqual({
            assignments: [
                'Role ini memberi dua tugas yang tidak boleh dipegang bersama: Pengaju dan verifikator harus berbeda.',
            ],
        });
        const rows = await pool.unsafe(
            'select id from role_assignments where membership_id = $1',
            [member.membershipId],
        );
        expect(rows).toHaveLength(0);
    });

    test('a deleted role keeps its row, stops granting, and frees its name', async () => {
        const role = await createRole('Sementara', ['core.access.inquire']);
        const member = await staff();
        await json(
            await assign(member.membershipId, [
                { role_id: role.id, policy_scopes: [] },
            ]),
            200,
        );
        const session = browser();
        await session.login(member.email, member.password);
        expect((await session.get('/api/v1/access')).status).toBe(200);
        expect(
            (
                await owner.delete(`/api/v1/roles/${role.id}`, {
                    version: await version('roles', role.id),
                })
            ).status,
        ).toBe(204);
        expect((await session.get('/api/v1/access')).status).toBe(403);
        const [row] = await pool.unsafe<
            { is_active: boolean; deleted: boolean }[]
        >(
            'select is_active, deleted_at is not null as deleted from roles where id = $1',
            [role.id],
        );
        expect({ ...row }).toEqual({ is_active: false, deleted: true });
        expect((await owner.get(`/api/v1/roles/${role.id}`)).status).toBe(404);
        await createRole('Sementara', ['core.access.inquire']);
    });

    test('memberships and roles of another tenant are out of reach', async () => {
        const otherTenant = await createTenant(pool, 'PT Tetangga');
        const foreign = await createMember(pool, otherTenant, [
            'core.vendor.inquire',
        ]);
        expect(
            (await owner.get(`/api/v1/memberships/${foreign.membershipId}`))
                .status,
        ).toBe(404);
        expect(
            (
                await owner.patch(
                    `/api/v1/memberships/${foreign.membershipId}`,
                    {
                        version: 1,
                        assignments: [],
                    },
                )
            ).status,
        ).toBe(404);
        const member = await staff();
        expect(
            await errors(
                await assign(member.membershipId, [
                    { role_id: foreign.roleId, policy_scopes: [] },
                ]),
            ),
        ).toEqual({
            role_ids: [
                'Pilih tanggung jawab bisnis yang tersedia untuk bisnis ini.',
            ],
        });
        const page = await json<{
            data: { id: string }[];
            next_cursor: string | null;
        }>(await owner.get('/api/v1/access/members?per_page=1'), 200);
        expect(page.next_cursor).not.toBeNull();
        const ids = page.data.map((row) => row.id);
        let cursor = page.next_cursor;
        while (cursor) {
            const next = await json<{
                data: { id: string }[];
                next_cursor: string | null;
            }>(
                await owner.get(
                    `/api/v1/access/members?per_page=1&cursor=${cursor}`,
                ),
                200,
            );
            ids.push(...next.data.map((row) => row.id));
            cursor = next.next_cursor;
        }
        const [count] = await pool.unsafe(
            'select count(*)::int as count from tenant_memberships where tenant_id = $1',
            [tenantId],
        );
        expect(new Set(ids).size).toBe(count?.count);
        expect(ids).not.toContain(foreign.membershipId);
    });

    test('the security catalog lists duties down to permissions', async () => {
        const body = await json<{
            data: {
                duties: { code: string; privilege_codes: string[] }[];
                privileges: { code: string; permission_codes: string[] }[];
                permissions: {
                    code: string;
                    entry_point: { code: string } | null;
                }[];
            };
        }>(await owner.get('/api/v1/security-configuration'), 200);
        expect(
            body.data.duties.find((duty) => duty.code === 'core.access.manage'),
        ).toEqual(
            expect.objectContaining({
                privilege_codes: ['core.access.maintain'],
            }),
        );
        expect(
            body.data.privileges.find(
                (privilege) => privilege.code === 'core.access.maintain',
            )?.permission_codes,
        ).toEqual(['core.access.read', 'core.access.update']);
        expect(
            body.data.permissions.find(
                (permission) => permission.code === 'core.access.update',
            )?.entry_point?.code,
        ).toBe('core.access.form');
    });
});
