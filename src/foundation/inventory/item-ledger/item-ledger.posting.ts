import { z } from 'zod';
import { nowSql, type Database } from '../../../platform/database/index.ts';
import { validation } from '../../../platform/http/index.ts';
import {
    amountOf,
    amountScale,
    display,
    fromNumeric,
    quantityScale,
    toNumeric,
} from '../quantity.ts';
import {
    allocate,
    candidates,
    type Candidates,
    type OpenEntry,
    type Slice,
} from './allocation.ts';
import {
    pickingMethods,
    resolveStockPolicy,
    transferModes,
    type Movement,
    type PolicySettings,
    type StockPolicy,
} from './stock-policy.ts';

// Jenis gerak di kartu gudang. Ini perilaku mesin, bukan data acuan: alasan bisnisnya (saldo awal, pemusnahan, dan
// seterusnya) ada di dokumen sumbernya.
export const entryKinds = [
    'penerimaan',
    'penyerahan',
    'penyesuaian_tambah',
    'penyesuaian_kurang',
    'transfer',
    'pemakaian',
] as const;
export type EntryKind = (typeof entryKinds)[number];

type LineBase = {
    // Kunci baris sumber, misalnya `penyesuaian:<id baris>`. Setiap baris kartu gudang yang ditulisnya mendapat akhiran
    // urutan, sehingga posting yang diulang menabrak indeks unik dan tidak pernah menulis dua kali.
    key: string;
    // Awalan nama field pada pesan penolakan, misalnya `lines.0`.
    field: string;
    sourceLineId: string | null;
    itemId: string;
    quantity: bigint;
};
export type InboundLine = LineBase & {
    kind: 'inbound';
    entryKind: EntryKind;
    locationId: string;
    unitCost: bigint;
    batchNumber: string | null;
    expiry: string | null;
};
export type OutboundLine = LineBase & {
    kind: 'outbound';
    entryKind: EntryKind;
    locationId: string;
    batchId: string | null;
};
export type TransferLine = LineBase & {
    kind: 'transfer';
    fromLocationId: string;
    toLocationId: string;
    batchId: string | null;
};
export type ItemLine = InboundLine | OutboundLine | TransferLine;

export type Source = { type: string; id: string; number: string | null };

export type PostingContext = {
    tenantId: string;
    legalEntityId: string;
    userId: string | null;
    postingDate: string;
    source: Source;
};

const itemSchema = z.object({
    id: z.string(),
    code: z.string(),
    unit: z.string(),
    blocked: z.boolean(),
    refuse_negative: z.boolean().nullable(),
    batch_required: z.boolean().nullable(),
    expiry_required: z.boolean().nullable(),
    strict_expiry: z.boolean().nullable(),
});
type Item = z.infer<typeof itemSchema>;

const locationSchema = z.object({
    id: z.string(),
    operating_unit_id: z.string(),
    picking: z.enum(pickingMethods).nullable(),
    transfer_mode: z.enum(transferModes).nullable(),
    unit_picking: z.enum(pickingMethods).nullable(),
});
type Location = z.infer<typeof locationSchema>;

const legalEntitySchema = z.object({
    picking: z.enum(pickingMethods),
    refuse_negative: z.boolean(),
    transfer_mode: z.enum(transferModes),
});
type LegalEntitySettings = z.infer<typeof legalEntitySchema>;

const batchSchema = z.object({
    id: z.string(),
    item_id: z.string(),
    number: z.string(),
    expiry: z.string().nullable(),
});
type Batch = z.infer<typeof batchSchema>;

const openSchema = z.object({
    id: z.string(),
    batch_id: z.string().nullable(),
    expiry: z.string().nullable(),
    open: z.string(),
    unit_cost: z.string().nullable(),
});

const entrySchema = z.object({
    id: z.string(),
    operating_unit_id: z.string(),
    location_id: z.string(),
    item_id: z.string(),
    batch_id: z.string().nullable(),
    expiry: z.string().nullable(),
    kind: z.enum(entryKinds),
    posting_date: z.string(),
    quantity: z.string(),
    open: z.string(),
    unit_cost: z.string().nullable(),
    amount: z.string(),
    source_type: z.string(),
    source_id: z.string(),
    source_line_id: z.string().nullable(),
    source_number: z.string().nullable(),
});

type Prepared =
    | {
          kind: 'inbound';
          line: InboundLine;
          item: Item;
          location: Location;
          expiry: string | null;
      }
    | {
          kind: 'outbound';
          line: OutboundLine;
          item: Item;
          location: Location;
          policy: StockPolicy;
          batch: Batch | null;
      }
    | {
          kind: 'transfer';
          line: TransferLine;
          item: Item;
          from: Location;
          to: Location;
          policy: StockPolicy;
          batch: Batch | null;
      };

