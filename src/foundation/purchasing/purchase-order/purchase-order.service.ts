import { z } from 'zod';
import { refuse, type Workspace } from '../../../platform/access/index.ts';
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
    type AmountDecimals,
} from '../../currency/index.ts';
import { Decimal } from '../../../platform/money/index.ts';
import { NumberIssuer } from '../../number-sequence/index.ts';
import {
    checkPriceLine,
    pricedLinesSchema,
    pricedLinesSql,
    withAmount,
    withTotals,
    type PriceLine,
} from '../purchase-line.service.ts';
import {
    paymentTermsJson,
    paymentTermsOf,
} from '../payment-terms/payment-terms.service.ts';
import {
    purchaseOrderInputSchema,
    purchaseOrderLineRowSchema,
    purchaseOrderRowSchema,
    purchaseOrderStatuses,
} from './purchase-order.schema.ts';

const numberReference = 'core.purchase-order-number';
const sourceType = 'purchase_order';

const transitions = {
    release: { from: 'terbuka', to: 'dirilis', released: true },
    reopen: { from: 'dirilis', to: 'terbuka', released: false },
} as const;

type LineDraft = PriceLine & {
    id: string | null;
    expectedReceiptDate: string | null;
};

const storedRowSchema = purchaseOrderRowSchema
    .omit({ amount: true, vat_amount: true })
    .extend({ priced_lines: pricedLinesSchema });
const storedLineSchema = purchaseOrderLineRowSchema.omit({ amount: true });

const rowSql = `select * from (
                    select h.id, h.nomor as number, h.tanggal::text as order_date,
                           h.tanggal_diharapkan::text as expected_receipt_date, h.status, h.version,
                           h.keterangan as description, h.lokasi_id as location_id,
                           p.name as vendor_name, l.kode as location_code, h.termasuk_ppn as prices_including_vat,
                           json_build_object('id', v.id, 'number', v.number, 'name', p.name) as vendor,
                           json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
                           ${paymentTermsJson('pt')} as payment_terms,
                           ${pricedLinesSql('bl_tr_order_detail', 'order_id', 'h')} as priced_lines,
                           ${isoSql('h.dirilis_pada')} as released_at
                    from bl_tr_order h
                    left join termin_pembayaran pt on pt.tenant_id = h.tenant_id and pt.id = h.termin_pembayaran_id
                    join vendors v on v.tenant_id = h.tenant_id and v.id = h.vendor_id
                    join parties p on p.tenant_id = v.tenant_id and p.id = v.party_id
                    join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
                    where h.tenant_id = $1 and h.legal_entity_id = $2 and h.deleted_at is null) orders
                where true`;

const messages = {
    vendor_id: 'Pilih vendor dari daftar.',
    location_id: 'Pilih lokasi dari daftar.',
    order_date: 'Isi tanggal order yang benar.',
    expected_receipt_date: 'Isi tanggal diharapkan datang yang benar.',
    description: 'Isi keterangan paling banyak 200 karakter.',
    lines: 'Satu order paling banyak 500 baris.',
    id: 'Baris ini sudah tidak ada. Muat ulang order, lalu ulangi perubahanmu.',
    item_id: 'Pilih barang dari daftar.',
    unit_id: 'Pilih satuan barang ini dari daftar.',
    quantity: 'Isi jumlah lebih dari 0.',
    unit_cost: 'Isi harga satuan 0 atau lebih.',
    discount_percent: 'Isi diskon 0 sampai 100 persen.',
    payment_terms_id: 'Pilih termin pembayaran dari daftar.',
};

export class PurchaseOrders {
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

    private async precision() {
        return new Currency(this.db, this.scope.tenantId).precision(
            localCurrencyCode,
        );
    }

