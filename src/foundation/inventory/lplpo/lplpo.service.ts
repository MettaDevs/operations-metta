import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import type { Bind, Database } from '../../../platform/database/index.ts';
import {
    dateSchema,
    lookupId,
    validation,
} from '../../../platform/http/index.ts';
import {
    activeLegalEntity,
    categoryTreeSql,
    exists,
} from '../inventory.service.ts';
import {
    entryKinds,
    type EntryKind,
} from '../item-ledger/item-ledger.posting.ts';
import { display, fromNumeric, quantityScale } from '../quantity.ts';
import type { transferOrderStatuses } from '../transfer/transfer-order.schema.ts';
import { lplpoRowSchema, lplpoSchema } from './lplpo.schema.ts';

// LPLPO (Laporan Pemakaian dan Lembar Permintaan Obat) satu lokasi atau satu operating unit, dihitung dari kartu gudang
// dengan agregat SQL. Pengganti SP SIMPUS_LPLPO di sistem lama, yang membagi kolom pemberian dengan id subkategori yang
// ditulis mati; di sini penerimaan dibagi per sumber dana yang melekat pada baris kartu gudang, dan kolomnya dibaca dari
// master sumber dana.
//
// Kolom tempat setiap jenis gerak dihitung. Formulir LPLPO menghitung pemakaian sebagai barang yang dikeluarkan selama
// periode, jadi penyerahan ke pasien, pemakaian unit, dan kiriman ke lokasi lain masuk pemakaian. Penyesuaian (opname,
// pemusnahan, kedaluwarsa, saldo awal) punya kolomnya sendiri supaya tidak tersembunyi di pemakaian. Transfer
// bergantung arah: masuk ke cakupan berarti penerimaan, keluar berarti pemakaian. Transfer yang kedua kakinya ada di
// dalam cakupan (antarlokasi satu operating unit) tidak dihitung sama sekali, karena jumlahnya nol bagi cakupan itu.
type Column = 'receipts' | 'usage' | 'adjustment' | 'transfer';
const columnOf: Record<EntryKind, Column> = {
    penerimaan: 'receipts',
    penyerahan: 'usage',
    pemakaian: 'usage',
    penyesuaian_tambah: 'adjustment',
    penyesuaian_kurang: 'adjustment',
    transfer: 'transfer',
};

// Amprah yang sudah diajukan, termasuk yang sudah selesai, dihitung sebagai permintaan; draf dan amprah batal tidak.
const requestStatuses: (typeof transferOrderStatuses)[number][] = [
    'diajukan',
    'selesai',
];

const reference = (alias: string) =>
    `case when ${alias}.id is null then null else json_build_object(
         'id', ${alias}.id, 'code', ${alias}.kode, 'name', ${alias}.nama) end`;

const totalsSchema = z.object({
    item: lplpoRowSchema.shape.item,
    category: lplpoRowSchema.shape.category,
    opening: z.string(),
    receipts: z.string(),
    usage: z.string(),
    adjustment: z.string(),
    ledger_closing: z.string(),
    receipts_by_funding: z.record(z.string(), z.string()),
    receipts_without_funding: z.string(),
    optimum: z.string().nullable(),
    requested: z.string(),
});

const quantity = (text: string) => fromNumeric(text, quantityScale);
const text = (value: bigint) => display(value, quantityScale);

export class Lplpo {
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

