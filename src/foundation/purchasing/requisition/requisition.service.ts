import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import {
    isoSql,
    nowSql,
    type Database,
} from '../../../platform/database/index.ts';
import {
    abort,
    coded,
    dateSchema,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import {
    activeLegalEntity,
    allowedLocationsSql,
    fromNumeric,
    parseInput,
    quantityScale,
    requireLocationAccess,
    toNumeric,
} from '../../inventory/index.ts';
import {
    Currency,
    localCurrencyCode,
    unitAmountDecimals,
} from '../../currency/index.ts';
import { insertOrder } from '../purchase-order/purchase-order.service.ts';
import { checkPriceLine } from '../purchase-line.service.ts';
import {
    carryOutInputSchema,
    requisitionInputSchema,
    requisitionRowSchema,
    requisitionStatuses,
} from './requisition.schema.ts';

const rowSql = `select * from (
        select r.id, r.lokasi_id as location_id, r.version, r.tanggal_dibutuhkan::text as due_date,
               r.keterangan as description, requester.name as requested_by, r.disetujui as accepted,
               case when r.order_detail_id is null then 'terbuka' else 'diproses' end as status,
               json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
               json_build_object('id', b.id, 'code', b.kode, 'name', b.nama, 'base_unit', base.kode) as item,
               json_build_object('id', u.id, 'code', u.kode, 'name', u.nama) as unit,
               trim_scale(r.konversi)::text as quantity_per_unit, trim_scale(r.jumlah)::text as quantity,
               trim_scale(r.harga_satuan)::text as unit_cost,
               case when v.id is null then null
                    else json_build_object('id', v.id, 'number', v.number, 'name', p.name) end as vendor,
               case when o.id is null then null else json_build_object('id', o.id, 'number', o.nomor) end as "order",
               b.kode as item_code, b.nama as item_name, l.kode as location_code, p.name as vendor_name,
               o.nomor as order_number, ${isoSql('r.diproses_pada')} as processed_at
        from bl_tr_permintaan r
        join gd_m_lokasi l on l.tenant_id = r.tenant_id and l.id = r.lokasi_id
        join gd_m_barang b on b.tenant_id = r.tenant_id and b.id = r.barang_id
        join gd_m_satuan base on base.tenant_id = b.tenant_id and base.id = b.satuan_dasar_id
        join gd_m_satuan u on u.tenant_id = r.tenant_id and u.id = r.satuan_id
        left join users requester on requester.id = r.diminta_oleh_user_id
        left join vendors v on v.tenant_id = r.tenant_id and v.id = r.vendor_id
        left join parties p on p.tenant_id = v.tenant_id and p.id = v.party_id
        left join bl_tr_order_detail od on od.tenant_id = r.tenant_id and od.id = r.order_detail_id
        left join bl_tr_order o on o.tenant_id = od.tenant_id and o.id = od.order_id
        where r.tenant_id = $1 and r.legal_entity_id = $2 and r.deleted_at is null) requisitions
    where true`;

const messages = {
    location_id: 'Pilih lokasi dari daftar.',
    item_id: 'Pilih barang dari daftar.',
    unit_id: 'Pilih satuan barang ini dari daftar.',
    quantity: 'Isi jumlah lebih dari 0.',
    due_date: 'Isi tanggal dibutuhkan yang benar.',
    description: 'Isi keterangan paling banyak 200 karakter.',
    vendor_id: 'Pilih vendor dari daftar.',
    unit_cost: 'Isi harga satuan 0 atau lebih.',
    order_date: 'Isi tanggal order yang benar.',
};
const purchasingOnly =
    'Hanya petugas pembelian yang mengisi vendor, harga, dan persetujuan.';

const storedSchema = z.object({
    vendor_id: z.string().nullable(),
    unit_cost: z.string().nullable(),
    accepted: z.boolean(),
    processed: z.boolean(),
    version: z.number(),
});

// Permintaan pembelian (Requisition Worksheet di BC). Lokasi mengajukan barang dan tanggal dibutuhkan; petugas pembelian
// mengisi vendor dan harga, menyetujui, lalu Buat purchase order membuat satu order terbuka per vendor dan lokasi untuk
// semua baris yang disetujui (Carry Out Action Message).
export class PurchaseRequisitions {
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

    private permissions() {
        const has = (permission: string) =>
            this.workspace.permissions.has(`core.${permission}`);
        return {
            update: has('purchase-requisition.update'),
            process: has('purchase-requisition.process'),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('purchase-requisition', 'read');
        const bindings: string[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        const status = z
            .enum(requisitionStatuses)
            .safeParse(parameters.get('status'));
        const filter = ` and ${allowedLocationsSql(this.workspace, bindings, ['location_id'])} and status = $${bindings.push(status.success ? status.data : 'terbuka')}`;
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                due_date: 'due_date',
                item: 'item_name',
                location: 'location_code',
                vendor: 'vendor_name',
                order: 'order_number',
            },
            searchColumns: [
                'item_code',
                'item_name',
                'location_code',
                'vendor_name',
                'order_number',
            ],
            numericColumns: [],
            defaultSort: 'due_date',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => requisitionRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            permissions: this.permissions(),
        };
    }

    private async row(id: string) {
        const bindings = [this.scope.tenantId, this.scope.legalEntityId, id];
        const found = lookupId(id)
            ? await this.db.one(
                  requisitionRowSchema,
                  `${rowSql} and requisitions.id = $3 and ${allowedLocationsSql(this.workspace, bindings, ['location_id'])}`,
                  bindings,
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async show(id: string) {
        this.workspace.guard('purchase-requisition', 'read');
        return { data: await this.row(id), permissions: this.permissions() };
    }

    // Isian baris. Vendor, harga, dan persetujuan hanya boleh berubah di tangan pemegang izin proses; nilai yang tidak
    // berubah boleh dikirim ulang oleh siapa pun, supaya layar yang sama dipakai keduanya.
    private async checked(
        body: unknown,
        stored: z.infer<typeof storedSchema> | null,
    ) {
        const data = parseInput(requisitionInputSchema, body, messages);
        const errors: Record<string, string> = {};
        const location = lookupId(data.location_id)
            ? await this.db.one(
                  z.object({
                      id: z.string(),
                      operating_unit_id: z.string(),
                      transit: z.boolean(),
                  }),
                  `select id, operating_unit_id, transit from gd_m_lokasi
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                  [
                      this.scope.tenantId,
                      this.scope.legalEntityId,
                      data.location_id,
                  ],
              )
            : undefined;
        if (!location || location.transit)
            errors.location_id = messages.location_id;
        else
            await requireLocationAccess(this.db, this.workspace, [location.id]);
        if (!dateSchema.safeParse(data.due_date).success)
            errors.due_date = messages.due_date;
        const description = data.description?.trim() || null;
        if (description && description.length > 200)
            errors.description = messages.description;
        const precision = await new Currency(
            this.db,
            this.scope.tenantId,
        ).precision(localCurrencyCode);
        const fail = (field: string, message: string) => {
            errors[field] = message;
        };
        const unitCost =
            data.unit_cost === null ||
            data.unit_cost === undefined ||
            data.unit_cost === ''
                ? null
                : data.unit_cost;
        const price = await checkPriceLine(
            this.db,
            this.scope,
            {
                item_id: data.item_id,
                unit_id: data.unit_id,
                quantity: data.quantity,
                unit_cost: unitCost ?? 0,
            },
            unitAmountDecimals(precision),
            fail,
        );
        const vendorId = data.vendor_id || null;
        if (vendorId !== null) {
            const vendor = lookupId(vendorId)
                ? await this.db.one(
                      z.object({ status: z.string() }),
                      'select status from vendors where tenant_id = $1 and legal_entity_id = $2 and id = $3',
                      [this.scope.tenantId, this.scope.legalEntityId, vendorId],
                  )
                : undefined;
            if (!vendor) errors.vendor_id = messages.vendor_id;
            else if (vendor.status !== 'active')
                errors.vendor_id =
                    'Vendor ini nonaktif. Pilih vendor aktif, atau aktifkan lagi vendornya.';
        }
        const accepted = data.accepted ?? false;
        const storedCost = stored?.unit_cost ?? null;
        const cost =
            unitCost === null ? null : toNumeric(price.unitCost, quantityScale);
        const sameCost =
            storedCost === null || cost === null
                ? storedCost === cost
                : fromNumeric(storedCost, quantityScale) === price.unitCost;
        if (!this.permissions().process) {
            if (vendorId !== (stored?.vendor_id ?? null))
                errors.vendor_id = purchasingOnly;
            if (!sameCost) errors.unit_cost = purchasingOnly;
            if (accepted !== (stored?.accepted ?? false))
                errors.accepted = purchasingOnly;
        }
        if (Object.keys(errors).length || !location) validation(errors);
        return {
            location,
            price,
            dueDate: data.due_date,
            description,
            vendorId,
            unitCost: cost,
            accepted,
        };
    }

    async create(body: unknown) {
        this.workspace.guard('purchase-requisition', 'update');
        const data = await this.checked(body, null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        await this.db.insert('bl_tr_permintaan', {
            id,
            tenant_id: this.scope.tenantId,
            legal_entity_id: this.scope.legalEntityId,
            operating_unit_id: data.location.operating_unit_id,
            lokasi_id: data.location.id,
            barang_id: data.price.itemId,
            satuan_id: data.price.unitId,
            konversi: toNumeric(data.price.conversion, quantityScale),
            jumlah: toNumeric(data.price.quantity, quantityScale),
            tanggal_dibutuhkan: data.dueDate,
            keterangan: data.description,
            diminta_oleh_user_id: this.workspace.userId,
            vendor_id: data.vendorId,
            harga_satuan: data.unitCost,
            disetujui: data.accepted,
            created_at: stamp,
            updated_at: stamp,
        });
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    private async lockOpen(id: string, version: number) {
        const stored = await this.db.one(
            storedSchema,
            `select vendor_id, harga_satuan::text as unit_cost, disetujui as accepted,
                    order_detail_id is not null as processed, version
             from bl_tr_permintaan
             where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null for update`,
            [this.scope.tenantId, this.scope.legalEntityId, id],
        );
        if (!stored) return abort(404, 'Not Found');
        if (stored.processed)
            validation({
                _form: 'Permintaan ini sudah menjadi purchase order, jadi tidak bisa diubah atau dihapus.',
            });
        if (stored.version !== version)
            coded(409, 'stale_version', staleMessage);
        return stored;
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-requisition', 'update');
        const current = await this.row(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const stored = await this.lockOpen(current.id, version);
            const data = await this.checked(body, stored);
            await this.db.execute(
                `update bl_tr_permintaan set operating_unit_id = $1, lokasi_id = $2, barang_id = $3, satuan_id = $4,
                        konversi = $5, jumlah = $6, tanggal_dibutuhkan = $7, keterangan = $8, vendor_id = $9,
                        harga_satuan = $10, disetujui = $11, updated_at = $12
                 where tenant_id = $13 and id = $14`,
                [
                    data.location.operating_unit_id,
                    data.location.id,
                    data.price.itemId,
                    data.price.unitId,
                    toNumeric(data.price.conversion, quantityScale),
                    toNumeric(data.price.quantity, quantityScale),
                    data.dueDate,
                    data.description,
                    data.vendorId,
                    data.unitCost,
                    data.accepted,
                    nowSql(),
                    this.scope.tenantId,
                    current.id,
                ],
            );
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.row(current.id) },
        };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-requisition', 'update');
        const current = await this.row(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            await this.lockOpen(current.id, version);
            await this.db.execute(
                'update bl_tr_permintaan set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3',
                [nowSql(), this.scope.tenantId, current.id],
            );
        });
        return { status: 204, headers: {}, body: undefined };
    }

    // Carry Out Action Message: semua baris disetujui di lokasi yang boleh dilihat pengguna menjadi purchase order
    // terbuka, satu per vendor dan lokasi. Harga yang kosong diisi harga penerimaan terakhir barang dan satuan itu, atau
    // 0 bila belum pernah diterima; order terbuka masih bisa diubah sebelum dirilis.
    async carryOut(body: unknown) {
        this.workspace.guard('purchase-requisition', 'process');
        this.workspace.guard('purchase-order', 'update');
        const input = carryOutInputSchema.safeParse(body);
        if (
            !input.success ||
            !dateSchema.safeParse(input.data.order_date).success
        )
            return validation({ order_date: messages.order_date });
        const orderDate = input.data.order_date;
        const created: { id: string; number: string }[] = [];
        await this.db.transaction(async () => {
            const bindings: string[] = [
                this.scope.tenantId,
                this.scope.legalEntityId,
            ];
            const lines = await this.db.rows(
                z.object({
                    id: z.string(),
                    vendor_id: z.string().nullable(),
                    vendor_active: z.boolean().nullable(),
                    location_id: z.string(),
                    operating_unit_id: z.string(),
                    item_id: z.string(),
                    unit_id: z.string(),
                    conversion: z.string(),
                    quantity: z.string(),
                    unit_cost: z.string(),
                    due_date: z.string(),
                }),
                `select r.id, r.vendor_id, v.status = 'active' as vendor_active, r.lokasi_id as location_id,
                        r.operating_unit_id, r.barang_id as item_id, r.satuan_id as unit_id,
                        r.konversi::text as conversion, r.jumlah::text as quantity,
                        coalesce(r.harga_satuan, (
                            select d.harga_satuan from bl_tr_penerimaan_detail d
                            join bl_tr_penerimaan h on h.tenant_id = d.tenant_id and h.id = d.penerimaan_id
                            where d.tenant_id = r.tenant_id and d.barang_id = r.barang_id and d.satuan_id = r.satuan_id
                              and d.deleted_at is null and h.status = 'diposting'
                            order by h.tanggal desc, h.diposting_pada desc limit 1), 0)::text as unit_cost,
                        r.tanggal_dibutuhkan::text as due_date
                 from bl_tr_permintaan r
                 left join vendors v on v.tenant_id = r.tenant_id and v.id = r.vendor_id
                 where r.tenant_id = $1 and r.legal_entity_id = $2 and r.deleted_at is null
                   and r.order_detail_id is null and r.disetujui
                   and ${allowedLocationsSql(this.workspace, bindings, ['r.lokasi_id'])}
                 order by r.lokasi_id, r.vendor_id, r.tanggal_dibutuhkan, r.id
                 for update of r`,
                bindings,
            );
            if (!lines.length)
                validation({
                    _form: 'Belum ada permintaan yang disetujui. Tandai Disetujui pada permintaan yang akan dipesan.',
                });
            const missing = lines.filter((line) => !line.vendor_id).length;
            if (missing)
                validation({
                    _form: `${missing} permintaan yang disetujui belum punya vendor. Isi vendornya lebih dulu.`,
                });
            if (lines.some((line) => !line.vendor_active))
                validation({
                    _form: 'Ada permintaan yang disetujui dengan vendor nonaktif. Ganti vendornya atau aktifkan lagi vendor itu.',
                });
            const groups = new Map<string, typeof lines>();
            for (const line of lines) {
                const key = `${line.vendor_id}:${line.location_id}`;
                groups.set(key, [...(groups.get(key) ?? []), line]);
            }
            const stamp = nowSql();
            for (const group of groups.values()) {
                const [first] = group;
                if (!first?.vendor_id) continue;
                const id = Bun.randomUUIDv7();
                const { number, lineIds } = await insertOrder(
                    this.db,
                    this.scope,
                    {
                        id,
                        vendorId: first.vendor_id,
                        locationId: first.location_id,
                        operatingUnitId: first.operating_unit_id,
                        orderDate,
                        expectedReceiptDate:
                            group.map((line) => line.due_date).sort()[0] ??
                            null,
                        description: 'Dari permintaan pembelian',
                        pricesIncludingVat: false,
                        lines: group.map((line) => ({
                            itemId: line.item_id,
                            unitId: line.unit_id,
                            conversion: fromNumeric(
                                line.conversion,
                                quantityScale,
                            ),
                            quantity: fromNumeric(line.quantity, quantityScale),
                            unitCost: fromNumeric(
                                line.unit_cost,
                                quantityScale,
                            ),
                            discountPercent: 0n,
                            vatPercent: 0n,
                            expectedReceiptDate: line.due_date,
                        })),
                    },
                );
                for (const [index, line] of group.entries())
                    await this.db.execute(
                        `update bl_tr_permintaan set order_detail_id = $1, diproses_pada = $2, updated_at = $2
                         where tenant_id = $3 and id = $4`,
                        [
                            lineIds[index] ?? null,
                            stamp,
                            this.scope.tenantId,
                            line.id,
                        ],
                    );
                created.push({ id, number });
            }
        });
        return { status: 201, headers: {}, body: { data: created } };
    }
}
