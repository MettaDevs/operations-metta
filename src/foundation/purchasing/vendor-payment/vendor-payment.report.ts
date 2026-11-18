import { z } from 'zod';
import {
    coreWorkspace,
    type Workspace,
} from '../../../platform/access/index.ts';
import type { Database } from '../../../platform/database/index.ts';
import { lookupId } from '../../../platform/http/index.ts';
import {
    defineReport,
    field,
    type Values,
} from '../../../platform/reporting/index.ts';
import { vendorPaymentLayouts } from './vendor-payment.layout.ts';

export const vendorPaymentFields = {
    number: field.text('Nomor pembayaran'),
    posting_date: field.date('Tanggal bayar'),
    is_draft: field.flag('Belum diposting'),
    is_cancelled: field.flag('Pembayaran dibatalkan'),
    vendor_number: field.text('Nomor vendor'),
    vendor_name: field.text('Vendor'),
    payment_method: field.text('Cara bayar'),
    bank: field.text('Rekening bank (nama bank dan nomor rekening)'),
    reference: field.text('Nomor referensi'),
    description: field.text('Keterangan'),
    paid_by: field.text('Petugas (pengguna yang memposting pembayaran)'),
    lines: field.lines('Faktur yang dibayar', {
        document_number: field.text('Nomor faktur'),
        vendor_document_number: field.text('Nomor dokumen vendor'),
        due_date: field.date('Jatuh tempo'),
        invoice_amount: field.money('Nilai faktur'),
        amount: field.money('Dibayar'),
    }),
    total: field.money('Total dibayar', { words: true }),
};

const paymentSchema = z.object({
    number: z.string(),
    posting_date: z.string(),
    is_draft: z.boolean(),
    is_cancelled: z.boolean(),
    vendor_number: z.string(),
    vendor_name: z.string(),
    payment_method: z.string(),
    bank: z.string().nullable(),
    reference: z.string().nullable(),
    description: z.string().nullable(),
    paid_by: z.string().nullable(),
    lines: z.array(
        z.object({
            document_number: z.string(),
            vendor_document_number: z.string(),
            due_date: z.string(),
            invoice_amount: z.string(),
            amount: z.string(),
        }),
    ),
    total: z.string(),
});

async function vendorPayment(
    db: Database,
    workspace: Workspace,
    paymentId: string,
) {
    workspace.guard('vendor-payment', 'read');
    if (!lookupId(paymentId) || !workspace.legalEntityId) return null;
    const row = await db.one(
        paymentSchema,
        `select h.nomor as number, h.tanggal::text as posting_date, h.status = 'draf' as is_draft,
                h.status = 'dibatalkan' as is_cancelled, v.number as vendor_number, p.name as vendor_name,
                j.nama as payment_method,
                coalesce(b.nama_bank || ' ' || b.nomor_rekening, h.bank) as bank, h.no_referensi as reference, h.keterangan as description,
                poster.name as paid_by, coalesce(t.lines, '[]'::json) as lines,
                trim_scale(coalesce(t.total, 0))::text as total
         from ap_tr_pembayaran h
         join vendors v on v.tenant_id = h.tenant_id and v.id = h.vendor_id
         join parties p on p.tenant_id = v.tenant_id and p.id = v.party_id
         join jenis_bayar j on j.tenant_id = h.tenant_id and j.id = h.jenis_bayar_id
         left join rekening_bank b on b.tenant_id = h.tenant_id and b.id = h.rekening_bank_id
         left join users poster on poster.id = h.diposting_oleh_user_id
         left join lateral (
             select json_agg(json_build_object(
                        'document_number', e.nomor_dokumen, 'vendor_document_number', e.no_dokumen_vendor,
                        'due_date', e.jatuh_tempo::text, 'invoice_amount', trim_scale(e.jumlah)::text,
                        'amount', trim_scale(d.jumlah)::text) order by d.urutan) as lines,
                    sum(d.jumlah) as total
             from ap_tr_pembayaran_detail d
             join ap_tr_entri_utang e on e.tenant_id = d.tenant_id and e.id = d.entri_utang_id
             where d.tenant_id = h.tenant_id and d.pembayaran_id = h.id and d.deleted_at is null) t on true
         where h.tenant_id = $1 and h.legal_entity_id = $2 and h.id = $3 and h.deleted_at is null`,
        [workspace.tenantId, workspace.legalEntityId, paymentId],
    );
    if (!row) return null;
    return {
        legalEntityId: workspace.legalEntityId,
        operatingUnitId: null,
        fileName: `Pembayaran ${row.number}`,
        values: row,
    };
}

const sample: Values<typeof vendorPaymentFields> = {
    number: 'PV-00000001',
    posting_date: '2026-12-01',
    is_draft: false,
    is_cancelled: false,
    vendor_number: 'V-0001',
    vendor_name: 'PBF Contoh',
    payment_method: 'Transfer',
    bank: 'Bank Contoh 1234567890',
    reference: 'TRF-0001',
    description: null,
    paid_by: 'Petugas Pembelian Contoh',
    lines: [
        {
            document_number: 'PI-00000001',
            vendor_document_number: 'FKT-7781',
            due_date: '2026-12-10',
            invoice_amount: '43013',
            amount: '43013',
        },
    ],
    total: '43013',
};

export const vendorPaymentReport = defineReport({
    code: 'core.vendor-payment',
    name: 'Bukti pembayaran ke vendor',
    moduleId: 'core',
    permission: 'core.vendor-payment.read',
    workspace: (context) => coreWorkspace(context),
    fields: vendorPaymentFields,
    sample: {
        legalEntityId: '00000000-0000-0000-0000-000000000000',
        operatingUnitId: null,
        fileName: 'Pembayaran PV-00000001',
        values: sample,
    },
    layouts: vendorPaymentLayouts,
    load: vendorPayment,
});
