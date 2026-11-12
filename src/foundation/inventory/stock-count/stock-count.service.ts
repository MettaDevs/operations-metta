import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import {
    isoSql,
    nowSql,
    type Bind,
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
    lockItemLocations,
    postItemLines,
    reverseItemEntries,
    type ItemLine,
} from '../item-ledger/item-ledger.posting.ts';
import {
    baseQuantity,
    decimalInput,
    display,
    quantityScale,
} from '../quantity.ts';
import {
    placeholders,
    positionKey,
    quantityOf,
    quantityText,
    sourceType,
    StockCountLedger,
    underLineNames,
    unique,
    type StoredLine,
} from './stock-count.posting.ts';
import {
    stockCountCalculationSchema,
    stockCountInputSchema,
    stockCountLineRowSchema,
    stockCountMaxLines,
    stockCountPositionSchema,
    stockCountPostingInputSchema,
    stockCountRowSchema,
    stockCountStatuses,
} from './stock-count.schema.ts';

const numberReference = 'core.inventory-count-number';

type Status = (typeof stockCountStatuses)[number];
type MoveName = 'finish' | 'reopen' | 'post' | 'reverse' | 'cancel';

// Perpindahan status yang sah, beserta kolom yang mencatat kapan dan oleh siapa. Buka lagi mengosongkan catatan selesai
// hitung; opname yang dibatalkan, diposting atau belum, tidak kembali ke status lain.
const moves: Record<
    MoveName,
    {
        from: readonly Status[];
        to: Status;
        at: string;
        by: string;
        clear: boolean;
    }
> = {
    finish: {
        from: ['draf'],
        to: 'dihitung',
        at: 'selesai_hitung_pada',
        by: 'selesai_hitung_oleh_user_id',
        clear: false,
    },
    reopen: {
        from: ['dihitung'],
        to: 'draf',
        at: 'selesai_hitung_pada',
        by: 'selesai_hitung_oleh_user_id',
        clear: true,
    },
    post: {
        from: ['dihitung'],
        to: 'diposting',
        at: 'diposting_pada',
        by: 'diposting_oleh_user_id',
        clear: false,
    },
    reverse: {
        from: ['diposting'],
        to: 'dibatalkan',
        at: 'dibatalkan_pada',
        by: 'dibatalkan_oleh_user_id',
        clear: false,
    },
    cancel: {
        from: ['draf', 'dihitung'],
        to: 'dibatalkan',
        at: 'dibatalkan_pada',
        by: 'dibatalkan_oleh_user_id',
        clear: false,
    },
};

function refusal(action: MoveName | 'edit', status: Status): string {
    switch (status) {
        case 'draf':
            return action === 'reverse'
                ? 'Opname ini belum diposting.'
                : 'Selesaikan hitungan opname ini lebih dulu.';
        case 'dihitung':
            return action === 'reverse'
                ? 'Opname ini belum diposting.'
                : 'Hitungan opname ini sudah selesai. Pilih Buka lagi untuk mengubahnya.';
        case 'diposting':
            return 'Opname ini sudah diposting.';
        case 'dibatalkan':
            return 'Opname ini sudah dibatalkan.';
        default: {
            const unknown: never = status;
            throw new Error(`Unknown status: ${String(unknown)}`);
        }
    }
}

const transitMessage =
    'Pilih lokasi yang bukan lokasi transit. Lokasi transit hanya dipakai untuk barang dalam perjalanan.';

const messages = {
    location_id: 'Pilih lokasi dari daftar.',
    count_date: 'Isi tanggal hitung yang benar.',
    posting_date: 'Isi tanggal posting yang benar.',
    description: 'Isi keterangan paling banyak 200 karakter.',
    lines: `Satu opname paling banyak ${stockCountMaxLines} baris.`,
    id: 'Baris ini sudah tidak ada. Muat ulang opname, lalu ulangi perubahanmu.',
    item_id: 'Pilih barang dari daftar.',
    unit_id: 'Pilih satuan barang ini dari daftar.',
    batch_id: 'Pilih batch dari daftar.',
    batch_number: 'Isi nomor batch yang benar.',
    expiry_date: 'Isi tanggal kedaluwarsa yang benar.',
    quantity_counted:
        'Isi jumlah dihitung 0 atau lebih, paling banyak empat angka di belakang koma.',
    item_ids: 'Pilih barang dari daftar.',
    category_id: 'Pilih kategori dari daftar.',
    only_in_stock: 'Pilih ya atau tidak.',
};