const quantityText = (value: bigint) => toNumeric(value, quantityScale);
const quantityOf = (text: string) => fromNumeric(text, quantityScale);
const placeholders = (values: unknown[], start: number) =>
    values.map((_, index) => `$${index + start}`).join(',');

function openEntry(row: z.infer<typeof openSchema>): OpenEntry {
    return {
        id: row.id,
        batchId: row.batch_id,
        expiry: row.expiry,
        open: quantityOf(row.open),
        unitCost: row.unit_cost === null ? 0n : quantityOf(row.unit_cost),
    };
}

// Satu penulis per barang dan lokasi. Kunci diambil berurutan menurut teksnya, jadi dua dokumen berbaris banyak yang
// menyentuh barang yang sama tidak pernah saling menunggu dalam urutan terbalik.
async function lock(
    db: Database,
    tenantId: string,
    pairs: { itemId: string; locationId: string }[],
) {
    const keys = pairs.map(
        (pair) =>
            `gd_tr_kartu_gudang:${tenantId}:${pair.itemId}:${pair.locationId}`,
    );
    for (const key of [...new Set(keys)].sort())
        await db.execute(
            'select pg_advisory_xact_lock(hashtextextended($1, 0))',
            [key],
        );
}

function settings(
    legalEntity: LegalEntitySettings,
    location: Location,
    item: Item,
): PolicySettings {
    return {
        legalEntity: {
            picking: legalEntity.picking,
            refuseNegative: legalEntity.refuse_negative,
            transferMode: legalEntity.transfer_mode,
        },
        operatingUnit: { picking: location.unit_picking },
        location: {
            picking: location.picking,
            transferMode: location.transfer_mode,
        },
        item: {
            refuseNegative: item.refuse_negative,
            tracking:
                item.batch_required === null
                    ? null
                    : {
                          batchRequired: item.batch_required,
                          expiryRequired: item.expiry_required ?? false,
                          strictExpiry: item.strict_expiry ?? false,
                      },
        },
    };
}

// Penulis kartu gudang. Baris baru ditulis dengan sisa = jumlah, dan sisa hanya bergerak lewat apply(), yang selalu
// mencatat baris aplikasinya. Karena itu SUM(jumlah) = SUM(sisa) per barang dan lokasi, dan jumlah aplikasi satu baris
// selalu sama dengan bagian yang sudah ditutupnya.
class Ledger {
    private readonly written = new Map<string, number>();

    constructor(
        readonly db: Database,
        readonly tenantId: string,
        readonly legalEntityId: string,
        private readonly userId: string | null,
    ) {}

    nextKey(lineKey: string) {
        const next = (this.written.get(lineKey) ?? 0) + 1;
        this.written.set(lineKey, next);
        return `${lineKey}:${next}`;
    }

    async insert(entry: {
        key: string;
        location: { id: string; operating_unit_id: string };
        itemId: string;
        batchId: string | null;
        expiry: string | null;
        kind: EntryKind;
        postingDate: string;
        quantity: bigint;
        unitCost: bigint | null;
        amount: bigint;
        source: Source;
        sourceLineId: string | null;
        reversedFrom: string | null;
    }): Promise<string> {
        const id = Bun.randomUUIDv7();
        await this.db.insert('gd_tr_kartu_gudang', {
            id,
            tenant_id: this.tenantId,
            legal_entity_id: this.legalEntityId,
            operating_unit_id: entry.location.operating_unit_id,
            lokasi_id: entry.location.id,
            barang_id: entry.itemId,
            batch_id: entry.batchId,
            kedaluwarsa: entry.expiry,
            jenis: entry.kind,
            tanggal_posting: entry.postingDate,
            jumlah: quantityText(entry.quantity),
            sisa: quantityText(entry.quantity),
            harga_satuan:
                entry.unitCost === null ? null : quantityText(entry.unitCost),
            nilai: toNumeric(entry.amount, amountScale),
            sumber_jenis: entry.source.type,
            sumber_id: entry.source.id,
            sumber_baris_id: entry.sourceLineId,
            sumber_nomor: entry.source.number,
            kunci_idempoten: entry.key,
            dibalik_dari: entry.reversedFrom,
            created_by_user_id: this.userId,
            created_at: nowSql(),
        });
        return id;
    }