    private async amountDecimals(): Promise<AmountDecimals> {
        return (await this.precision()).amount_decimals;
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('purchase-order', 'read');
        const bindings: string[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        const status = z
            .enum(purchaseOrderStatuses)
            .safeParse(parameters.get('status'));
        let filter = ` and ${allowedLocationsSql(this.workspace, bindings, ['location_id'])}`;
        if (status.success)
            filter += ` and status = $${bindings.push(status.data)}`;
        const decimals = await this.amountDecimals();
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                number: 'number',
                order_date: 'order_date',
                expected_receipt_date: 'expected_receipt_date',
                status: 'status',
                vendor: 'vendor_name',
                location: 'location_code',
            },
            searchColumns: ['number', 'vendor_name', 'location_code'],
            numericColumns: [],
            defaultSort: 'order_date',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) =>
                withTotals(storedRowSchema.parse(row), decimals),
            ),
            next_cursor: batch.next_cursor,
            permissions: this.permissions(),
            amount_decimals: decimals,
        };
    }

    private permissions() {
        const has = (permission: string) =>
            this.workspace.permissions.has(`core.${permission}`);
        return {
            update: has('purchase-order.update'),
            release: has('purchase-order.release'),
            receive: has('purchase-receipt.update'),
            create_vendor: has('vendor.update'),
        };
    }

    private async header(id: string) {
        const bindings = [this.scope.tenantId, this.scope.legalEntityId, id];
        const found = lookupId(id)
            ? await this.db.one(
                  storedRowSchema,
                  `${rowSql} and orders.id = $3 and ${allowedLocationsSql(this.workspace, bindings, ['location_id'])}`,
                  bindings,
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return withTotals(found, await this.amountDecimals());
    }

    private async document(id: string) {
        const header = await this.header(id);
        const decimals = await this.amountDecimals();
        const lines = await this.db.rows(
            storedLineSchema,
            `select d.id, d.urutan as line_no,
                    json_build_object('id', b.id, 'code', b.kode, 'name', b.nama, 'base_unit', base.kode) as item,
                    json_build_object('id', u.id, 'code', u.kode, 'name', u.nama) as unit,
                    trim_scale(d.konversi)::text as quantity_per_unit, trim_scale(d.jumlah)::text as quantity,
                    trim_scale(d.harga_satuan)::text as unit_cost,
                    trim_scale(d.diskon_persen)::text as discount_percent,
                    trim_scale(d.tarif_ppn)::text as vat_percent,
                    d.tanggal_diharapkan::text as expected_receipt_date,
                    trim_scale(d.jumlah_diterima)::text as quantity_received,
                    trim_scale(d.jumlah - d.jumlah_diterima)::text as outstanding_quantity
             from bl_tr_order_detail d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             join gd_m_satuan base on base.tenant_id = b.tenant_id and base.id = b.satuan_dasar_id
             join gd_m_satuan u on u.tenant_id = d.tenant_id and u.id = d.satuan_id
             where d.tenant_id = $1 and d.order_id = $2 and d.deleted_at is null
             order by d.urutan, d.id`,
            [this.scope.tenantId, header.id],
        );
        return {
            ...header,
            lines: lines.map((line) => withAmount(line, decimals)),
        };
    }

    async show(id: string) {
        this.workspace.guard('purchase-order', 'read');
        return {
            data: await this.document(id),
            permissions: this.permissions(),
            amount_decimals: await this.amountDecimals(),
        };
    }

    private async vendorStatus(id: string) {
        return lookupId(id)
            ? (
                  await this.db.one(
                      z.object({ status: z.string() }),
                      `select status from vendors where tenant_id = $1 and legal_entity_id = $2 and id = $3`,
                      [this.scope.tenantId, this.scope.legalEntityId, id],
                  )
              )?.status
            : undefined;
    }

    private async checked(body: unknown) {
        const data = parseInput(purchaseOrderInputSchema, body, messages);
        const errors: Record<string, string> = {};
        if (!dateSchema.safeParse(data.order_date).success)
            errors.order_date = messages.order_date;
        const expected = data.expected_receipt_date?.trim() || null;
        if (expected !== null && !dateSchema.safeParse(expected).success)
            errors.expected_receipt_date = messages.expected_receipt_date;
        const vendor = await this.vendorStatus(data.vendor_id);
        if (!vendor) errors.vendor_id = messages.vendor_id;
        else if (vendor !== 'active')
            errors.vendor_id =
                'Vendor ini nonaktif. Pilih vendor aktif, atau aktifkan lagi vendornya.';
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
        if (!location) errors.location_id = messages.location_id;
        else if (location.transit)
            errors.location_id =
                'Pilih lokasi yang bukan lokasi transit. Lokasi transit hanya dipakai mutasi.';
        else
            await requireLocationAccess(this.db, this.workspace, [location.id]);
        const description = data.description?.trim() || null;
        if (description && description.length > 200)
            errors.description = messages.description;
        const terms =
            data.payment_terms_id === undefined
                ? undefined
                : await paymentTermsOf(
                      this.db,
                      this.scope,
                      data.payment_terms_id,
                  );
        if (terms === null) errors.payment_terms_id = messages.payment_terms_id;
        const unitCostDecimals = unitAmountDecimals(await this.precision());
        const lines: LineDraft[] = [];
        for (const [index, line] of data.lines.entries()) {
            const fail = (name: string, message: string) => {
                errors[`lines.${index}.${name}`] = message;
            };
            const price = await checkPriceLine(
                this.db,
                this.scope,
                line,
                unitCostDecimals,
                fail,
            );
            const lineExpected = line.expected_receipt_date?.trim() || null;
            if (
                lineExpected !== null &&
                !dateSchema.safeParse(lineExpected).success
            )
                fail('expected_receipt_date', messages.expected_receipt_date);
            lines.push({
                id: line.id ?? null,
                ...price,
                expectedReceiptDate: lineExpected,
            });
        }
        if (Object.keys(errors).length || !location) validation(errors);
        return {
            vendorId: data.vendor_id,
            location,
            orderDate: data.order_date,
            expectedReceiptDate: expected,
            description,
            pricesIncludingVat: data.prices_including_vat ?? false,
            paymentTermsId:
                data.payment_terms_id === undefined
                    ? undefined
                    : (terms?.id ?? null),
            lines,
        };
    }

    private async saveLines(orderId: string, lines: LineDraft[]) {
        const stored = await this.db.rows(
            z.object({
                id: z.string(),
                item_id: z.string(),
                unit_id: z.string(),
                received: z.string(),
            }),
            `select id, barang_id as item_id, satuan_id as unit_id, jumlah_diterima::text as received
             from bl_tr_order_detail
             where tenant_id = $1 and order_id = $2 and deleted_at is null`,
            [this.scope.tenantId, orderId],
        );
        const existing = new Map(
            stored.map((line) => [
                line.id,
                {
                    ...line,
                    received: fromNumeric(line.received, quantityScale),
                },
            ]),
        );
        const errors: Record<string, string> = {};
        for (const [index, line] of lines.entries()) {
            const before = line.id === null ? undefined : existing.get(line.id);
            if (!before || before.received === 0n) continue;
            if (
                before.item_id !== line.itemId ||
                before.unit_id !== line.unitId
            )
                errors[`lines.${index}.item_id`] =
                    'Barang dan satuan baris yang sudah diterima tidak bisa diganti. Tambahkan baris baru untuk barang lain.';
            else if (line.quantity < before.received)
                errors[`lines.${index}.quantity`] =
                    `Jumlah tidak boleh kurang dari yang sudah diterima (${quantityText(before.received)}).`;
        }
        const kept = new Set(lines.map((line) => line.id));
        for (const before of existing.values())
            if (before.received > 0n && !kept.has(before.id))
                errors.lines =
                    'Baris yang sudah diterima tidak bisa dihapus. Kurangi jumlahnya sampai sama dengan yang sudah diterima.';
        if (Object.keys(errors).length) validation(errors);
        const saved = new Set<string>();
        const stamp = nowSql();
        for (const [index, line] of lines.entries()) {
            const values = {
                urutan: index + 1,
                barang_id: line.itemId,
                satuan_id: line.unitId,
                konversi: toNumeric(line.conversion, quantityScale),
                jumlah: toNumeric(line.quantity, quantityScale),
                harga_satuan: toNumeric(line.unitCost, quantityScale),
                diskon_persen: toNumeric(line.discountPercent, quantityScale),
                tarif_ppn: toNumeric(line.vatPercent, quantityScale),
                tanggal_diharapkan: line.expectedReceiptDate,
            };
            if (line.id === null) {
                await this.db.insert('bl_tr_order_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    order_id: orderId,
                    ...values,
                    created_at: stamp,
                    updated_at: stamp,
                });
                continue;
            }
            if (!existing.has(line.id) || saved.has(line.id))
                validation({ [`lines.${index}.id`]: messages.id });
            saved.add(line.id);
            await this.db.execute(
                `update bl_tr_order_detail set urutan = $1, barang_id = $2, satuan_id = $3, konversi = $4,
                        jumlah = $5, harga_satuan = $6, diskon_persen = $7, tarif_ppn = $8,
                        tanggal_diharapkan = $9, updated_at = $10
                 where tenant_id = $11 and id = $12`,
                [
                    values.urutan,
                    values.barang_id,
                    values.satuan_id,
                    values.konversi,
                    values.jumlah,
                    values.harga_satuan,
                    values.diskon_persen,
                    values.tarif_ppn,
                    values.tanggal_diharapkan,
                    stamp,
                    this.scope.tenantId,
                    line.id,
                ],
            );
        }
        for (const id of existing.keys())
            if (!saved.has(id))
                await this.db.execute(
                    'update bl_tr_order_detail set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3',
                    [stamp, this.scope.tenantId, id],
                );
    }

    async create(body: unknown) {
        this.workspace.guard('purchase-order', 'update');
        const data = await this.checked(body);
        const id = Bun.randomUUIDv7();
        await this.db.transaction(async () => {
            await insertOrder(this.db, this.scope, {
                id,
                vendorId: data.vendorId,
                locationId: data.location.id,
                operatingUnitId: data.location.operating_unit_id,
                orderDate: data.orderDate,
                expectedReceiptDate: data.expectedReceiptDate,
                description: data.description,
                pricesIncludingVat: data.pricesIncludingVat,
                paymentTermsId: data.paymentTermsId,
                lines: data.lines,
            });
        });
        return {
            status: 201,
            headers: {},
            body: { data: await this.document(id) },
        };
    }

    private async lockHeader(id: string) {
        const locked = await this.db.one(
            z.object({
                status: z.enum(purchaseOrderStatuses),
                version: z.number(),
            }),
            `select status, version from bl_tr_order
             where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null for update`,
            [this.scope.tenantId, this.scope.legalEntityId, id],
        );
        if (!locked) abort(404, 'Not Found');
        return locked;
    }

    private async lockOpen(id: string, version: number, refusal: string) {
        const locked = await this.lockHeader(id);
        if (locked.status === 'selesai')
            validation({
                _form: 'Order ini sudah diterima seluruhnya, jadi tidak bisa diubah atau dihapus lagi.',
            });
        if (locked.status !== 'terbuka') validation({ _form: refusal });
        if (locked.version !== version)
            coded(409, 'stale_version', staleMessage);
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-order', 'update');
        const current = await this.header(id);
        const data = await this.checked(body);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            await this.lockOpen(
                current.id,
                version,
                'Order yang sudah dirilis tidak bisa diubah. Pilih Buka lagi lebih dulu.',
            );
            await this.db.execute(
                `update bl_tr_order set operating_unit_id = $1, lokasi_id = $2, vendor_id = $3, tanggal = $4,
                        tanggal_diharapkan = $5, keterangan = $6, termasuk_ppn = $7, updated_at = $8,
                        termin_pembayaran_id = case when $11 then $12::uuid else termin_pembayaran_id end
                 where tenant_id = $9 and id = $10`,
                [
                    data.location.operating_unit_id,
                    data.location.id,
                    data.vendorId,
                    data.orderDate,
                    data.expectedReceiptDate,
                    data.description,
                    data.pricesIncludingVat,
                    nowSql(),
                    this.scope.tenantId,
                    current.id,
                    data.paymentTermsId !== undefined,
                    data.paymentTermsId ?? null,
                ],
            );
            await this.saveLines(current.id, data.lines);
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }

    private async refuseReceived(id: string) {
        const usage = await this.db.one(
            z.object({
                received: z.boolean(),
                draft: z.string().nullable(),
                draft_number: z.string().nullable(),
            }),
            `select exists (select 1 from bl_tr_order_detail d
                            where d.tenant_id = $1 and d.order_id = $2 and d.deleted_at is null
                              and d.jumlah_diterima > 0) as received,
                    r.id as draft, r.nomor as draft_number
             from (select 1) one
             left join lateral (select id, nomor from bl_tr_penerimaan
                                where tenant_id = $1 and order_id = $2 and status = 'draf' and deleted_at is null
                                order by nomor limit 1) r on true`,
            [this.scope.tenantId, id],
        );
        if (usage?.received)
            validation({
                _form: 'Sebagian barang order ini sudah diterima, jadi ordernya tidak bisa dihapus. Kurangi jumlah barisnya sampai sama dengan yang sudah diterima, lalu rilis lagi.',
            });
        if (usage?.draft && usage.draft_number)
            await refuse(this.db, this.workspace, {
                message: `Order ini sedang diterima lewat draf penerimaan ${usage.draft_number}, jadi belum bisa dihapus. Hapus draf itu lebih dulu.`,
                open: {
                    page: 'core.purchase-receipt',
                    recordId: usage.draft,
                    label: `Buka penerimaan ${usage.draft_number}`,
                },
                otherwise: `Minta petugas gudang menghapus draf penerimaan ${usage.draft_number}.`,
            });
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-order', 'update');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            await this.lockOpen(
                current.id,
                version,
                'Order yang sudah dirilis tidak bisa dihapus. Pilih Buka lagi lebih dulu.',
            );
            await this.refuseReceived(current.id);
            const stamp = nowSql();
            await this.db.execute(
                'update bl_tr_order set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3',
                [stamp, this.scope.tenantId, current.id],
            );
            await this.db.execute(
                `update bl_tr_order_detail set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and order_id = $3 and deleted_at is null`,
                [stamp, this.scope.tenantId, current.id],
            );
        });
        return { status: 204, headers: {}, body: undefined };
    }

    private async transition(
        id: string,
        version: number,
        move: keyof typeof transitions,
    ) {
        const { from, to, released } = transitions[move];
        const claimed = await this.db.one(
            z.object({ vendor_id: z.string() }),
            `update bl_tr_order set status = $3, updated_at = $1,
                    dirilis_pada = case when $9 then $1::timestamp end,
                    dirilis_oleh_user_id = case when $9 then $2::uuid end
             where tenant_id = $4 and legal_entity_id = $5 and id = $6 and status = $7 and version = $8
               and deleted_at is null
             returning vendor_id`,
            [
                nowSql(),
                this.workspace.userId,
                to,
                this.scope.tenantId,
                this.scope.legalEntityId,
                id,
                from,
                version,
                released,
            ],
        );
        if (claimed) return claimed;
        const current = await this.lockHeader(id);
        if (current.status === to) return null;
        return coded(409, 'stale_version', staleMessage);
    }

    async release(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-order', 'release');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const claimed = await this.transition(
                current.id,
                version,
                'release',
            );
            if (!claimed) return;
            if ((await this.vendorStatus(claimed.vendor_id)) !== 'active')
                validation({
                    vendor_id:
                        'Vendor ini nonaktif, jadi ordernya tidak bisa dirilis. Aktifkan lagi vendornya atau pilih vendor lain.',
                });
            const lines = await this.db.one(
                z.object({ count: z.number() }),
                `select count(*)::int as count from bl_tr_order_detail
                 where tenant_id = $1 and order_id = $2 and deleted_at is null`,
                [this.scope.tenantId, current.id],
            );
            if (!lines?.count)
                validation({
                    lines: 'Tambahkan sedikitnya satu barang sebelum order dirilis.',
                });
            await settleOrder(this.db, this.scope.tenantId, current.id);
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }

    async reopen(request: Request, id: string, body: unknown) {
        this.workspace.guard('purchase-order', 'release');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            await this.transition(current.id, version, 'reopen');
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }
}

