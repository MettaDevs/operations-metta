import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import {
    nowSql,
    type Bind,
    type Database,
} from '../../../platform/database/index.ts';
import {
    allowedLocationsSql,
    display,
    fromNumeric,
    quantityScale,
    toNumeric,
} from '../../inventory/index.ts';

const one = 10n ** BigInt(quantityScale);

export type ReorderRule =
    | { policy: 'jumlah_tetap'; reorderPoint: bigint; reorderQuantity: bigint }
    | { policy: 'maksimum'; reorderPoint: bigint; maximumInventory: bigint };

export function reorderQuantity(
    rule: ReorderRule,
    projected: bigint,
): bigint | null {
    if (projected > rule.reorderPoint) return null;
    switch (rule.policy) {
        case 'maksimum':
            return rule.maximumInventory - projected;
        case 'jumlah_tetap':
            return (
                ((rule.reorderPoint - projected) / rule.reorderQuantity + 1n) *
                rule.reorderQuantity
            );
        default: {
            const unknown: never = rule;
            throw new Error(`Unknown reordering policy: ${String(unknown)}`);
        }
    }
}

const planSchema = z.object({
    item_id: z.string(),
    location_id: z.string(),
    operating_unit_id: z.string(),
    policy: z.enum(['jumlah_tetap', 'maksimum']),
    reorder_point: z.string(),
    maximum_inventory: z.string().nullable(),
    reorder_quantity: z.string().nullable(),
    base_unit_id: z.string(),
    base_unit_code: z.string(),
    purchase_unit_id: z.string().nullable(),
    purchase_conversion: z.string().nullable(),
    vendor_id: z.string().nullable(),
    replenishment_system: z.enum(['beli', 'amprah']),
    transfer_from_id: z.string().nullable(),
    projected: z.string(),
});
type Plan = z.infer<typeof planSchema>;

const suggestionSchema = z.object({
    id: z.string(),
    item_id: z.string(),
    location_id: z.string(),
    unit_id: z.string(),
    quantity: z.string(),
    vendor_id: z.string().nullable(),
    transfer_from_id: z.string().nullable(),
    request_date: z.string(),
    due_date: z.string(),
    description: z.string().nullable(),
});

function ruleOf(plan: Plan): ReorderRule {
    const reorderPoint = fromNumeric(plan.reorder_point, quantityScale);
    switch (plan.policy) {
        case 'jumlah_tetap':
            if (plan.reorder_quantity === null)
                throw new Error('Fixed reorder quantity without a quantity.');
            return {
                policy: plan.policy,
                reorderPoint,
                reorderQuantity: fromNumeric(
                    plan.reorder_quantity,
                    quantityScale,
                ),
            };
        case 'maksimum':
            if (plan.maximum_inventory === null)
                throw new Error('Maximum quantity without a maximum.');
            return {
                policy: plan.policy,
                reorderPoint,
                maximumInventory: fromNumeric(
                    plan.maximum_inventory,
                    quantityScale,
                ),
            };
        default: {
            const unknown: never = plan.policy;
            throw new Error(`Unknown reordering policy: ${String(unknown)}`);
        }
    }
}

function orderUnit(plan: Plan, base: bigint) {
    const conversion =
        plan.replenishment_system === 'beli' &&
        plan.purchase_unit_id &&
        plan.purchase_conversion
            ? fromNumeric(plan.purchase_conversion, quantityScale)
            : null;
    if (plan.purchase_unit_id && conversion && base % conversion === 0n)
        return {
            unitId: plan.purchase_unit_id,
            conversion,
            quantity: (base * one) / conversion,
        };
    return { unitId: plan.base_unit_id, conversion: one, quantity: base };
}

function byTransferLevel(plans: Plan[]): Plan[] {
    const byLocation = new Map(
        plans.map((plan) => [`${plan.item_id}:${plan.location_id}`, plan]),
    );
    const levels = new Map<Plan, number>();
    const transferLevel = (plan: Plan, seen: Set<Plan>): number => {
        const known = levels.get(plan);
        if (known !== undefined) return known;
        const from =
            plan.transfer_from_id === null
                ? undefined
                : byLocation.get(`${plan.item_id}:${plan.transfer_from_id}`);
        const found =
            from === undefined || seen.has(from)
                ? 0
                : transferLevel(from, new Set([...seen, plan])) + 1;
        levels.set(plan, found);
        return found;
    };
    return plans
        .map((plan, index) => ({
            plan,
            index,
            level: transferLevel(plan, new Set([plan])),
        }))
        .sort((a, b) => b.level - a.level || a.index - b.index)
        .map(({ plan }) => plan);
}