    // Baris masuk `inboundId` memberi `quantity` kepada baris keluar `outboundId`: sisa keduanya bergerak ke nol.
    async apply(inboundId: string, outboundId: string, quantity: bigint) {
        const amount = quantityText(quantity);
        await this.db.execute(
            'update gd_tr_kartu_gudang set sisa = sisa - $1 where tenant_id = $2 and id = $3',
            [amount, this.tenantId, inboundId],
        );
        await this.db.execute(
            'update gd_tr_kartu_gudang set sisa = sisa + $1 where tenant_id = $2 and id = $3',
            [amount, this.tenantId, outboundId],
        );
        await this.db.insert('gd_tr_kartu_gudang_aplikasi', {
            id: Bun.randomUUIDv7(),
            tenant_id: this.tenantId,
            legal_entity_id: this.legalEntityId,
            entri_masuk_id: inboundId,
            entri_keluar_id: outboundId,
            jumlah: amount,
            created_at: nowSql(),
        });
    }
}

// Mesin posting stok (Item Jnl.-Post Line di BC): satu pintu untuk setiap dokumen yang menggerakkan stok. Berjalan di
// dalam transaksi pemanggil, yang menjaga dokumennya sendiri dari posting ganda; indeks unik kunci idempoten menjadi
// penjaga terakhir. Penolakan dilempar sebagai 422 dengan nama field `<field baris>.<isian>`.
export async function postItemLines(
    db: Database,
    context: PostingContext,
    lines: ItemLine[],
): Promise<void> {
    if (!db.inTransaction)
        throw new Error(
            'postItemLines must run inside the document transaction.',
        );
    if (!lines.length) return;
    const prepared = await prepare(db, context, lines);
    await lock(
        db,
        context.tenantId,
        lines.flatMap((line) =>
            line.kind === 'transfer'
                ? [
                      { itemId: line.itemId, locationId: line.fromLocationId },
                      { itemId: line.itemId, locationId: line.toLocationId },
                  ]
                : [{ itemId: line.itemId, locationId: line.locationId }],
        ),
    );
    // Batch baru dicatat lebih dulu dalam urutan tetap. Dua dokumen di lokasi berbeda tidak berbagi kunci barang dan
    // lokasi, jadi tanpa urutan ini keduanya bisa saling menunggu batch baru yang sama.
    const newBatches = prepared
        .flatMap((entry) =>
            entry.kind === 'inbound' && entry.line.batchNumber !== null
                ? [
                      {
                          entry,
                          number: entry.line.batchNumber,
                          order: `${entry.item.id}:${entry.line.batchNumber}`,
                      },
                  ]
                : [],
        )
        .sort((left, right) =>
            left.order < right.order ? -1 : left.order > right.order ? 1 : 0,
        );
    const batches = new Map<
        InboundLine,
        { id: string; expiry: string | null }
    >();
    for (const { entry, number } of newBatches)
        batches.set(
            entry.line,
            await ensureBatch(db, context, entry.line, number, entry.expiry),
        );
    const ledger = new Ledger(
        db,
        context.tenantId,
        context.legalEntityId,
        context.userId,
    );
    for (const entry of prepared) {
        switch (entry.kind) {
            case 'inbound': {
                const { line } = entry;
                const batch = batches.get(line) ?? null;
                await receive(ledger, context, {
                    key: line.key,
                    sourceLineId: line.sourceLineId,
                    itemId: entry.item.id,
                    location: entry.location,
                    quantity: line.quantity,
                    unitCost: line.unitCost,
                    batchId: batch?.id ?? null,
                    expiry: batch?.expiry ?? null,
                    kind: line.entryKind,
                });
                break;
            }
            case 'outbound':
                await issue(ledger, context, {
                    line: entry.line,
                    item: entry.item,
                    location: entry.location,
                    policy: entry.policy,
                    batch: entry.batch,
                    kind: entry.line.entryKind,
                });
                break;
            case 'transfer': {
                const { line } = entry;
                const slices = await issue(ledger, context, {
                    line,
                    item: entry.item,
                    location: entry.from,
                    policy: entry.policy,
                    batch: entry.batch,
                    kind: 'transfer',
                });
                for (const slice of slices)
                    await receive(ledger, context, {
                        key: line.key,
                        sourceLineId: line.sourceLineId,
                        itemId: entry.item.id,
                        location: entry.to,
                        quantity: slice.quantity,
                        unitCost: slice.entry.unitCost,
                        batchId: slice.entry.batchId,
                        expiry: slice.entry.expiry,
                        kind: 'transfer',
                    });
                break;
            }
            default: {
                const unknown: never = entry;
                throw new Error(
                    `Unknown prepared line: ${JSON.stringify(unknown)}`,
                );
            }
        }
    }
}

