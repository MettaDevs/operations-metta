import { z } from 'zod';
import type { Database } from '../../../platform/database/index.ts';
import { fromNumeric, quantityScale } from '../quantity.ts';
import type { Funding } from './allocation.ts';

// Bacaan kartu gudang untuk module yang menggerakkan stok lewat postItemLines, supaya module tidak menulis query atas
// tabel gd_* sendiri: stok terbuka per batch di satu lokasi, dan stok yang sudah diambil baris keluar satu dokumen.

type Scope = { tenantId: string; legalEntityId: string };
export type StockBatch = {
    id: string;
    number: string;
    expiry: string | null;
};

const quantityOf = (text: string) => fromNumeric(text, quantityScale);
const placeholders = (values: unknown[], start: number) =>
    values.map((_, index) => `$${index + start}`).join(',');

// Stok yang masih ada per barang dan batch di satu lokasi, kedaluwarsa terdekat lebih dulu. Stok tanpa batch tampil
// dengan batch kosong; posisi yang minus tidak ikut.
export async function openStock(
    db: Database,
    scope: Scope,
    locationId: string,
    itemIds: string[],
): Promise<{ itemId: string; batch: StockBatch | null; quantity: bigint }[]> {
    if (!itemIds.length) return [];
    const rows = await db.rows(
        z.object({
            item_id: z.string(),
            batch_id: z.string().nullable(),
            batch_number: z.string().nullable(),
            expiry: z.string().nullable(),
            quantity: z.string(),
        }),
        `select k.barang_id as item_id, t.id as batch_id, t.no_batch as batch_number,
                t.kedaluwarsa::text as expiry, sum(k.sisa)::text as quantity
         from gd_tr_kartu_gudang k
         left join gd_m_batch t on t.tenant_id = k.tenant_id and t.id = k.batch_id
         where k.tenant_id = $1 and k.legal_entity_id = $2 and k.lokasi_id = $3 and k.sisa <> 0
           and k.barang_id in (${placeholders(itemIds, 4)})
         group by k.barang_id, t.id
         having sum(k.sisa) > 0
         order by k.barang_id, t.kedaluwarsa nulls last, t.no_batch`,
        [scope.tenantId, scope.legalEntityId, locationId, ...itemIds],
    );
    return rows.map((row) => ({
        itemId: row.item_id,
        batch:
            row.batch_id === null
                ? null
                : {
                      id: row.batch_id,
                      number: row.batch_number ?? '',
                      expiry: row.expiry,
                  },
        quantity: quantityOf(row.quantity),
    }));
}

// Stok yang diambil baris keluar satu dokumen sumber dan belum dibalik, per bagian baris masuk asalnya: batch,
// kedaluwarsa, harga satuan, dan sumber dana. Retur memakai bagian ini supaya stok kembali dengan nilai yang sama
// dengan saat keluar (Appl.-from Item Entry pada retur penjualan BC). Kekurangan pada lokasi yang mengizinkan stok
// minus belum punya baris masuk asal, jadi tampil dengan harga satuan 0 dan tanpa sumber dana.
export type IssuedSlice = {
    sourceLineId: string | null;
    locationId: string;
    itemId: string;
    batch: StockBatch | null;
    quantity: bigint;
    unitCost: bigint;
    funding: Funding;
};

export async function issuedSlices(
    db: Database,
    scope: Scope,
    source: { type: string; id: string },
): Promise<IssuedSlice[]> {
    const rows = await db.rows(
        z.object({
            source_line_id: z.string().nullable(),
            location_id: z.string(),
            item_id: z.string(),
            batch_id: z.string().nullable(),
            batch_number: z.string().nullable(),
            expiry: z.string().nullable(),
            quantity: z.string(),
            unit_cost: z.string(),
            funding_source_id: z.string().nullable(),
            program_id: z.string().nullable(),
            budget_year: z.number().nullable(),
        }),
        `with issued as (
             select k.* from gd_tr_kartu_gudang k
             where k.tenant_id = $1 and k.legal_entity_id = $2 and k.sumber_jenis = $3 and k.sumber_id = $4
               and k.jumlah < 0 and k.dibalik_dari is null
               and not exists (select 1 from gd_tr_kartu_gudang r
                               where r.tenant_id = k.tenant_id and r.dibalik_dari = k.id))
         select k.sumber_baris_id as source_line_id, k.lokasi_id as location_id, k.barang_id as item_id,
                i.batch_id, t.no_batch as batch_number, i.kedaluwarsa::text as expiry,
                a.jumlah::text as quantity, i.harga_satuan::text as unit_cost,
                i.sumber_dana_id as funding_source_id, i.program_pengadaan_id as program_id,
                i.tahun_anggaran as budget_year, k.id as entry_id, a.id as part_id
         from issued k
         join gd_tr_kartu_gudang_aplikasi a on a.tenant_id = k.tenant_id and a.entri_keluar_id = k.id
         join gd_tr_kartu_gudang i on i.tenant_id = a.tenant_id and i.id = a.entri_masuk_id
         left join gd_m_batch t on t.tenant_id = i.tenant_id and t.id = i.batch_id
         union all
         select k.sumber_baris_id, k.lokasi_id, k.barang_id, k.batch_id, t.no_batch, k.kedaluwarsa::text,
                (-k.sisa)::text, '0', null, null, null, k.id, k.id
         from issued k
         left join gd_m_batch t on t.tenant_id = k.tenant_id and t.id = k.batch_id
         where k.sisa < 0
         order by entry_id, part_id`,
        [scope.tenantId, scope.legalEntityId, source.type, source.id],
    );
    return rows.map((row) => ({
        sourceLineId: row.source_line_id,
        locationId: row.location_id,
        itemId: row.item_id,
        batch:
            row.batch_id === null
                ? null
                : {
                      id: row.batch_id,
                      number: row.batch_number ?? '',
                      expiry: row.expiry,
                  },
        quantity: quantityOf(row.quantity),
        unitCost: quantityOf(row.unit_cost),
        funding: {
            sourceId: row.funding_source_id,
            programId: row.program_id,
            budgetYear: row.budget_year,
        },
    }));
}
