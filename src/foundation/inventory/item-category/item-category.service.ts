import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import {
    activeLegalEntity,
    codeAndName,
    codeAndNameMessages,
    exists,
    inUse,
    parseInput,
    violates,
} from '../inventory.service.ts';
import {
    itemCategoryInputSchema,
    itemCategoryRowSchema,
} from './item-category.schema.ts';

// Urutan pohon seperti Item Categories BC: induk sebelum anaknya, saudara menurut kode. tree_key menyambung peringkat
// enam digit setiap tingkat, jadi urutannya sama di collation apa pun dan bisa dipakai cursor daftar bertahap.
// Kategori yang induknya sudah tidak ada ditampilkan sebagai akar.
const rowSql = `select * from (
                    with recursive ranked as (
                        select k.id, k.parent_id,
                               lpad((row_number() over (partition by k.parent_id order by k.kode, k.id))::text, 6, '0')
                               as rank
                        from gd_m_kategori k
                        where k.tenant_id = $1 and k.legal_entity_id = $2 and k.deleted_at is null
                    ), tree as (
                        select r.id, 0 as depth, r.rank as tree_key from ranked r
                        where r.parent_id is null or not exists (select 1 from ranked p where p.id = r.parent_id)
                        union all
                        select r.id, t.depth + 1, t.tree_key || r.rank from ranked r
                        join tree t on r.parent_id = t.id
                        where t.depth < 30
                    )
                    select c.id, c.kode as code, c.nama as name, c.version, c.parent_id,
                           coalesce(tree.depth, 0) as depth, coalesce(tree.tree_key, '') as tree_key,
                           exists (select 1 from ranked child where child.parent_id = c.id) as has_children,
                           case when parent.id is null then null else json_build_object(
                               'id', parent.id, 'code', parent.kode, 'name', parent.nama) end as parent,
                           case when profile.id is null then null else json_build_object(
                               'id', profile.id, 'code', profile.kode, 'name', profile.nama) end as tracking_code
                    from gd_m_kategori c
                    left join tree on tree.id = c.id
                    left join gd_m_kategori parent on parent.tenant_id = c.tenant_id and parent.id = c.parent_id
                    left join gd_m_profil_pelacakan profile on profile.tenant_id = c.tenant_id
                         and profile.id = c.profil_pelacakan_id
                    where c.tenant_id = $1 and c.legal_entity_id = $2 and c.deleted_at is null) categories
                where true`;

function codeTaken(error: unknown): void {
    if (violates(error, 'gd_m_kategori_kode_unique'))
        validation({ code: 'Kode ini sudah dipakai kategori lain.' });
}

export class ItemCategories {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('inventory-category', 'read');
        const batch = await incrementalList(this.db, {
            query: rowSql,
            bindings: [this.scope.tenantId, this.scope.legalEntityId],
            parameters,
            columns: { tree: 'tree_key', code: 'code', name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'tree',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => itemCategoryRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.inventory-category.update',
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  itemCategoryRowSchema,
                  `${rowSql} and categories.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async checked(body: unknown) {
        const data = parseInput(
            itemCategoryInputSchema,
            body,
            codeAndNameMessages('kategori'),
        );
        const errors: Record<string, string> = {};
        const { code, name } = codeAndName(data, errors, 'kategori', {
            code: 20,
            name: 100,
        });
        const parentId = data.parent_id ?? null;
        const trackingCodeId = data.tracking_code_id ?? null;
        if (
            parentId !== null &&
            !(await exists(this.db, 'gd_m_kategori', this.scope, parentId))
        )
            errors.parent_id = 'Pilih kategori induk dari daftar.';
        if (
            trackingCodeId !== null &&
            !(await exists(
                this.db,
                'gd_m_profil_pelacakan',
                this.scope,
                trackingCodeId,
            ))
        )
            errors.tracking_code_id = 'Pilih profil pelacakan dari daftar.';
        if (Object.keys(errors).length) validation(errors);
        return { code, name, parentId, trackingCodeId };
    }

    // Induk tidak boleh kembali ke kategori yang disimpan. Dijalankan di bawah kunci per legal entity, supaya dua admin
    // yang menyimpan bersamaan tidak sama-sama membuat putaran.
    private async checkParent(id: string, parentId: string | null) {
        await this.db.execute(
            "select pg_advisory_xact_lock(hashtextextended('gd_m_kategori:' || $1 || ':' || $2, 0))",
            [this.scope.tenantId, this.scope.legalEntityId],
        );
        if (parentId === null) return;
        if (parentId === id)
            validation({
                parent_id: 'Kategori tidak bisa menjadi induk dirinya sendiri.',
            });
        const chain = await this.db.rows(
            z.object({ id: z.string() }),
            `with recursive chain as (
                 select id, parent_id, 0 as depth from gd_m_kategori
                 where tenant_id = $1 and id = $2 and deleted_at is null
                 union all
                 select c.id, c.parent_id, chain.depth + 1 from chain
                 join gd_m_kategori c on c.tenant_id = $1 and c.id = chain.parent_id and c.deleted_at is null
                 where chain.depth < 64
             )
             select id from chain`,
            [this.scope.tenantId, parentId],
        );
        if (chain.some((category) => category.id === id))
            validation({
                parent_id:
                    'Kategori induk ini berada di bawah kategori yang sedang diubah. Pilih induk lain.',
            });
    }

    async create(body: unknown) {
        this.workspace.guard('inventory-category', 'update');
        const data = await this.checked(body);
        const id = Bun.randomUUIDv7();
        try {
            await this.db.transaction(async () => {
                await this.checkParent(id, data.parentId);
                const stamp = nowSql();
                await this.db.insert('gd_m_kategori', {
                    id,
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    parent_id: data.parentId,
                    kode: data.code,
                    nama: data.name,
                    profil_pelacakan_id: data.trackingCodeId,
                    created_at: stamp,
                    updated_at: stamp,
                });
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-category', 'update');
        const current = await this.row(id);
        const data = await this.checked(body);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                await this.checkParent(current.id, data.parentId);
                updated = await this.db.execute(
                    `update gd_m_kategori set kode = $1, nama = $2, parent_id = $3, profil_pelacakan_id = $4,
                            updated_at = $5
                     where tenant_id = $6 and id = $7 and version = $8 and deleted_at is null`,
                    [
                        data.code,
                        data.name,
                        data.parentId,
                        data.trackingCodeId,
                        nowSql(),
                        this.scope.tenantId,
                        current.id,
                        version,
                    ],
                );
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-category', 'update');
        const current = await this.row(id);
        let deleted = 0;
        await this.db.transaction(async () => {
            await this.checkParent(current.id, null);
            await inUse(
                this.db,
                [
                    {
                        sql: 'select 1 as found from gd_m_kategori where tenant_id = $1 and parent_id = $2 and deleted_at is null limit 1',
                        message:
                            'Kategori ini masih menjadi induk kategori lain. Pindahkan kategori itu lebih dulu.',
                    },
                    {
                        sql: 'select 1 as found from gd_m_barang where tenant_id = $1 and kategori_id = $2 and deleted_at is null limit 1',
                        message:
                            'Kategori ini masih dipakai barang. Pindahkan barang itu lebih dulu.',
                    },
                ],
                [this.scope.tenantId, current.id],
            );
            deleted = await this.db.execute(
                `update gd_m_kategori set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
                [
                    nowSql(),
                    this.scope.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        });
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