async function prepare(
    db: Database,
    context: PostingContext,
    lines: ItemLine[],
): Promise<Prepared[]> {
    const { tenantId, legalEntityId, postingDate } = context;
    const items = new Map(
        (
            await db.rows(
                itemSchema,
                `select b.id, b.kode as code, s.kode as unit, b.diblokir as blocked,
                        b.tolak_stok_minus as refuse_negative, p.wajib_batch as batch_required,
                        p.wajib_kedaluwarsa as expiry_required, p.tolak_kedaluwarsa as strict_expiry
                 from gd_m_barang b
                 join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
                 left join gd_m_profil_pelacakan p on p.tenant_id = b.tenant_id and p.id = b.profil_pelacakan_id
                 where b.tenant_id = $1 and b.legal_entity_id = $2 and b.deleted_at is null
                   and b.id in (${placeholders(lines, 3)})
                 for share of b`,
                [tenantId, legalEntityId, ...lines.map((line) => line.itemId)],
            )
        ).map((item) => [item.id, item]),
    );
    const locationIds = lines.flatMap((line) =>
        line.kind === 'transfer'
            ? [line.fromLocationId, line.toLocationId]
            : [line.locationId],
    );
    const locations = new Map(
        (
            await db.rows(
                locationSchema,
                `select l.id, l.operating_unit_id, l.metode_pengambilan as picking, l.cara_mutasi as transfer_mode,
                        u.metode_pengambilan as unit_picking
                 from gd_m_lokasi l
                 left join gd_m_parameter_unit u on u.tenant_id = l.tenant_id
                      and u.legal_entity_id = l.legal_entity_id and u.operating_unit_id = l.operating_unit_id
                 where l.tenant_id = $1 and l.legal_entity_id = $2 and l.deleted_at is null
                   and l.id in (${placeholders(locationIds, 3)})`,
                [tenantId, legalEntityId, ...locationIds],
            )
        ).map((location) => [location.id, location]),
    );
    const legalEntity = await db.one(
        legalEntitySchema,
        `select metode_pengambilan as picking, tolak_stok_minus as refuse_negative, cara_mutasi as transfer_mode
         from gd_m_parameter where tenant_id = $1 and legal_entity_id = $2`,
        [tenantId, legalEntityId],
    );
    if (!legalEntity)
        throw new Error(`Inventory setup is missing for ${legalEntityId}.`);
    const chosenIds = lines.flatMap((line) =>
        line.kind !== 'inbound' && line.batchId !== null ? [line.batchId] : [],
    );
    const chosen = new Map(
        (chosenIds.length
            ? await db.rows(
                  batchSchema,
                  `select id, barang_id as item_id, no_batch as number, kedaluwarsa::text as expiry
                   from gd_m_batch
                   where tenant_id = $1 and legal_entity_id = $2 and id in (${placeholders(chosenIds, 3)})`,
                  [tenantId, legalEntityId, ...chosenIds],
              )
            : []
        ).map((batch) => [batch.id, batch]),
    );
    const policyOf = (item: Item, location: Location, movement: Movement) =>
        resolveStockPolicy(settings(legalEntity, location, item), movement);

    const errors: Record<string, string> = {};
    const prepared: Prepared[] = [];
    for (const line of lines) {
        const item = items.get(line.itemId);
        if (!item) {
            errors[`${line.field}.item_id`] = 'Pilih barang dari daftar.';
            continue;
        }
        if (item.blocked)
            errors[`${line.field}.item_id`] =
                `Barang ${item.code} diblokir, jadi stoknya tidak bisa diposting.`;
        if (line.quantity <= 0n)
            errors[`${line.field}.quantity`] = 'Isi jumlah lebih dari 0.';
        switch (line.kind) {
            case 'inbound': {
                const location = locations.get(line.locationId);
                if (!location) {
                    errors[`${line.field}.location_id`] =
                        'Pilih lokasi dari daftar.';
                    break;
                }
                const { tracking } = policyOf(item, location, 'inbound');
                const existing = line.batchNumber
                    ? await db.one(
                          batchSchema,
                          `select id, barang_id as item_id, no_batch as number, kedaluwarsa::text as expiry
                           from gd_m_batch where tenant_id = $1 and barang_id = $2 and no_batch = $3`,
                          [tenantId, item.id, line.batchNumber],
                      )
                    : undefined;
                const expiry = line.expiry ?? existing?.expiry ?? null;
                if (line.expiry !== null && line.batchNumber === null)
                    errors[`${line.field}.batch_number`] =
                        'Isi nomor batch. Tanggal kedaluwarsa dicatat per batch.';
                else if (tracking.batchRequired && line.batchNumber === null)
                    errors[`${line.field}.batch_number`] =
                        'Isi nomor batch. Barang ini wajib dicatat per batch.';
                if (tracking.expiryRequired && expiry === null)
                    errors[`${line.field}.expiry_date`] =
                        'Isi tanggal kedaluwarsa. Barang ini wajib dicatat tanggal kedaluwarsanya.';
                else if (existing && line.expiry !== null)
                    mismatch(errors, line.field, existing, line.expiry);
                if (line.unitCost < 0n)
                    errors[`${line.field}.unit_cost`] =
                        'Isi harga satuan 0 atau lebih.';
                prepared.push({
                    kind: 'inbound',
                    line,
                    item,
                    location,
                    expiry,
                });
                break;
            }
            case 'outbound': {
                const location = locations.get(line.locationId);
                if (!location) {
                    errors[`${line.field}.location_id`] =
                        'Pilih lokasi dari daftar.';
                    break;
                }
                const policy = policyOf(item, location, 'outbound');
                const batch = checkChosen(
                    errors,
                    line,
                    item,
                    policy,
                    chosen,
                    postingDate,
                );
                prepared.push({
                    kind: 'outbound',
                    line,
                    item,
                    location,
                    policy,
                    batch,
                });
                break;
            }
            case 'transfer': {
                const from = locations.get(line.fromLocationId);
                const to = locations.get(line.toLocationId);
                if (!from)
                    errors[`${line.field}.location_id`] =
                        'Pilih lokasi asal dari daftar.';
                if (!to)
                    errors[`${line.field}.to_location_id`] =
                        'Pilih lokasi tujuan dari daftar.';
                else if (line.toLocationId === line.fromLocationId)
                    errors[`${line.field}.to_location_id`] =
                        'Lokasi tujuan harus berbeda dengan lokasi asal.';
                if (!from || !to) break;
                const policy = policyOf(item, from, 'transfer');
                const batch = checkChosen(
                    errors,
                    line,
                    item,
                    policy,
                    chosen,
                    postingDate,
                );
                prepared.push({
                    kind: 'transfer',
                    line,
                    item,
                    from,
                    to,
                    policy,
                    batch,
                });
                break;
            }
            default: {
                const unknown: never = line;
                throw new Error(
                    `Unknown item line: ${JSON.stringify(unknown)}`,
                );
            }
        }
    }
    if (Object.keys(errors).length) validation(errors);
    return prepared;
}