async function settleOrder(db: Database, tenantId: string, orderId: string) {
    await db.execute(
        `update bl_tr_order h
         set status = s.status, updated_at = $3,
             selesai_pada = case when s.status = 'selesai' then $3::timestamp end
         from (select case when exists (select 1 from bl_tr_order_detail d
                                        where d.tenant_id = $1 and d.order_id = $2 and d.deleted_at is null
                                          and d.jumlah_diterima < d.jumlah)
                           then 'dirilis' else 'selesai' end as status) s
         where h.tenant_id = $1 and h.id = $2 and h.status in ('dirilis', 'selesai') and h.status <> s.status`,
        [tenantId, orderId, nowSql()],
    );
}

export type OrderReceiptLine = {
    index: number;
    orderLineId: string;
    itemId: string;
    unitId: string;
    quantity: bigint;
};

type Scope = { tenantId: string; legalEntityId: string };

async function lockOrder(db: Database, scope: Scope, orderId: string) {
    return db.one(
        z.object({
            status: z.enum(purchaseOrderStatuses),
            number: z.string(),
        }),
        `select status, nomor as number from bl_tr_order
         where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null for update`,
        [scope.tenantId, scope.legalEntityId, orderId],
    );
}

const quantityText = (value: bigint) =>
    Decimal.of(toNumeric(value, quantityScale)).normalized();

