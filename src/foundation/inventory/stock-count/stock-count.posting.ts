import { z } from 'zod';
import type { Database } from '../../../platform/database/index.ts';
import { HttpFailure, validation } from '../../../platform/http/index.ts';
import { noFunding, type Funding } from '../item-ledger/allocation.ts';
import type { ItemLine } from '../item-ledger/item-ledger.posting.ts';
import { fromNumeric, quantityScale, toNumeric } from '../quantity.ts';

// Bacaan kartu gudang yang dipakai posting opname: stok tercatat per barang dan batch sampai tanggal posting, gerak
// sesudah hitung dimulai, harga dan sumber dana stok temuan, dan baris yang dikirim ke mesin posting. Pratinjau Post
// memakai bacaan yang sama, tanpa kunci.

export const sourceType = 'opname';

export type StoredLine = {
    id: string;
    itemId: string;
    batchId: string | null;
    knownBatchNumber: string | null;
    newBatchNumber: string | null;
    expiry: string | null;
    counted: bigint | null;
    batchRequired: boolean;
    expiryRequired: boolean;
};

// Hasil membandingkan hitungan dengan stok tercatat sampai tanggal posting, satu per baris.
export type Assessed = {
    line: StoredLine;
    index: number;
    batchId: string | null;
    expected: bigint;
    counted: bigint;
    difference: bigint;
    moved: boolean;
};

export type Cost = { unitCost: bigint; funding: Funding };

const fundingRow = {
    unit_cost: z.string(),
    funding_source_id: z.string().nullable(),
    program_id: z.string().nullable(),
    budget_year: z.number().nullable(),
};
const costOf = (row: {
    unit_cost: string;
    funding_source_id: string | null;
    program_id: string | null;
    budget_year: number | null;
}): Cost => ({
    unitCost: fromNumeric(row.unit_cost, quantityScale),
    funding: {
        sourceId: row.funding_source_id,
        programId: row.program_id,
        budgetYear: row.budget_year,
    },
});

export const quantityText = (value: bigint) => toNumeric(value, quantityScale);
export const quantityOf = (text: string) => fromNumeric(text, quantityScale);
export const placeholders = (values: unknown[], start: number) =>
    values.map((_, index) => `$${index + start}`).join(',');
export const unique = <T>(values: T[]) => [...new Set(values)];
export const positionKey = (itemId: string, batchId: string | null) =>
    `${itemId}:${batchId ?? ''}`;

// Penolakan mesin posting memakai nama isian baris kartu gudang; layar opname menamai jumlah dan batch barisnya
// sendiri, jadi kesalahannya dipindah ke isian itu.
const failureSchema = z.object({
    errors: z.record(z.string(), z.array(z.string())),
});
export async function underLineNames(work: () => Promise<void>): Promise<void> {
    try {
        await work();
    } catch (error) {
        const parsed =
            error instanceof HttpFailure && error.status === 422
                ? failureSchema.safeParse(error.body)
                : undefined;
        if (!parsed?.success) throw error;
        validation(
            Object.fromEntries(
                Object.entries(parsed.data.errors).map(([field, list]) => [
                    field
                        .replace(/\.quantity$/, '.quantity_counted')
                        .replace(/\.batch_id$/, '.batch_number'),
                    list,
                ]),
            ),
        );
    }
}

export class StockCountLedger {
    constructor(
        private readonly db: Database,
        private readonly scope: { tenantId: string; legalEntityId: string },
    ) {}