function mismatch(
    errors: Record<string, string>,
    field: string,
    batch: Batch,
    expiry: string,
) {
    if (batch.expiry === expiry) return;
    errors[`${field}.expiry_date`] =
        batch.expiry === null
            ? `Batch ${batch.number} sudah tercatat tanpa tanggal kedaluwarsa. Batch yang sama harus memakai tanggal kedaluwarsa yang sama.`
            : `Batch ${batch.number} sudah tercatat dengan kedaluwarsa ${batch.expiry}. Batch yang sama harus memakai tanggal kedaluwarsa yang sama.`;
}

function checkChosen(
    errors: Record<string, string>,
    line: OutboundLine | TransferLine,
    item: Item,
    policy: StockPolicy,
    chosen: Map<string, Batch>,
    postingDate: string,
): Batch | null {
    const field = `${line.field}.batch_id`;
    if (line.batchId === null) {
        if (policy.picking === 'manual' && policy.tracking.batchRequired)
            errors[field] =
                'Pilih batch yang diambil. Lokasi ini mengambil stok dari batch yang dipilih.';
        return null;
    }
    const batch = chosen.get(line.batchId);
    if (batch?.item_id !== item.id) {
        errors[field] = 'Pilih batch dari daftar.';
        return null;
    }
    if (
        policy.tracking.strictExpiry &&
        batch.expiry !== null &&
        batch.expiry < postingDate
    )
        errors[field] =
            `Batch ${batch.number} sudah kedaluwarsa sejak ${batch.expiry}, jadi tidak bisa dikeluarkan.`;
    return batch;
}

