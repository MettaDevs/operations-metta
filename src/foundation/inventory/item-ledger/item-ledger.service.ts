import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import type { Bind, Database } from '../../../platform/database/index.ts';
import {
    dateSchema,
    incrementalList,
    lookupId,
    validation,
} from '../../../platform/http/index.ts';
import { activeLegalEntity } from '../inventory.service.ts';
import { entryKinds } from './item-ledger.posting.ts';
import { ledgerRowSchema, stockRowSchema } from './item-ledger.schema.ts';
import { Currency, localCurrencyCode } from '../../currency/index.ts';

const batchJson = `case when t.id is null then null else json_build_object(
                       'id', t.id, 'batch_number', t.no_batch, 'expiry_date', t.kedaluwarsa) end`;

// Stok dan kartu stok legal entity aktif, dibaca langsung dari kartu gudang. Tidak ada saldo yang disimpan: stok adalah
// jumlah sisa baris terbuka, dan saldo kartu stok dijumlahkan saat dibaca.
export class ItemLedger {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async stock(parameters: URLSearchParams) {
        this.workspace.guard('inventory-stock', 'read');
        const bindings: Bind[] = [
            this.workspace.tenantId,
            activeLegalEntity(this.workspace),
        ];
        let filter = '';
        const item = lookupId(parameters.get('item_id') ?? '');
        if (item) filter += ` and k.barang_id = $${bindings.push(item)}`;
        const location = lookupId(parameters.get('location_id') ?? '');
        if (location)
            filter += ` and k.lokasi_id = $${bindings.push(location)}`;
        const batch = await incrementalList(this.db, {
            query: `select md5(k.barang_id::text || ':' || k.lokasi_id::text || ':' || coalesce(k.batch_id::text, ''))
                           as id,
                           json_build_object('id', b.id, 'code', b.kode, 'name', b.nama, 'unit', s.kode) as item,
                           json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
                           ${batchJson} as batch,
                           trim_scale(sum(k.sisa))::text as quantity, sum(k.sisa) as quantity_value,
                           concat_ws(' ', b.kode, l.kode, coalesce(t.kedaluwarsa::text, '9999-12-31'), t.no_batch)
                           as position,
                           t.kedaluwarsa::text as expiry_date
                    from gd_tr_kartu_gudang k
                    join gd_m_barang b on b.tenant_id = k.tenant_id and b.id = k.barang_id
                    join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
                    join gd_m_lokasi l on l.tenant_id = k.tenant_id and l.id = k.lokasi_id
                    left join gd_m_batch t on t.tenant_id = k.tenant_id and t.id = k.batch_id
                    where k.tenant_id = $1 and k.legal_entity_id = $2 and k.sisa <> 0${filter}
                    group by k.barang_id, k.lokasi_id, k.batch_id, b.id, s.kode, l.id, t.id
                    having sum(k.sisa) <> 0`,
            bindings,
            parameters,
            columns: {
                item: 'position',
                expiry_date: 'expiry_date',
                quantity: 'quantity_value',
            },
            searchColumns: [
                "item->>'code'",
                "item->>'name'",
                "batch->>'batch_number'",
            ],
            numericColumns: ['quantity_value'],
            defaultSort: 'item',
            defaultDirection: 'asc',
            idType: 'text',
        });
        return {
            data: batch.data.map((row) => stockRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    async ledger(parameters: URLSearchParams) {
        this.workspace.guard('inventory-stock', 'read');
        const errors: Record<string, string> = {};
        const item = lookupId(parameters.get('item_id') ?? '');
        if (!item) errors.item_id = 'Pilih barang dari daftar.';
        const from = parameters.get('from') ?? '';
        const to = parameters.get('to') ?? '';
        if (!dateSchema.safeParse(from).success)
            errors.from = 'Isi tanggal mulai yang benar.';
        if (!dateSchema.safeParse(to).success)
            errors.to = 'Isi tanggal selesai yang benar.';
        else if (to < from)
            errors.to = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
        if (Object.keys(errors).length || !item) validation(errors);
        const bindings: Bind[] = [
            this.workspace.tenantId,
            activeLegalEntity(this.workspace),
            item,
        ];
        let filter = '';
        const location = lookupId(parameters.get('location_id') ?? '');
        if (location)
            filter += ` and k.lokasi_id = $${bindings.push(location)}`;
        const batchId = lookupId(parameters.get('batch_id') ?? '');
        if (batchId) filter += ` and k.batch_id = $${bindings.push(batchId)}`;
        const kind = z.enum(entryKinds).safeParse(parameters.get('kind'));
        if (kind.success)
            filter += ` and k.jenis = $${bindings.push(kind.data)}`;
        const opening =
            (
                await this.db.one(
                    z.object({ balance: z.string().nullable() }),
                    `select trim_scale(sum(k.jumlah))::text as balance from gd_tr_kartu_gudang k
                     where k.tenant_id = $1 and k.legal_entity_id = $2 and k.barang_id = $3${filter}
                       and k.tanggal_posting < $${bindings.length + 1}::date`,
                    [...bindings, from],
                )
            )?.balance ?? '0';
        const fromAt = bindings.push(from);
        const toAt = bindings.push(to);
        const openingAt = bindings.push(opening);
        const batch = await incrementalList(this.db, {
            query: `select k.id, k.tanggal_posting::text as posting_date, k.jenis as kind,
                           json_build_object('type', k.sumber_jenis, 'id', k.sumber_id, 'number', k.sumber_nomor)
                           as document,
                           json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) as location,
                           ${batchJson} as batch,
                           trim_scale(k.jumlah)::text as quantity, trim_scale(k.sisa)::text as remaining_quantity,
                           trim_scale(k.nilai)::text as cost_amount,
                           trim_scale($${openingAt}::numeric
                               + sum(k.jumlah) over (order by k.tanggal_posting, k.id))::text as balance,
                           k.dibalik_dari as reversed_entry_id, k.sumber_nomor as document_number
                    from gd_tr_kartu_gudang k
                    join gd_m_lokasi l on l.tenant_id = k.tenant_id and l.id = k.lokasi_id
                    left join gd_m_batch t on t.tenant_id = k.tenant_id and t.id = k.batch_id
                    where k.tenant_id = $1 and k.legal_entity_id = $2 and k.barang_id = $3${filter}
                      and k.tanggal_posting between $${fromAt}::date and $${toAt}::date`,
            bindings,
            parameters,
            columns: { posting_date: 'posting_date' },
            searchColumns: ['document_number'],
            numericColumns: [],
            defaultSort: 'posting_date',
            defaultDirection: 'asc',
        });
        return {
            opening_balance: opening,
            amount_decimals: (
                await new Currency(this.db, this.workspace.tenantId).precision(
                    localCurrencyCode,
                )
            ).amount_decimals,
            data: batch.data.map((row) => ledgerRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }
}