    async batches(itemIds: string[], batchIds: string[], numbers: string[]) {
        const schema = z.object({
            id: z.string(),
            item_id: z.string(),
            number: z.string(),
            expiry: z.string().nullable(),
        });
        const columns =
            'id, barang_id as item_id, no_batch as number, kedaluwarsa::text as expiry';
        const byId = new Map(
            (batchIds.length
                ? await this.db.rows(
                      schema,
                      `select ${columns} from gd_m_batch
                       where tenant_id = $1 and legal_entity_id = $2 and id in (${placeholders(batchIds, 3)})`,
                      [
                          this.scope.tenantId,
                          this.scope.legalEntityId,
                          ...batchIds,
                      ],
                  )
                : []
            ).map((batch) => [batch.id, batch]),
        );
        const byNumber = new Map(
            (itemIds.length && numbers.length
                ? await this.db.rows(
                      schema,
                      `select ${columns} from gd_m_batch
                       where tenant_id = $1 and legal_entity_id = $2
                         and barang_id in (${placeholders(itemIds, 3)})
                         and no_batch in (${placeholders(numbers, 3 + itemIds.length)})`,
                      [
                          this.scope.tenantId,
                          this.scope.legalEntityId,
                          ...itemIds,
                          ...numbers,
                      ],
                  )
                : []
            ).map((batch) => [`${batch.item_id}:${batch.number}`, batch]),
        );
        return { byId, byNumber };
    }

    // Stok tercatat per barang dan batch di satu lokasi, dari semua gerak sampai tanggal posting, seperti Qty.
    // Expected di BC yang menyaring kartu gudang sampai Posting Date opname.
    async expectedAt(
        locationId: string,
        postingDate: string,
        itemIds: string[],
    ) {
        const found = new Map<string, bigint>();
        if (!itemIds.length) return found;
        const rows = await this.db.rows(
            z.object({
                item_id: z.string(),
                batch_id: z.string().nullable(),
                quantity: z.string(),
            }),
            `select barang_id as item_id, batch_id, sum(jumlah)::text as quantity
             from gd_tr_kartu_gudang
             where tenant_id = $1 and legal_entity_id = $2 and lokasi_id = $3 and tanggal_posting <= $4::date
               and barang_id in (${placeholders(itemIds, 5)})
             group by barang_id, batch_id`,
            [
                this.scope.tenantId,
                this.scope.legalEntityId,
                locationId,
                postingDate,
                ...itemIds,
            ],
        );
        for (const row of rows)
            found.set(
                positionKey(row.item_id, row.batch_id),
                quantityOf(row.quantity),
            );
        return found;
    }

    // Jumlah tercatat sampai tanggal posting dan gerak sesudah hitung dimulai, per baris. Batch temuan yang nomornya
    // tercatat sesudah baris dibuat dibaca sebagai batch itu.
    async assess(
        facts: { location_id: string; started_at: string | null },
        lines: StoredLine[],
        postingDate: string,
    ): Promise<Assessed[]> {
        const itemIds = unique(lines.map((line) => line.itemId));
        const numbers = unique(
            lines.flatMap((line) =>
                line.newBatchNumber === null ? [] : [line.newBatchNumber],
            ),
        );
        const { byNumber } = await this.batches(itemIds, [], numbers);
        const expected = await this.expectedAt(
            facts.location_id,
            postingDate,
            itemIds,
        );
        const moved = new Set(
            facts.started_at === null || !itemIds.length
                ? []
                : (
                      await this.db.rows(
                          z.object({
                              item_id: z.string(),
                              batch_id: z.string().nullable(),
                          }),
                          `select distinct barang_id as item_id, batch_id
                           from gd_tr_kartu_gudang
                           where tenant_id = $1 and legal_entity_id = $2 and lokasi_id = $3
                             and created_at > $4::timestamp and barang_id in (${placeholders(itemIds, 5)})`,
                          [
                              this.scope.tenantId,
                              this.scope.legalEntityId,
                              facts.location_id,
                              facts.started_at,
                              ...itemIds,
                          ],
                      )
                  ).map((row) => positionKey(row.item_id, row.batch_id)),
        );
        return lines.map((line, index) => {
            const batchId =
                line.batchId ??
                (line.newBatchNumber === null
                    ? null
                    : (byNumber.get(`${line.itemId}:${line.newBatchNumber}`)
                          ?.id ?? null));
            const unknownBatch =
                line.newBatchNumber !== null && batchId === null;
            const key = positionKey(line.itemId, batchId);
            const quantity = unknownBatch ? 0n : (expected.get(key) ?? 0n);
            const counted = line.counted ?? 0n;
            return {
                line,
                index,
                batchId,
                expected: quantity,
                counted,
                difference: counted - quantity,
                moved: !unknownBatch && moved.has(key),
            };
        });
    }