export async function receiveOnOrder(
    db: Database,
    workspace: Workspace,
    scope: Scope,
    orderId: string,
    lines: OrderReceiptLine[],
) {
    const order = await lockOrder(db, scope, orderId);
    if (!order)
        return validation({
            _form: 'Purchase order penerimaan ini sudah dihapus. Buat penerimaan tanpa order.',
        });
    if (order.status !== 'dirilis')
        await refuse(db, workspace, {
            message:
                order.status === 'selesai'
                    ? `Purchase order ${order.number} sudah diterima seluruhnya.`
                    : `Purchase order ${order.number} sedang dibuka untuk diubah, jadi penerimaannya belum bisa diposting. Rilis ordernya lebih dulu.`,
            open: {
                page: 'core.purchase-order',
                recordId: orderId,
                label: `Buka order ${order.number}`,
            },
            otherwise: `Minta petugas pembelian memeriksa order ${order.number}.`,
        });
    const stored = new Map(
        (
            await db.rows(
                z.object({
                    id: z.string(),
                    item_id: z.string(),
                    unit_id: z.string(),
                    unit: z.string(),
                    outstanding: z.string(),
                }),
                `select d.id, d.barang_id as item_id, d.satuan_id as unit_id, s.kode as unit,
                        (d.jumlah - d.jumlah_diterima)::text as outstanding
                 from bl_tr_order_detail d
                 join gd_m_satuan s on s.tenant_id = d.tenant_id and s.id = d.satuan_id
                 where d.tenant_id = $1 and d.order_id = $2 and d.deleted_at is null`,
                [scope.tenantId, orderId],
            )
        ).map((line) => [
            line.id,
            {
                ...line,
                outstanding: fromNumeric(line.outstanding, quantityScale),
            },
        ]),
    );
    const totals = new Map<string, bigint>();
    for (const line of lines)
        totals.set(
            line.orderLineId,
            (totals.get(line.orderLineId) ?? 0n) + line.quantity,
        );
    const errors: Record<string, string> = {};
    for (const line of lines) {
        const target = stored.get(line.orderLineId);
        const field = `lines.${line.index}.quantity`;
        if (!target)
            errors[field] =
                'Baris ini sudah dihapus dari purchase order. Hapus baris ini dari penerimaan.';
        else if (
            target.item_id !== line.itemId ||
            target.unit_id !== line.unitId
        )
            errors[field] =
                'Barang atau satuan baris ini berbeda dengan baris purchase order-nya.';
        else if ((totals.get(line.orderLineId) ?? 0n) > target.outstanding)
            errors[field] =
                `Jumlah melebihi sisa order (${quantityText(target.outstanding)} ${target.unit}). Kurangi jumlahnya, atau tambah jumlah di order lebih dulu.`;
    }
    if (Object.keys(errors).length) validation(errors);
    for (const [orderLineId, quantity] of totals)
        await db.execute(
            `update bl_tr_order_detail set jumlah_diterima = jumlah_diterima + $1, updated_at = $2
             where tenant_id = $3 and id = $4`,
            [
                toNumeric(quantity, quantityScale),
                nowSql(),
                scope.tenantId,
                orderLineId,
            ],
        );
    await settleOrder(db, scope.tenantId, orderId);
}

