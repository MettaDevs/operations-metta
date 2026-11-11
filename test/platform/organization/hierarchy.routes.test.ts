import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../support/operations-app.ts';
import { createMember, createTenant } from '../../support/tenant-fixtures.ts';

type Graph = {
    id: string;
    status: string;
    version: number;
    purposes: { code: string; pivot: { hierarchy_id: string } }[];
    versions: {
        id: string;
        version_number: number;
        status: string;
        nodes: {
            id: string;
            organization_id: string;
            parent_node_id: string | null;
            organization: { name: string };
            parent_node: { organization: { name: string } } | null;
        }[];
    }[];
};
type Saved = { savedHierarchy: Graph; flash: { status: string } };

// Perilaku acuan: OrganizationHierarchyTest, OperatingUnitNumberTest, dan SettingsRowVersionTest di CoreERP.
describe.skipIf(!process.env.DB_HOST)('organization hierarchy', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    let tenantId: string;
    let owner: Browser;
    afterAll(close);

    beforeAll(async () => {
        tenantId = await createTenant(pool, 'PT Uji Hierarchy');
        const member = await createMember(pool, tenantId, [
            'core.organization.manage',
        ]);
        owner = browser();
        await owner.login(member.email, member.password);
    });

    let counter = 0;
    async function organization(
        classification: 'legal_entity' | 'operating_unit',
        name: string,
        type = 'department',
    ): Promise<string> {
        counter++;
        const response = await owner.post(
            '/api/v1/organizations',
            classification === 'legal_entity'
                ? {
                      classification,
                      name,
                      company_code: `LE${counter}`,
                      country_code: 'ID',
                  }
                : {
                      classification,
                      name,
                      operating_unit_type: type,
                      operating_unit_number: `UNIT-${counter}`,
                  },
        );
        expect(response.status).toBe(201);
        return ((await response.json()) as { data: { id: string } }).data.id;
    }

    async function saved(response: Response): Promise<Saved> {
        expect(response.status).toBe(200);
        return (await response.json()) as Saved;
    }

    async function hierarchy(
        name: string,
        root: string,
        purposes = ['management'],
    ) {
        const result = await saved(
            await owner.post('/api/v1/settings/organization/hierarchies', {
                name,
                purpose_codes: purposes,
                root_organization_id: root,
                effective_from: '2026-01-01',
            }),
        );
        const version = result.savedHierarchy.versions[0];
        if (!version) throw new Error('Hierarchy without a version.');
        return { graph: result.savedHierarchy, versionId: version.id };
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
        return owner.post(`${versionPath(versionId)}/placements`, {
            version: await rowVersion(versionId),
            organization_id: child,
            parent_organization_id: parent,
        });
    }

    async function publish(versionId: string) {
        return owner.post(`${versionPath(versionId)}/publish`, {
            version: await rowVersion(versionId),
        });
    }

    async function closure(
        versionId: string,
        ancestor: string,
        descendant: string,
    ) {
        const [row] = await pool.unsafe<
            { distance: number; deleted_at: Date | null }[]
        >(
            'select distance, deleted_at from organization_hierarchy_closures where version_id = $1 and ancestor_organization_id = $2 and descendant_organization_id = $3',
            [versionId, ancestor, descendant],
        );
        return row;
    }

    test('owner builds a purpose-scoped hierarchy, places a unit, and publishes it', async () => {
        const company = await organization('legal_entity', 'PT Metta');
        const finance = await organization('operating_unit', 'Finance');
        const created = await hierarchy('Management structure', company, [
            'management',
            'policy',
        ]);
        expect(created.graph).toMatchObject({
            name: 'Management structure',
            status: 'draft',
            tenant_id: tenantId,
            versions: [
                {
                    version_number: 1,
                    status: 'draft',
                    effective_from: '2026-01-01T00:00:00.000000Z',
                    published_at: null,
                    nodes: [
                        {
                            organization_id: company,
                            parent_node_id: null,
                            parent_node: null,
                        },
                    ],
                },
            ],
        });
        expect(created.graph.purposes.map((purpose) => purpose.code)).toEqual([
            'management',
            'policy',
        ]);

        const placed = await saved(
            await place(created.versionId, finance, company),
        );
        expect(placed.flash.status).toBe(
            'Organisasi ditempatkan pada draft hierarchy.',
        );
        expect(placed.savedHierarchy.versions[0]?.nodes[1]).toMatchObject({
            organization_id: finance,
            organization: {
                name: 'Finance',
                operating_unit: { type: 'department' },
            },
            parent_node: { organization: { name: 'PT Metta' } },
        });
        const published = await saved(await publish(created.versionId));
        expect(published.flash.status).toBe('Hierarchy dipublikasikan.');
        expect(published.savedHierarchy).toMatchObject({
            status: 'active',
            versions: [{ status: 'published' }],
        });
        expect({
            ...(await closure(created.versionId, company, finance)),
        }).toEqual({
            distance: 1,
            deleted_at: null,
        });
    });

    test('the same organization can serve several hierarchies without copies', async () => {
        const company = await organization('legal_entity', 'PT Bersama');
        await hierarchy('Management bersama', company, ['management']);
        await hierarchy('Procurement bersama', company, ['procurement']);
        const [counts] = await pool.unsafe<
            { organizations: number; nodes: number }[]
        >(
            `select (select count(*)::int from organizations where tenant_id = $1 and name = 'PT Bersama') as organizations,
                    (select count(*)::int from organization_hierarchy_nodes where organization_id = $2) as nodes`,
            [tenantId, company],
        );
        expect({ ...counts }).toEqual({ organizations: 1, nodes: 2 });
    });

    test('a published hierarchy is copied to an editable next version', async () => {
        const company = await organization('legal_entity', 'PT Versi');
        const finance = await organization('operating_unit', 'Finance Versi');
        const { versionId } = await hierarchy('Struktur versi', company);
        await saved(await place(versionId, finance, company));
        expect(
            (
                await owner.post(`${versionPath(versionId)}/drafts`, {
                    version: await rowVersion(versionId),
                    effective_from: '2026-02-01',
                })
            ).status,
        ).toBe(422);
        await saved(await publish(versionId));
        const draft = await saved(
            await owner.post(`${versionPath(versionId)}/drafts`, {
                version: await rowVersion(versionId),
                effective_from: '2026-02-01',
            }),
        );
        expect(draft.flash.status).toBe(
            'Draft versi baru dibuat. Susun perubahan lalu publikasikan.',
        );
        const next = draft.savedHierarchy.versions[0];
        expect(next).toMatchObject({ version_number: 2, status: 'draft' });
        expect(next?.nodes).toHaveLength(2);
        expect(next?.nodes[1]?.parent_node_id).toBe(next?.nodes[0]?.id ?? '');
        expect({
            ...(await closure(next?.id ?? '', company, finance)),
        }).toEqual({
            distance: 1,
            deleted_at: null,
        });
        expect(
            (
                await place(
                    versionId,
                    await organization('operating_unit', 'Telat'),
                    company,
                )
            ).status,
        ).toBe(422);
    });

    test('an organization cannot be placed twice in one draft', async () => {
        const company = await organization('legal_entity', 'PT Ganda');
        const finance = await organization('operating_unit', 'Finance Ganda');
        const { versionId } = await hierarchy('Struktur ganda', company);
        await saved(await place(versionId, finance, company));
        const again = await place(versionId, finance, company);
        expect(again.status).toBe(422);
        expect(
            ((await again.json()) as { errors: Record<string, string[]> })
                .errors,
        ).toEqual({
            organization_id: ['Organisasi ini sudah ada pada draft hierarchy.'],
        });
        const [nodes] = await pool.unsafe(
            'select count(*)::int as count from organization_hierarchy_nodes where version_id = $1',
            [versionId],
        );
        expect(nodes?.count).toBe(2);
    });

    test('a draft placement can be cancelled and placed again under another parent', async () => {
        const company = await organization('legal_entity', 'PT Lepas');
        const branch = await organization(
            'operating_unit',
            'Branch',
            'business_unit',
        );
        const front = await organization('operating_unit', 'Front Office');
        const { versionId } = await hierarchy('Struktur lepas', company);
        await saved(await place(versionId, branch, company));
        const placed = await saved(await place(versionId, front, company));
        const node = placed.savedHierarchy.versions[0]?.nodes.find(
            (item) => item.organization_id === front,
        );
        const root = placed.savedHierarchy.versions[0]?.nodes.find(
            (item) => item.organization_id === company,
        );

        const rootRemoval = await owner.delete(
            `${versionPath(versionId)}/placements/${root?.id}`,
            { version: await rowVersion(versionId) },
        );
        expect(rootRemoval.status).toBe(422);
        expect(
            ((await rootRemoval.json()) as { errors: Record<string, string[]> })
                .errors,
        ).toEqual({
            node: [
                'Organisasi paling atas tidak dapat dilepas dari draft ini.',
            ],
        });

        const removed = await saved(
            await owner.delete(
                `${versionPath(versionId)}/placements/${node?.id}`,
                {
                    version: await rowVersion(versionId),
                },
            ),
        );
        expect(removed.flash.status).toBe('Penempatan organisasi dibatalkan.');
        expect(
            removed.savedHierarchy.versions[0]?.nodes.map(
                (item) => item.organization_id,
            ),
        ).toEqual([company, branch]);
        // Tidak ada baris yang dihapus fisik: node dan closure-nya diberi deleted_at.
        const [softNode] = await pool.unsafe(
            'select deleted_at is not null as deleted from organization_hierarchy_nodes where id = $1',
            [node?.id ?? ''],
        );
        expect(softNode?.deleted).toBe(true);
        expect(
            (await closure(versionId, company, front))?.deleted_at,
        ).not.toBeNull();
        expect(
            (
                await owner.delete(
                    `${versionPath(versionId)}/placements/${node?.id}`,
                    {
                        version: await rowVersion(versionId),
                    },
                )
            ).status,
        ).toBe(404);

        await saved(await place(versionId, front, branch));
        expect({ ...(await closure(versionId, branch, front)) }).toEqual({
            distance: 1,
            deleted_at: null,
        });
        expect({ ...(await closure(versionId, company, front)) }).toEqual({
            distance: 2,
            deleted_at: null,
        });

        const [branchNode] = await pool.unsafe(
            'select id from organization_hierarchy_nodes where version_id = $1 and organization_id = $2 and deleted_at is null',
            [versionId, branch],
        );
        const parentRemoval = await owner.delete(
            `${versionPath(versionId)}/placements/${branchNode?.id}`,
            { version: await rowVersion(versionId) },
        );
        expect(parentRemoval.status).toBe(422);
        expect(
            (
                (await parentRemoval.json()) as {
                    errors: Record<string, string[]>;
                }
            ).errors,
        ).toEqual({
            node: [
                'Pindahkan atau lepaskan organisasi di bawahnya terlebih dahulu.',
            ],
        });
    });

    test('a draft accepts several operating units under one legal entity', async () => {
        const company = await organization('legal_entity', 'PT Banyak');
        const { versionId } = await hierarchy('Struktur banyak', company);
        for (const name of ['Finance', 'Operations', 'Sales'])
            await saved(
                await place(
                    versionId,
                    await organization('operating_unit', `${name} Banyak`),
                    company,
                ),
            );
        const [nodes] = await pool.unsafe(
            'select count(*)::int as count from organization_hierarchy_nodes where version_id = $1',
            [versionId],
        );
        expect(nodes?.count).toBe(4);
    });

    test('hierarchy input is validated and names are unique per tenant', async () => {
        const company = await organization('legal_entity', 'PT Nama');
        await hierarchy('Business policy', company, ['policy']);
        const duplicate = await owner.post(
            '/api/v1/settings/organization/hierarchies',
            {
                name: ' Business policy ',
                purpose_codes: ['policy'],
                root_organization_id: company,
                effective_from: '2026-01-01',
            },
        );
        expect(duplicate.status).toBe(422);
        expect(
            ((await duplicate.json()) as { errors: Record<string, string[]> })
                .errors,
        ).toEqual({
            name: ['Nama susunan organisasi sudah dipakai. Pilih nama lain.'],
        });

        const invalid = await owner.post(
            '/api/v1/settings/organization/hierarchies',
            {
                name: '',
                purpose_codes: ['policy', 'tidak-ada'],
                effective_from: '2026-02-30',
            },
        );
        expect(invalid.status).toBe(422);
        expect(
            ((await invalid.json()) as { errors: Record<string, string[]> })
                .errors,
        ).toEqual({
            name: ['Isi nama hierarki.'],
            'purpose_codes.1': ['The selected purpose codes.1 is invalid.'],
            root_organization_id: ['Pilih organisasi paling atas.'],
            effective_from: [
                'Isi tanggal berlaku mulai dengan format dd/mm/yyyy.',
            ],
        });

        const foreignRoot = await owner.post(
            '/api/v1/settings/organization/hierarchies',
            {
                name: 'Akar asing',
                purpose_codes: ['policy'],
                root_organization_id: Bun.randomUUIDv7(),
                effective_from: '2026-01-01',
            },
        );
        expect(
            ((await foreignRoot.json()) as { errors: Record<string, string[]> })
                .errors,
        ).toEqual({
            root_organization_id: [
                'Organisasi atau tujuan hierarchy tidak valid.',
            ],
        });
        const [count] = await pool.unsafe(
            "select count(*)::int as count from organization_hierarchies where tenant_id = $1 and name = 'Business policy'",
            [tenantId],
        );
        expect(count?.count).toBe(1);
    });

    test('the lookup leaves out placed organizations and keeps the tenant scope', async () => {
        const lookupTenant = await createTenant(pool, 'PT Lookup');
        const member = await createMember(pool, lookupTenant, [
            'core.organization.manage',
        ]);
        const looker = browser();
        await looker.login(member.email, member.password);
        const make = async (body: Record<string, unknown>) =>
            (
                (await (
                    await looker.post('/api/v1/organizations', body)
                ).json()) as {
                    data: { id: string };
                }
            ).data.id;
        const company = await make({
            classification: 'legal_entity',
            name: 'Legal entity',
            company_code: 'CO',
            country_code: 'ID',
        });
        const unit = await make({
            classification: 'operating_unit',
            name: 'Unit',
            operating_unit_type: 'cost_center',
        });
        const created = (await (
            await looker.post('/api/v1/settings/organization/hierarchies', {
                name: 'Struktur',
                purpose_codes: ['management'],
                root_organization_id: company,
                effective_from: '2026-01-01',
            })
        ).json()) as Saved;
        const versionId = created.savedHierarchy.versions[0]?.id ?? '';
        const lookup = (await (
            await looker.get(
                `/api/v1/settings/organization-hierarchies?incremental=1&resource=organizations&exclude_version_id=${versionId}`,
            )
        ).json()) as { data: { id: string }[] };
        expect(lookup.data.map((row) => row.id)).toEqual([unit]);

        const record = (await (
            await looker.get(
                `/api/v1/settings/organization-hierarchies?incremental=1&record_id=${created.savedHierarchy.id}`,
            )
        ).json()) as { data: Graph[]; next_cursor: null };
        expect(record.next_cursor).toBeNull();
        expect(record.data[0]?.versions).toHaveLength(1);
        expect(record.data[0]?.versions[0]?.nodes).toHaveLength(1);

        const list = (await (
            await looker.get(
                '/api/v1/settings/organization-hierarchies?incremental=1',
            )
        ).json()) as { data: unknown[] };
        expect(list.data).toEqual([
            {
                id: created.savedHierarchy.id,
                name: 'Struktur',
                status: 'draft',
                version: 1,
            },
        ]);
        expect(
            (
                await looker.get(
                    `/api/v1/settings/organization-hierarchies?incremental=1&record_id=${Bun.randomUUIDv7()}`,
                )
            ).status,
        ).toBe(404);
        expect(
            (
                await owner.get(
                    `/api/v1/settings/organization-hierarchies?incremental=1&record_id=${created.savedHierarchy.id}`,
                )
            ).status,
        ).toBe(404);
        expect(
            (
                await looker.get(
                    '/api/v1/settings/organization-hierarchies?incremental=1&resource=orang',
                )
            ).status,
        ).toBe(422);

        // Versi tenant lain tidak bisa diubah, walau pemanggilnya memegang izin di tenantnya sendiri.
        const foreign = await owner.post(`${versionPath(versionId)}/publish`, {
            version: 1,
        });
        expect(foreign.status).toBe(403);
    });

    test('a placement from a stale screen keeps the first placement', async () => {
        const company = await organization('legal_entity', 'PT Basi');
        const first = await organization('operating_unit', 'Poli Umum Basi');
        const second = await organization('operating_unit', 'Poli Gigi Basi');
        const { versionId } = await hierarchy('Struktur basi', company);
        const version = await rowVersion(versionId);
        await saved(
            await owner.post(`${versionPath(versionId)}/placements`, {
                organization_id: first,
                parent_organization_id: company,
                version,
            }),
        );
        const stale = await owner.post(`${versionPath(versionId)}/placements`, {
            organization_id: second,
            parent_organization_id: company,
            version,
        });
        expect(stale.status).toBe(409);
        expect(
            ((await stale.json()) as { error: { code: string } }).error.code,
        ).toBe('stale_version');
        expect(
            (await owner.post(`${versionPath(versionId)}/publish`, {})).status,
        ).toBe(428);
        const [nodes] = await pool.unsafe(
            'select count(*)::int as count from organization_hierarchy_nodes where version_id = $1',
            [versionId],
        );
        expect(nodes?.count).toBe(2);
    });

    test('a member without the manage duty cannot change a hierarchy', async () => {
        const company = await organization('legal_entity', 'PT Hak');
        const { versionId } = await hierarchy('Struktur hak', company);
        const reader = await createMember(pool, tenantId, [
            'core.organization.inquire',
        ]);
        const viewer = browser();
        await viewer.login(reader.email, reader.password);
        const before = await rowVersion(versionId);
        expect(
            (
                await viewer.post(`${versionPath(versionId)}/publish`, {
                    version: before,
                })
            ).status,
        ).toBe(403);
        expect(
            (
                await viewer.post('/api/v1/settings/organization/hierarchies', {
                    name: 'Struktur pembaca',
                    purpose_codes: ['management'],
                    root_organization_id: company,
                    effective_from: '2026-01-01',
                })
            ).status,
        ).toBe(403);
        expect(await rowVersion(versionId)).toBe(before);
    });

    test('a data policy over a published hierarchy ignores units removed from its draft', async () => {
        const company = await organization('legal_entity', 'PT Kebijakan');
        const kept = await organization('operating_unit', 'Poli Tetap');
        const removed = await organization('operating_unit', 'Poli Dilepas');
        const { versionId } = await hierarchy('Struktur kebijakan', company);
        await saved(await place(versionId, kept, company));
        const placed = await saved(await place(versionId, removed, company));
        const node = placed.savedHierarchy.versions[0]?.nodes.find(
            (item) => item.organization_id === removed,
        );
        await saved(
            await owner.delete(
                `${versionPath(versionId)}/placements/${node?.id}`,
                {
                    version: await rowVersion(versionId),
                },
            ),
        );
        await saved(await publish(versionId));

        const member = await createMember(pool, tenantId, [
            'core.organization.inquire',
        ]);
        const [assignment] = await pool.unsafe(
            'select id from role_assignments where membership_id = $1',
            [member.membershipId],
        );
        const [hierarchyRow] = await pool.unsafe(
            'select hierarchy_id from organization_hierarchy_versions where id = $1',
            [versionId],
        );
        await pool.unsafe(
            `insert into app_data_policies (code, app_id, name, protected_permissions, allows_descendants, created_at, updated_at)
             values ('uji.kebijakan', 'core', 'Kebijakan uji', '[]', true, now(), now())
             on conflict (code) do nothing`,
        );
        await pool.unsafe(
            `insert into role_assignment_data_policy_scopes
                 (id, tenant_id, role_assignment_id, policy_code, legal_entity_id, organization_id, hierarchy_id,
                  hierarchy_version_id, include_descendants, valid_from, created_at, updated_at)
             values ($1, $2, $3, 'uji.kebijakan', $4, $4, $5, $6, true, now() - interval '1 day', now(), now())`,
            [
                Bun.randomUUIDv7(),
                tenantId,
                assignment?.id,
                company,
                hierarchyRow?.hierarchy_id,
                versionId,
            ],
        );
        const scoped = browser();
        await scoped.login(member.email, member.password);
        const allowed = await scoped.put('/api/v1/workspace-context', {
            membership_id: member.membershipId,
            legal_entity_id: company,
            org_unit_id: kept,
        });
        expect(allowed.status).toBe(200);
        const refused = await scoped.put('/api/v1/workspace-context', {
            membership_id: member.membershipId,
            legal_entity_id: company,
            org_unit_id: removed,
        });
        expect(refused.status).toBe(422);
    });
});
