import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import { nowSql, type Database } from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    dateSchema,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import {
    activeLegalEntity,
    decimalInput,
    fromNumeric,
    parseInput,
    quantityScale,
    toNumeric,
} from '@core/foundation/inventory/index.ts';
import { pharmacySetup } from '../setup/pharmacy-setup.service.ts';
import {
    drugPrice,
    type DrugPrice,
    type PriceGrading,
} from './drug-price.calculation.ts';
import {
    drugPriceInputSchema,
    drugPriceRowSchema,
} from './drug-price.schema.ts';

type Scope = { tenantId: string; legalEntityId: string };

const percentLimit = 1000n * 10n ** BigInt(quantityScale);
const hundredPercent = 100n * 10n ** BigInt(quantityScale);

const rowSql = `select * from (
                    select h.id, json_build_object('id', g.id, 'code', g.kode, 'name', g.nama) as price_group,
                           case when k.id is null then null
                                else json_build_object('id', k.id, 'name', k.nama) end as grading_group,
                           trim_scale(h.harga_dari)::text as price_from, trim_scale(h.harga_sampai)::text as price_to,
                           trim_scale(h.persen_naik)::text as markup_percent,
                           trim_scale(h.persen_diskon)::text as discount_percent,
                           h.berlaku_mulai::text as effective_from, h.version, h.kelompok_harga_id as price_group_id,
                           g.kode as price_group_code, g.nama as price_group_name, k.nama as grading_group_name,
                           h.harga_dari as price_from_sort, h.persen_naik as markup_sort,
                           h.persen_diskon as discount_sort
                    from far_m_grading_harga h
                    join kelompok_harga g on g.tenant_id = h.tenant_id and g.id = h.kelompok_harga_id
                    left join far_m_kelompok_grading k on k.tenant_id = h.tenant_id and k.id = h.kelompok_grading_id
                    where h.tenant_id = $1 and h.legal_entity_id = $2 and h.deleted_at is null) drug_prices
                where true`;

const gradingSchema = z.object({
    id: z.string(),
    price_group_id: z.string(),
    grading_group_id: z.string().nullable(),
    price_from: z.string(),
    price_to: z.string(),
    markup_percent: z.string(),
    discount_percent: z.string(),
    effective_from: z.string(),
});

const messages = {
    price_group_id: 'Pilih kelompok harga dari daftar.',
    grading_group_id: 'Pilih kelompok grading dari daftar.',
    price_from: 'Isi harga dasar dari, 0 atau lebih.',
    price_to: 'Isi harga dasar sampai, 0 atau lebih.',
    markup_percent: 'Isi % naik, 0 atau lebih.',
    discount_percent: 'Isi % diskon, 0 sampai 100.',
    effective_from: 'Isi tanggal berlaku mulai.',
};

// Harga obat untuk baris penyerahan yang disiapkan: harga dasar barang Core per satuan dasar, kelompok grading dari
// data obat farmasi, baris grading kelompok harga pembeli yang sudah berlaku pada tanggal penyerahan, dan pembulatan
// harga satuan dari setelan farmasi legal entity itu. Barang yang tidak punya data obat farmasi tidak berkelompok
// grading.
export async function priceDrugLines<
    Line extends { itemId: string; quantityPerUnit: bigint },
