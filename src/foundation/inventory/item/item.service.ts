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
import { decimalsHint } from '../../../platform/money/index.ts';
import {
    Currency,
    localCurrencyCode,
    unitAmountDecimals,
} from '../../currency/index.ts';
import { quantityScale, toNumeric, unitCostInput } from '../quantity.ts';
import {
    batchRowSchema,
    itemInputSchema,
    itemRowSchema,
} from './item.schema.ts';

const reference = (alias: string) =>
    `case when ${alias}.id is null then null else json_build_object(
         'id', ${alias}.id, 'code', ${alias}.kode, 'name', ${alias}.nama) end`;

const defaultUnitSql = (column: string) =>
    `(select json_build_object('id', s.id, 'code', s.kode, 'name', s.nama, 'quantity_per_unit',
             case when s.id = b.satuan_dasar_id then '1' else trim_scale(k.konversi)::text end)
      from gd_m_satuan s
      left join gd_m_barang_satuan k on k.tenant_id = b.tenant_id and k.barang_id = b.id and k.satuan_id = s.id
           and k.deleted_at is null
      where s.tenant_id = b.tenant_id and s.id = coalesce(b.${column}, b.satuan_dasar_id))`;

const rowSql = `select * from (
                    select b.id, b.kode as code, b.nama as name, b.tolak_stok_minus as refuse_negative_stock,
                           b.diblokir as is_blocked, b.version, b.kategori_id as category_id,
                           trim_scale(b.harga_dasar)::text as base_price, b.kode_kfa as kfa_code,
                           b.satuan_dasar_id as base_unit_id, b.profil_pelacakan_id as tracking_code_id,
                           ${reference('unit')} as base_unit, ${defaultUnitSql('satuan_beli_id')} as purchase_unit,
                           ${defaultUnitSql('satuan_jual_id')} as sales_unit, ${reference('category')} as category,
                           ${reference('profile')} as tracking_code,
                           coalesce(profile.wajib_batch, false) as batch_required,
                           coalesce(profile.wajib_kedaluwarsa, false) as expiry_required,
                           (select trim_scale(coalesce(sum(k.sisa), 0))::text from gd_tr_kartu_gudang k
                            where k.tenant_id = b.tenant_id and k.barang_id = b.id and k.sisa <> 0) as inventory,
                           exists (select 1 from gd_tr_kartu_gudang k
                                   where k.tenant_id = b.tenant_id and k.barang_id = b.id) as has_entries,
                           exists (select 1 from gd_tr_kartu_gudang k
                                   where k.tenant_id = b.tenant_id and k.barang_id = b.id and k.sisa <> 0)
                               as has_open_entries
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
    satuan_beli_id: z.string().nullable(),
    satuan_jual_id: z.string().nullable(),
    profil_pelacakan_id: z.string().nullable(),
    kode_kfa: z.string().nullable(),
});

const defaultUnitMessage =
    'Pilih satuan dasar atau salah satu satuan kemasan barang ini.';
const kfaCodeMessage =
    'Isi kode KFA dengan angka saja, paling banyak 20 angka.';

async function isPackagingUnit(
    db: Database,
    scope: ItemScope,
    itemId: string,
    unitId: string,
): Promise<boolean> {
    if (!lookupId(unitId)) return false;
    const found = await db.one(
        z.object({ id: z.string() }),
        `select id from gd_m_barang_satuan
         where tenant_id = $1 and legal_entity_id = $2 and barang_id = $3 and satuan_id = $4 and deleted_at is null`,
        [scope.tenantId, scope.legalEntityId, itemId, unitId],
    );
    return found !== undefined;
}

// Satuan dasar disimpan kosong. Barang baru (itemId kosong) belum punya satuan kemasan, jadi hanya satuan dasar yang sah.
async function defaultUnits(
    db: Database,
    scope: ItemScope,
    itemId: string | null,
    baseUnitId: string,
    requested: { purchase: string | null; sales: string | null },
): Promise<{ purchase: string | null; sales: string | null }> {
    const errors: Record<string, string> = {};
    const checked = async (unitId: string | null, field: string) => {
        if (unitId === null || unitId === baseUnitId) return null;
        if (
            itemId === null ||
            !(await isPackagingUnit(db, scope, itemId, unitId))
        )
            errors[field] = defaultUnitMessage;
        return unitId;
    };
    const units = {
        purchase: await checked(requested.purchase, 'purchase_unit_id'),
        sales: await checked(requested.sales, 'sales_unit_id'),
    };
    if (Object.keys(errors).length) validation(errors);
    return units;
}

function codeTaken(error: unknown): void {
    if (violates(error, 'gd_m_barang_kode_unique'))
        validation({ code: 'Kode ini sudah dipakai barang lain.' });
}

export type ItemScope = { tenantId: string; legalEntityId: string };
export type ItemInput = z.input<typeof itemInputSchema>;

// errors memegang kesalahan isian pemanggil di luar barang (misalnya bentuk sediaan di kartu obat), supaya pengguna
// melihat semuanya dalam satu jawaban 422.
async function checked(
    db: Database,
    scope: ItemScope,
    body: unknown,
    errors: Record<string, string>,
) {
    const data = parseInput(itemInputSchema, body, {
        ...codeAndNameMessages('barang'),
        base_unit_id: 'Pilih satuan dasar dari daftar.',
        category_id: 'Pilih kategori dari daftar.',
        tracking_code_id: 'Pilih profil pelacakan dari daftar.',
        kfa_code: kfaCodeMessage,
    });
    const { code, name } = codeAndName(data, errors, 'barang', {
        code: 20,
        name: 200,
    });
    if (!(await exists(db, 'gd_m_satuan', scope, data.base_unit_id)))
        errors.base_unit_id = 'Pilih satuan dasar dari daftar.';
    const categoryId = data.category_id ?? null;
    if (
        categoryId !== null &&
        !(await exists(db, 'gd_m_kategori', scope, categoryId))
    )
        errors.category_id = 'Pilih kategori dari daftar.';
    const trackingCodeId = data.tracking_code_id;
    if (
        typeof trackingCodeId === 'string' &&
        !(await exists(db, 'gd_m_profil_pelacakan', scope, trackingCodeId))
    )
        errors.tracking_code_id = 'Pilih profil pelacakan dari daftar.';
    const priceDecimals = unitAmountDecimals(
        await new Currency(db, scope.tenantId).precision(localCurrencyCode),
    );
    const basePrice =
        data.base_price === undefined
            ? undefined
            : unitCostInput(data.base_price, priceDecimals);
    if (basePrice === null)
        errors.base_price = `Isi harga dasar 0 atau lebih, ${decimalsHint(priceDecimals)}.`;
    const kfaCode =
        data.kfa_code === undefined ? undefined : data.kfa_code?.trim() || null;
    if (typeof kfaCode === 'string' && !/^\d{1,20}$/.test(kfaCode))
        errors.kfa_code = kfaCodeMessage;
    if (Object.keys(errors).length) validation(errors);
    return {
        code,
        name,
        baseUnitId: data.base_unit_id,
        categoryId,
        trackingCodeId,
        refuseNegative: data.refuse_negative_stock ?? null,
        isBlocked: data.is_blocked ?? false,
        purchaseUnitId: data.purchase_unit_id,
        salesUnitId: data.sales_unit_id,
        basePrice: basePrice ?? undefined,
        kfaCode,
    };
}

async function posted(
    db: Database,
    scope: ItemScope,
    itemId: string,
    openOnly: boolean,
) {
    return (
        (await db.one(
            z.object({ found: z.number() }),
            `select 1 as found from gd_tr_kartu_gudang
             where tenant_id = $1 and barang_id = $2${openOnly ? ' and sisa <> 0' : ''} limit 1`,
            [scope.tenantId, itemId],
        )) !== undefined
    );
}

// Pintu tulis barang untuk kartu barang Core dan untuk module yang memperluas barang, seperti table extension di BC:
// kartu obat layanan kesehatan menulis barisnya sendiri dan barangnya lewat fungsi ini dalam satu transaksi. Izin
// diperiksa pemanggil. Mengembalikan id barang baru.
export async function createItem(
    db: Database,
    scope: ItemScope,
    body: unknown,
    errors: Record<string, string> = {},
): Promise<string> {
    const data = await checked(db, scope, body, errors);
    const trackingCodeId =
        data.trackingCodeId === undefined && data.categoryId !== null
            ? ((
                  await db.one(
                      z.object({ id: z.string().nullable() }),
                      'select profil_pelacakan_id as id from gd_m_kategori where tenant_id = $1 and id = $2',
                      [scope.tenantId, data.categoryId],
                  )
              )?.id ?? null)
            : (data.trackingCodeId ?? null);
    const units = await defaultUnits(db, scope, null, data.baseUnitId, {
        purchase: data.purchaseUnitId ?? null,
        sales: data.salesUnitId ?? null,
    });
    const id = Bun.randomUUIDv7();
    const stamp = nowSql();
    try {
        await db.insert('gd_m_barang', {
            id,
            tenant_id: scope.tenantId,
            legal_entity_id: scope.legalEntityId,
            kode: data.code,
            nama: data.name,
            satuan_dasar_id: data.baseUnitId,
            satuan_beli_id: units.purchase,
            satuan_jual_id: units.sales,
            kategori_id: data.categoryId,
            profil_pelacakan_id: trackingCodeId,
            tolak_stok_minus: data.refuseNegative,
            diblokir: data.isBlocked,
            harga_dasar: toNumeric(data.basePrice ?? 0n, quantityScale),
            kode_kfa: data.kfaCode ?? null,
            created_at: stamp,
            updated_at: stamp,
        });
    } catch (error) {
        codeTaken(error);
        throw error;
    }
    return id;
}

// Profil pelacakan terkunci begitu barang punya kartu gudang, dan satuan dasar selama masih ada baris terbuka,
// sama dengan Item di BC (TestNoEntriesExist dan TestNoOpenEntriesExist). Baris barang dikunci lebih dulu; mesin
// posting membacanya dengan `for share`, jadi posting pertama dan perubahan ini tidak bisa saling menyalip.
export async function updateItem(
    db: Database,
    scope: ItemScope,
    id: string,
    version: number,
    body: unknown,
    errors: Record<string, string> = {},
): Promise<void> {
    const data = await checked(db, scope, body, errors);
    let updated = 0;
    try {
        await db.transaction(async () => {
            const stored = lookupId(id)
                ? await db.one(
                      storedSchema,
                      `select id, satuan_dasar_id, satuan_beli_id, satuan_jual_id, profil_pelacakan_id, kode_kfa
                       from gd_m_barang
                       where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null
                       for update`,
                      [scope.tenantId, scope.legalEntityId, id],
                  )
                : undefined;
            if (!stored) abort(404, 'Not Found');
            const trackingCodeId =
                data.trackingCodeId === undefined
                    ? stored.profil_pelacakan_id
                    : data.trackingCodeId;
            const locked: Record<string, string> = {};
            if (
                trackingCodeId !== stored.profil_pelacakan_id &&
                (await posted(db, scope, stored.id, false))
            )
                locked.tracking_code_id =
                    'Barang ini sudah punya gerak stok, jadi profil pelacakannya tidak bisa diubah.';
            if (
                data.baseUnitId !== stored.satuan_dasar_id &&
                (await posted(db, scope, stored.id, true))
            )
                locked.base_unit_id =
                    'Barang ini masih punya stok atau kekurangan stok yang belum tertutup, jadi satuan dasarnya tidak bisa diubah.';
            if (Object.keys(locked).length) validation(locked);
            const units = await defaultUnits(
                db,
                scope,
                stored.id,
                data.baseUnitId,
                {
                    purchase:
                        data.purchaseUnitId === undefined
                            ? stored.satuan_beli_id
                            : data.purchaseUnitId,
                    sales:
                        data.salesUnitId === undefined
                            ? stored.satuan_jual_id
                            : data.salesUnitId,
                },
            );
            updated = await db.execute(
                `update gd_m_barang set kode = $1, nama = $2, satuan_dasar_id = $3, kategori_id = $4,
                        profil_pelacakan_id = $5, tolak_stok_minus = $6, diblokir = $7, satuan_beli_id = $8,
                        satuan_jual_id = $9, harga_dasar = coalesce($10::numeric, harga_dasar), kode_kfa = $11,
                        updated_at = $12
                 where tenant_id = $13 and id = $14 and version = $15 and deleted_at is null`,
                [
                    data.code,
                    data.name,
                    data.baseUnitId,
                    data.categoryId,
                    trackingCodeId,
                    data.refuseNegative,
                    data.isBlocked,
                    units.purchase,
                    units.sales,
                    data.basePrice === undefined
                        ? null
                        : toNumeric(data.basePrice, quantityScale),
                    data.kfaCode === undefined ? stored.kode_kfa : data.kfaCode,
                    nowSql(),
                    scope.tenantId,
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
}

// Posting penerimaan menaikkan harga dasar barang ke harga beli per satuan dasar yang lebih tinggi, seperti
// Goods_receipt.php sistem lama, dan tidak pernah menurunkannya. Dipanggil sebelum mesin posting membaca barang yang
// sama dengan `for share`, dan barang dikunci menurut urutan id: dua penerimaan yang menaikkan barang yang sama saling
// menunggu, bukan saling mengunci.
export async function raiseBasePrices(
    db: Database,
    scope: ItemScope,
    prices: ReadonlyMap<string, bigint>,
): Promise<void> {
    const ordered = [...prices].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
    );
    for (const [itemId, price] of ordered)
        await db.execute(
            `update gd_m_barang set harga_dasar = $1, updated_at = $2
             where tenant_id = $3 and legal_entity_id = $4 and id = $5 and harga_dasar < $1`,
            [
                toNumeric(price, quantityScale),
                nowSql(),
                scope.tenantId,
                scope.legalEntityId,
                itemId,
            ],
        );
}

export async function deleteItem(
    db: Database,
    scope: ItemScope,
    id: string,
    version: number,
): Promise<void> {
    await inUse(
        db,
        [
            {
                sql: 'select 1 as found from gd_tr_kartu_gudang where tenant_id = $1 and barang_id = $2 limit 1',
                message:
                    'Barang ini sudah punya gerak stok, jadi tidak bisa dihapus. Blokir saja supaya tidak dipakai lagi.',
            },
            {
                sql: 'select 1 as found from gd_tr_penyesuaian_detail where tenant_id = $1 and barang_id = $2 and deleted_at is null limit 1',
                message:
                    'Barang ini dipakai dokumen penyesuaian, jadi tidak bisa dihapus.',
            },
        ],
        [scope.tenantId, id],
    );
    const deleted = await db.execute(
        `update gd_m_barang set deleted_at = $1, updated_at = $1
         where tenant_id = $2 and legal_entity_id = $3 and id = $4 and version = $5 and deleted_at is null`,
        [nowSql(), scope.tenantId, scope.legalEntityId, id, version],
    );
    if (!deleted) coded(409, 'stale_version', staleMessage);
}

export class Items {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope(): ItemScope {
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
        let filter = '';
        const category = lookupId(parameters.get('category_id') ?? '');
        if (category)
            filter += ` and category_id = $${bindings.push(category)}`;
        const blocked = parameters.get('blocked');
        if (blocked === 'true' || blocked === 'false')
            filter += ` and is_blocked = ${blocked}`;
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

    async create(body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const id = await createItem(this.db, this.scope, body);
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const current = await this.row(id);
        await updateItem(
            this.db,
            this.scope,
            current.id,
            expectedVersion(request, body),
            body,
        );
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-item', 'update');
        const current = await this.row(id);
        await deleteItem(
            this.db,
            this.scope,
            current.id,
            expectedVersion(request, body),
        );
        return { status: 204, headers: {}, body: undefined };
    }

    // Batch satu barang, dimuat bertahap dan dicari lewat nomornya; kedaluwarsa terdekat lebih dulu, tanpa kedaluwarsa
    // di akhir.
    async batches(id: string, parameters: URLSearchParams) {
        this.workspace.guard('inventory-item', 'read');
        const item = await this.row(id);
        const batch = await incrementalList(this.db, {
            query: `select id, no_batch as batch_number, kedaluwarsa::text as expiry_date from gd_m_batch
                    where tenant_id = $1 and legal_entity_id = $2 and barang_id = $3`,
            bindings: [this.scope.tenantId, this.scope.legalEntityId, item.id],
            parameters,
            columns: {
                expiry_date: 'expiry_date',
                batch_number: 'batch_number',
            },
            searchColumns: ['batch_number'],
            numericColumns: [],
            defaultSort: 'expiry_date',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => batchRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }
}
