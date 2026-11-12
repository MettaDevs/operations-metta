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
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../../platform/http/index.ts';
import { activeLegalEntity } from '../inventory.service.ts';
import { reverseItemEntries } from '../item-ledger/item-ledger.posting.ts';
import { transferModes } from '../item-ledger/stock-policy.ts';
import {
    postedTransferLineRowSchema,
    postedTransferRowSchema,
    postedTransferStatuses,
} from './transfer-order.schema.ts';
import {
    receiptSource,
    resetQuantitiesToHandle,
    shipmentSource,
} from './transfer.posting.ts';

// Mutasi (Posted Transfer Shipment) dan penerimaan mutasi (Posted Transfer Receipt) berbagi bentuk dan alur batal
// posting; yang berbeda hanya tabel, lokasi asal, dan jumlah kumulatif amprah yang dikembalikan.
const kinds = {
    shipment: {
        header: 'gd_tr_mutasi',
        detail: 'gd_tr_mutasi_detail',
        parent: 'mutasi_id',
        source: shipmentSource,
        from: 'h.lokasi_asal_id',
        mode: 'h.cara_mutasi',
    },
    receipt: {
        header: 'gd_tr_mutasi_terima',
        detail: 'gd_tr_mutasi_terima_detail',
        parent: 'mutasi_terima_id',
        source: receiptSource,
        from: 'h.lokasi_transit_id',
        mode: `'kirim_terima'`,
    },
} as const;
export type PostedTransferKind = keyof typeof kinds;

const location = (alias: string) =>
    `json_build_object('id', ${alias}.id, 'code', ${alias}.kode, 'name', ${alias}.nama)`;
const reference = (alias: string) =>
    `case when ${alias}.id is null then null else ${location(alias)} end`;

const rowSql = (kind: PostedTransferKind) => {
    const { header, detail, parent, from, mode } = kinds[kind];
    return `select * from (
                select h.id, h.nomor as number, h.tanggal::text as posting_date, h.status, h.version,
                       json_build_object('id', a.id, 'number', a.nomor) as transfer_order, a.id as transfer_order_id,
                       a.nomor as order_number, f.kode as from_code, f.nama as from_name, t.kode as to_code,
                       t.nama as to_name, ${location('f')} as from_location, ${location('t')} as to_location,
                       ${reference('x')} as transit_location, ${mode} as transfer_mode,
                       coalesce((select trim_scale(sum(d.nilai))::text from ${detail} d
                                 where d.tenant_id = h.tenant_id and d.${parent} = h.id), '0') as amount,
                       ${isoSql('h.diposting_pada')} as posted_at, ${isoSql('h.dibatalkan_pada')} as reversed_at
                from ${header} h
                join gd_tr_amprahan a on a.tenant_id = h.tenant_id and a.id = h.amprahan_id
                join gd_m_lokasi f on f.tenant_id = h.tenant_id and f.id = ${from}
                join gd_m_lokasi t on t.tenant_id = h.tenant_id and t.id = h.lokasi_tujuan_id
                left join gd_m_lokasi x on x.tenant_id = h.tenant_id and x.id = h.lokasi_transit_id
                where h.tenant_id = $1 and h.legal_entity_id = $2) postings
            where true`;
};