const planSql = (allowed: string) => `
    select k.barang_id as item_id, k.lokasi_id as location_id, l.operating_unit_id,
           k.kebijakan_pesan_ulang as policy, k.stok_minimum::text as reorder_point,
           k.stok_maksimum::text as maximum_inventory, k.jumlah_pesan_ulang::text as reorder_quantity,
           b.satuan_dasar_id as base_unit_id, base.kode as base_unit_code,
           case when b.satuan_beli_id is null or b.satuan_beli_id = b.satuan_dasar_id then null
                else b.satuan_beli_id end as purchase_unit_id,
           purchase.konversi::text as purchase_conversion,
           k.cara_pengadaan as replenishment_system, k.lokasi_pemasok_id as transfer_from_id,
           (select v.id from bl_tr_penerimaan_detail d
            join bl_tr_penerimaan h on h.tenant_id = d.tenant_id and h.id = d.penerimaan_id
            left join vendors v on v.tenant_id = h.tenant_id and v.id = h.vendor_id and v.status = 'active'
            where d.tenant_id = k.tenant_id and d.barang_id = k.barang_id and d.deleted_at is null
              and h.status = 'diposting'
            order by h.tanggal desc, h.diposting_pada desc limit 1) as vendor_id,
           round(
               coalesce((select sum(g.jumlah) from gd_tr_kartu_gudang g
                         where g.tenant_id = k.tenant_id and g.legal_entity_id = k.legal_entity_id
                           and g.barang_id = k.barang_id and g.lokasi_id = k.lokasi_id), 0)
             + coalesce((select sum((d.jumlah - d.jumlah_diterima) * d.konversi) from bl_tr_order_detail d
                         join bl_tr_order o on o.tenant_id = d.tenant_id and o.id = d.order_id
                         where d.tenant_id = k.tenant_id and d.legal_entity_id = k.legal_entity_id
                           and d.barang_id = k.barang_id and o.lokasi_id = k.lokasi_id
                           and o.status in ('terbuka', 'dirilis') and o.deleted_at is null and d.deleted_at is null), 0)
             + coalesce((select sum(r.jumlah * r.konversi) from bl_tr_permintaan r
                         where r.tenant_id = k.tenant_id and r.legal_entity_id = k.legal_entity_id
                           and r.barang_id = k.barang_id and r.lokasi_id = k.lokasi_id
                           and r.deleted_at is null and r.diproses_pada is null
                           and r.saran is distinct from 'baru'), 0)
             - coalesce((select sum(r.jumlah * r.konversi) from bl_tr_permintaan r
                         where r.tenant_id = k.tenant_id and r.legal_entity_id = k.legal_entity_id
                           and r.barang_id = k.barang_id and r.lokasi_pemasok_id = k.lokasi_id
                           and r.deleted_at is null and r.diproses_pada is null
                           and r.saran is distinct from 'baru'), 0)
             + coalesce((select sum((d.jumlah_diminta - d.jumlah_diterima) * d.konversi) from gd_tr_amprahan_detail d
                         join gd_tr_amprahan a on a.tenant_id = d.tenant_id and a.id = d.amprahan_id
                         where d.tenant_id = k.tenant_id and d.legal_entity_id = k.legal_entity_id
                           and d.barang_id = k.barang_id and a.lokasi_peminta_id = k.lokasi_id
                           and a.status in ('draf', 'diajukan') and a.deleted_at is null and d.deleted_at is null), 0)
             - coalesce((select sum((d.jumlah_diminta - d.jumlah_dikirim) * d.konversi) from gd_tr_amprahan_detail d
                         join gd_tr_amprahan a on a.tenant_id = d.tenant_id and a.id = d.amprahan_id
                         where d.tenant_id = k.tenant_id and d.legal_entity_id = k.legal_entity_id
                           and d.barang_id = k.barang_id and a.lokasi_pemasok_id = k.lokasi_id
                           and a.status in ('draf', 'diajukan') and a.deleted_at is null and d.deleted_at is null), 0),
             ${quantityScale})::text as projected
    from gd_m_barang_lokasi k
    join gd_m_lokasi l on l.tenant_id = k.tenant_id and l.id = k.lokasi_id and l.deleted_at is null
    join gd_m_barang b on b.tenant_id = k.tenant_id and b.id = k.barang_id and b.deleted_at is null
    join gd_m_satuan base on base.tenant_id = b.tenant_id and base.id = b.satuan_dasar_id
    left join gd_m_barang_satuan purchase on purchase.tenant_id = b.tenant_id and purchase.barang_id = b.id
         and purchase.satuan_id = b.satuan_beli_id and purchase.deleted_at is null
    where k.tenant_id = $1 and k.legal_entity_id = $2 and k.deleted_at is null
      and k.kebijakan_pesan_ulang is not null and not b.diblokir and ${allowed}
    order by l.kode, b.kode`;

