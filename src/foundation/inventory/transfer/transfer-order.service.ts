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
import { NumberIssuer } from '../../number-sequence/index.ts';
import { activeLegalEntity, exists, parseInput } from '../inventory.service.ts';
import {
    postItemLines,
    type TransferLine,
} from '../item-ledger/item-ledger.posting.ts';
import { transferModes } from '../item-ledger/stock-policy.ts';
import { unitConversion } from '../item-unit/item-unit.service.ts';
import {
    baseQuantity,
    decimalInput,
    display,
    fromNumeric,
    quantityScale,
    toNumeric,
} from '../quantity.ts';
import {
    transferOrderInputSchema,
    transferOrderLineRowSchema,
    transferOrderRowSchema,
    transferOrderStatuses,
    transferPostingInputSchema,
    transferPostingSummarySchema,
    transferQuantitiesInputSchema,
} from './transfer-order.schema.ts';
import {
    receiptSource,
    resetQuantitiesToHandle,
    shipmentSource,
} from './transfer.posting.ts';

// Reference nomor amprah, mutasi, dan penerimaan mutasi; juga tampil di bagian Penomoran setelan persediaan.
export const transferNumberReferences = {
    order: 'core.inventory-transfer-order-number',
    shipment: 'core.inventory-transfer-shipment-number',
    receipt: 'core.inventory-transfer-receipt-number',
} as const;

const one = 10n ** BigInt(quantityScale);

type Status = (typeof transferOrderStatuses)[number];

// Perpindahan status selain posting, beserta syarat baris yang harus dipenuhi dan pesan bila syarat itu tidak terpenuhi.
const moves = {
    submit: {
        from: 'draf',
        to: 'diajukan',
        stamp: 'diajukan_pada = $1, diajukan_oleh_user_id = $2',
        requires: `exists (select 1 from gd_tr_amprahan_detail d
                           where d.tenant_id = h.tenant_id and d.amprahan_id = h.id and d.deleted_at is null)`,
        refusal: {
            lines: 'Tambahkan sedikitnya satu baris sebelum mengajukan amprah.',
        },
    },
    close: {
        from: 'diajukan',
        to: 'selesai',
        stamp: 'ditutup_pada = $1, ditutup_oleh_user_id = $2',
        requires: `not exists (select 1 from gd_tr_amprahan_detail d
                               where d.tenant_id = h.tenant_id and d.amprahan_id = h.id and d.deleted_at is null
                                 and d.jumlah_diterima < d.jumlah_dikirim)`,
        refusal: {
            _form: 'Masih ada barang dalam perjalanan. Terima barangnya, atau batalkan posting kirimnya, sebelum menutup amprah.',
        },
    },
    cancel: {
        from: 'diajukan',
        to: 'dibatalkan',
        stamp: 'dibatalkan_pada = $1, dibatalkan_oleh_user_id = $2',
        requires: `not exists (select 1 from gd_tr_amprahan_detail d
                               where d.tenant_id = h.tenant_id and d.amprahan_id = h.id and d.deleted_at is null
                                 and d.jumlah_dikirim > 0)`,
        refusal: {
            _form: 'Sebagian barang sudah dikirim, jadi amprah ini tidak bisa dibatalkan. Tutup amprahnya, atau batalkan dulu posting kirimnya.',
        },
    },
} as const;

const statusRefusals: Record<Status, string> = {
    draf: 'Ajukan amprah ini lebih dulu.',
    diajukan: 'Amprah ini sudah diajukan, jadi barisnya tidak bisa diubah.',
    selesai: 'Amprah ini sudah selesai.',
    dibatalkan: 'Amprah ini sudah dibatalkan.',
};

const location = (alias: string) =>
    `json_build_object('id', ${alias}.id, 'code', ${alias}.kode, 'name', ${alias}.nama)`;

const rowSql = `select * from (
                    select h.id, h.nomor as number, h.tanggal::text as posting_date, h.status, h.version,
                           h.keterangan as description, f.kode as from_code, f.nama as from_name, t.kode as to_code,
                           t.nama as to_name, ${location('f')} as from_location, ${location('t')} as to_location,
                           case when x.id is null then null else ${location('x')} end as transit_location,
                           coalesce(f.cara_mutasi, p.cara_mutasi) as transfer_mode,
                           ${isoSql('h.diajukan_pada')} as submitted_at, ${isoSql('h.ditutup_pada')} as closed_at,
                           ${isoSql('h.dibatalkan_pada')} as cancelled_at
                    from gd_tr_amprahan h
                    join gd_m_lokasi f on f.tenant_id = h.tenant_id and f.id = h.lokasi_pemasok_id
                    join gd_m_lokasi t on t.tenant_id = h.tenant_id and t.id = h.lokasi_peminta_id
                    left join gd_m_lokasi x on x.tenant_id = h.tenant_id and x.id = h.lokasi_transit_id
                    join gd_m_parameter p on p.tenant_id = h.tenant_id and p.legal_entity_id = h.legal_entity_id
                    where h.tenant_id = $1 and h.legal_entity_id = $2 and h.deleted_at is null) orders
                where true`;

