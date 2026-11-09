import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import { Database, nowSql } from '../database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    validation,
} from '../http/index.ts';
import {
    createHierarchySchema,
    draftSchema,
    graphHierarchySchema,
    hierarchyListRowSchema,
    graphNodeSchema,
    graphVersionSchema,
    nodeSchema,
    placementSchema,
    purposeSchema,
    versionSchema,
    type HierarchyVersion,
} from './hierarchy.schema.ts';
import { failOn } from './organization.schema.ts';
import { isoSql, staleMessage } from './organization.service.ts';

const found = z.object({ found: z.boolean() });

function closureInsert(): string {
    // Pasangan atas-bawah yang pernah dilepas dari draft ini dihidupkan lagi, karena dalam satu versi ia tetap satu
    // fakta (kunci utamanya versi, atas, dan bawah).
    return `insert into organization_hierarchy_closures (version_id, ancestor_organization_id, descendant_organization_id, distance)
            values ($1, $2, $3, $4)
            on conflict (version_id, ancestor_organization_id, descendant_organization_id)
            do update set distance = excluded.distance, deleted_at = null`;
}

export class OrganizationHierarchies {
    constructor(
        private readonly db: Database,
        readonly workspace: Workspace,
    ) {}

    purposes() {
        return this.db.rows(
            z.object({
                code: z.string(),
                name: z.string(),
                description: z.string().nullable(),
            }),
            'select code, name, description from hierarchy_purposes order by name, code',
        );
    }