// Batch baru dicatat saat pertama kali masuk. Dua penerimaan batch yang sama di lokasi berbeda bisa berjalan bersamaan,
// jadi yang kalah membaca batch pemenang dan tetap dibandingkan tanggal kedaluwarsanya.
async function ensureBatch(
    db: Database,
    context: PostingContext,
    line: InboundLine,
    number: string,
    expiry: string | null,
): Promise<{ id: string; expiry: string | null }> {
    await db.execute(
        `insert into gd_m_batch (id, tenant_id, legal_entity_id, barang_id, no_batch, kedaluwarsa, created_at,
                                 created_by_user_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (tenant_id, barang_id, no_batch) do nothing`,
        [
            Bun.randomUUIDv7(),
            context.tenantId,
            context.legalEntityId,
            line.itemId,
            number,
            expiry,
            nowSql(),
            context.userId,
        ],
    );
    const batch = await db.one(
        batchSchema,
        `select id, barang_id as item_id, no_batch as number, kedaluwarsa::text as expiry
         from gd_m_batch where tenant_id = $1 and barang_id = $2 and no_batch = $3`,
        [context.tenantId, line.itemId, number],
    );
    if (!batch) throw new Error(`Batch ${number} was not recorded.`);
    if (expiry !== null) {
        const errors: Record<string, string> = {};
        mismatch(errors, line.field, batch, expiry);
        if (Object.keys(errors).length) validation(errors);
    }
    return batch;
}

// Stok masuk. Bila sebelumnya stok minus diizinkan, kekurangan baris keluar yang masih terbuka di barang dan lokasi
// ini dilunasi lebih dulu, dari yang paling lama; kekurangan yang menunjuk batch lain menunggu batch itu.
async function receive(
    ledger: Ledger,
    context: PostingContext,
    entry: {
        key: string;
        sourceLineId: string | null;
        itemId: string;
        location: Location;
        quantity: bigint;
        unitCost: bigint;
        batchId: string | null;
        expiry: string | null;
        kind: EntryKind;
    },
): Promise<void> {
    const negatives = (
        await ledger.db.rows(
            openSchema,
            `select id, batch_id, kedaluwarsa::text as expiry, (-sisa)::text as open,
                    harga_satuan::text as unit_cost
             from gd_tr_kartu_gudang
             where tenant_id = $1 and legal_entity_id = $2 and barang_id = $3 and lokasi_id = $4 and sisa < 0
               and ${entry.batchId === null ? 'batch_id is null' : '(batch_id is null or batch_id = $5)'}
             order by tanggal_posting, id`,
            [
                context.tenantId,
                context.legalEntityId,
                entry.itemId,
                entry.location.id,
                ...(entry.batchId === null ? [] : [entry.batchId]),
            ],
        )
    ).map(openEntry);
    const id = await ledger.insert({
        key: ledger.nextKey(entry.key),
        location: entry.location,
        itemId: entry.itemId,
        batchId: entry.batchId,
        expiry: entry.expiry,
        kind: entry.kind,
        postingDate: context.postingDate,
        quantity: entry.quantity,
        unitCost: entry.unitCost,
        amount: amountOf([
            { quantity: entry.quantity, unitCost: entry.unitCost },
        ]),
        source: context.source,
        sourceLineId: entry.sourceLineId,
        reversedFrom: null,
    });
    for (const slice of allocate(negatives, entry.quantity).slices)
        await ledger.apply(id, slice.entry.id, slice.quantity);
}

// Satu baris kartu gudang per batch. Bila stok minus diizinkan, kekurangannya tetap terbuka pada batch yang dipilih,
// atau tanpa batch, sampai penerimaan berikutnya melunasinya.
async function issue(
    ledger: Ledger,
    context: PostingContext,
    args: {
        line: OutboundLine | TransferLine;
        item: Item;
        location: Location;
        policy: StockPolicy;
        batch: Batch | null;
        kind: EntryKind;
    },
): Promise<Slice[]> {
    const { line, item, location, policy } = args;
    const plan = candidates(policy.picking, line.batchId);
    const skipExpired =
        policy.tracking.strictExpiry && plan.batch.kind === 'any';
    const open = (
        await ledger.db.rows(
            openSchema,
            ...openInbound(context, item.id, location.id, plan, skipExpired),
        )
    ).map(openEntry);
    const { slices, shortfall } = allocate(open, line.quantity);
    if (shortfall > 0n && policy.refuseNegative)
        await refuseShortage(ledger.db, context, {
            line,
            item,
            locationId: location.id,
            available: open.reduce((sum, entry) => sum + entry.open, 0n),
            skipExpired,
        });
    const groups = new Map<
        string | null,
        { expiry: string | null; slices: Slice[]; shortfall: bigint }
    >();
    for (const slice of slices) {
        const group = groups.get(slice.entry.batchId) ?? {
            expiry: slice.entry.expiry,
            slices: [],
            shortfall: 0n,
        };
        group.slices.push(slice);
        groups.set(slice.entry.batchId, group);
    }
    if (shortfall > 0n) {
        const target =
            plan.batch.kind === 'exactly' ? plan.batch.batchId : null;
        const group = groups.get(target) ?? {
            expiry: target === null ? null : (args.batch?.expiry ?? null),
            slices: [],
            shortfall: 0n,
        };
        group.shortfall = shortfall;
        groups.set(target, group);
    }
    for (const [batchId, group] of groups) {
        const taken = group.slices.reduce(
            (sum, slice) => sum + slice.quantity,
            0n,
        );
        const id = await ledger.insert({
            key: ledger.nextKey(line.key),
            location,
            itemId: item.id,
            batchId,
            expiry: group.expiry,
            kind: args.kind,
            postingDate: context.postingDate,
            quantity: -(taken + group.shortfall),
            unitCost: null,
            amount: -amountOf(
                group.slices.map((slice) => ({
                    quantity: slice.quantity,
                    unitCost: slice.entry.unitCost,
                })),
            ),
            source: context.source,
            sourceLineId: line.sourceLineId,
            reversedFrom: null,
        });
        for (const slice of group.slices)
            await ledger.apply(slice.entry.id, id, slice.quantity);
    }
    return slices;
}