const storedLineSchema = z.object({
    id: z.string(),
    item_id: z.string(),
    item_code: z.string(),
    conversion: z.string(),
    quantity: z.string(),
    shipped: z.string(),
    received: z.string(),
    to_ship: z.string(),
    to_receive: z.string(),
});

type StoredLine = {
    id: string;
    itemId: string;
    itemCode: string;
    conversion: bigint;
    quantity: bigint;
    shipped: bigint;
    received: bigint;
    toShip: bigint;
    toReceive: bigint;
};

const locationRowSchema = z.object({
    id: z.string(),
    transit: z.boolean(),
});

const claimedSchema = z.object({
    from_location_id: z.string(),
    to_location_id: z.string(),
    transit_location_id: z.string().nullable(),
});

type LineDraft = {
    id: string | null;
    itemId: string;
    unitId: string;
    conversion: bigint;
    quantity: bigint;
};

const messages = {
    from_location_id: 'Pilih lokasi pemasok dari daftar.',
    to_location_id: 'Pilih lokasi peminta dari daftar.',
    transit_location_id: 'Pilih lokasi transit dari daftar.',
    posting_date: 'Isi tanggal yang benar.',
    description: 'Isi keterangan paling banyak 200 karakter.',
    lines: 'Satu amprah paling banyak 500 baris.',
    id: 'Baris ini sudah tidak ada. Muat ulang amprah, lalu ulangi perubahanmu.',
    item_id: 'Pilih barang dari daftar.',
    unit_id: 'Pilih satuan barang ini dari daftar.',
    quantity: 'Isi jumlah lebih dari 0.',
    quantity_to_ship: 'Isi jumlah akan dikirim 0 atau lebih.',
    quantity_to_receive: 'Isi jumlah akan diterima 0 atau lebih.',
};

const quantity = (value: bigint) => display(value, quantityScale);