    async graph(id: string) {
        const hierarchy = lookupId(id)
            ? await this.db.one(
                  graphHierarchySchema,
                  `select id, tenant_id, name, status, ${isoSql('created_at')} as created_at,
                          ${isoSql('updated_at')} as updated_at, created_by_user_id, updated_by_user_id, version
                   from organization_hierarchies where tenant_id = $1 and id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!hierarchy) abort(404, 'Not Found');
        const purposes = await this.db.rows(
            purposeSchema,
            `select p.id, p.code, p.name,
                    json_build_object('hierarchy_id', hp.hierarchy_id, 'purpose_id', hp.purpose_id) as pivot,
                    coalesce((select json_agg(json_build_object('purpose_id', t.purpose_id, 'organization_type', t.organization_type)
                                              order by t.organization_type)
                              from hierarchy_purpose_organization_types t where t.purpose_id = p.id), '[]'::json)
                        as allowed_organization_types
             from organization_hierarchy_purposes hp
             join hierarchy_purposes p on p.id = hp.purpose_id
             where hp.hierarchy_id = $1
             order by p.code`,
            [hierarchy.id],
        );
        const versions = await this.db.rows(
            graphVersionSchema,
            `select id, hierarchy_id, version_number, status, ${isoSql('effective_from')} as effective_from,
                    ${isoSql('published_at')} as published_at, ${isoSql('created_at')} as created_at,
                    ${isoSql('updated_at')} as updated_at
             from organization_hierarchy_versions where hierarchy_id = $1 order by version_number desc limit 1`,
            [hierarchy.id],
        );
        return {
            ...hierarchy,
            purposes,
            versions: await Promise.all(
                versions.map(async (version) => ({
                    ...version,
                    nodes: await this.db.rows(
                        graphNodeSchema,
                        `select n.id, n.version_id, n.organization_id, n.parent_node_id,
                                ${isoSql('n.created_at')} as created_at, ${isoSql('n.updated_at')} as updated_at,
                                json_build_object('id', o.id, 'name', o.name, 'classification', o.classification,
                                    'operating_unit', case when ou.organization_id is null then null else
                                        json_build_object('organization_id', ou.organization_id, 'type', ou.type, 'number', ou.number) end)
                                    as organization,
                                case when parent.id is null then null else
                                    json_build_object('id', parent.id, 'organization_id', parent.organization_id,
                                        'organization', json_build_object('id', parent_organization.id, 'name', parent_organization.name))
                                end as parent_node
                         from organization_hierarchy_nodes n
                         join organizations o on o.id = n.organization_id
                         left join operating_units ou on ou.organization_id = o.id
                         left join organization_hierarchy_nodes parent on parent.id = n.parent_node_id
                         left join organizations parent_organization on parent_organization.id = parent.organization_id
                         where n.version_id = $1 and n.deleted_at is null
                         order by n.created_at, n.id`,
                        [version.id],
                    ),
                })),
            ),
        };
    }

    async batch(parameters: URLSearchParams) {
        const batch = await incrementalList(this.db, {
            query: 'select id, name, status, version from organization_hierarchies where tenant_id = $1',
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { name: 'name' },
            searchColumns: ['name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        // Baris yang sama dengan kolom query di atas, dibaca lewat schema supaya tipenya sampai ke layar.
        return {
            data: z.array(hierarchyListRowSchema).parse(batch.data),
            next_cursor: batch.next_cursor,
        };
    }

    // Versi milik tenant, untuk menyaring organisasi yang sudah ditempatkan.
    async ownVersion(id: string): Promise<string> {
        const version = lookupId(id)
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  'select v.id from organization_hierarchy_versions v join organization_hierarchies h on h.id = v.hierarchy_id where h.tenant_id = $1 and v.id = $2',
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!version) abort(404, 'Not Found');
        return version.id;
    }

    async create(body: unknown) {
        this.workspace.guard('organization', 'update');
        const input = createHierarchySchema.parse(body);
        const errors: Record<string, string[]> = { ...input.errors };
        if (
            !errors.name?.length &&
            (await this.db.one(
                found,
                'select true as found from organization_hierarchies where name = $1 and tenant_id = $2 limit 1',
                [input.name, this.workspace.tenantId],
            ))
        )
            errors.name = [
                'Nama susunan organisasi sudah dipakai. Pilih nama lain.',
            ];
        for (const [index, code] of input.purpose_codes.entries()) {
            const key = `purpose_codes.${index}`;
            if (errors[key]?.length) continue;
            if (
                !(await this.db.one(
                    found,
                    'select true as found from hierarchy_purposes where code = $1 limit 1',
                    [code],
                ))
            )
                errors[key] = [
                    `The selected purpose codes.${index} is invalid.`,
                ];
        }
        failOn(errors);

        const tenantId = this.workspace.tenantId;
        const root = lookupId(input.root_organization_id)
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  "select id from organizations where tenant_id = $1 and status = 'active' and id = $2",
                  [tenantId, input.root_organization_id],
              )
            : undefined;
        const codes = [...new Set(input.purpose_codes)];
        const purposes = await this.db.rows(
            z.object({ id: z.string() }),
            `select id from hierarchy_purposes where code in (${codes.map((_, index) => `$${index + 1}`).join(',')})`,
            codes,
        );
        if (!root || purposes.length !== codes.length)
            validation({
                root_organization_id:
                    'Organisasi atau tujuan hierarchy tidak valid.',
            });
        const id = Bun.randomUUIDv7();
        const versionId = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.transaction(async () => {
                await this.db.insert('organization_hierarchies', {
                    id,
                    tenant_id: tenantId,
                    name: input.name,
                    status: 'draft',
                    created_at: stamp,
                    updated_at: stamp,
                });
                for (const purpose of purposes)
                    await this.db.insert('organization_hierarchy_purposes', {
                        hierarchy_id: id,
                        purpose_id: purpose.id,
                    });
                await this.db.insert('organization_hierarchy_versions', {
                    id: versionId,
                    hierarchy_id: id,
                    version_number: 1,
                    status: 'draft',
                    effective_from: input.effective_from,
                    created_at: stamp,
                    updated_at: stamp,
                });
                await this.db.insert('organization_hierarchy_nodes', {
                    id: Bun.randomUUIDv7(),
                    version_id: versionId,
                    organization_id: root.id,
                    parent_node_id: null,
                    created_at: stamp,
                    updated_at: stamp,
                });
                await this.db.execute(closureInsert(), [
                    versionId,
                    root.id,
                    root.id,
                    0,
                ]);
            });
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.includes(
                    '"organization_hierarchies_tenant_id_name_unique"',
                )
            )
                validation({
                    name: 'Nama susunan organisasi sudah dipakai. Pilih nama lain.',
                });
            throw error;
        }
        return this.saved(id, 'Draft hierarchy dibuat.');
    }

    async place(request: Request, versionId: string, body: unknown) {
        const version = await this.version(versionId);
        const input = placementSchema.parse(body);
        failOn(input.errors);
        await this.db.transaction(async () => {
            await this.claim(request, body, version);
            if (version.status !== 'draft')
                validation({
                    hierarchy_version:
                        'Hierarchy yang sudah dipublikasikan tidak dapat diubah.',
                });
            const organization = lookupId(input.organization_id)
                ? await this.db.one(
                      z.object({ id: z.string() }),
                      'select id from organizations where tenant_id = $1 and id = $2',
                      [this.workspace.tenantId, input.organization_id],
                  )
                : undefined;
            const parent = lookupId(input.parent_organization_id)
                ? await this.db.one(
                      nodeSchema,
                      'select id, version_id, organization_id, parent_node_id from organization_hierarchy_nodes where version_id = $1 and organization_id = $2 and deleted_at is null limit 1',
                      [version.id, input.parent_organization_id],
                  )
                : undefined;
            if (!organization || !parent)
                validation({
                    organization_id:
                        'Organisasi dan parent harus berasal dari tenant serta versi yang sama.',
                });
            if (
                await this.db.one(
                    found,
                    'select true as found from organization_hierarchy_nodes where version_id = $1 and organization_id = $2 and deleted_at is null limit 1',
                    [version.id, organization.id],
                )
            )
                validation({
                    organization_id:
                        'Organisasi ini sudah ada pada draft hierarchy.',
                });
            const stamp = nowSql();
            await this.db.insert('organization_hierarchy_nodes', {
                id: Bun.randomUUIDv7(),
                version_id: version.id,
                organization_id: organization.id,
                parent_node_id: parent.id,
                created_at: stamp,
                updated_at: stamp,
            });
            const ancestors = await this.db.rows(
                z.object({
                    ancestor_organization_id: z.string(),
                    distance: z.number(),
                }),
                'select ancestor_organization_id, distance from organization_hierarchy_closures where version_id = $1 and descendant_organization_id = $2 and deleted_at is null',
                [version.id, parent.organization_id],
            );
            for (const ancestor of ancestors)
                await this.db.execute(closureInsert(), [
                    version.id,
                    ancestor.ancestor_organization_id,
                    organization.id,
                    ancestor.distance + 1,
                ]);
            await this.db.execute(closureInsert(), [
                version.id,
                organization.id,
                organization.id,
                0,
            ]);
        });
        return this.saved(
            version.hierarchy_id,
            'Organisasi ditempatkan pada draft hierarchy.',
        );
    }

    // Di CoreERP node dan closure-nya dihapus fisik. Di sini keduanya diberi deleted_at.
    async unplace(
        request: Request,
        versionId: string,
        nodeId: string,
        body: unknown,
    ) {
        const version = await this.version(versionId);
        const node = lookupId(nodeId)
            ? await this.db.one(
                  nodeSchema,
                  'select id, version_id, organization_id, parent_node_id from organization_hierarchy_nodes where id = $1 and deleted_at is null',
                  [nodeId],
              )
            : undefined;
        if (!node) abort(404, 'Not Found');
        await this.db.transaction(async () => {
            await this.claim(request, body, version);
            if (node.version_id !== version.id) abort(403, 'Tidak diizinkan.');
            if (version.status !== 'draft')
                validation({
                    hierarchy_version:
                        'Hierarchy yang sudah dipublikasikan tidak dapat diubah.',
                });
            if (node.parent_node_id === null)
                validation({
                    node: 'Organisasi paling atas tidak dapat dilepas dari draft ini.',
                });
            if (
                await this.db.one(
                    found,
                    'select true as found from organization_hierarchy_nodes where version_id = $1 and parent_node_id = $2 and deleted_at is null limit 1',
                    [version.id, node.id],
                )
            )
                validation({
                    node: 'Pindahkan atau lepaskan organisasi di bawahnya terlebih dahulu.',
                });
            const stamp = nowSql();
            await this.db.execute(
                'update organization_hierarchy_closures set deleted_at = $1 where version_id = $2 and (ancestor_organization_id = $3 or descendant_organization_id = $3) and deleted_at is null',
                [stamp, version.id, node.organization_id],
            );
            await this.db.execute(
                'update organization_hierarchy_nodes set deleted_at = $1, updated_at = $1 where id = $2',
                [stamp, node.id],
            );
        });
        return this.saved(
            version.hierarchy_id,
            'Penempatan organisasi dibatalkan.',
        );
    }

    async createDraft(request: Request, versionId: string, body: unknown) {
        const source = await this.version(versionId);
        const input = draftSchema.parse(body);
        failOn(input.errors);
        await this.db.transaction(async () => {
            await this.claim(request, body, source);
            if (source.status !== 'published')
                validation({
                    hierarchy_version:
                        'Draft baru hanya dapat dibuat dari versi yang sudah dipublikasikan.',
                });
            await this.db.execute(
                'select id from organization_hierarchies where id = $1 for update',
                [source.hierarchy_id],
            );
            const latest = await this.db.one(
                z.object({ number: z.number().nullable() }),
                'select max(version_number) as number from organization_hierarchy_versions where hierarchy_id = $1',
                [source.hierarchy_id],
            );
            const draftId = Bun.randomUUIDv7();
            const stamp = nowSql();
            await this.db.insert('organization_hierarchy_versions', {
                id: draftId,
                hierarchy_id: source.hierarchy_id,
                version_number: (latest?.number ?? 0) + 1,
                status: 'draft',
                effective_from: input.effective_from,
                created_at: stamp,
                updated_at: stamp,
            });
            // Node disalin induk lebih dulu, supaya setiap node baru menunjuk salinan induknya.
            let remaining = await this.db.rows(
                nodeSchema,
                'select id, version_id, organization_id, parent_node_id from organization_hierarchy_nodes where version_id = $1 and deleted_at is null order by created_at, id',
                [source.id],
            );
            const copies = new Map<string, string>();
            while (remaining.length) {
                const waiting: typeof remaining = [];
                for (const node of remaining) {
                    const parent = node.parent_node_id
                        ? copies.get(node.parent_node_id)
                        : null;
                    if (parent === undefined) {
                        waiting.push(node);
                        continue;
                    }
                    const id = Bun.randomUUIDv7();
                    await this.db.insert('organization_hierarchy_nodes', {
                        id,
                        version_id: draftId,
                        organization_id: node.organization_id,
                        parent_node_id: parent,
                        created_at: stamp,
                        updated_at: stamp,
                    });
                    copies.set(node.id, id);
                }
                if (waiting.length === remaining.length)
                    throw new Error(
                        'Hierarchy nodes point to a parent outside the version.',
                    );
                remaining = waiting;
            }
            await this.db.execute(
                `insert into organization_hierarchy_closures (version_id, ancestor_organization_id, descendant_organization_id, distance)
                 select $1, ancestor_organization_id, descendant_organization_id, distance
                 from organization_hierarchy_closures where version_id = $2 and deleted_at is null`,
                [draftId, source.id],
            );
        });
        return this.saved(
            source.hierarchy_id,
            'Draft versi baru dibuat. Susun perubahan lalu publikasikan.',
        );
    }

    async publish(request: Request, versionId: string, body: unknown) {
        const version = await this.version(versionId);
        await this.db.transaction(async () => {
            await this.claim(request, body, version);
            if (version.status !== 'draft')
                validation({
                    hierarchy_version:
                        'Hanya draft hierarchy yang dapat dipublikasikan.',
                });
            const stamp = nowSql();
            await this.db.execute(
                "update organization_hierarchy_versions set status = 'published', published_at = $1, updated_at = $1 where id = $2",
                [stamp, version.id],
            );
            await this.db.execute(
                "update organization_hierarchies set status = 'active', updated_at = $1 where id = $2",
                [stamp, version.hierarchy_id],
            );
        });
        return this.saved(version.hierarchy_id, 'Hierarchy dipublikasikan.');
    }

    // Route model binding CoreERP: versi dicari tanpa melihat tenant; tenant diperiksa sesudahnya dengan 403.
    private async version(id: string): Promise<HierarchyVersion> {
        const version = lookupId(id)
            ? await this.db.one(
                  versionSchema,
                  'select v.id, v.hierarchy_id, v.status, h.tenant_id from organization_hierarchy_versions v join organization_hierarchies h on h.id = v.hierarchy_id where v.id = $1',
                  [id],
              )
            : undefined;
        if (!version) abort(404, 'Not Found');
        return version;
    }

    private authorize(version: HierarchyVersion): void {
        this.workspace.guard('organization', 'update');
        if (version.tenant_id !== this.workspace.tenantId)
            abort(403, 'Tidak diizinkan.');
    }

    // Versi hierarchy tidak membawa kolom versi baris, jadi penyimpanan pada versi mana pun mengunci hierarchy
    // induknya: dua perubahan dari layar yang dibuka bersamaan tidak sama-sama lolos. Hak diperiksa lebih dulu
    // supaya pengguna tanpa hak tidak dapat menaikkan versinya.
    private async claim(
        request: Request,
        body: unknown,
        version: HierarchyVersion,
    ): Promise<void> {
        this.authorize(version);
        const expected = expectedVersion(request, body);
        const claimed = await this.db.execute(
            'update organization_hierarchies set version = $1 where id = $2 and version = $1',
            [expected, version.hierarchy_id],
        );
        if (claimed) return;
        if (
            !(await this.db.one(
                found,
                'select true as found from organization_hierarchies where id = $1',
                [version.hierarchy_id],
            ))
        )
            abort(404, 'Not Found');
        coded(409, 'stale_version', staleMessage);
    }

    private async saved(id: string, status: string) {
        return {
            savedHierarchy: await this.graph(id),
            flash: { status },
        };
    }
}