const rowSql = `select * from (
                    select h.id, h.nomor as number, h.tanggal::text as count_date,
                           h.tanggal_posting::text as posting_date, h.status, h.version, h.keterangan as description,
                           l.kode as location_code, l.nama as location_name,
                           json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
                           (select count(*)::int from gd_tr_opname_detail d
                            where d.tenant_id = h.tenant_id and d.opname_id = h.id and d.deleted_at is null) as line_count,
                           ${isoSql('h.mulai_hitung_pada')} as count_started_at,
                           ${isoSql('h.selesai_hitung_pada')} as counted_at,
                           ${isoSql('h.diposting_pada')} as posted_at, ${isoSql('h.dibatalkan_pada')} as cancelled_at
                    from gd_tr_opname h
                    join gd_m_lokasi l on l.tenant_id = h.tenant_id and l.id = h.lokasi_id
                    where h.tenant_id = $1 and h.legal_entity_id = $2) counts
                where true`;

const itemJson = (alias: string, profile: string) =>
    `json_build_object('id', ${alias}.id, 'code', ${alias}.kode, 'name', ${alias}.nama, 'base_unit', base.kode,
                       'batch_required', coalesce(${profile}.wajib_batch, false),
                       'expiry_required', coalesce(${profile}.wajib_kedaluwarsa, false))`;
const batchJson = `case when t.id is null then null else json_build_object(
                       'id', t.id, 'batch_number', t.no_batch, 'expiry_date', t.kedaluwarsa) end`;

const headerFactsSchema = z.object({
    status: z.enum(stockCountStatuses),
    version: z.number(),
    location_id: z.string(),
    started_at: z.string().nullable(),
});
type HeaderFacts = z.infer<typeof headerFactsSchema>;

const storedLineSchema = z.object({
    id: z.string(),
    item_id: z.string(),
    batch_id: z.string().nullable(),
    known_batch_number: z.string().nullable(),
    new_batch_number: z.string().nullable(),
    expiry: z.string().nullable(),
    counted: z.string().nullable(),
    batch_required: z.boolean(),
    expiry_required: z.boolean(),
});
type LineDraft = {
    id: string | null;
    itemId: string;
    batchId: string | null;
    batchNumber: string | null;
    expiry: string | null;
    unitId: string;
    conversion: bigint;
    counted: bigint | null;
    description: string | null;
};