export async function unreceiveOnOrder(
    db: Database,
    scope: Scope,
    orderId: string,
    lines: { orderLineId: string; quantity: bigint }[],
) {
    if (!(await lockOrder(db, scope, orderId))) return;
    for (const line of lines)
        await db.execute(
            `update bl_tr_order_detail set jumlah_diterima = jumlah_diterima - $1, updated_at = $2
             where tenant_id = $3 and id = $4`,
            [
                toNumeric(line.quantity, quantityScale),
                nowSql(),
                scope.tenantId,
                line.orderLineId,
            ],
        );
    await settleOrder(db, scope.tenantId, orderId);
}

export type NewOrder = {
    id: string;
    vendorId: string;
    locationId: string;
    operatingUnitId: string;
    orderDate: string;
    expectedReceiptDate: string | null;
    description: string | null;
    pricesIncludingVat: boolean;
    // Tidak diisi berarti termin bawaan vendor, seperti Payment Terms Code yang disalin dari vendor di BC.
    paymentTermsId?: string | null | undefined;
    lines: (PriceLine & { expectedReceiptDate: string | null })[];
};

async function vendorPaymentTerms(
    db: Database,
    scope: Scope,
    vendorId: string,
): Promise<string | null> {
    return (
        (
            await db.one(
                z.object({ id: z.string().nullable() }),
                `select termin_pembayaran_id as id from vendors
                 where tenant_id = $1 and legal_entity_id = $2 and id = $3`,
                [scope.tenantId, scope.legalEntityId, vendorId],
            )
        )?.id ?? null
    );
}