async function refuseShortage(
    db: Database,
    context: PostingContext,
    args: {
        line: OutboundLine | TransferLine;
        item: Item;
        locationId: string;
        available: bigint;
        skipExpired: boolean;
    },
): Promise<never> {
    const expired =
        args.skipExpired &&
        (await db.one(
            z.object({ id: z.string() }),
            `select id from gd_tr_kartu_gudang
             where tenant_id = $1 and legal_entity_id = $2 and barang_id = $3 and lokasi_id = $4 and sisa > 0
               and kedaluwarsa < $5::date
             limit 1`,
            [
                context.tenantId,
                context.legalEntityId,
                args.item.id,
                args.locationId,
                context.postingDate,
            ],
        )) !== undefined;
    const unit = args.item.unit;
    return validation({
        [`${args.line.field}.quantity`]:
            `Stok ${args.item.code} tidak cukup. Tersedia ${display(args.available, quantityScale)} ${unit}, diminta ${display(args.line.quantity, quantityScale)} ${unit}.` +
            (expired ? ' Stok yang sudah kedaluwarsa tidak dihitung.' : ''),
    });
}

function openInbound(
    context: PostingContext,
    itemId: string,
    locationId: string,
    plan: Candidates,
    skipExpired: boolean,
): [string, (string | null)[]] {
    const bindings: (string | null)[] = [
        context.tenantId,
        context.legalEntityId,
        itemId,
        locationId,
    ];
    const bind = (value: string | null) => `$${bindings.push(value)}`;
    let filter = '';
    switch (plan.batch.kind) {
        case 'any':
            break;
        case 'exactly':
            filter =
                plan.batch.batchId === null
                    ? ' and batch_id is null'
                    : ` and batch_id = ${bind(plan.batch.batchId)}`;
            break;
        default: {
            const unknown: never = plan.batch;
            throw new Error(`Unknown batch filter: ${JSON.stringify(unknown)}`);
        }
    }
    if (skipExpired)
        filter += ` and (kedaluwarsa is null or kedaluwarsa >= ${bind(context.postingDate)}::date)`;
    let order: string;
    switch (plan.order) {
        case 'expiry':
            order = 'kedaluwarsa asc nulls last, tanggal_posting, id';
            break;
        case 'posting':
            order = 'tanggal_posting, id';
            break;
        default: {
            const unknown: never = plan.order;
            throw new Error(`Unknown order: ${String(unknown)}`);
        }
    }
    return [
        `select id, batch_id, kedaluwarsa::text as expiry, sisa::text as open, harga_satuan::text as unit_cost
         from gd_tr_kartu_gudang
         where tenant_id = $1 and legal_entity_id = $2 and barang_id = $3 and lokasi_id = $4 and sisa > 0${filter}
         order by ${order}`,
        bindings,
    ];
}