    // Harga dan sumber dana stok temuan: dari baris masuk terakhir batch itu di lokasi ini, lalu dari baris masuk
    // terakhir barang itu di legal entity, lalu 0 tanpa sumber dana. Baris masuk yang postingnya dibatalkan dan baris
    // pembalik tidak dihitung, karena harganya bukan harga stok yang masih berlaku.
    async costs(locationId: string, wanted: Assessed[]) {
        const itemIds = unique(wanted.map((entry) => entry.line.itemId));
        const atLocation = new Map<string, Cost>();
        const inEntity = new Map<string, Cost>();
        if (itemIds.length) {
            const usable = `k.jumlah > 0 and k.dibalik_dari is null and k.harga_satuan is not null
                            and not exists (select 1 from gd_tr_kartu_gudang r
                                            where r.tenant_id = k.tenant_id and r.dibalik_dari = k.id)`;
            const columns = `k.harga_satuan::text as unit_cost, k.sumber_dana_id as funding_source_id,
                             k.program_pengadaan_id as program_id, k.tahun_anggaran as budget_year`;
            for (const row of await this.db.rows(
                z.object({
                    item_id: z.string(),
                    batch_id: z.string().nullable(),
                    ...fundingRow,
                }),
                `select distinct on (k.barang_id, k.batch_id) k.barang_id as item_id, k.batch_id, ${columns}
                 from gd_tr_kartu_gudang k
                 where k.tenant_id = $1 and k.legal_entity_id = $2 and k.lokasi_id = $3
                   and k.barang_id in (${placeholders(itemIds, 4)}) and ${usable}
                 order by k.barang_id, k.batch_id, k.tanggal_posting desc, k.id desc`,
                [
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    locationId,
                    ...itemIds,
                ],
            ))
                atLocation.set(
                    positionKey(row.item_id, row.batch_id),
                    costOf(row),
                );
            for (const row of await this.db.rows(
                z.object({ item_id: z.string(), ...fundingRow }),
                `select distinct on (k.barang_id) k.barang_id as item_id, ${columns}
                 from gd_tr_kartu_gudang k
                 where k.tenant_id = $1 and k.legal_entity_id = $2 and k.barang_id in (${placeholders(itemIds, 3)})
                   and ${usable}
                 order by k.barang_id, k.tanggal_posting desc, k.id desc`,
                [this.scope.tenantId, this.scope.legalEntityId, ...itemIds],
            ))
                inEntity.set(row.item_id, costOf(row));
        }
        return (entry: Assessed): Cost =>
            atLocation.get(positionKey(entry.line.itemId, entry.batchId)) ??
            inEntity.get(entry.line.itemId) ?? {
                unitCost: 0n,
                funding: noFunding,
            };
    }

    // Selisih lebih masuk sebagai penyesuaian tambah pada batchnya (batch temuan dicatat mesin posting); selisih kurang
    // keluar dari batch itu saja, membawa sumber dana stok yang diambilnya.
    itemLine(
        entry: Assessed,
        locationId: string,
        cost: (entry: Assessed) => Cost,
    ): ItemLine[] {
        const { line } = entry;
        const base = {
            key: `${sourceType}:${line.id}`,
            field: `lines.${entry.index}`,
            sourceLineId: line.id,
            itemId: line.itemId,
            locationId,
        };
        if (entry.difference > 0n) {
            const found = cost(entry);
            return [
                {
                    ...base,
                    kind: 'inbound',
                    entryKind: 'penyesuaian_tambah',
                    quantity: entry.difference,
                    unitCost: found.unitCost,
                    funding: found.funding,
                    batchNumber: line.knownBatchNumber ?? line.newBatchNumber,
                    expiry: line.batchId === null ? line.expiry : null,
                },
            ];
        }
        if (entry.difference < 0n)
            return [
                {
                    ...base,
                    kind: 'outbound',
                    entryKind: 'penyesuaian_kurang',
                    quantity: -entry.difference,
                    batchId: entry.batchId,
                    exactBatch: true,
                },
            ];
        return [];
    }
}