>(
    db: Database,
    scope: Scope,
    buyer: { priceGroupId: string | null; date: string },
    lines: readonly Line[],
): Promise<{ line: Line; price: DrugPrice & { basePrice: bigint } }[]> {
    const itemIds = [...new Set(lines.map((line) => line.itemId))];
    const items = new Map(
        (
            await db.rows(
                z.object({
                    id: z.string(),
                    base_price: z.string(),
                    grading_group_id: z.string().nullable(),
                }),
                `select b.id, b.harga_dasar::text as base_price, o.kelompok_grading_id as grading_group_id
                 from gd_m_barang b
                 left join far_m_obat o on o.tenant_id = b.tenant_id and o.id = b.id and o.deleted_at is null
                 where b.tenant_id = $1 and b.legal_entity_id = $2
                   and b.id in (${itemIds.map((_, index) => `$${String(index + 3)}`).join(',')})`,
                [scope.tenantId, scope.legalEntityId, ...itemIds],
            )
        ).map((item) => [item.id, item]),
    );
    const gradings: PriceGrading[] =
        buyer.priceGroupId === null
            ? []
            : (
                  await db.rows(
                      gradingSchema,
                      `select id, kelompok_harga_id as price_group_id, kelompok_grading_id as grading_group_id,
                              harga_dari::text as price_from, harga_sampai::text as price_to,
                              persen_naik::text as markup_percent, persen_diskon::text as discount_percent,
                              berlaku_mulai::text as effective_from
                       from far_m_grading_harga
                       where tenant_id = $1 and legal_entity_id = $2 and kelompok_harga_id = $3
                         and berlaku_mulai <= $4::date and deleted_at is null`,
                      [
                          scope.tenantId,
                          scope.legalEntityId,
                          buyer.priceGroupId,
                          buyer.date,
                      ],
                  )
              ).map((row) => ({
                  id: row.id,
                  priceGroupId: row.price_group_id,
                  gradingGroupId: row.grading_group_id,
                  priceFrom: fromNumeric(row.price_from, quantityScale),
                  priceTo: fromNumeric(row.price_to, quantityScale),
                  markupPercent: fromNumeric(row.markup_percent, quantityScale),
                  discountPercent: fromNumeric(
                      row.discount_percent,
                      quantityScale,
                  ),
                  effectiveFrom: row.effective_from,
              }));
    const { unit_price_decimals: unitPriceDecimals } = await pharmacySetup(
        db,
        scope,
    );
    return lines.map((line) => {
        const item = items.get(line.itemId);
        if (!item) throw new Error(`Item ${line.itemId} was not found.`);
        const basePrice = fromNumeric(item.base_price, quantityScale);
        return {
            line,
            price: {
                basePrice,
                ...drugPrice(gradings, {
                    basePrice,
                    priceGroupId: buyer.priceGroupId,
                    gradingGroupId: item.grading_group_id,
                    date: buyer.date,
                    quantityPerUnit: line.quantityPerUnit,
                    unitPriceDecimals,
                }),
            },
        };
    });
}