export async function insertOrder(
    db: Database,
    scope: Scope,
    order: NewOrder,
): Promise<{ number: string; lineIds: string[] }> {
    const number = await new NumberIssuer(db, {
        tenantId: scope.tenantId,
        moduleId: 'core',
    }).issue({
        reference: numberReference,
        key: `${sourceType}:${order.id}`,
        documentDate: order.orderDate,
        legalEntityId: scope.legalEntityId,
    });
    const stamp = nowSql();
    await db.insert('bl_tr_order', {
        id: order.id,
        tenant_id: scope.tenantId,
        legal_entity_id: scope.legalEntityId,
        operating_unit_id: order.operatingUnitId,
        lokasi_id: order.locationId,
        vendor_id: order.vendorId,
        nomor: number,
        tanggal: order.orderDate,
        tanggal_diharapkan: order.expectedReceiptDate,
        keterangan: order.description,
        termasuk_ppn: order.pricesIncludingVat,
        termin_pembayaran_id:
            order.paymentTermsId !== undefined
                ? order.paymentTermsId
                : await vendorPaymentTerms(db, scope, order.vendorId),
        created_at: stamp,
        updated_at: stamp,
    });
    const lineIds: string[] = [];
    for (const [index, line] of order.lines.entries()) {
        const lineId = Bun.randomUUIDv7();
        lineIds.push(lineId);
        await db.insert('bl_tr_order_detail', {
            id: lineId,
            tenant_id: scope.tenantId,
            legal_entity_id: scope.legalEntityId,
            order_id: order.id,
            urutan: index + 1,
            barang_id: line.itemId,
            satuan_id: line.unitId,
            konversi: toNumeric(line.conversion, quantityScale),
            jumlah: toNumeric(line.quantity, quantityScale),
            harga_satuan: toNumeric(line.unitCost, quantityScale),
            diskon_persen: toNumeric(line.discountPercent, quantityScale),
            tarif_ppn: toNumeric(line.vatPercent, quantityScale),
            tanggal_diharapkan: line.expectedReceiptDate,
            created_at: stamp,
            updated_at: stamp,
        });
    }
    return { number, lineIds };
}