// Opname stok (Physical Inventory Order di BC). Baris lahir dari Hitung baris atau ditambah tangan, lalu jumlah dihitung
// diisi. Stok tidak dibekukan: saat posting, jumlah tercatat dihitung ulang sampai tanggal posting di bawah kunci mesin
// posting, dan selisih hitung − tercatat ditulis sebagai penyesuaian pada batch yang tepat. Barang yang bergerak sesudah
// hitung dimulai ditandai, bukan ditolak.
export class StockCounts {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get ledger() {
        return new StockCountLedger(this.db, this.scope);
    }

    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    private permissions() {
        const has = (action: string) =>
            this.workspace.permissions.has(`core.inventory-count.${action}`);
        return {
            update: has('update'),
            post: has('post'),
            reverse: has('reverse'),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('inventory-count', 'read');
        const bindings: Bind[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        const status = z
            .enum(stockCountStatuses)
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
                count_date: 'count_date',
                posting_date: 'posting_date',
                status: 'status',
                location: 'location_code',
            },
            searchColumns: [
                'number',
                'location_code',
                'location_name',
                'description',
            ],
            numericColumns: [],
            defaultSort: 'count_date',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) => stockCountRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            permissions: this.permissions(),
        };
    }

    private async header(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  stockCountRowSchema,
                  `${rowSql} and counts.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async document(id: string) {
        const header = await this.header(id);
        const lines = await this.db.rows(
            stockCountLineRowSchema,
            `select d.id, d.urutan as line_no, ${itemJson('b', 'p')} as item, ${batchJson} as batch,
                    d.no_batch as batch_number, d.kedaluwarsa::text as expiry_date,
                    json_build_object('id', u.id, 'code', u.kode, 'name', u.nama) as unit,
                    trim_scale(d.konversi)::text as quantity_per_unit,
                    trim_scale(d.jumlah_tercatat)::text as quantity_expected,
                    trim_scale(round(d.jumlah_dihitung / d.konversi, 4))::text as quantity_counted,
                    trim_scale(d.jumlah_dihitung)::text as quantity_counted_base,
                    trim_scale(d.jumlah_tercatat_posting)::text as quantity_expected_at_posting,
                    d.bergerak_setelah_mulai as moved_after_count_started, d.keterangan as description
             from gd_tr_opname_detail d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             join gd_m_satuan base on base.tenant_id = b.tenant_id and base.id = b.satuan_dasar_id
             join gd_m_satuan u on u.tenant_id = d.tenant_id and u.id = d.satuan_id
             left join gd_m_profil_pelacakan p on p.tenant_id = b.tenant_id and p.id = b.profil_pelacakan_id
             left join gd_m_batch t on t.tenant_id = d.tenant_id and t.id = d.batch_id
             where d.tenant_id = $1 and d.opname_id = $2 and d.deleted_at is null
             order by d.urutan, d.id`,
            [this.scope.tenantId, header.id],
        );
        return { ...header, lines };
    }

    async show(id: string) {
        this.workspace.guard('inventory-count', 'read');
        return {
            data: await this.document(id),
            permissions: this.permissions(),
        };
    }

    private async reply(id: string, status = 200) {
        return { status, headers: {}, body: { data: await this.document(id) } };
    }

    private async activeLocation(id: string) {
        return lookupId(id)
            ? await this.db.one(
                  z.object({
                      id: z.string(),
                      operating_unit_id: z.string(),
                      transit: z.boolean(),
                  }),
                  `select id, operating_unit_id, transit from gd_m_lokasi
                   where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
    }

    private async checked(body: unknown) {
        const data = parseInput(stockCountInputSchema, body, messages);
        const errors: Record<string, string> = {};
        if (!dateSchema.safeParse(data.count_date).success)
            errors.count_date = messages.count_date;
        if (!dateSchema.safeParse(data.posting_date).success)
            errors.posting_date = messages.posting_date;
        const location = await this.activeLocation(data.location_id);
        if (!location) errors.location_id = messages.location_id;
        else if (location.transit) errors.location_id = transitMessage;
        const description = data.description?.trim() || null;
        if (description && description.length > 200)
            errors.description = messages.description;
        const lines = await this.checkedLines(data.lines, errors);
        if (Object.keys(errors).length || !location) validation(errors);
        return {
            location,
            countDate: data.count_date,
            postingDate: data.posting_date,
            description,
            lines,
        };
    }

    // Isian baris. Batch yang nomornya sudah tercatat untuk barang itu ditunjuk lewat batch_id, supaya satu batch hanya
    // punya satu bentuk di dokumen. Kewajiban batch dan kedaluwarsa diperiksa saat hitungan diselesaikan, supaya draf
    // boleh disimpan setengah jadi.
    private async checkedLines(
        lines: z.infer<typeof stockCountInputSchema>['lines'],
        errors: Record<string, string>,
    ): Promise<LineDraft[]> {
        const itemIds = unique(
            lines.flatMap((line) =>
                lookupId(line.item_id) ? [line.item_id] : [],
            ),
        );
        const items = new Set(
            (itemIds.length
                ? await this.db.rows(
                      z.object({ id: z.string() }),
                      `select id from gd_m_barang
                       where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null
                         and id in (${placeholders(itemIds, 3)})`,
                      [
                          this.scope.tenantId,
                          this.scope.legalEntityId,
                          ...itemIds,
                      ],
                  )
                : []
            ).map((item) => item.id),
        );
        const conversions = await this.conversions(itemIds);
        const batchIds = unique(
            lines.flatMap((line) =>
                line.batch_id && lookupId(line.batch_id) ? [line.batch_id] : [],
            ),
        );
        const numbers = unique(
            lines.flatMap((line) => {
                const number = line.batch_number?.trim().toUpperCase();
                return number ? [number] : [];
            }),
        );
        const batches = await this.ledger.batches(itemIds, batchIds, numbers);
        const drafts: LineDraft[] = [];
        const seen = new Map<string, number>();
        for (const [index, line] of lines.entries()) {
            const fail = (name: string, message: string) => {
                errors[`lines.${index}.${name}`] ??= message;
            };
            if (!items.has(line.item_id)) fail('item_id', messages.item_id);
            const conversion = conversions.get(
                `${line.item_id}:${line.unit_id}`,
            );
            if (conversion === undefined) fail('unit_id', messages.unit_id);
            let counted: bigint | null = null;
            const raw = line.quantity_counted;
            if (raw !== null && raw !== undefined && raw !== '') {
                const value = decimalInput(raw);
                const base =
                    value === null || conversion === undefined
                        ? null
                        : baseQuantity(value, conversion);
                if (value === null || value < 0n)
                    fail('quantity_counted', messages.quantity_counted);
                else if (conversion !== undefined && base === null)
                    fail(
                        'quantity_counted',
                        'Jumlah ini dalam satuan dasar punya lebih dari empat angka di belakang koma atau terlalu besar. Ubah jumlah atau satuannya.',
                    );
                counted = base;
            }
            let batchId: string | null = null;
            let batchNumber: string | null = null;
            let expiry: string | null = null;
            const number = line.batch_number?.trim().toUpperCase() || null;
            const expiryText = line.expiry_date?.trim() || null;
            if (line.batch_id) {
                const found = batches.byId.get(line.batch_id);
                if (number || expiryText)
                    fail(
                        'batch_number',
                        'Pilih batch yang tercatat, atau isi nomor batch baru, tidak keduanya.',
                    );
                else if (found?.item_id !== line.item_id)
                    fail('batch_id', messages.batch_id);
                else batchId = found.id;
            } else if (number) {
                const known = batches.byNumber.get(`${line.item_id}:${number}`);
                if (number.length > 50)
                    fail(
                        'batch_number',
                        'Nomor batch paling banyak 50 karakter.',
                    );
                if (
                    expiryText !== null &&
                    !dateSchema.safeParse(expiryText).success
                )
                    fail('expiry_date', messages.expiry_date);
                else if (
                    known &&
                    expiryText !== null &&
                    known.expiry !== expiryText
                )
                    fail(
                        'expiry_date',
                        known.expiry === null
                            ? `Batch ${number} sudah tercatat tanpa tanggal kedaluwarsa. Batch yang sama harus memakai tanggal kedaluwarsa yang sama.`
                            : `Batch ${number} sudah tercatat dengan kedaluwarsa ${known.expiry}. Batch yang sama harus memakai tanggal kedaluwarsa yang sama.`,
                    );
                if (known) batchId = known.id;
                else {
                    batchNumber = number;
                    expiry = expiryText;
                }
            } else if (expiryText)
                fail(
                    'batch_number',
                    'Isi nomor batch. Tanggal kedaluwarsa dicatat per batch.',
                );
            const description = line.description?.trim() || null;
            if (description && description.length > 200)
                fail('description', messages.description);
            const key = `${line.item_id}:${batchId ?? (batchNumber ? `baru:${batchNumber}` : '')}`;
            const earlier = seen.get(key);
            if (earlier !== undefined)
                fail(
                    'item_id',
                    `Barang dengan batch ini sudah ada di baris ${earlier + 1}.`,
                );
            else seen.set(key, index);
            drafts.push({
                id: line.id ?? null,
                itemId: line.item_id,
                batchId,
                batchNumber,
                expiry,
                unitId: line.unit_id,
                conversion: conversion ?? 10n ** BigInt(quantityScale),
                counted,
                description,
            });
        }
        return drafts;
    }

    // Isi satuan per barang: satuan dasar berisi 1, satuan kemasan aktif berisi konversinya.
    private async conversions(itemIds: string[]) {
        const found = new Map<string, bigint>();
        if (!itemIds.length) return found;
        const rows = await this.db.rows(
            z.object({
                item_id: z.string(),
                unit_id: z.string(),
                conversion: z.string(),
            }),
            `select id as item_id, satuan_dasar_id as unit_id, '1' as conversion, 0 as rank
             from gd_m_barang
             where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null and id in (${placeholders(itemIds, 3)})
             union all
             select k.barang_id, k.satuan_id, k.konversi::text, 1
             from gd_m_barang_satuan k
             join gd_m_barang b on b.tenant_id = k.tenant_id and b.id = k.barang_id and b.deleted_at is null
             where k.tenant_id = $1 and k.legal_entity_id = $2 and k.deleted_at is null
               and k.barang_id in (${placeholders(itemIds, 3)})
             order by rank`,
            [this.scope.tenantId, this.scope.legalEntityId, ...itemIds],
        );
        for (const row of rows) {
            const key = `${row.item_id}:${row.unit_id}`;
            if (!found.has(key)) found.set(key, quantityOf(row.conversion));
        }
        return found;
    }

    private async saveLines(
        documentId: string,
        lines: LineDraft[],
        locationId: string,
        postingDate: string,
    ) {
        const stored = new Map(
            (
                await this.db.rows(
                    z.object({
                        id: z.string(),
                        item_id: z.string(),
                        batch_id: z.string().nullable(),
                        batch_number: z.string().nullable(),
                        expiry: z.string().nullable(),
                        unit_id: z.string(),
                        conversion: z.string(),
                        counted: z.string().nullable(),
                        description: z.string().nullable(),
                        line_no: z.number(),
                    }),
                    `select id, barang_id as item_id, batch_id, no_batch as batch_number,
                            kedaluwarsa::text as expiry, satuan_id as unit_id, konversi::text as conversion,
                            jumlah_dihitung::text as counted, keterangan as description, urutan as line_no
                     from gd_tr_opname_detail
                     where tenant_id = $1 and opname_id = $2 and deleted_at is null`,
                    [this.scope.tenantId, documentId],
                )
            ).map((line) => [line.id, line]),
        );
        const identity = (line: {
            itemId: string;
            batchId: string | null;
            batchNumber: string | null;
        }) => `${line.itemId}:${line.batchId ?? ''}:${line.batchNumber ?? ''}`;
        const kept = new Set<string>();
        for (const [index, line] of lines.entries()) {
            if (line.id === null) continue;
            if (!stored.has(line.id) || kept.has(line.id))
                validation({ [`lines.${index}.id`]: messages.id });
            kept.add(line.id);
        }
        // Jumlah tercatat dipotret saat baris lahir, atau saat barang atau batchnya diganti.
        const fresh = lines.filter((line) => {
            const before = line.id === null ? undefined : stored.get(line.id);
            return (
                !before ||
                identity({
                    itemId: before.item_id,
                    batchId: before.batch_id,
                    batchNumber: before.batch_number,
                }) !== identity(line)
            );
        });
        const expected = await this.ledger.expectedAt(
            locationId,
            postingDate,
            unique(fresh.map((line) => line.itemId)),
        );
        const snapshot = (line: LineDraft) =>
            quantityText(
                line.batchNumber === null
                    ? (expected.get(positionKey(line.itemId, line.batchId)) ??
                          0n)
                    : 0n,
            );
        const stamp = nowSql();
        for (const [index, line] of lines.entries()) {
            const values = {
                urutan: index + 1,
                barang_id: line.itemId,
                batch_id: line.batchId,
                no_batch: line.batchNumber,
                kedaluwarsa: line.expiry,
                satuan_id: line.unitId,
                konversi: quantityText(line.conversion),
                jumlah_dihitung:
                    line.counted === null ? null : quantityText(line.counted),
                keterangan: line.description,
            };
            const before = line.id === null ? undefined : stored.get(line.id);
            if (!before || line.id === null) {
                await this.db.insert('gd_tr_opname_detail', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.scope.tenantId,
                    legal_entity_id: this.scope.legalEntityId,
                    opname_id: documentId,
                    ...values,
                    jumlah_tercatat: snapshot(line),
                    created_at: stamp,
                    updated_at: stamp,
                });
                continue;
            }
            const reidentified = fresh.includes(line);
            const unchanged =
                !reidentified &&
                before.line_no === values.urutan &&
                before.expiry === values.kedaluwarsa &&
                before.unit_id === values.satuan_id &&
                before.conversion === values.konversi &&
                before.counted === values.jumlah_dihitung &&
                before.description === values.keterangan;
            if (unchanged) continue;
            await this.db.execute(
                `update gd_tr_opname_detail
                 set urutan = $1, barang_id = $2, batch_id = $3, no_batch = $4, kedaluwarsa = $5, satuan_id = $6,
                     konversi = $7, jumlah_dihitung = $8, keterangan = $9,
                     jumlah_tercatat = coalesce($10, jumlah_tercatat), updated_at = $11
                 where tenant_id = $12 and id = $13`,
                [
                    values.urutan,
                    values.barang_id,
                    values.batch_id,
                    values.no_batch,
                    values.kedaluwarsa,
                    values.satuan_id,
                    values.konversi,
                    values.jumlah_dihitung,
                    values.keterangan,
                    reidentified ? snapshot(line) : null,
                    stamp,
                    this.scope.tenantId,
                    line.id,
                ],
            );
        }
        for (const id of stored.keys())
            if (!kept.has(id))
                await this.db.execute(
                    'update gd_tr_opname_detail set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3',
                    [stamp, this.scope.tenantId, id],
                );
    }

    private issue(id: string, documentDate: string) {
        return new NumberIssuer(this.db, {
            tenantId: this.scope.tenantId,
            moduleId: 'core',
        }).issue({
            reference: numberReference,
            key: `${sourceType}:${id}`,
            documentDate,
            legalEntityId: this.scope.legalEntityId,
        });
    }

    // Hitung dimulai saat dokumen pertama kali punya baris. Dokumen yang semua barisnya dihapus mulai lagi dari awal.
    async create(body: unknown) {
        this.workspace.guard('inventory-count', 'update');
        const data = await this.checked(body);
        const id = Bun.randomUUIDv7();
        await this.db.transaction(async () => {
            const number = await this.issue(id, data.countDate);
            const stamp = nowSql();
            await this.db.insert('gd_tr_opname', {
                id,
                tenant_id: this.scope.tenantId,
                legal_entity_id: this.scope.legalEntityId,
                operating_unit_id: data.location.operating_unit_id,
                lokasi_id: data.location.id,
                nomor: number,
                tanggal: data.countDate,
                tanggal_posting: data.postingDate,
                keterangan: data.description,
                mulai_hitung_pada: data.lines.length ? stamp : null,
                created_at: stamp,
                updated_at: stamp,
            });
            await this.saveLines(
                id,
                data.lines,
                data.location.id,
                data.postingDate,
            );
        });
        return this.reply(id, 201);
    }

    // Kepala dikunci lebih dulu, supaya dua penyimpanan bersamaan tidak menyatukan dua set baris. Lokasi hanya bisa
    // diganti selama baris yang tersimpan tidak dibawa, karena jumlah tercatatnya milik lokasi lama.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-count', 'update');
        const current = await this.header(id);
        const data = await this.checked(body);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const locked = await this.facts(current.id, true);
            if (locked.status !== 'draf')
                validation({ _form: refusal('edit', locked.status) });
            if (locked.version !== version)
                coded(409, 'stale_version', staleMessage);
            if (
                locked.location_id !== data.location.id &&
                data.lines.some((line) => line.id !== null)
            )
                validation({
                    location_id:
                        'Lokasi tidak bisa diganti karena opname ini sudah punya baris. Hapus barisnya lebih dulu, atau buat opname baru.',
                });
            const stamp = nowSql();
            await this.db.execute(
                `update gd_tr_opname
                 set operating_unit_id = $1, lokasi_id = $2, tanggal = $3, tanggal_posting = $4, keterangan = $5,
                     mulai_hitung_pada = case when $6 then coalesce(mulai_hitung_pada, $7::timestamp) end,
                     updated_at = $7
                 where tenant_id = $8 and id = $9`,
                [
                    data.location.operating_unit_id,
                    data.location.id,
                    data.countDate,
                    data.postingDate,
                    data.description,
                    data.lines.length > 0,
                    stamp,
                    this.scope.tenantId,
                    current.id,
                ],
            );
            await this.saveLines(
                current.id,
                data.lines,
                data.location.id,
                data.postingDate,
            );
        });
        return this.reply(current.id);
    }

    private async facts(id: string, lock: boolean): Promise<HeaderFacts> {
        const found = await this.db.one(
            headerFactsSchema,
            `select status, version, lokasi_id as location_id, mulai_hitung_pada::text as started_at
             from gd_tr_opname
             where tenant_id = $1 and legal_entity_id = $2 and id = $3${lock ? ' for update' : ''}`,
            [this.scope.tenantId, this.scope.legalEntityId, id],
        );
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Status berpindah di bawah kunci baris kepala, di transaksi yang sama dengan efeknya. Permintaan yang diulang
    // setelah opname sampai di status tujuan, termasuk posting serentak yang kalah, tidak menulis apa pun.
    private async move(
        id: string,
        version: number,
        name: MoveName,
    ): Promise<HeaderFacts | null> {
        const move = moves[name];
        const locked = await this.facts(id, true);
        if (locked.status === move.to) return null;
        if (!move.from.includes(locked.status))
            validation({ _form: refusal(name, locked.status) });
        if (locked.version !== version)
            coded(409, 'stale_version', staleMessage);
        const parameters: Bind[] = [this.scope.tenantId, id, move.to, nowSql()];
        const stamp = move.clear
            ? `${move.at} = null, ${move.by} = null`
            : `${move.at} = $4, ${move.by} = $${parameters.push(this.workspace.userId)}`;
        await this.db.execute(
            `update gd_tr_opname set status = $3, updated_at = $4, ${stamp} where tenant_id = $1 and id = $2`,
            parameters,
        );
        return locked;
    }

    private async storedLines(id: string): Promise<StoredLine[]> {
        const rows = await this.db.rows(
            storedLineSchema,
            `select d.id, d.barang_id as item_id, d.batch_id, t.no_batch as known_batch_number,
                    d.no_batch as new_batch_number, d.kedaluwarsa::text as expiry, d.jumlah_dihitung::text as counted,
                    coalesce(p.wajib_batch, false) as batch_required,
                    coalesce(p.wajib_kedaluwarsa, false) as expiry_required
             from gd_tr_opname_detail d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             left join gd_m_profil_pelacakan p on p.tenant_id = b.tenant_id and p.id = b.profil_pelacakan_id
             left join gd_m_batch t on t.tenant_id = d.tenant_id and t.id = d.batch_id
             where d.tenant_id = $1 and d.opname_id = $2 and d.deleted_at is null
             order by d.urutan, d.id`,
            [this.scope.tenantId, id],
        );
        return rows.map((row) => ({
            id: row.id,
            itemId: row.item_id,
            batchId: row.batch_id,
            knownBatchNumber: row.known_batch_number,
            newBatchNumber: row.new_batch_number,
            expiry: row.expiry,
            counted: row.counted === null ? null : quantityOf(row.counted),
            batchRequired: row.batch_required,
            expiryRequired: row.expiry_required,
        }));
    }

    // Hitungan dianggap selesai bila setiap baris sudah dihitung, dan barang yang wajib berbatch yang ditemukan membawa
    // nomor batchnya. Baris barang berbatch tanpa batch yang dihitung 0 boleh: artinya memang tidak ada.
    private requireCounted(lines: StoredLine[]) {
        const errors: Record<string, string> = {};
        if (!lines.length)
            errors.lines =
                'Tambahkan sedikitnya satu baris, atau pilih Hitung baris.';
        for (const [index, line] of lines.entries()) {
            const field = `lines.${index}`;
            if (line.counted === null)
                errors[`${field}.quantity_counted`] =
                    'Isi jumlah dihitung. Isi 0 bila barangnya tidak ada.';
            else if (
                line.batchRequired &&
                line.batchId === null &&
                line.newBatchNumber === null &&
                line.counted !== 0n
            )
                errors[`${field}.batch_number`] =
                    'Isi nomor batch. Barang ini wajib dicatat per batch.';
            if (
                line.expiryRequired &&
                line.newBatchNumber !== null &&
                line.expiry === null
            )
                errors[`${field}.expiry_date`] =
                    'Isi tanggal kedaluwarsa. Barang ini wajib dicatat tanggal kedaluwarsanya.';
        }
        if (Object.keys(errors).length) validation(errors);
    }

    async calculateLines(body: unknown) {
        this.workspace.guard('inventory-count', 'update');
        const data = parseInput(stockCountCalculationSchema, body, messages);
        const errors: Record<string, string> = {};
        if (!dateSchema.safeParse(data.posting_date).success)
            errors.posting_date = messages.posting_date;
        const location = await this.activeLocation(data.location_id);
        if (!location) errors.location_id = messages.location_id;
        else if (location.transit) errors.location_id = transitMessage;
        const categoryId = data.category_id || null;
        if (
            categoryId !== null &&
            !(await exists(this.db, 'gd_m_kategori', this.scope, categoryId))
        )
            errors.category_id = messages.category_id;
        const itemIds = unique(data.item_ids ?? []);
        for (const [index, itemId] of itemIds.entries())
            if (!(await exists(this.db, 'gd_m_barang', this.scope, itemId)))
                errors[`item_ids.${index}`] = messages.item_ids;
        if (Object.keys(errors).length || !location) validation(errors);
        const bindings: Bind[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
            location.id,
            data.posting_date,
        ];
        const bind = (value: Bind) => `$${bindings.push(value)}`;
        let itemFilter = '';
        if (itemIds.length)
            itemFilter += ` and b.id in (${itemIds.map(bind).join(',')})`;
        if (categoryId !== null)
            itemFilter += ` and b.kategori_id in (select id from categories)`;
        const categories =
            categoryId === null
                ? ''
                : `recursive categories as (
                       select id from gd_m_kategori
                       where tenant_id = $1 and legal_entity_id = $2 and id = ${bind(categoryId)}
                       union
                       select c.id from gd_m_kategori c join categories p on c.parent_id = p.id
                       where c.tenant_id = $1 and c.deleted_at is null),`;
        const withoutStock =
            data.only_in_stock === false
                ? `union all
                   select i.id, null::uuid, 0 from items i
                   where not exists (select 1 from positions p where p.barang_id = i.id)`
                : '';
        const rows = await this.db.rows(
            stockCountPositionSchema,
            `with ${categories}
             items as (
                 select b.id from gd_m_barang b
                 where b.tenant_id = $1 and b.legal_entity_id = $2 and b.deleted_at is null and not b.diblokir${itemFilter}
             ),
             positions as (
                 select k.barang_id, k.batch_id, sum(k.jumlah) as quantity
                 from gd_tr_kartu_gudang k join items i on i.id = k.barang_id
                 where k.tenant_id = $1 and k.legal_entity_id = $2 and k.lokasi_id = $3
                   and k.tanggal_posting <= $4::date
                 group by k.barang_id, k.batch_id
                 having sum(k.jumlah) <> 0
             ),
             chosen as (
                 select barang_id, batch_id, quantity from positions
                 ${withoutStock}
             )
             select json_build_object('id', b.id, 'code', b.kode, 'name', b.nama, 'base_unit', base.kode,
                                      'base_unit_id', base.id,
                                      'batch_required', coalesce(p.wajib_batch, false),
                                      'expiry_required', coalesce(p.wajib_kedaluwarsa, false)) as item,
                    ${batchJson} as batch, trim_scale(c.quantity)::text as quantity
             from chosen c
             join gd_m_barang b on b.tenant_id = $1 and b.id = c.barang_id
             join gd_m_satuan base on base.tenant_id = b.tenant_id and base.id = b.satuan_dasar_id
             left join gd_m_profil_pelacakan p on p.tenant_id = b.tenant_id and p.id = b.profil_pelacakan_id
             left join gd_m_batch t on t.tenant_id = b.tenant_id and t.id = c.batch_id
             order by b.kode, t.kedaluwarsa nulls first, t.no_batch nulls first
             limit ${stockCountMaxLines + 1}`,
            bindings,
        );
        if (rows.length > stockCountMaxLines)
            validation({
                _form: `Hasilnya lebih dari ${stockCountMaxLines} baris. Persempit saringannya, misalnya pilih kategori atau barang.`,
            });
        return { data: rows };
    }

    private postingDate(body: unknown) {
        const data = parseInput(stockCountPostingInputSchema, body, messages);
        if (!dateSchema.safeParse(data.posting_date).success)
            validation({ posting_date: messages.posting_date });
        return data.posting_date;
    }

    // Selisih yang akan diposting bila opname diposting sekarang dengan tanggal itu. Hanya bacaan: stok bisa bergerak
    // lagi sebelum Post, dan posting menghitungnya ulang.
    async preview(id: string, parameters: URLSearchParams) {
        this.workspace.guard('inventory-count', 'read');
        const current = await this.header(id);
        const postingDate = parameters.get('posting_date') ?? '';
        if (!dateSchema.safeParse(postingDate).success)
            validation({ posting_date: messages.posting_date });
        const facts = await this.facts(current.id, false);
        const assessed = await this.ledger.assess(
            facts,
            await this.storedLines(current.id),
            postingDate,
        );
        const cost = await this.ledger.costs(
            facts.location_id,
            assessed.filter((entry) => entry.difference > 0n),
        );
        return {
            data: {
                posting_date: postingDate,
                lines: assessed.map((entry) => ({
                    id: entry.line.id,
                    quantity_expected: display(entry.expected, quantityScale),
                    quantity_counted: display(entry.counted, quantityScale),
                    difference: display(entry.difference, quantityScale),
                    unit_cost:
                        entry.difference > 0n
                            ? display(cost(entry).unitCost, quantityScale)
                            : null,
                    moved_after_count_started: entry.moved,
                })),
            },
        };
    }

    async finish(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-count', 'update');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            if (!(await this.move(current.id, version, 'finish'))) return;
            this.requireCounted(await this.storedLines(current.id));
        });
        return this.reply(current.id);
    }

    async reopen(request: Request, id: string, body: unknown) {
        return this.transition(request, id, body, 'reopen');
    }

    async cancel(request: Request, id: string, body: unknown) {
        return this.transition(request, id, body, 'cancel');
    }

    private async transition(
        request: Request,
        id: string,
        body: unknown,
        name: 'reopen' | 'cancel',
    ) {
        this.workspace.guard('inventory-count', 'update');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            await this.move(current.id, version, name);
        });
        return this.reply(current.id);
    }

    async post(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-count', 'post');
        const current = await this.header(id);
        const postingDate = this.postingDate(body);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const claimed = await this.move(current.id, version, 'post');
            if (!claimed) return;
            const lines = await this.storedLines(current.id);
            this.requireCounted(lines);
            const location = await this.activeLocation(claimed.location_id);
            if (!location)
                validation({
                    location_id:
                        'Lokasi opname ini sudah dihapus. Batalkan opname ini dan buat opname baru.',
                });
            if (location.transit) validation({ location_id: transitMessage });
            await lockItemLocations(
                this.db,
                this.scope.tenantId,
                lines.map((line) => ({
                    itemId: line.itemId,
                    locationId: location.id,
                })),
            );
            const assessed = await this.ledger.assess(
                claimed,
                lines,
                postingDate,
            );
            const cost = await this.ledger.costs(
                location.id,
                assessed.filter((entry) => entry.difference > 0n),
            );
            await underLineNames(() =>
                postItemLines(
                    this.db,
                    {
                        ...this.scope,
                        userId: this.workspace.userId,
                        postingDate,
                        source: {
                            type: sourceType,
                            id: current.id,
                            number: current.number,
                        },
                    },
                    assessed.flatMap((entry): ItemLine[] =>
                        this.ledger.itemLine(entry, location.id, cost),
                    ),
                ),
            );
            for (const entry of assessed)
                await this.db.execute(
                    `update gd_tr_opname_detail set jumlah_tercatat_posting = $1, bergerak_setelah_mulai = $2,
                            updated_at = $3
                     where tenant_id = $4 and id = $5`,
                    [
                        quantityText(entry.expected),
                        entry.moved,
                        nowSql(),
                        this.scope.tenantId,
                        entry.line.id,
                    ],
                );
            await this.db.execute(
                'update gd_tr_opname set tanggal_posting = $1 where tenant_id = $2 and id = $3',
                [postingDate, this.scope.tenantId, current.id],
            );
        });
        return this.reply(current.id);
    }

    // Opname yang dibatalkan postingnya tidak kembali ke draf: kunci idempoten barisnya sudah terpakai di kartu gudang.
    async reverse(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-count', 'reverse');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            if (!(await this.move(current.id, version, 'reverse'))) return;
            await reverseItemEntries(
                this.db,
                {
                    ...this.scope,
                    userId: this.workspace.userId,
                },
                { type: sourceType, id: current.id },
            );
        });
        return this.reply(current.id);
    }
}