// Amprah (Transfer Order di BC): lokasi peminta meminta barang, lokasi pemasok mengirimnya sebagian atau seluruhnya,
// dan lokasi peminta menerimanya. Cara mutasi diambil dari setelan lokasi pemasok saat posting kirim: langsung
// memindahkan stok dalam satu posting, kirim-terima lewat lokasi transit dalam dua posting. Setiap posting menjadi
// dokumen terposting sendiri; amprah mencatat jumlah kumulatifnya dan tidak pernah dihapus sesudah diajukan.
export class TransferOrders {
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
        const has = (action: string) =>
            this.workspace.permissions.has(`core.inventory-transfer.${action}`);
        return {
            update: has('update'),
            ship: has('ship'),
            receive: has('receive'),
            reverse: has('reverse'),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('inventory-transfer', 'read');
        const bindings: string[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        const status = z
            .enum(transferOrderStatuses)
            .safeParse(parameters.get('status'));
        const filter = status.success
            ? ` and status = $${bindings.push(status.data)}`
            : '';
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                number: 'number',
                posting_date: 'posting_date',
                status: 'status',
                from_location: 'from_code',
                to_location: 'to_code',
            },
            searchColumns: [
                'number',
                'from_code',
                'from_name',
                'to_code',
                'to_name',
                'description',
            ],
            numericColumns: [],
            defaultSort: 'posting_date',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) => transferOrderRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            permissions: this.permissions(),
        };
    }

    private async header(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  transferOrderRowSchema,
                  `${rowSql} and orders.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async document(id: string) {
        const header = await this.header(id);
        const lines = await this.db.rows(
            transferOrderLineRowSchema,
            `select d.id, d.urutan as line_no,
                    json_build_object('id', b.id, 'code', b.kode, 'name', b.nama, 'base_unit', base.kode) as item,
                    json_build_object('id', u.id, 'code', u.kode, 'name', u.nama) as unit,
                    trim_scale(d.konversi)::text as quantity_per_unit,
                    trim_scale(d.jumlah_diminta)::text as quantity,
                    trim_scale(d.jumlah_dikirim)::text as quantity_shipped,
                    trim_scale(d.jumlah_diterima)::text as quantity_received,
                    trim_scale(d.jumlah_dikirim - d.jumlah_diterima)::text as quantity_in_transit,
                    trim_scale(d.jumlah_diminta - d.jumlah_dikirim)::text as quantity_outstanding,
                    trim_scale(d.jumlah_akan_dikirim)::text as quantity_to_ship,
                    trim_scale(d.jumlah_akan_diterima)::text as quantity_to_receive,
                    coalesce((select trim_scale(sum(k.sisa))::text from gd_tr_kartu_gudang k
                              where k.tenant_id = d.tenant_id and k.barang_id = d.barang_id and k.lokasi_id = $3
                                and k.sisa <> 0), '0') as supplier_stock
             from gd_tr_amprahan_detail d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             join gd_m_satuan base on base.tenant_id = b.tenant_id and base.id = b.satuan_dasar_id
             join gd_m_satuan u on u.tenant_id = d.tenant_id and u.id = d.satuan_id
             where d.tenant_id = $1 and d.amprahan_id = $2 and d.deleted_at is null
             order by d.urutan, d.id`,
            [this.scope.tenantId, header.id, header.from_location.id],
        );
        const postings = await this.db.rows(
            transferPostingSummarySchema,
            `select id, kind, number, posting_date, status from (
                 select id, 'shipment' as kind, nomor as number, tanggal::text as posting_date, status, diposting_pada
                 from gd_tr_mutasi where tenant_id = $1 and amprahan_id = $2
                 union all
                 select id, 'receipt', nomor, tanggal::text, status, diposting_pada
                 from gd_tr_mutasi_terima where tenant_id = $1 and amprahan_id = $2) postings
             order by diposting_pada, id`,
            [this.scope.tenantId, header.id],
        );
        return { ...header, lines, postings };
    }

    async show(id: string) {
        this.workspace.guard('inventory-transfer', 'read');
        return {
            data: await this.document(id),
            permissions: this.permissions(),
        };
    }

    private async activeLocation(id: string | null | undefined) {
        return id && lookupId(id)
            ? await this.db.one(
                  locationRowSchema,
                  `select id, transit from gd_m_lokasi
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
    }

    // Cara mutasi lokasi pemasok, atau legal entity bila lokasi tidak menimpanya.
    private async transferMode(fromLocationId: string) {
        const found = await this.db.one(
            z.object({ mode: z.enum(transferModes) }),
            `select coalesce(l.cara_mutasi, p.cara_mutasi) as mode
             from gd_m_lokasi l
             join gd_m_parameter p on p.tenant_id = l.tenant_id and p.legal_entity_id = l.legal_entity_id
             where l.tenant_id = $1 and l.legal_entity_id = $2 and l.id = $3`,
            [this.scope.tenantId, this.scope.legalEntityId, fromLocationId],
        );
        if (!found) throw new Error(`Location ${fromLocationId} has no mode.`);
        return found.mode;
    }

    // Lokasi transit bawaan: satu-satunya lokasi transit di legal entity ini, bila memang hanya ada satu.
    private async onlyTransit() {
        const found = await this.db.rows(
            z.object({ id: z.string() }),
            `select id from gd_m_lokasi
             where tenant_id = $1 and legal_entity_id = $2 and transit and deleted_at is null
             limit 2`,
            [this.scope.tenantId, this.scope.legalEntityId],
        );
        return found.length === 1 && found[0] ? found[0].id : null;
    }

    private async checked(body: unknown) {
        const data = parseInput(transferOrderInputSchema, body, messages);
        const errors: Record<string, string> = {};
        if (!dateSchema.safeParse(data.posting_date).success)
            errors.posting_date = messages.posting_date;
        const from = await this.activeLocation(data.from_location_id);
        const to = await this.activeLocation(data.to_location_id);
        const transitText =
            'Pilih lokasi yang bukan lokasi transit. Lokasi transit hanya dipakai untuk barang dalam perjalanan.';
        if (!from) errors.from_location_id = messages.from_location_id;
        else if (from.transit) errors.from_location_id = transitText;
        if (!to) errors.to_location_id = messages.to_location_id;
        else if (to.transit) errors.to_location_id = transitText;
        else if (to.id === from?.id)
            errors.to_location_id =
                'Lokasi peminta harus berbeda dengan lokasi pemasok.';
        let transitId = data.transit_location_id || null;
        if (transitId !== null) {
            const transit = await this.activeLocation(transitId);
            if (!transit?.transit)
                errors.transit_location_id = messages.transit_location_id;
        }
        const description = data.description?.trim() || null;
        if (description && description.length > 200)
            errors.description = messages.description;
        const lines: LineDraft[] = [];
        for (const [index, line] of data.lines.entries()) {
            const fail = (name: string, message: string) => {
                errors[`lines.${index}.${name}`] = message;
            };
            if (
                !(await exists(
                    this.db,
                    'gd_m_barang',
                    this.scope,
                    line.item_id,
                ))
            )
                fail('item_id', messages.item_id);
            const conversion = await unitConversion(
                this.db,
                this.scope,
                line.item_id,
                line.unit_id,
            );
            if (conversion === null) fail('unit_id', messages.unit_id);
            const requested = decimalInput(line.quantity);
            if (requested === null || requested <= 0n)
                fail(
                    'quantity',
                    'Isi jumlah lebih dari 0, paling banyak empat angka di belakang koma.',
                );
            else if (
                conversion !== null &&
                baseQuantity(requested, conversion) === null
            )
                fail(
                    'quantity',
                    'Jumlah ini dalam satuan dasar punya lebih dari empat angka di belakang koma atau terlalu besar. Ubah jumlah atau satuannya.',
                );
            lines.push({
                id: line.id ?? null,
                itemId: line.item_id,
                unitId: line.unit_id,
                conversion: conversion ?? one,
                quantity: requested ?? 0n,
            });
        }
        if (Object.keys(errors).length || !from || !to) validation(errors);
        if (
            transitId === null &&
            (await this.transferMode(from.id)) === 'kirim_terima'
        )
            transitId = await this.onlyTransit();
        return {
            fromId: from.id,
            toId: to.id,
            transitId,
            postingDate: data.posting_date,
            description,
            lines,
        };
    }

    private async saveLines(documentId: string, lines: LineDraft[]) {
        const existing = new Set(
            (
                await this.db.rows(
                    z.object({ id: z.string() }),
                    `select id from gd_tr_amprahan_detail
                     where tenant_id = $1 and amprahan_id = $2 and deleted_at is null`,
                    [this.scope.tenantId, documentId],
                )
            ).map((line) => line.id),
        );
        const kept = new Set<string>();
        const stamp = nowSql();
        for (const [index, line] of lines.entries()) {
            const values = {
                urutan: index + 1,
                barang_id: line.itemId,
                satuan_id: line.unitId,
                konversi: toNumeric(line.conversion, quantityScale),
                jumlah_diminta: toNumeric(line.quantity, quantityScale),
            };
            if (line.id === null) {
                await this.db.insert('gd_tr_amprahan_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    amprahan_id: documentId,
                    ...values,
                    created_at: stamp,
                    updated_at: stamp,
                });
                continue;
            }
            if (!existing.has(line.id) || kept.has(line.id))
                validation({ [`lines.${index}.id`]: messages.id });
            kept.add(line.id);
            await this.db.execute(
                `update gd_tr_amprahan_detail set urutan = $1, barang_id = $2, satuan_id = $3, konversi = $4,
                        jumlah_diminta = $5, updated_at = $6
                 where tenant_id = $7 and id = $8`,
                [
                    values.urutan,
                    values.barang_id,
                    values.satuan_id,
                    values.konversi,
                    values.jumlah_diminta,
                    stamp,
                    this.scope.tenantId,
                    line.id,
                ],
            );
        }
        for (const id of existing)
            if (!kept.has(id))
                await this.db.execute(
                    'update gd_tr_amprahan_detail set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3',
                    [stamp, this.scope.tenantId, id],
                );
    }

    async create(body: unknown) {
        this.workspace.guard('inventory-transfer', 'update');
        const data = await this.checked(body);
        const id = Bun.randomUUIDv7();
        await this.db.transaction(async () => {
            const number = await this.issue(
                transferNumberReferences.order,
                `amprahan:${id}`,
                data.postingDate,
            );
            const stamp = nowSql();
            await this.db.insert('gd_tr_amprahan', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                nomor: number,
                tanggal: data.postingDate,
                lokasi_peminta_id: data.toId,
                lokasi_pemasok_id: data.fromId,
                lokasi_transit_id: data.transitId,
                keterangan: data.description,
                created_at: stamp,
                updated_at: stamp,
            });
            await this.saveLines(id, data.lines);
        });
        return {
            status: 201,
            headers: {},
            body: { data: await this.document(id) },
        };
    }

    private issue(reference: string, key: string, documentDate: string) {
        return new NumberIssuer(this.db, {
            tenantId: this.scope.tenantId,
            moduleId: 'core',
        }).issue({
            reference,
            key,
            documentDate,
            legalEntityId: this.scope.legalEntityId,
        });
    }

    // Kepala dikunci lebih dulu, supaya dua penyimpanan bersamaan tidak menyatukan dua set baris.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-transfer', 'update');
        const current = await this.header(id);
        const data = await this.checked(body);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const locked = await this.lockHeader(current.id);
            if (locked.status !== 'draf')
                validation({ _form: statusRefusals[locked.status] });
            if (locked.version !== version)
                coded(409, 'stale_version', staleMessage);
            await this.db.execute(
                `update gd_tr_amprahan set lokasi_peminta_id = $1, lokasi_pemasok_id = $2, lokasi_transit_id = $3,
                        tanggal = $4, keterangan = $5, updated_at = $6
                 where tenant_id = $7 and id = $8`,
                [
                    data.toId,
                    data.fromId,
                    data.transitId,
                    data.postingDate,
                    data.description,
                    nowSql(),
                    this.scope.tenantId,
                    current.id,
                ],
            );
            await this.saveLines(current.id, data.lines);
        });
        return this.reply(current.id);
    }

    private async reply(id: string) {
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(id) },
        };
    }

    private async lockHeader(id: string) {
        const locked = await this.db.one(
            z.object({
                status: z.enum(transferOrderStatuses),
                version: z.number(),
            }),
            `select status, version from gd_tr_amprahan
             where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null for update`,
            [this.scope.tenantId, this.scope.legalEntityId, id],
        );
        if (!locked) abort(404, 'Not Found');
        return locked;
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-transfer', 'update');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const locked = await this.lockHeader(current.id);
            if (locked.status !== 'draf')
                validation({
                    _form: 'Amprah yang sudah diajukan tidak bisa dihapus. Batalkan atau tutup amprahnya.',
                });
            if (locked.version !== version)
                coded(409, 'stale_version', staleMessage);
            const stamp = nowSql();
            await this.db.execute(
                'update gd_tr_amprahan set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3',
                [stamp, this.scope.tenantId, current.id],
            );
            await this.db.execute(
                `update gd_tr_amprahan_detail set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and amprahan_id = $3 and deleted_at is null`,
                [stamp, this.scope.tenantId, current.id],
            );
        });
        return { status: 204, headers: {}, body: undefined };
    }

    // Status berpindah dengan compare-and-set yang sekaligus memeriksa syarat barisnya. Permintaan yang diulang setelah
    // amprah sampai di status tujuan tidak menulis apa pun.
    private async move(
        id: string,
        version: number,
        name: keyof typeof moves,
    ): Promise<boolean> {
        const { from, to, stamp, requires, refusal } = moves[name];
        const claimed = await this.db.one(
            z.object({ id: z.string() }),
            `update gd_tr_amprahan h set status = $3, ${stamp}, updated_at = $1
             where h.tenant_id = $4 and h.legal_entity_id = $5 and h.id = $6 and h.status = $7 and h.version = $8
               and h.deleted_at is null and ${requires}
             returning h.id`,
            [
                nowSql(),
                this.workspace.userId,
                to,
                this.scope.tenantId,
                this.scope.legalEntityId,
                id,
                from,
                version,
            ],
        );
        if (claimed) return true;
        const current = await this.lockHeader(id);
        if (current.status === to) return false;
        if (current.status !== from)
            validation({ _form: statusRefusals[current.status] });
        if (current.version !== version)
            coded(409, 'stale_version', staleMessage);
        return validation(refusal);
    }

    private async transition(
        request: Request,
        id: string,
        body: unknown,
        name: keyof typeof moves,
    ) {
        this.workspace.guard('inventory-transfer', 'update');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            if (!(await this.move(current.id, version, name))) return;
            if (name === 'submit')
                await resetQuantitiesToHandle(
                    this.db,
                    this.scope.tenantId,
                    current.id,
                );
        });
        return this.reply(current.id);
    }

    submit(request: Request, id: string, body: unknown) {
        return this.transition(request, id, body, 'submit');
    }

    close(request: Request, id: string, body: unknown) {
        return this.transition(request, id, body, 'close');
    }

    cancel(request: Request, id: string, body: unknown) {
        return this.transition(request, id, body, 'cancel');
    }

    private async storedLines(id: string): Promise<StoredLine[]> {
        const rows = await this.db.rows(
            storedLineSchema,
            `select d.id, d.barang_id as item_id, b.kode as item_code, d.konversi::text as conversion,
                    d.jumlah_diminta::text as quantity, d.jumlah_dikirim::text as shipped,
                    d.jumlah_diterima::text as received, d.jumlah_akan_dikirim::text as to_ship,
                    d.jumlah_akan_diterima::text as to_receive
             from gd_tr_amprahan_detail d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             where d.tenant_id = $1 and d.amprahan_id = $2 and d.deleted_at is null
             order by d.urutan, d.id`,
            [this.scope.tenantId, id],
        );
        const scaled = (text: string) => fromNumeric(text, quantityScale);
        return rows.map((row) => ({
            id: row.id,
            itemId: row.item_id,
            itemCode: row.item_code,
            conversion: scaled(row.conversion),
            quantity: scaled(row.quantity),
            shipped: scaled(row.shipped),
            received: scaled(row.received),
            toShip: scaled(row.to_ship),
            toReceive: scaled(row.to_receive),
        }));
    }

    // Jumlah yang akan dikirim dan diterima pada posting berikutnya, seperti Qty. to Ship dan Qty. to Receive di baris
    // Transfer Order BC. Mengisi jumlah akan dikirim butuh hak posting kirim, jumlah akan diterima hak posting terima.
    async quantities(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-transfer', 'read');
        const current = await this.header(id);
        const data = parseInput(transferQuantitiesInputSchema, body, messages);
        const allowed = this.permissions();
        if (
            data.lines.some(
                (line) =>
                    (line.quantity_to_ship !== undefined && !allowed.ship) ||
                    (line.quantity_to_receive !== undefined &&
                        !allowed.receive),
            )
        )
            abort(403, 'Tidak diizinkan.');
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const locked = await this.lockHeader(current.id);
            if (locked.status !== 'diajukan')
                validation({ _form: statusRefusals[locked.status] });
            if (locked.version !== version)
                coded(409, 'stale_version', staleMessage);
            const stored = await this.storedLines(current.id);
            const errors: Record<string, string> = {};
            const changes: { id: string; toShip: bigint; toReceive: bigint }[] =
                [];
            for (const [index, input] of data.lines.entries()) {
                const line = stored.find((entry) => entry.id === input.id);
                if (!line) {
                    errors[`lines.${index}.id`] = messages.id;
                    continue;
                }
                const position = stored.indexOf(line);
                const toShip = this.handled(
                    errors,
                    `lines.${position}.quantity_to_ship`,
                    input.quantity_to_ship,
                    line.toShip,
                    line.quantity - line.shipped,
                    line.conversion,
                    'sisa yang belum dikirim',
                );
                const toReceive = this.handled(
                    errors,
                    `lines.${position}.quantity_to_receive`,
                    input.quantity_to_receive,
                    line.toReceive,
                    line.shipped - line.received,
                    line.conversion,
                    'barang dalam perjalanan',
                );
                changes.push({ id: line.id, toShip, toReceive });
            }
            if (Object.keys(errors).length) validation(errors);
            const stamp = nowSql();
            for (const change of changes)
                await this.db.execute(
                    `update gd_tr_amprahan_detail set jumlah_akan_dikirim = $1, jumlah_akan_diterima = $2,
                            updated_at = $3
                     where tenant_id = $4 and id = $5`,
                    [
                        toNumeric(change.toShip, quantityScale),
                        toNumeric(change.toReceive, quantityScale),
                        stamp,
                        this.scope.tenantId,
                        change.id,
                    ],
                );
            await this.touch(current.id);
        });
        return this.reply(current.id);
    }

    private handled(
        errors: Record<string, string>,
        field: string,
        raw: string | number | undefined,
        stored: bigint,
        limit: bigint,
        conversion: bigint,
        limitLabel: string,
    ): bigint {
        if (raw === undefined) return stored;
        const value = raw === '' ? 0n : decimalInput(raw);
        if (value === null || value < 0n)
            errors[field] =
                'Isi jumlah 0 atau lebih, paling banyak empat angka di belakang koma.';
        else if (value > limit)
            errors[field] =
                `Paling banyak ${quantity(limit)}, yaitu ${limitLabel}.`;
        else if (baseQuantity(value, conversion) === null)
            errors[field] =
                'Jumlah ini dalam satuan dasar punya lebih dari empat angka di belakang koma. Ubah jumlahnya.';
        return value ?? 0n;
    }

    private async touch(id: string) {
        await this.db.execute(
            'update gd_tr_amprahan set updated_at = $1 where tenant_id = $2 and id = $3',
            [nowSql(), this.scope.tenantId, id],
        );
    }

    // Posting kirim dan terima tidak memindahkan status, jadi versi amprah yang dikirim pemanggil menjadi kuncinya:
    // compare-and-set menaikkan versi, dan dokumen terposting mencatat versi asalnya. Permintaan yang diulang dengan
    // versi yang sama menemukan dokumen itu dan tidak menulis apa pun.
    private async claim(
        id: string,
        version: number,
        postings: 'gd_tr_mutasi' | 'gd_tr_mutasi_terima',
    ) {
        const claimed = await this.db.one(
            claimedSchema,
            `update gd_tr_amprahan set updated_at = $1
             where tenant_id = $2 and legal_entity_id = $3 and id = $4 and status = 'diajukan' and version = $5
               and deleted_at is null
             returning lokasi_pemasok_id as from_location_id, lokasi_peminta_id as to_location_id,
                       lokasi_transit_id as transit_location_id`,
            [
                nowSql(),
                this.scope.tenantId,
                this.scope.legalEntityId,
                id,
                version,
            ],
        );
        if (claimed) return claimed;
        const posted = await this.db.one(
            z.object({ id: z.string() }),
            `select id from ${postings} where tenant_id = $1 and amprahan_id = $2 and versi_amprahan = $3`,
            [this.scope.tenantId, id, version],
        );
        if (posted) return null;
        const current = await this.lockHeader(id);
        if (current.status !== 'diajukan')
            validation({ _form: statusRefusals[current.status] });
        return coded(409, 'stale_version', staleMessage);
    }

    private postingDate(body: unknown) {
        const data = parseInput(transferPostingInputSchema, body, messages);
        if (!dateSchema.safeParse(data.posting_date).success)
            validation({ posting_date: messages.posting_date });
        return data.posting_date;
    }

    private async requireLocations(claimed: z.infer<typeof claimedSchema>) {
        const errors: Record<string, string> = {};
        if (!(await this.activeLocation(claimed.from_location_id)))
            errors.from_location_id =
                'Lokasi pemasok sudah dihapus. Batalkan amprah ini dan buat amprah baru.';
        if (!(await this.activeLocation(claimed.to_location_id)))
            errors.to_location_id =
                'Lokasi peminta sudah dihapus. Batalkan amprah ini dan buat amprah baru.';
        if (Object.keys(errors).length) validation(errors);
    }

    private baseOf(line: StoredLine, value: bigint) {
        const base = baseQuantity(value, line.conversion);
        if (base === null)
            throw new Error(`Transfer line ${line.id} has no exact base.`);
        return base;
    }

    async ship(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-transfer', 'ship');
        const current = await this.header(id);
        const postingDate = this.postingDate(body);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const claimed = await this.claim(
                current.id,
                version,
                'gd_tr_mutasi',
            );
            if (!claimed) return;
            await this.requireLocations(claimed);
            const stored = await this.storedLines(current.id);
            const errors: Record<string, string> = {};
            for (const [index, line] of stored.entries())
                if (line.toShip > line.quantity - line.shipped)
                    errors[`lines.${index}.quantity_to_ship`] =
                        `Paling banyak ${quantity(line.quantity - line.shipped)}, yaitu sisa yang belum dikirim.`;
            if (!stored.some((line) => line.toShip > 0n))
                errors.lines =
                    'Isi jumlah akan dikirim pada sedikitnya satu baris.';
            if (Object.keys(errors).length) validation(errors);
            const mode = await this.transferMode(claimed.from_location_id);
            let transitId: string | null = null;
            if (mode === 'kirim_terima') {
                transitId =
                    claimed.transit_location_id ?? (await this.onlyTransit());
                const transit = await this.activeLocation(transitId);
                if (!transitId || !transit?.transit)
                    validation({
                        transit_location_id:
                            'Pilih lokasi transit. Lokasi pemasok mengirim barang lewat lokasi transit.',
                    });
                if (claimed.transit_location_id === null)
                    await this.db.execute(
                        'update gd_tr_amprahan set lokasi_transit_id = $1 where tenant_id = $2 and id = $3',
                        [transitId, this.scope.tenantId, current.id],
                    );
            }
            const shipmentId = Bun.randomUUIDv7();
            const number = await this.issue(
                transferNumberReferences.shipment,
                `${shipmentSource}:${shipmentId}`,
                postingDate,
            );
            await this.db.insert('gd_tr_mutasi', {
                id: shipmentId,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                amprahan_id: current.id,
                versi_amprahan: version,
                nomor: number,
                tanggal: postingDate,
                lokasi_asal_id: claimed.from_location_id,
                lokasi_tujuan_id: claimed.to_location_id,
                lokasi_transit_id: transitId,
                cara_mutasi: mode,
                diposting_pada: nowSql(),
                diposting_oleh_user_id: this.workspace.userId,
                created_at: nowSql(),
                updated_at: nowSql(),
            });
            const shipping = stored.flatMap((line, index) =>
                line.toShip > 0n ? [{ line, index }] : [],
            );
            await postItemLines(
                this.db,
                {
                    ...this.scope,
                    userId: this.workspace.userId,
                    postingDate,
                    source: { type: shipmentSource, id: shipmentId, number },
                },
                shipping.map(({ line, index }): TransferLine => ({
                    kind: 'transfer',
                    key: `${shipmentSource}:${shipmentId}:${line.id}`,
                    field: `lines.${index}`,
                    sourceLineId: line.id,
                    itemId: line.itemId,
                    quantity: this.baseOf(line, line.toShip),
                    fromLocationId: claimed.from_location_id,
                    toLocationId: transitId ?? claimed.to_location_id,
                    batchId: null,
                })),
            );
            await this.recordTaken(
                'gd_tr_mutasi_detail',
                'mutasi_id',
                shipmentSource,
                shipmentId,
                claimed.from_location_id,
            );
            const stamp = nowSql();
            for (const { line } of shipping)
                await this.db.execute(
                    `update gd_tr_amprahan_detail
                     set jumlah_dikirim = jumlah_dikirim + $1, jumlah_diterima = jumlah_diterima + $2, updated_at = $3
                     where tenant_id = $4 and id = $5`,
                    [
                        toNumeric(line.toShip, quantityScale),
                        toNumeric(
                            mode === 'langsung' ? line.toShip : 0n,
                            quantityScale,
                        ),
                        stamp,
                        this.scope.tenantId,
                        line.id,
                    ],
                );
            await this.settle(current.id);
        });
        return this.reply(current.id);
    }

    async receive(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-transfer', 'receive');
        const current = await this.header(id);
        const postingDate = this.postingDate(body);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const claimed = await this.claim(
                current.id,
                version,
                'gd_tr_mutasi_terima',
            );
            if (!claimed) return;
            await this.requireLocations(claimed);
            const stored = await this.storedLines(current.id);
            const errors: Record<string, string> = {};
            for (const [index, line] of stored.entries())
                if (line.toReceive > line.shipped - line.received)
                    errors[`lines.${index}.quantity_to_receive`] =
                        `Paling banyak ${quantity(line.shipped - line.received)}, yaitu barang dalam perjalanan.`;
            if (!stored.some((line) => line.toReceive > 0n))
                errors.lines =
                    'Isi jumlah akan diterima pada sedikitnya satu baris.';
            const transitId = claimed.transit_location_id;
            if (transitId === null)
                errors._form =
                    'Belum ada barang dalam perjalanan untuk amprah ini.';
            if (Object.keys(errors).length || transitId === null)
                validation(errors);
            const receiving = stored.flatMap((line, index) =>
                line.toReceive > 0n ? [{ line, index }] : [],
            );
            const receiptId = Bun.randomUUIDv7();
            const number = await this.issue(
                transferNumberReferences.receipt,
                `${receiptSource}:${receiptId}`,
                postingDate,
            );
            await this.db.insert('gd_tr_mutasi_terima', {
                id: receiptId,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                amprahan_id: current.id,
                versi_amprahan: version,
                nomor: number,
                tanggal: postingDate,
                lokasi_transit_id: transitId,
                lokasi_tujuan_id: claimed.to_location_id,
                diposting_pada: nowSql(),
                diposting_oleh_user_id: this.workspace.userId,
                created_at: nowSql(),
                updated_at: nowSql(),
            });
            const lines: TransferLine[] = [];
            for (const { line, index } of receiving)
                lines.push({
                    kind: 'transfer',
                    key: `${receiptSource}:${receiptId}:${line.id}`,
                    field: `lines.${index}`,
                    sourceLineId: line.id,
                    itemId: line.itemId,
                    quantity: this.baseOf(line, line.toReceive),
                    fromLocationId: transitId,
                    toLocationId: claimed.to_location_id,
                    batchId: null,
                    appliesTo: await this.inTransit(line.id, transitId),
                });
            await postItemLines(
                this.db,
                {
                    ...this.scope,
                    userId: this.workspace.userId,
                    postingDate,
                    source: { type: receiptSource, id: receiptId, number },
                },
                lines,
            );
            await this.recordTaken(
                'gd_tr_mutasi_terima_detail',
                'mutasi_terima_id',
                receiptSource,
                receiptId,
                transitId,
            );
            const stamp = nowSql();
            for (const { line } of receiving)
                await this.db.execute(
                    `update gd_tr_amprahan_detail set jumlah_diterima = jumlah_diterima + $1, updated_at = $2
                     where tenant_id = $3 and id = $4`,
                    [
                        toNumeric(line.toReceive, quantityScale),
                        stamp,
                        this.scope.tenantId,
                        line.id,
                    ],
                );
            await this.settle(current.id);
        });
        return this.reply(current.id);
    }

    // Stok satu baris amprah yang masih di lokasi transit: baris masuk yang ditulis posting kirimnya, atau pembatalan
    // penerimaannya, untuk baris amprah ini saja.
    private async inTransit(lineId: string, transitId: string) {
        return (
            await this.db.rows(
                z.object({ id: z.string() }),
                `select id from gd_tr_kartu_gudang
                 where tenant_id = $1 and sumber_baris_id = $2 and lokasi_id = $3 and jumlah > 0 and sisa > 0`,
                [this.scope.tenantId, lineId, transitId],
            )
        ).map((entry) => entry.id);
    }

    // Baris dokumen terposting dari baris keluar yang ditulis mesin di lokasi asal: satu per baris amprah, batch, dan
    // sumber dana yang diambil.
    private async recordTaken(
        table: 'gd_tr_mutasi_detail' | 'gd_tr_mutasi_terima_detail',
        parent: 'mutasi_id' | 'mutasi_terima_id',
        sourceType: string,
        sourceId: string,
        fromLocationId: string,
    ) {
        const taken = await this.db.rows(
            z.object({
                line_id: z.string(),
                item_id: z.string(),
                unit_id: z.string(),
                conversion: z.string(),
                quantity: z.string(),
                batch_id: z.string().nullable(),
                expiry: z.string().nullable(),
                funding_source_id: z.string().nullable(),
                program_id: z.string().nullable(),
                budget_year: z.number().nullable(),
                amount: z.string(),
            }),
            `select k.sumber_baris_id as line_id, k.barang_id as item_id, d.satuan_id as unit_id,
                    d.konversi::text as conversion, (-k.jumlah)::text as quantity, k.batch_id,
                    k.kedaluwarsa::text as expiry, k.sumber_dana_id as funding_source_id,
                    k.program_pengadaan_id as program_id, k.tahun_anggaran as budget_year, (-k.nilai)::text as amount
             from gd_tr_kartu_gudang k
             join gd_tr_amprahan_detail d on d.tenant_id = k.tenant_id and d.id = k.sumber_baris_id
             where k.tenant_id = $1 and k.sumber_jenis = $2 and k.sumber_id = $3 and k.lokasi_id = $4 and k.jumlah < 0
             order by d.urutan, k.id`,
            [this.scope.tenantId, sourceType, sourceId, fromLocationId],
        );
        const stamp = nowSql();
        for (const [index, entry] of taken.entries())
            await this.db.insert(table, {
                id: Bun.randomUUIDv7(),
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                [parent]: sourceId,
                amprahan_detail_id: entry.line_id,
                urutan: index + 1,
                barang_id: entry.item_id,
                satuan_id: entry.unit_id,
                konversi: entry.conversion,
                jumlah_dasar: entry.quantity,
                batch_id: entry.batch_id,
                kedaluwarsa: entry.expiry,
                sumber_dana_id: entry.funding_source_id,
                program_pengadaan_id: entry.program_id,
                tahun_anggaran: entry.budget_year,
                nilai: entry.amount,
                created_at: stamp,
                created_by_user_id: this.workspace.userId,
            });
    }

    // Sesudah posting: jumlah akan dikirim dan diterima kembali ke sisanya, dan amprah yang sudah dikirim dan diterima
    // seluruhnya selesai dengan sendirinya.
    private async settle(id: string) {
        await resetQuantitiesToHandle(this.db, this.scope.tenantId, id);
        const stamp = nowSql();
        await this.db.execute(
            `update gd_tr_amprahan h set status = 'selesai', ditutup_pada = $1, ditutup_oleh_user_id = $2,
                    updated_at = $1
             where h.tenant_id = $3 and h.id = $4 and h.status = 'diajukan'
               and not exists (select 1 from gd_tr_amprahan_detail d
                               where d.tenant_id = h.tenant_id and d.amprahan_id = h.id and d.deleted_at is null
                                 and (d.jumlah_dikirim < d.jumlah_diminta or d.jumlah_diterima < d.jumlah_dikirim))`,
            [stamp, this.workspace.userId, this.scope.tenantId, id],
        );
    }
}
