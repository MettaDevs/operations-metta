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
    batchRowSchema,
    itemInputSchema,
    itemRowSchema,
} from './item.schema.ts';

const reference = (alias: string) =>
    `case when ${alias}.id is null then null else json_build_object(
         'id', ${alias}.id, 'code', ${alias}.kode, 'name', ${alias}.nama) end`;

const rowSql = `select * from (
                    select b.id, b.kode as code, b.nama as name, b.tolak_stok_minus as refuse_negative_stock,
                           b.diblokir as is_blocked, b.version, b.kategori_id as category_id,
                           b.satuan_dasar_id as base_unit_id, b.profil_pelacakan_id as tracking_code_id,
                           ${reference('unit')} as base_unit, ${reference('category')} as category,
                           ${reference('profile')} as tracking_code
                    from gd_m_barang b
                    join gd_m_satuan unit on unit.tenant_id = b.tenant_id and unit.id = b.satuan_dasar_id
                    left join gd_m_kategori category on category.tenant_id = b.tenant_id
                         and category.id = b.kategori_id
                    left join gd_m_profil_pelacakan profile on profile.tenant_id = b.tenant_id
                         and profile.id = b.profil_pelacakan_id
                    where b.tenant_id = $1 and b.legal_entity_id = $2 and b.deleted_at is null) items
                where true`;

const storedSchema = z.object({
    id: z.string(),
    satuan_dasar_id: z.string(),
    profil_pelacakan_id: z.string().nullable(),
});

function codeTaken(error: unknown): void {
    if (violates(error, 'gd_m_barang_kode_unique'))
        validation({ code: 'Kode ini sudah dipakai barang lain.' });
}

