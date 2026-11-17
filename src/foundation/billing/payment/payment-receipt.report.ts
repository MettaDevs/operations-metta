import { z } from 'zod';
import {
    coreWorkspace,
    type Workspace,
} from '../../../platform/access/index.ts';
import { isoSql, type Database } from '../../../platform/database/index.ts';
import { lookupId } from '../../../platform/http/index.ts';
import {
    defineReport,
    field,
    type Values,
} from '../../../platform/reporting/index.ts';
import { paymentReceiptLayouts } from './payment-receipt.layout.ts';

// Kuitansi satu pembayaran kasir (Print_out::kwitansi sistem lama): nomor bukti, diterima dari, jenis pelayanan per
// kelompok jasa, diskon, total dengan terbilang, cara bayar, kembalian, dan kasir. Pembayaran yang sudah dibatalkan
// tetap bisa dicetak dan ditandai, supaya salinan untuk arsip menunjukkan keadaannya sekarang.
export const paymentReceiptFields = {
    number: field.text('Nomor kuitansi'),
    paid_at: field.datetime('Waktu bayar'),
    cancelled: field.flag('Pembayaran dibatalkan'),
    cancel_reason: field.text('Alasan batal'),
    source_number: field.text('Nomor registrasi atau penjualan'),
    received_from: field.text('Diterima dari'),
    medical_record_number: field.text('Nomor rekam medis'),
    patient_type: field.text('Tipe pasien'),
    guarantor: field.text('Penjamin'),
    section: field.text('Poli atau unit'),
    services: field.lines('Jenis pelayanan', {
        name: field.text('Kelompok jasa'),
        amount: field.money('Nilai'),
    }),
    value: field.money('Nilai tagihan'),
    has_discount: field.flag('Ada diskon'),
    discount: field.money('Diskon'),
    has_surcharge: field.flag('Ada biaya kartu'),
    surcharge: field.money('Biaya kartu'),
    total: field.money('Total dibayar', { words: true }),
    tenders: field.lines('Cara bayar', {
        name: field.text('Jenis bayar'),
        amount: field.money('Nilai'),
    }),
    received: field.money('Uang diterima'),
    change: field.money('Kembalian'),
    cashier: field.text('Kasir'),
};

const receiptSchema = z.object({
    legal_entity_id: z.string(),
    operating_unit_id: z.string().nullable(),
    number: z.string(),
    paid_at: z.string(),
    cancelled: z.boolean(),
    cancel_reason: z.string().nullable(),
    source_number: z.string().nullable(),
    received_from: z.string().nullable(),
    medical_record_number: z.string().nullable(),
    patient_type: z.string().nullable(),
    guarantor: z.string().nullable(),
    section: z.string().nullable(),
    services: z.array(z.object({ name: z.string(), amount: z.string() })),
    value: z.string(),
    has_discount: z.boolean(),
    discount: z.string(),
    has_surcharge: z.boolean(),
    surcharge: z.string(),
    total: z.string(),
    tenders: z.array(z.object({ name: z.string(), amount: z.string() })),
    received: z.string(),
    change: z.string(),
    cashier: z.string().nullable(),
});

// Baris tagihan tanpa kelompok jasa, yaitu obat dan bahan habis pakai, dijumlah kasir dalam satu kelompok tanpa nama.
const ungroupedLabel = 'Obat dan BHP';

async function receipt(db: Database, workspace: Workspace, paymentId: string) {
    workspace.guard('payment', 'read');
    if (!lookupId(paymentId)) return null;
    const row = await db.one(
        receiptSchema,
        `select k.legal_entity_id, t.operating_unit_id, k.no_bukti as number, ${isoSql('k.jam')} as paid_at,
                k.status = 'batal' as cancelled, k.alasan_batal as cancel_reason,
                t.sumber_nomor as source_number, coalesce(t.pasien_nama, t.pembeli_nama) as received_from,
                t.pasien_nrm as medical_record_number, t.tipe_pasien_nama as patient_type,
                t.penjamin_nama as guarantor, t.section_nama as section,
                coalesce((select json_agg(json_build_object('name', coalesce(g.kelompok_jasa_nama, $4),
                                                            'amount', trim_scale(g.nilai)::text)
                                          order by g.kelompok_jasa_nama nulls last)
                          from kasir_detail_group_jasa g
                          where g.tenant_id = k.tenant_id and g.kasir_id = k.id), '[]'::json) as services,
                trim_scale(k.nilai)::text as value, k.nilai_discount <> 0 as has_discount,
                trim_scale(k.nilai_discount)::text as discount, k.biaya_tambahan <> 0 as has_surcharge,
                trim_scale(k.biaya_tambahan)::text as surcharge,
                trim_scale(k.nilai - k.nilai_discount + k.biaya_tambahan)::text as total,
                coalesce((select json_agg(json_build_object('name', coalesce(j.label_kasir, j.nama),
                                                            'amount', trim_scale(d.nilai)::text)
                                          order by j.urutan, j.kode)
                          from kasir_detail d join jenis_bayar j on j.tenant_id = d.tenant_id and j.id = d.jenis_bayar_id
                          where d.tenant_id = k.tenant_id and d.kasir_id = k.id), '[]'::json) as tenders,
                trim_scale(k.jumlah_bayar)::text as received, trim_scale(k.nilai_kembalian)::text as change,
                u.name as cashier
         from kasir k
         join tagihan_kasir t on t.tenant_id = k.tenant_id and t.sumber_dokumen_id = k.sumber_dokumen_id
         left join users u on u.id = k.user_id
         where k.tenant_id = $1 and k.legal_entity_id = $2 and k.id = $3`,
        [
            workspace.tenantId,
            workspace.legalEntityId,
            paymentId,
            ungroupedLabel,
        ],
    );
    if (!row) return null;
    const { legal_entity_id, operating_unit_id, ...values } = row;
    return {
        legalEntityId: legal_entity_id,
        operatingUnitId: operating_unit_id,
        fileName: `Kuitansi ${values.number}`,
        values,
    };
}

const sample: Values<typeof paymentReceiptFields> = {
    number: 'KSR-00000012',
    paid_at: '2026-11-17T02:15:00.000000Z',
    cancelled: false,
    cancel_reason: null,
    source_number: 'RJ-2611-0007',
    received_from: 'Pasien Contoh',
    medical_record_number: '00-00-12',
    patient_type: 'Umum',
    guarantor: null,
    section: 'Poli Umum',
    services: [
        { name: 'Jasa Dokter', amount: '50000' },
        { name: 'Obat', amount: '27500' },
    ],
    value: '77500',
    has_discount: true,
    discount: '7500',
    has_surcharge: false,
    surcharge: '0',
    total: '70000',
    tenders: [{ name: 'Tunai', amount: '70000' }],
    received: '100000',
    change: '30000',
    cashier: 'Kasir Contoh',
};

export const paymentReceiptReport = defineReport({
    code: 'core.payment-receipt',
    name: 'Kuitansi pembayaran',
    moduleId: 'core',
    permission: 'core.payment.read',
    workspace: (context) => coreWorkspace(context),
    fields: paymentReceiptFields,
    sample: {
        legalEntityId: '00000000-0000-0000-0000-000000000000',
        operatingUnitId: null,
        fileName: 'Kuitansi KSR-00000012',
        values: sample,
    },
    layouts: paymentReceiptLayouts,
    load: receipt,
});