// Mutasi dan penerimaannya hanya dibaca dan dibatalkan postingnya; keduanya lahir dari posting amprah.
export class PostedTransfers {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
        private readonly kind: PostedTransferKind,
    ) {}

    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    private permissions() {
        return {
            reverse: this.workspace.permissions.has(
                'core.inventory-transfer.reverse',
            ),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('inventory-transfer', 'read');
        const bindings: string[] = [
            this.scope.tenantId,
            this.scope.legalEntityId,
        ];
        let filter = '';
        const status = z
            .enum(postedTransferStatuses)
            .safeParse(parameters.get('status'));
        if (status.success)
            filter += ` and status = $${bindings.push(status.data)}`;
        const order = lookupId(parameters.get('transfer_order_id') ?? '');
        if (order)
            filter += ` and transfer_order_id = $${bindings.push(order)}`;
        const batch = await incrementalList(this.db, {
            query: `${rowSql(this.kind)}${filter}`,
            bindings,
            parameters,
            columns: {
                number: 'number',
                posting_date: 'posting_date',
                status: 'status',
                transfer_order: 'order_number',
                from_location: 'from_code',
                to_location: 'to_code',
            },
            searchColumns: [
                'number',
                'order_number',
                'from_code',
                'from_name',
                'to_code',
                'to_name',
            ],
            numericColumns: [],
            defaultSort: 'posting_date',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) => postedTransferRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            permissions: this.permissions(),
        };
    }

    private async header(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  postedTransferRowSchema,
                  `${rowSql(this.kind)} and postings.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async document(id: string) {
        const header = await this.header(id);
        const { detail, parent } = kinds[this.kind];
        const lines = await this.db.rows(
            postedTransferLineRowSchema,
            `select d.id, d.urutan as line_no,
                    json_build_object('id', b.id, 'code', b.kode, 'name', b.nama, 'base_unit', base.kode) as item,
                    ${location('u')} as unit, trim_scale(d.konversi)::text as quantity_per_unit,
                    trim_scale(d.jumlah_dasar)::text as quantity,
                    case when t.id is null then null else json_build_object(
                        'id', t.id, 'batch_number', t.no_batch, 'expiry_date', d.kedaluwarsa) end as batch,
                    ${reference('f')} as funding_source, ${reference('g')} as procurement_program,
                    d.tahun_anggaran as budget_year, trim_scale(d.nilai)::text as amount
             from ${detail} d
             join gd_m_barang b on b.tenant_id = d.tenant_id and b.id = d.barang_id
             join gd_m_satuan base on base.tenant_id = b.tenant_id and base.id = b.satuan_dasar_id
             join gd_m_satuan u on u.tenant_id = d.tenant_id and u.id = d.satuan_id
             left join gd_m_batch t on t.tenant_id = d.tenant_id and t.id = d.batch_id
             left join gd_m_sumber_dana f on f.tenant_id = d.tenant_id and f.id = d.sumber_dana_id
             left join gd_m_program_pengadaan g on g.tenant_id = d.tenant_id and g.id = d.program_pengadaan_id
             where d.tenant_id = $1 and d.${parent} = $2
             order by d.urutan`,
            [this.scope.tenantId, header.id],
        );
        return { ...header, lines };
    }

    async show(id: string) {
        this.workspace.guard('inventory-transfer', 'read');
        return {
            data: await this.document(id),
            permissions: this.permissions(),
        };
    }

    // Batal posting membalik baris kartu gudangnya lewat mesin posting, lalu mengembalikan jumlah kumulatif amprah.
    // Dokumen terposting dikunci lebih dulu, lalu amprahnya, sama dengan urutan posting kirim dan terima.
    async reverse(request: Request, id: string, body: unknown) {
        this.workspace.guard('inventory-transfer', 'reverse');
        const current = await this.header(id);
        const version = expectedVersion(request, body);
        const { header, detail, parent, source, mode } = kinds[this.kind];
        await this.db.transaction(async () => {
            const stamp = nowSql();
            const claimed = await this.db.one(
                z.object({
                    order_id: z.string(),
                    mode: z.enum(transferModes),
                }),
                `update ${header} h set status = 'dibatalkan', dibatalkan_pada = $1, dibatalkan_oleh_user_id = $2,
                        updated_at = $1
                 where h.tenant_id = $3 and h.legal_entity_id = $4 and h.id = $5 and h.status = 'diposting'
                   and h.version = $6
                 returning h.amprahan_id as order_id, ${mode} as mode`,
                [
                    stamp,
                    this.workspace.userId,
                    this.scope.tenantId,
                    this.scope.legalEntityId,
                    current.id,
                    version,
                ],
            );
            if (!claimed) {
                const locked = await this.db.one(
                    z.object({ status: z.enum(postedTransferStatuses) }),
                    `select status from ${header} where tenant_id = $1 and id = $2 for update`,
                    [this.scope.tenantId, current.id],
                );
                if (locked?.status === 'dibatalkan') return;
                coded(409, 'stale_version', staleMessage);
            }
            await this.db.execute(
                'select id from gd_tr_amprahan where tenant_id = $1 and id = $2 for update',
                [this.scope.tenantId, claimed.order_id],
            );
            if (this.kind === 'shipment' && claimed.mode === 'kirim_terima')
                await this.refuseReceived(current.id);
            await reverseItemEntries(
                this.db,
                { ...this.scope, userId: this.workspace.userId },
                { type: source, id: current.id },
            );
            const shipped = this.kind === 'shipment' ? 1 : 0;
            const received =
                this.kind === 'receipt' || claimed.mode === 'langsung' ? 1 : 0;
            await this.db.execute(
                `update gd_tr_amprahan_detail a
                 set jumlah_dikirim = a.jumlah_dikirim - s.quantity * $1,
                     jumlah_diterima = a.jumlah_diterima - s.quantity * $2, updated_at = $3
                 from (select amprahan_detail_id, sum(jumlah_dasar) / min(konversi) as quantity
                       from ${detail} where tenant_id = $4 and ${parent} = $5
                       group by amprahan_detail_id) s
                 where a.tenant_id = $4 and a.id = s.amprahan_detail_id`,
                [shipped, received, stamp, this.scope.tenantId, current.id],
            );
            await resetQuantitiesToHandle(
                this.db,
                this.scope.tenantId,
                claimed.order_id,
            );
            // Amprah yang sudah selesai terbuka lagi, karena sebagian barangnya kini belum dikirim atau diterima.
            await this.db.execute(
                `update gd_tr_amprahan
                 set status = case when status = 'selesai' then 'diajukan' else status end,
                     ditutup_pada = case when status = 'selesai' then null else ditutup_pada end,
                     ditutup_oleh_user_id = case when status = 'selesai' then null else ditutup_oleh_user_id end,
                     updated_at = $1
                 where tenant_id = $2 and id = $3`,
                [stamp, this.scope.tenantId, claimed.order_id],
            );
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.document(current.id) },
        };
    }

    // Barang mutasi dua langkah yang sebagian sudah keluar dari lokasi transit tidak bisa ditarik kembali ke pemasok.
    private async refuseReceived(shipmentId: string) {
        const taken = await this.db.one(
            z.object({ id: z.string() }),
            `select id from gd_tr_kartu_gudang
             where tenant_id = $1 and sumber_jenis = $2 and sumber_id = $3 and jumlah > 0 and sisa < jumlah
               and dibalik_dari is null
             limit 1`,
            [this.scope.tenantId, shipmentSource, shipmentId],
        );
        if (taken)
            validation({
                _form: 'Sebagian barang mutasi ini sudah diterima lokasi peminta, jadi postingnya tidak bisa dibatalkan.',
            });
    }
}