export class Items {
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
        this.workspace.guard('inventory-item', 'read');
        const bindings: string[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        const category = lookupId(parameters.get('category_id') ?? '');
        const filter = category
            ? ` and category_id = $${bindings.push(category)}`
            : '';
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: { code: 'code', name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => itemRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.inventory-item.update',
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(itemRowSchema, `${rowSql} and items.id = $3`, [
                  this.scope.tenantId,
                  this.scope.legalEntityId,
                  id,
              ])
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async checked(body: unknown) {
        const data = parseInput(itemInputSchema, body, {
            ...codeAndNameMessages('barang'),
            base_unit_id: 'Pilih satuan dasar dari daftar.',
            category_id: 'Pilih kategori dari daftar.',
            tracking_code_id: 'Pilih profil pelacakan dari daftar.',
        });
        const errors: Record<string, string> = {};
        const { code, name } = codeAndName(data, errors, 'barang', {
            code: 20,
            name: 200,
        });
        if (
            !(await exists(
                this.db,
                'gd_m_satuan',
                this.scope,
                data.base_unit_id,
            ))
        )
            errors.base_unit_id = 'Pilih satuan dasar dari daftar.';
        const categoryId = data.category_id ?? null;
        if (
            categoryId !== null &&
            !(await exists(this.db, 'gd_m_kategori', this.scope, categoryId))
        )
            errors.category_id = 'Pilih kategori dari daftar.';
        const trackingCodeId = data.tracking_code_id;
        if (
            typeof trackingCodeId === 'string' &&
            !(await exists(
                this.db,
                'gd_m_profil_pelacakan',
                this.scope,
                trackingCodeId,
            ))
        )
            errors.tracking_code_id = 'Pilih profil pelacakan dari daftar.';
        if (Object.keys(errors).length) validation(errors);
        return {
            code,
            name,
            baseUnitId: data.base_unit_id,
            categoryId,
            trackingCodeId,
            refuseNegative: data.refuse_negative_stock ?? null,
            isBlocked: data.is_blocked ?? false,
        };
    }

    async create(body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const data = await this.checked(body);
        const trackingCodeId =
            data.trackingCodeId === undefined && data.categoryId !== null
                ? ((
                      await this.db.one(
                          z.object({ id: z.string().nullable() }),
                          'select profil_pelacakan_id as id from gd_m_kategori where tenant_id = $1 and id = $2',
                          [this.scope.tenantId, data.categoryId],
                      )
                  )?.id ?? null)
                : (data.trackingCodeId ?? null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('gd_m_barang', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                kode: data.code,
                nama: data.name,
                satuan_dasar_id: data.baseUnitId,
                kategori_id: data.categoryId,
                profil_pelacakan_id: trackingCodeId,
                tolak_stok_minus: data.refuseNegative,
                diblokir: data.isBlocked,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    // Profil pelacakan terkunci begitu barang punya kartu gudang, dan satuan dasar selama masih ada baris terbuka,
    // sama dengan Item di BC (TestNoEntriesExist dan TestNoOpenEntriesExist). Baris barang dikunci lebih dulu; mesin
    // posting membacanya dengan `for share`, jadi posting pertama dan perubahan ini tidak bisa saling menyalip.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const current = await this.row(id);
        const data = await this.checked(body);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                const stored = await this.db.one(
                    storedSchema,
                    `select id, satuan_dasar_id, profil_pelacakan_id from gd_m_barang
                     where tenant_id = $1 and id = $2 for update`,
                    [this.scope.tenantId, current.id],
                );
                if (!stored) abort(404, 'Not Found');
                const trackingCodeId =
                    data.trackingCodeId === undefined
                        ? stored.profil_pelacakan_id
                        : data.trackingCodeId;
                const errors: Record<string, string> = {};
                if (
                    trackingCodeId !== stored.profil_pelacakan_id &&
                    (await this.posted(stored.id, false))
                )
                    errors.tracking_code_id =
                        'Barang ini sudah punya kartu gudang, jadi profil pelacakannya tidak bisa diubah.';
                if (
                    data.baseUnitId !== stored.satuan_dasar_id &&
                    (await this.posted(stored.id, true))
                )
                    errors.base_unit_id =
                        'Barang ini masih punya stok terbuka di kartu gudang, jadi satuan dasarnya tidak bisa diubah.';
                if (Object.keys(errors).length) validation(errors);
                updated = await this.db.execute(
                    `update gd_m_barang set kode = $1, nama = $2, satuan_dasar_id = $3, kategori_id = $4,
                            profil_pelacakan_id = $5, tolak_stok_minus = $6, diblokir = $7, updated_at = $8
                     where tenant_id = $9 and id = $10 and version = $11 and deleted_at is null`,
                    [
                        data.code,
                        data.name,
                        data.baseUnitId,
                        data.categoryId,
                        trackingCodeId,
                        data.refuseNegative,
                        data.isBlocked,
                        nowSql(),
                        this.scope.tenantId,
                        stored.id,
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

    private async posted(itemId: string, openOnly: boolean) {
        return (
            (await this.db.one(
                z.object({ found: z.number() }),
                `select 1 as found from gd_tr_kartu_gudang
                 where tenant_id = $1 and barang_id = $2${openOnly ? ' and sisa <> 0' : ''} limit 1`,
                [this.scope.tenantId, itemId],
            )) !== undefined
        );
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const current = await this.row(id);
        await inUse(
            this.db,
            [
                {
                    sql: 'select 1 as found from gd_tr_kartu_gudang where tenant_id = $1 and barang_id = $2 limit 1',
                    message:
                        'Barang ini sudah punya kartu gudang, jadi tidak bisa dihapus. Blokir saja supaya tidak dipakai lagi.',
                },
                {
                    sql: 'select 1 as found from gd_tr_penyesuaian_detail where tenant_id = $1 and barang_id = $2 and deleted_at is null limit 1',
                    message:
                        'Barang ini dipakai dokumen penyesuaian, jadi tidak bisa dihapus.',
                },
            ],
            [this.scope.tenantId, current.id],
        );
        const deleted = await this.db.execute(
            `update gd_m_barang set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
            [
                nowSql(),
                this.scope.tenantId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }

    async batches(id: string) {
        this.workspace.guard('inventory-item', 'read');
        const item = await this.row(id);
        return {
            data: await this.db.rows(
                batchRowSchema,
                `select id, no_batch as batch_number, kedaluwarsa::text as expiry_date from gd_m_batch
                 where tenant_id = $1 and legal_entity_id = $2 and barang_id = $3
                 order by kedaluwarsa nulls last, no_batch`,
                [this.scope.tenantId, this.scope.legalEntityId, item.id],
            ),
        };
    }
}
