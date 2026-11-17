import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import type { Database } from '../../../platform/database/index.ts';
import { incrementalList, lookupId } from '../../../platform/http/index.ts';
import { Currency, localCurrencyCode } from '../../currency/index.ts';
import { activeLegalEntity } from '../../inventory/index.ts';
import { vendorLedgerEntrySchema } from './vendor-ledger.schema.ts';

const rowSql = `select * from (
                    select e.id, e.jenis as kind,
                           json_build_object('id', v.id, 'number', v.number, 'name', p.name) as vendor,
                           e.vendor_id, p.name as vendor_name, e.faktur_id as invoice_id,
                           e.pembayaran_id as payment_id,
                           e.nomor_dokumen as document_number, e.no_faktur_vendor as vendor_invoice_number,
                           e.tanggal::text as posting_date, e.jatuh_tempo::text as due_date,
                           trim_scale(e.jumlah)::text as amount, trim_scale(e.sisa)::text as remaining,
                           coalesce(paid.payments, '[]'::json) as payments,
                           coalesce(trim_scale(paid.amount), 0)::text as paid,
                           e.sisa <> 0 as open, (current_date - e.jatuh_tempo)::int as days_overdue
                    from ap_tr_entri_utang e
                    join vendors v on v.tenant_id = e.tenant_id and v.id = e.vendor_id
                    join parties p on p.tenant_id = v.tenant_id and p.id = v.party_id
                    left join lateral (
                        select json_agg(json_build_object('id', h.id, 'number', h.nomor,
                                                          'amount', trim_scale(d.jumlah)::text)
                                        order by h.diposting_pada, h.id) as payments,
                               sum(d.jumlah) as amount
                        from ap_tr_pembayaran_detail d
                        join ap_tr_pembayaran h on h.tenant_id = d.tenant_id and h.id = d.pembayaran_id
                        where d.tenant_id = e.tenant_id and d.entri_utang_id = e.id and d.deleted_at is null
                          and h.status = 'diposting') paid on true
                    where e.tenant_id = $1 and e.legal_entity_id = $2) entries
                where true`;

// Entri utang vendor (Vendor Ledger Entries di BC).
export class VendorLedger {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(parameters: URLSearchParams) {
        this.workspace.guard('purchase-invoice', 'read');
        const bindings: string[] = [
            this.workspace.tenantId,
            activeLegalEntity(this.workspace),
        ];
        let filter = '';
        if (parameters.get('all') !== '1') filter += ' and open';
        const vendorId = parameters.get('vendor_id');
        if (vendorId && lookupId(vendorId))
            filter += ` and vendor_id = $${bindings.push(vendorId)}`;
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                due_date: 'due_date',
                posting_date: 'posting_date',
                vendor: 'vendor_name',
                document_number: 'document_number',
            },
            searchColumns: [
                'vendor_name',
                'document_number',
                'vendor_invoice_number',
            ],
            numericColumns: [],
            defaultSort: 'due_date',
            defaultDirection: 'asc',
        });
        const totals = await this.db.one(
            z.object({ remaining: z.string(), overdue: z.string() }),
            `select coalesce(trim_scale(sum(remaining::numeric)), 0)::text as remaining,
                    coalesce(trim_scale(sum(remaining::numeric) filter (where days_overdue > 0)), 0)::text as overdue
             from (${rowSql}${filter}) filtered`,
            bindings,
        );
        return {
            data: batch.data.map((row) => vendorLedgerEntrySchema.parse(row)),
            next_cursor: batch.next_cursor,
            remaining: totals?.remaining ?? '0',
            overdue: totals?.overdue ?? '0',
            amount_decimals: (
                await new Currency(this.db, this.workspace.tenantId).precision(
                    localCurrencyCode,
                )
            ).amount_decimals,
        };
    }
}