// Membatalkan posting satu dokumen sumber tanpa mengubah baris lamanya (Undo di BC). Setiap baris sumber mendapat baris
// pembalik yang menunjuknya, bertanggal sama dengan aslinya. Baris masuk hanya boleh dibalik selama stoknya belum
// tersentuh (sisa = jumlah). Baris keluar dibalik dengan membuka lagi stok yang diambilnya: batch, kedaluwarsa, dan
// harga satuannya sama dengan baris masuk asalnya.
export async function reverseItemEntries(
    db: Database,
    context: { tenantId: string; legalEntityId: string; userId: string | null },
    source: { type: string; id: string },
): Promise<void> {
    if (!db.inTransaction)
        throw new Error(
            'reverseItemEntries must run inside the document transaction.',
        );
    const { tenantId, legalEntityId } = context;
    const scope = `tenant_id = $1 and legal_entity_id = $2 and sumber_jenis = $3 and sumber_id = $4`;
    const parameters = [tenantId, legalEntityId, source.type, source.id];
    const touched = await db.rows(
        z.object({ item_id: z.string(), location_id: z.string() }),
        `select distinct barang_id as item_id, lokasi_id as location_id from gd_tr_kartu_gudang where ${scope}`,
        parameters,
    );
    await lock(
        db,
        tenantId,
        touched.map((pair) => ({
            itemId: pair.item_id,
            locationId: pair.location_id,
        })),
    );
    const entries = await db.rows(
        entrySchema,
        `select id, operating_unit_id, lokasi_id as location_id, barang_id as item_id, batch_id,
                kedaluwarsa::text as expiry, jenis as kind, tanggal_posting::text as posting_date,
                jumlah::text as quantity, sisa::text as open, harga_satuan::text as unit_cost, nilai::text as amount,
                sumber_jenis as source_type, sumber_id as source_id, sumber_baris_id as source_line_id,
                sumber_nomor as source_number
         from gd_tr_kartu_gudang where ${scope} and dibalik_dari is null
         order by id`,
        parameters,
    );
    if (!entries.length) return;
    const reversed = await db.one(
        z.object({ id: z.string() }),
        `select id from gd_tr_kartu_gudang where ${scope} and dibalik_dari is not null limit 1`,
        parameters,
    );
    if (reversed)
        validation({ _form: 'Posting dokumen ini sudah dibatalkan.' });
    if (
        entries.some(
            (entry) =>
                quantityOf(entry.quantity) > 0n &&
                quantityOf(entry.open) !== quantityOf(entry.quantity),
        )
    )
        validation({
            _form: 'Stok yang masuk lewat dokumen ini sudah dipakai, jadi postingnya tidak bisa dibatalkan.',
        });
    const ledger = new Ledger(db, tenantId, legalEntityId, context.userId);
    for (const entry of entries) {
        const quantity = quantityOf(entry.quantity);
        const reversal = {
            location: {
                id: entry.location_id,
                operating_unit_id: entry.operating_unit_id,
            },
            itemId: entry.item_id,
            kind: entry.kind,
            postingDate: entry.posting_date,
            source: {
                type: entry.source_type,
                id: entry.source_id,
                number: entry.source_number,
            },
            sourceLineId: entry.source_line_id,
            reversedFrom: entry.id,
        };
        const key = `reverse:${entry.id}`;
        if (quantity > 0n) {
            const id = await ledger.insert({
                ...reversal,
                key: ledger.nextKey(key),
                batchId: entry.batch_id,
                expiry: entry.expiry,
                quantity: -quantity,
                unitCost: null,
                amount: -fromNumeric(entry.amount, amountScale),
            });
            await ledger.apply(entry.id, id, quantity);
            continue;
        }
        const taken = await db.rows(
            z.object({
                quantity: z.string(),
                batch_id: z.string().nullable(),
                expiry: z.string().nullable(),
                unit_cost: z.string(),
            }),
            `select a.jumlah::text as quantity, i.batch_id, i.kedaluwarsa::text as expiry,
                    i.harga_satuan::text as unit_cost
             from gd_tr_kartu_gudang_aplikasi a
             join gd_tr_kartu_gudang i on i.tenant_id = a.tenant_id and i.id = a.entri_masuk_id
             where a.tenant_id = $1 and a.entri_keluar_id = $2
             order by a.id`,
            [tenantId, entry.id],
        );
        for (const part of taken) {
            const partQuantity = quantityOf(part.quantity);
            const unitCost = quantityOf(part.unit_cost);
            await ledger.insert({
                ...reversal,
                key: ledger.nextKey(key),
                batchId: part.batch_id,
                expiry: part.expiry,
                quantity: partQuantity,
                unitCost,
                amount: amountOf([{ quantity: partQuantity, unitCost }]),
            });
        }
        const unapplied = -quantityOf(entry.open);
        if (unapplied > 0n) {
            const id = await ledger.insert({
                ...reversal,
                key: ledger.nextKey(key),
                batchId: entry.batch_id,
                expiry: entry.expiry,
                quantity: unapplied,
                unitCost: 0n,
                amount: 0n,
            });
            await ledger.apply(id, entry.id, unapplied);
        }
    }
}