export async function calculatePlan(
    db: Database,
    workspace: Workspace,
    scope: { tenantId: string; legalEntityId: string },
    { requestDate, dueDate }: { requestDate: string; dueDate: string },
) {
    const counts = { created: 0, updated: 0, removed: 0 };
    await db.transaction(async () => {
        await db.execute(
            "select pg_advisory_xact_lock(hashtextextended($1 || ':' || $2 || ':bl_tr_permintaan_saran', 0))",
            [scope.tenantId, scope.legalEntityId],
        );
        const suggestionBindings: Bind[] = [
            scope.tenantId,
            scope.legalEntityId,
        ];
        const suggestions = await db.rows(
            suggestionSchema,
            `select id, barang_id as item_id, lokasi_id as location_id, satuan_id as unit_id,
                    trim_scale(jumlah)::text as quantity, vendor_id, lokasi_pemasok_id as transfer_from_id,
                    tanggal_permintaan::text as request_date,
                    tanggal_dibutuhkan::text as due_date,
                    keterangan as description
             from bl_tr_permintaan
             where tenant_id = $1 and legal_entity_id = $2 and saran = 'baru' and deleted_at is null
               and diproses_pada is null
               and ${allowedLocationsSql(workspace, suggestionBindings, ['lokasi_id'])}
             for update`,
            suggestionBindings,
        );
        const stale = new Map(
            suggestions.map((row) => [
                `${row.item_id}:${row.location_id}`,
                row,
            ]),
        );
        const planBindings: Bind[] = [scope.tenantId, scope.legalEntityId];
        const plans = await db.rows(
            planSchema,
            planSql(
                allowedLocationsSql(workspace, planBindings, ['k.lokasi_id']),
            ),
            planBindings,
        );
        const stamp = nowSql();
        const transferDemand = new Map<string, bigint>();
        for (const plan of byTransferLevel(plans)) {
            const rule = ruleOf(plan);
            const projected =
                fromNumeric(plan.projected, quantityScale) -
                (transferDemand.get(`${plan.item_id}:${plan.location_id}`) ??
                    0n);
            const base = reorderQuantity(rule, projected);
            if (base === null) continue;
            const vendorId =
                plan.transfer_from_id === null ? plan.vendor_id : null;
            if (plan.transfer_from_id !== null) {
                const supplier = `${plan.item_id}:${plan.transfer_from_id}`;
                transferDemand.set(
                    supplier,
                    (transferDemand.get(supplier) ?? 0n) + base,
                );
            }
            const unit = orderUnit(plan, base);
            const description = `Stok yang akan tersedia ${display(projected, quantityScale)} ${plan.base_unit_code}, stok minimum ${display(rule.reorderPoint, quantityScale)} ${plan.base_unit_code}.`;
            const key = `${plan.item_id}:${plan.location_id}`;
            const existing = stale.get(key);
            stale.delete(key);
            if (!existing) {
                await db.insert('bl_tr_permintaan', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: scope.tenantId,
                    legal_entity_id: scope.legalEntityId,
                    operating_unit_id: plan.operating_unit_id,
                    lokasi_id: plan.location_id,
                    barang_id: plan.item_id,
                    satuan_id: unit.unitId,
                    konversi: toNumeric(unit.conversion, quantityScale),
                    jumlah: toNumeric(unit.quantity, quantityScale),
                    tanggal_permintaan: requestDate,
                    tanggal_dibutuhkan: dueDate,
                    keterangan: description,
                    diminta_oleh_user_id: workspace.userId,
                    vendor_id: vendorId,
                    lokasi_pemasok_id: plan.transfer_from_id,
                    saran: 'baru',
                    created_at: stamp,
                    updated_at: stamp,
                });
                counts.created++;
                continue;
            }
            if (
                existing.unit_id === unit.unitId &&
                fromNumeric(existing.quantity, quantityScale) ===
                    unit.quantity &&
                existing.vendor_id === vendorId &&
                existing.transfer_from_id === plan.transfer_from_id &&
                existing.request_date === requestDate &&
                existing.due_date === dueDate &&
                existing.description === description
            )
                continue;
            await db.execute(
                `update bl_tr_permintaan set operating_unit_id = $1, satuan_id = $2, konversi = $3, jumlah = $4,
                        tanggal_dibutuhkan = $5, keterangan = $6, vendor_id = $7, diminta_oleh_user_id = $8,
                        updated_at = $9, tanggal_permintaan = $12, lokasi_pemasok_id = $13
                 where tenant_id = $10 and id = $11`,
                [
                    plan.operating_unit_id,
                    unit.unitId,
                    toNumeric(unit.conversion, quantityScale),
                    toNumeric(unit.quantity, quantityScale),
                    dueDate,
                    description,
                    vendorId,
                    workspace.userId,
                    stamp,
                    scope.tenantId,
                    existing.id,
                    requestDate,
                    plan.transfer_from_id,
                ],
            );
            counts.updated++;
        }
        for (const row of stale.values()) {
            await db.execute(
                'update bl_tr_permintaan set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3',
                [stamp, scope.tenantId, row.id],
            );
            counts.removed++;
        }
    });
    return counts;
}