    // Lokasi cakupan sebagai potongan SQL atas gd_m_lokasi. Satu lokasi wajib aktif dan bukan transit. Operating unit
    // mencakup semua lokasinya di legal entity aktif, termasuk lokasi transit dan lokasi yang sudah dihapus, karena
    // barang yang sedang dikirim antarlokasinya dan riwayat lokasi lama tetap stok unit itu.
    private async locations(
        parameters: URLSearchParams,
        errors: Record<string, string>,
        bind: (value: Bind) => string,
    ) {
        const locationId = parameters.get('location_id') ?? '';
        const unitId = parameters.get('operating_unit_id') ?? '';
        if (Boolean(locationId) === Boolean(unitId)) {
            errors.location_id = 'Pilih satu lokasi atau satu operating unit.';
            return '';
        }
        if (locationId) {
            const location = lookupId(locationId)
                ? await this.db.one(
                      z.object({ transit: z.boolean() }),
                      `select transit from gd_m_lokasi
                       where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                      [
                          this.scope.tenantId,
                          this.scope.legalEntityId,
                          locationId,
                      ],
                  )
                : undefined;
            if (!location) errors.location_id = 'Pilih lokasi dari daftar.';
            else if (location.transit)
                errors.location_id =
                    'Pilih lokasi yang bukan lokasi transit. Barang di lokasi transit sedang dalam perjalanan.';
            return `id = ${bind(locationId)}`;
        }
        const found = lookupId(unitId)
            ? await this.db.one(
                  z.object({ found: z.number() }),
                  `select 1 as found from gd_m_lokasi
                   where tenant_id = $1 and legal_entity_id = $2 and operating_unit_id = $3 limit 1`,
                  [this.scope.tenantId, this.scope.legalEntityId, unitId],
              )
            : undefined;
        if (!found)
            errors.operating_unit_id =
                'Pilih operating unit yang punya lokasi stok di legal entity ini.';
        return `operating_unit_id = ${bind(unitId)}`;
    }

    async report(parameters: URLSearchParams) {
        this.workspace.guard('inventory-report', 'read');
        const bindings: Bind[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        const bind = (value: Bind) => `$${bindings.push(value)}`;
        const errors: Record<string, string> = {};
        const from = parameters.get('from') ?? '';
        const to = parameters.get('to') ?? '';
        if (!dateSchema.safeParse(from).success)
            errors.from = 'Isi tanggal mulai yang benar.';
        if (!dateSchema.safeParse(to).success)
            errors.to = 'Isi tanggal selesai yang benar.';
        else if (to < from)
            errors.to = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
        const locations = await this.locations(parameters, errors, bind);
        const categoryId = parameters.get('category_id') ?? '';
        if (
            categoryId &&
            !(await exists(this.db, 'gd_m_kategori', this.scope, categoryId))
        )
            errors.category_id = 'Pilih kategori dari daftar.';
        if (Object.keys(errors).length) validation(errors);

        const fromAt = bind(from);
        const toAt = bind(to);
        const kinds = (column: Column) =>
            entryKinds
                .filter((kind) => columnOf[kind] === column)
                .map(bind)
                .join(', ');
        const category = categoryId
            ? `and b.kategori_id in (select id from kategori)`
            : '';
        const categoryTree = categoryId
            ? `${categoryTreeSql(bind(categoryId))},`
            : '';
        const rows = await this.db.rows(
            totalsSchema,
            `with recursive ${categoryTree}
                 lokasi as (
                     select id from gd_m_lokasi where tenant_id = $1 and legal_entity_id = $2 and ${locations}
                 ),
                 gerak as (
                     select k.barang_id, k.jumlah, k.sumber_dana_id, k.tanggal_posting < ${fromAt}::date as sebelum,
                            case
                                when k.jenis in (${kinds('receipts')}) then 'receipts'
                                when k.jenis in (${kinds('usage')}) then 'usage'
                                when k.jenis in (${kinds('adjustment')}) then 'adjustment'
                                -- Baris pembalik berarah kebalikan tandanya, jadi kembali ke kolom baris aslinya.
                                when k.jenis in (${kinds('transfer')})
                                     and sign(k.jumlah) * case when k.dibalik_dari is null then 1 else -1 end > 0
                                    then 'receipts'
                                when k.jenis in (${kinds('transfer')}) then 'usage'
                            end as kolom
                     from gd_tr_kartu_gudang k
                     where k.tenant_id = $1 and k.legal_entity_id = $2 and k.lokasi_id in (select id from lokasi)
                       and k.tanggal_posting <= ${toAt}::date
                       and (k.jenis not in (${kinds('transfer')})
                            or exists (select 1 from gd_tr_kartu_gudang o
                                       where o.tenant_id = k.tenant_id and o.sumber_jenis = k.sumber_jenis
                                         and o.sumber_id = k.sumber_id and o.lokasi_id not in (select id from lokasi)))
                 ),
                 saldo as (
                     select barang_id,
                            coalesce(sum(jumlah) filter (where sebelum), 0) as opening,
                            coalesce(sum(jumlah) filter (where not sebelum and kolom = 'receipts'), 0) as receipts,
                            coalesce(-sum(jumlah) filter (where not sebelum and kolom = 'usage'), 0) as usage,
                            coalesce(sum(jumlah) filter (where not sebelum and kolom = 'adjustment'), 0) as adjustment,
                            coalesce(sum(jumlah) filter (where not sebelum and kolom = 'receipts'
                                                               and sumber_dana_id is null), 0) as without_funding,
                            count(*) filter (where not sebelum) as moved
                     from gerak group by barang_id
                 ),
                 dana as (
                     select barang_id, json_object_agg(sumber_dana_id, trim_scale(jumlah)::text) as funding
                     from (select barang_id, sumber_dana_id, sum(jumlah) as jumlah from gerak
                           where not sebelum and kolom = 'receipts' and sumber_dana_id is not null
                           group by barang_id, sumber_dana_id) per_dana
                     group by barang_id
                 ),
                 buku as (
                     select barang_id, sum(jumlah) as closing from gd_tr_kartu_gudang
                     where tenant_id = $1 and legal_entity_id = $2 and lokasi_id in (select id from lokasi)
                       and tanggal_posting <= ${toAt}::date
                     group by barang_id
                 ),
                 permintaan as (
                     select d.barang_id, sum(d.jumlah_diminta * d.konversi) as requested
                     from gd_tr_amprahan a
                     join gd_tr_amprahan_detail d on d.tenant_id = a.tenant_id and d.amprahan_id = a.id
                          and d.deleted_at is null
                     where a.tenant_id = $1 and a.legal_entity_id = $2 and a.deleted_at is null
                       and a.status in (${requestStatuses.map(bind).join(', ')})
                       and a.tanggal between ${fromAt}::date and ${toAt}::date
                       and a.lokasi_peminta_id in (select id from lokasi)
                       and a.lokasi_pemasok_id not in (select id from lokasi)
                     group by d.barang_id
                 ),
                 optimum as (
                     select barang_id, sum(stok_maksimum) as optimum from gd_m_barang_lokasi
                     where tenant_id = $1 and legal_entity_id = $2 and lokasi_id in (select id from lokasi)
                       and deleted_at is null and stok_maksimum is not null
                     group by barang_id
                 ),
                 barang_laporan as (
                     select barang_id from saldo where opening <> 0 or moved > 0
                     union select barang_id from permintaan
                     union select barang_id from optimum
                 )
             select json_build_object('id', b.id, 'code', b.kode, 'name', b.nama, 'unit', s.kode) as item,
                    ${reference('c')} as category,
                    trim_scale(coalesce(g.opening, 0))::text as opening,
                    trim_scale(coalesce(g.receipts, 0))::text as receipts,
                    trim_scale(coalesce(g.usage, 0))::text as usage,
                    trim_scale(coalesce(g.adjustment, 0))::text as adjustment,
                    trim_scale(coalesce(bk.closing, 0))::text as ledger_closing,
                    coalesce(d.funding, '{}'::json) as receipts_by_funding,
                    trim_scale(coalesce(g.without_funding, 0))::text as receipts_without_funding,
                    trim_scale(o.optimum)::text as optimum,
                    trim_scale(coalesce(p.requested, 0))::text as requested
             from barang_laporan r
             join gd_m_barang b on b.tenant_id = $1 and b.legal_entity_id = $2 and b.id = r.barang_id
             join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
             left join gd_m_kategori c on c.tenant_id = b.tenant_id and c.id = b.kategori_id
             left join saldo g on g.barang_id = r.barang_id
             left join buku bk on bk.barang_id = r.barang_id
             left join dana d on d.barang_id = r.barang_id
             left join permintaan p on p.barang_id = r.barang_id
             left join optimum o on o.barang_id = r.barang_id
             where true ${category}
             order by b.kode, b.id`,
            bindings,
        );

        const used = [
            ...new Set(
                rows.flatMap((row) => Object.keys(row.receipts_by_funding)),
            ),
        ];
        const fundingSources = await this.db.rows(
            lplpoSchema.shape.funding_sources.element,
            `select id, kode as code, nama as name from gd_m_sumber_dana
             where tenant_id = $1 and legal_entity_id = $2
               and (deleted_at is null or id::text in (select jsonb_array_elements_text($3::jsonb)))
             order by kode, id`,
            [
                this.scope.tenantId,
                this.scope.legalEntityId,
                JSON.stringify(used),
            ],
        );

        return lplpoSchema.parse({
            funding_sources: fundingSources,
            rows: rows.map((row) => {
                const opening = quantity(row.opening);
                const receipts = quantity(row.receipts);
                const usage = quantity(row.usage);
                const adjustment = quantity(row.adjustment);
                const closing = opening + receipts - usage + adjustment;
                // Setiap baris kartu gudang cakupan masuk tepat satu kolom, jadi sisa stok selalu sama dengan jumlah
                // kartu gudang. Selisih berarti jenis gerak yang belum dipetakan, dan laporannya salah.
                if (closing !== quantity(row.ledger_closing))
                    throw new Error(
                        `LPLPO closing ${text(closing)} for item ${row.item.id} differs from the item ledger ${row.ledger_closing}.`,
                    );
                const optimum =
                    row.optimum === null ? null : quantity(row.optimum);
                const shortfall = optimum === null ? null : optimum - closing;
                return {
                    item: row.item,
                    category: row.category,
                    opening: row.opening,
                    receipts: row.receipts,
                    receipts_by_funding: Object.fromEntries(
                        fundingSources.map((source) => [
                            source.id,
                            row.receipts_by_funding[source.id] ?? '0',
                        ]),
                    ),
                    receipts_without_funding: row.receipts_without_funding,
                    available: text(opening + receipts),
                    usage: row.usage,
                    adjustment: row.adjustment,
                    closing: text(closing),
                    optimum: row.optimum,
                    requested: row.requested,
                    suggested:
                        shortfall === null
                            ? null
                            : text(shortfall > 0n ? shortfall : 0n),
                };
            }),
        });
    }
}