// Grading harga obat per legal entity (SIMmGradingHargaObat sistem lama). Kelompok harga milik Core dan dibaca langsung
// dari tabelnya; module boleh membaca tabel Core.
export class DrugPrices {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope(): Scope {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    // Pilihan kelompok harga di kartu grading. Kelompok nonaktif ikut, supaya baris yang sudah memegangnya tetap terbaca
    // namanya.
    async metadata() {
        this.workspace.guard('drug-price', 'read');
        return {
            price_groups: await this.db.rows(
                z.object({
                    id: z.string(),
                    code: z.string(),
                    name: z.string(),
                    active: z.boolean(),
                }),
                `select id, kode as code, nama as name, aktif as active from kelompok_harga
                 where tenant_id = $1 and deleted_at is null order by kode`,
                [this.workspace.tenantId],
            ),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('drug-price', 'read');
        const scope = this.scope;
        const bindings = [scope.tenantId, scope.legalEntityId];
        const priceGroup = lookupId(parameters.get('price_group_id') ?? '');
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${priceGroup ? ` and price_group_id = $${bindings.push(priceGroup)}` : ''}`,
            bindings,
            parameters,
            columns: {
                price_group: 'price_group_code',
                grading_group: 'grading_group_name',
                price_from: 'price_from_sort',
                markup_percent: 'markup_sort',
                discount_percent: 'discount_sort',
                effective_from: 'effective_from',
            },
            searchColumns: [
                'price_group_code',
                'price_group_name',
                'grading_group_name',
            ],
            numericColumns: ['price_from_sort', 'markup_sort', 'discount_sort'],
            defaultSort: 'price_group',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => drugPriceRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'pharmacy.drug-price.update',
            ),
        };
    }

    private async row(id: string) {
        const scope = this.scope;
        const found = lookupId(id)
            ? await this.db.one(
                  drugPriceRowSchema,
                  `${rowSql} and drug_prices.id = $3`,
                  [scope.tenantId, scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Kelompok harga dan kelompok grading nonaktif hanya boleh tetap dipakai baris yang sudah memegangnya.
    private async checked(
        body: unknown,
        saved: { priceGroupId: string; gradingGroupId: string | null } | null,
    ) {
        const data = parseInput(drugPriceInputSchema, body, messages);
        const scope = this.scope;
        const errors: Record<string, string> = {};
        const priceGroupId = data.price_group_id;
        if (!(
            lookupId(priceGroupId) &&
            (await this.db.one(
                z.object({ id: z.string() }),
                `select id from kelompok_harga
                     where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3::uuid)`,
                [scope.tenantId, priceGroupId, saved?.priceGroupId ?? null],
            ))
        ))
            errors.price_group_id = messages.price_group_id;
        const gradingGroupId = data.grading_group_id || null;
        if (
            gradingGroupId !== null &&
            !(
                lookupId(gradingGroupId) &&
                (await this.db.one(
                    z.object({ id: z.string() }),
                    `select id from far_m_kelompok_grading
                     where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null
                       and (aktif or id = $4::uuid)`,
                    [
                        scope.tenantId,
                        scope.legalEntityId,
                        gradingGroupId,
                        saved?.gradingGroupId ?? null,
                    ],
                ))
            )
        )
            errors.grading_group_id = messages.grading_group_id;
        const amountOf = (
            field: 'price_from' | 'price_to',
            raw: string | number,
        ) => {
            const value = decimalInput(raw);
            if (value === null || value < 0n) {
                errors[field] =
                    `${messages[field]} Paling banyak empat angka di belakang koma.`;
                return null;
            }
            return value;
        };
        const priceFrom = amountOf('price_from', data.price_from);
        const priceTo = amountOf('price_to', data.price_to);
        if (priceFrom !== null && priceTo !== null && priceFrom > priceTo)
            errors.price_to =
                'Harga dasar sampai tidak boleh lebih kecil dari harga dasar dari.';
        const markup = decimalInput(data.markup_percent);
        if (markup === null || markup < 0n || markup >= percentLimit)
            errors.markup_percent =
                'Isi % naik 0 sampai 999,9999, paling banyak empat angka di belakang koma.';
        const discount = decimalInput(data.discount_percent ?? 0);
        if (discount === null || discount < 0n || discount > hundredPercent)
            errors.discount_percent =
                'Isi % diskon 0 sampai 100, paling banyak empat angka di belakang koma.';
        const effectiveFrom = dateSchema.safeParse(data.effective_from);
        if (!effectiveFrom.success)
            errors.effective_from = messages.effective_from;
        if (Object.keys(errors).length) validation(errors);
        return {
            priceGroupId,
            gradingGroupId,
            priceFrom: priceFrom ?? 0n,
            priceTo: priceTo ?? 0n,
            markup: markup ?? 0n,
            discount: discount ?? 0n,
            effectiveFrom: effectiveFrom.data ?? '',
        };
    }

    // Rentang yang bertumpuk dengan baris hidup lain berkunci sama membuat harga tidak tunggal, jadi ditolak. Kunci
    // per kelompok harga membuat dua penyimpanan bersamaan diperiksa bergiliran.
    private async refuseOverlap(
        id: string,
        data: Awaited<ReturnType<DrugPrices['checked']>>,
    ): Promise<void> {
        const scope = this.scope;
        await this.db.execute(
            "select pg_advisory_xact_lock(hashtextextended('far_m_grading_harga:' || $1 || ':' || $2 || ':' || $3, 0))",
            [scope.tenantId, scope.legalEntityId, data.priceGroupId],
        );
        const overlapping = await this.db.one(
            z.object({ found: z.number() }),
            `select 1 as found from far_m_grading_harga
             where tenant_id = $1 and legal_entity_id = $2 and kelompok_harga_id = $3
               and kelompok_grading_id is not distinct from $4::uuid and berlaku_mulai = $5::date
               and harga_dari <= $7::numeric and $6::numeric <= harga_sampai and id <> $8 and deleted_at is null
             limit 1`,
            [
                scope.tenantId,
                scope.legalEntityId,
                data.priceGroupId,
                data.gradingGroupId,
                data.effectiveFrom,
                toNumeric(data.priceFrom, quantityScale),
                toNumeric(data.priceTo, quantityScale),
                id,
            ],
        );
        if (overlapping)
            validation({
                price_from:
                    'Rentang harga dasar ini bertumpuk dengan grading lain untuk kelompok harga, kelompok grading, dan tanggal berlaku yang sama. Ubah rentangnya atau tanggal berlakunya.',
            });
    }

    async create(body: unknown) {
        this.workspace.guard('drug-price', 'update');
        const data = await this.checked(body, null);
        const scope = this.scope;
        const id = Bun.randomUUIDv7();
        await this.db.transaction(async () => {
            await this.refuseOverlap(id, data);
            const stamp = nowSql();
            await this.db.insert('far_m_grading_harga', {
                id,
                tenant_id: scope.tenantId,
                legal_entity_id: scope.legalEntityId,
                kelompok_harga_id: data.priceGroupId,
                kelompok_grading_id: data.gradingGroupId,
                harga_dari: toNumeric(data.priceFrom, quantityScale),
                harga_sampai: toNumeric(data.priceTo, quantityScale),
                persen_naik: toNumeric(data.markup, quantityScale),
                persen_diskon: toNumeric(data.discount, quantityScale),
                berlaku_mulai: data.effectiveFrom,
                created_at: stamp,
                updated_at: stamp,
            });
        });
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('drug-price', 'update');
        const current = await this.row(id);
        const data = await this.checked(body, {
            priceGroupId: current.price_group.id,
            gradingGroupId: current.grading_group?.id ?? null,
        });
        const version = expectedVersion(request, body);
        let updated = 0;
        await this.db.transaction(async () => {
            await this.refuseOverlap(current.id, data);
            updated = await this.db.execute(
                `update far_m_grading_harga set kelompok_harga_id = $1, kelompok_grading_id = $2, harga_dari = $3,
                        harga_sampai = $4, persen_naik = $5, persen_diskon = $6, berlaku_mulai = $7, updated_at = $8
                 where tenant_id = $9 and id = $10 and version = $11 and deleted_at is null`,
                [
                    data.priceGroupId,
                    data.gradingGroupId,
                    toNumeric(data.priceFrom, quantityScale),
                    toNumeric(data.priceTo, quantityScale),
                    toNumeric(data.markup, quantityScale),
                    toNumeric(data.discount, quantityScale),
                    data.effectiveFrom,
                    nowSql(),
                    this.scope.tenantId,
                    current.id,
                    version,
                ],
            );
        });
        if (!updated) coded(409, 'stale_version', staleMessage);
        return {
            status: 200,
            headers: {},
            body: { data: await this.row(current.id) },
        };
    }

    // Baris yang sudah dipakai penyerahan boleh dihapus: harga baris penyerahan sudah tersalin dan tidak berubah.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('drug-price', 'update');
        const current = await this.row(id);
        const deleted = await this.db.execute(
            `update far_m_grading_harga set deleted_at = $1, updated_at = $1
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
}
