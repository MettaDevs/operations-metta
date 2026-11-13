import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import { isoSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    incrementalList,
    lookupId,
    validation,
} from '../../../platform/http/index.ts';
import {
    Currency,
    localCurrencyCode,
    missingRateMessage,
} from '../../currency/index.ts';
import { activeLegalEntity } from '../../inventory/index.ts';
import {
    chargeRowSchema,
    visitDetailSchema,
    visitRowSchema,
} from './invoice.schema.ts';
import { invoiceTotals } from './invoice.totals.ts';
import { creditMemoPreview } from '../credit-memo/credit-memo.service.ts';
import { patientTypeMessage } from '../payment/payment.service.ts';

// Sudah dibayar bila kunjungan punya pembayaran yang tidak batal.
const paidSql = `exists (select 1 from kasir p where p.tenant_id = k.tenant_id and p.sumber_module = k.sumber_module
                                and p.kunjungan_id = k.kunjungan_id and p.status = 'diposting')`;

const visitSql = `select * from (
                      select k.kunjungan_id as id, k.no_reg as registration_number, k.tanggal::text as date,
                             ${isoSql('k.didaftarkan_pada')} as registered_at,
                             k.pasien_nrm as patient_medical_record_number, k.pasien_nama as patient_name,
                             k.tipe_pasien_nama as patient_type_name, k.section_nama as sections,
                             ${paidSql} as paid, k.penjamin_nama as guarantor_name, k.no_kartu as card_number,
                             to_json(k.jenis_bayar_dibatasi) as restricted_payment_method_ids
                      from kunjungan_kasir k
                      where k.tenant_id = $1 and k.legal_entity_id = $2 and k.status = 'selesai') visits
                  where true`;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class Invoices {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Dibaca sesudah izin diperiksa, supaya anggota tanpa izin mendapat 403, bukan permintaan memilih legal entity.
    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    // Rentang tanggal kunjungan, bawaannya hari ini di zona waktu legal entity, seperti Dari Tanggal sistem lama.
    private async range(parameters: URLSearchParams) {
        const today = await this.db.one(
            z.object({ date: z.string() }),
            `select (now() at time zone l.timezone)::date::text as date
             from legal_entities l where l.tenant_id = $1 and l.organization_id = $2`,
            [this.scope.tenantId, this.scope.legalEntityId],
        );
        const from = parameters.get('from') ?? today?.date ?? '';
        const to = parameters.get('to') ?? from;
        if (!datePattern.test(from) || !datePattern.test(to))
            validation({
                from: 'Isi tanggal dengan format tahun-bulan-tanggal.',
            });
        return { from, to };
    }

    // Daftar Pembayaran: kunjungan selesai dalam rentang tanggal, dengan lencana Belum Bayar, Sudah Bayar, dan Total
    // atas rentang itu.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('payment', 'read');
        const { from, to } = await this.range(parameters);
        const status = parameters.get('status');
        const base = `${visitSql} and date between $3 and $4`;
        const batch = await incrementalList(this.db, {
            query: `${base}${status === 'paid' ? ' and paid' : status === 'unpaid' ? ' and not paid' : ''}`,
            bindings: [this.scope.tenantId, this.scope.legalEntityId, from, to],
            parameters,
            columns: {
                registered_at: 'registered_at',
                registration_number: 'registration_number',
                patient_name: 'patient_name',
            },
            searchColumns: [
                'registration_number',
                'patient_medical_record_number',
                'patient_name',
            ],
            numericColumns: [],
            defaultSort: 'registered_at',
            defaultDirection: 'asc',
        });
        const [counts] = await this.db.rows(
            z.object({
                unpaid: z.number(),
                paid: z.number(),
                total: z.number(),
            }),
            `select count(*) filter (where not paid)::int as unpaid, count(*) filter (where paid)::int as paid,
                    count(*)::int as total
             from (${base}) counted`,
            [this.scope.tenantId, this.scope.legalEntityId, from, to],
        );
        return {
            data: batch.data.map((row) => visitRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            counts: counts ?? { unpaid: 0, paid: 0, total: 0 },
            from,
            to,
        };
    }

    // Form Pembayaran baca-saja: panel Pasien, Rincian Biaya, dan Nilai tagihan dengan rumus kasir Kuta.
    async show(visitId: string) {
        this.workspace.guard('payment', 'read');
        const visit = lookupId(visitId)
            ? await this.db.one(
                  visitDetailSchema,
                  `${visitSql} and visits.id = $3`,
                  [this.scope.tenantId, this.scope.legalEntityId, visitId],
              )
            : undefined;
        if (!visit) abort(404, 'Not Found');
        const charges = await this.db.rows(
            chargeRowSchema,
            `select r.id, r.group_biaya as charge_group, r.kelompok_jasa_id as service_group_id,
                    r.kelompok_jasa_nama as service_group_name, r.kelompok_jasa_urutan as service_group_order,
                    r.kategori_nama as category_name, r.jenis_biaya_kode as code, r.jenis_biaya_nama as name,
                    trim_scale(r.qty)::text as quantity, trim_scale(r.nilai)::text as value,
                    trim_scale(r.harga_orig)::text as original_price, trim_scale(r.disc)::text as discount_percent,
                    trim_scale(r.hext)::text as extra, r.section_nama as section_name, r.dokter_nama as doctor_name,
                    r.tanggal::text as date, r.status, r.jenis_biaya_id as procedure_id, r.dokter_id as doctor_id,
                    coalesce((select json_agg(json_build_object('charge_component_id', c.komponen_biaya_id,
                                                                'value', trim_scale(c.nilai)::text))
                              from kunjungan_kasir_detail_komponen c
                              where c.tenant_id = r.tenant_id and c.kunjungan_kasir_detail_id = r.id
                                and c.deleted_at is null), '[]'::json) as components
             from kunjungan_kasir_detail r
             where r.tenant_id = $1 and r.legal_entity_id = $2 and r.kunjungan_id = $3 and r.deleted_at is null
             order by r.group_biaya, r.kelompok_jasa_urutan nulls last, r.kelompok_jasa_nama, r.tanggal, r.id`,
            [this.scope.tenantId, this.scope.legalEntityId, visitId],
        );
        const currency = new Currency(this.db, this.scope.tenantId);
        const precision = await currency.precision(localCurrencyCode);
        const totals = invoiceTotals(
            charges.map((charge) => ({
                serviceGroupId: charge.service_group_id,
                quantity: charge.quantity,
                value: charge.value,
                originalPrice: charge.original_price,
                discountPercent: charge.discount_percent,
                extra: charge.extra,
            })),
            precision,
        );
        const today = await this.db.one(
            z.object({ date: z.string() }),
            `select (now() at time zone l.timezone)::date::text as date
             from legal_entities l where l.tenant_id = $1 and l.organization_id = $2`,
            [this.scope.tenantId, this.scope.legalEntityId],
        );
        const date = today?.date ?? new Date().toISOString().slice(0, 10);
        // Jenis bayar yang digambar form kasir, berurut letaknya, dan merchan aktif untuk isian kartu. Jenis bayar
        // bermata uang asing membawa presisi mata uangnya dan kurs hari ini, atau pesan bila kursnya belum diisi.
        const methodRows = await this.db.rows(
            z.object({
                id: z.string(),
                label: z.string(),
                behavior: z.string(),
                party: z.string(),
                requires_merchant: z.boolean(),
                requires_reference: z.boolean(),
                allows_surcharge: z.boolean(),
                takes_remainder: z.boolean(),
                currency_code: z.string().nullable(),
            }),
            `select id, coalesce(label_kasir, nama) as label, perilaku as behavior, pihak as party,
                    wajib_merchan as requires_merchant, wajib_referensi as requires_reference,
                    biaya_tambahan as allows_surcharge, menampung_sisa as takes_remainder, mata_uang as currency_code
             from jenis_bayar
             where tenant_id = $1 and legal_entity_id = $2 and aktif and tampil_di_kasir and deleted_at is null
             order by urutan, kode`,
            [this.scope.tenantId, this.scope.legalEntityId],
        );
        // Jenis bayar yang dikhususkan tipe pasien lain tetap tampil seperti layar lama; refusal membawa pesan yang
        // ditampilkan layar saat jenis bayar itu diisi.
        const restricted = new Set(visit.restricted_payment_method_ids);
        const paymentMethods = await Promise.all(
            methodRows.map(async (method) => {
                const refusal = restricted.has(method.id)
                    ? patientTypeMessage
                    : null;
                if (!method.currency_code)
                    return {
                        ...method,
                        refusal,
                        currency_decimals: precision.amount_decimals,
                        rate: null,
                        rate_message: null,
                    };
                const rate = await currency.findRate(
                    method.currency_code,
                    date,
                );
                return {
                    ...method,
                    refusal,
                    currency_decimals: (
                        await currency.precision(method.currency_code)
                    ).amount_decimals,
                    rate: rate?.normalized() ?? null,
                    rate_message: rate
                        ? null
                        : missingRateMessage(method.currency_code, date),
                };
            }),
        );
        const merchants = await this.db.rows(
            z.object({ id: z.string(), code: z.string(), name: z.string() }),
            `select id, kode as code, nama as name from merchan
             where tenant_id = $1 and legal_entity_id = $2 and aktif and deleted_at is null order by kode`,
            [this.scope.tenantId, this.scope.legalEntityId],
        );
        const discounts = await this.db.rows(
            z.object({
                id: z.string(),
                code: z.string(),
                name: z.string(),
                kind: z.string(),
                charge_component_id: z.string().nullable(),
                service_group_id: z.string().nullable(),
            }),
            `select id, kode as code, nama as name, jenis as kind, komponen_biaya_id as charge_component_id,
                    kelompok_jasa_id as service_group_id
             from discount
             where tenant_id = $1 and legal_entity_id = $2 and aktif and deleted_at is null
             order by kode`,
            [this.scope.tenantId, this.scope.legalEntityId],
        );
        const payment = await this.db.one(
            z.object({
                id: z.string(),
                version: z.number(),
                number: z.string(),
                automatic: z.boolean(),
                // Clerk pembayaran ini sudah Clerk End: koreksinya nota kredit, bukan Batal.
                clerk_ended: z.boolean(),
                discount: z.string(),
                discounts: z.array(
                    z.object({
                        name: z.string(),
                        doctor_name: z.string().nullable(),
                        procedure_name: z.string().nullable(),
                        percent: z.string(),
                        amount: z.string(),
                        note: z.string().nullable(),
                    }),
                ),
                received: z.string(),
                change: z.string(),
                cash_label: z.string().nullable(),
                lines: z.array(
                    z.object({
                        label: z.string(),
                        amount: z.string(),
                        currency_code: z.string(),
                        currency_amount: z.string(),
                        rate: z.string(),
                    }),
                ),
            }),
            // Tunai mata uang lokal tersimpan bersih (uang diterima dikurangi kembalian), dan negatif bila kembalian tunai
            // valuta melebihi uang yang diterima. Layar menampilkannya seperti saat kasir mengisi: uang diterima di bawah
            // label jenis bayar tunai, lalu Kembalian, jadi barisnya tidak ikut daftar jenis bayar lain.
            `select k.id, k.version, k.no_bukti as number, k.otomatis as automatic,
                    coalesce((select c.status <> 'start' from clerk c
                              where c.tenant_id = k.tenant_id and c.id = k.clerk_id), false) as clerk_ended,
                    trim_scale(k.nilai_discount)::text as discount,
                    coalesce((select json_agg(json_build_object('name', m.nama, 'doctor_name', x.dokter_nama,
                                                                'procedure_name', x.jenis_biaya_nama,
                                                                'percent', trim_scale(x.persen)::text,
                                                                'amount', trim_scale(x.nilai)::text,
                                                                'note', x.keterangan) order by x.id)
                              from kasir_discount x join discount m on m.tenant_id = x.tenant_id and m.id = x.discount_id
                              where x.tenant_id = k.tenant_id and x.kasir_id = k.id), '[]'::json) as discounts,
                    trim_scale(k.jumlah_bayar)::text as received,
                    trim_scale(k.nilai_kembalian)::text as change,
                    coalesce((select coalesce(j.label_kasir, j.nama)
                              from kasir_detail d join jenis_bayar j on j.tenant_id = d.tenant_id and j.id = d.jenis_bayar_id
                              where d.tenant_id = k.tenant_id and d.kasir_id = k.id and j.perilaku = 'tunai'
                                and d.mata_uang = $4
                              limit 1),
                             (select coalesce(j.label_kasir, j.nama) from jenis_bayar j
                              where j.tenant_id = k.tenant_id and j.legal_entity_id = k.legal_entity_id
                                and j.perilaku = 'tunai' and j.mata_uang is null and j.aktif and j.deleted_at is null
                              order by j.urutan, j.kode limit 1)) as cash_label,
                    coalesce((select json_agg(json_build_object('label', coalesce(j.label_kasir, j.nama),
                                                                'amount', trim_scale(d.nilai)::text,
                                                                'currency_code', d.mata_uang,
                                                                'currency_amount', trim_scale(d.nilai_valuta)::text,
                                                                'rate', trim_scale(d.kurs)::text)
                                              order by j.urutan, j.kode)
                              from kasir_detail d join jenis_bayar j on j.tenant_id = d.tenant_id and j.id = d.jenis_bayar_id
                              where d.tenant_id = k.tenant_id and d.kasir_id = k.id
                                and not (j.perilaku = 'tunai' and d.mata_uang = $4)), '[]'::json) as lines
             from kasir k
             where k.tenant_id = $1 and k.legal_entity_id = $2 and k.kunjungan_id = $3 and k.status = 'diposting'`,
            [
                this.scope.tenantId,
                this.scope.legalEntityId,
                visitId,
                localCurrencyCode,
            ],
        );
        // Pembayaran kunjungan ini yang sudah dikoreksi nota kredit, ditampilkan baca-saja di atas pembayaran barunya.
        const creditMemos = await this.db.rows(
            z.object({ number: z.string(), payment_number: z.string() }),
            `select n.no_bukti as number, k.no_bukti as payment_number
             from nota_kredit n join kasir k on k.tenant_id = n.tenant_id and k.id = n.kasir_id
             where n.tenant_id = $1 and n.legal_entity_id = $2 and k.kunjungan_id = $3
             order by n.jam, n.id`,
            [this.scope.tenantId, this.scope.legalEntityId, visitId],
        );
        return {
            data: {
                visit,
                charges,
                totals: {
                    value: totals.value,
                    original_value: totals.originalValue,
                },
                payment_methods: paymentMethods,
                merchants,
                discounts,
                payment: payment
                    ? {
                          ...payment,
                          credit_memo: payment.clerk_ended
                              ? await creditMemoPreview(this.db, {
                                    tenantId: this.scope.tenantId,
                                    paymentId: payment.id,
                                })
                              : null,
                      }
                    : null,
                credit_memos: creditMemos,
                can_pay: this.workspace.permissions.has('core.payment.update'),
                can_change_rate: this.workspace.permissions.has(
                    'core.payment-rate.update',
                ),
                amount_decimals: precision.amount_decimals,
                local_currency: localCurrencyCode,
                date,
            },
        };
    }
}
