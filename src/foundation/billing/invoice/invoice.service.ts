import { z } from 'zod';
import type { Workspace } from '../../../platform/access/index.ts';
import { isoSql, type Database } from '../../../platform/database/index.ts';
import {
    abort,
    incrementalList,
    lookupId,
    validation,
} from '../../../platform/http/index.ts';
import { Currency, localCurrencyCode } from '../../currency/index.ts';
import { activeLegalEntity } from '../../inventory/index.ts';
import {
    chargeRowSchema,
    visitDetailSchema,
    visitRowSchema,
} from './invoice.schema.ts';
import { invoiceTotals } from './invoice.totals.ts';

// Sudah dibayar bila kunjungan punya pembayaran yang tidak batal. Pembayaran lahir bersama Simpan pembayaran; sampai
// saat itu setiap kunjungan belum dibayar.
const paidSql = 'false';

const visitSql = `select * from (
                      select k.kunjungan_id as id, k.no_reg as registration_number, k.tanggal::text as date,
                             ${isoSql('k.didaftarkan_pada')} as registered_at,
                             k.pasien_nrm as patient_medical_record_number, k.pasien_nama as patient_name,
                             k.tipe_pasien_nama as patient_type_name, k.section_nama as sections,
                             ${paidSql} as paid, k.penjamin_nama as guarantor_name, k.no_kartu as card_number
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
                    r.tanggal::text as date, r.status
             from kunjungan_kasir_detail r
             where r.tenant_id = $1 and r.legal_entity_id = $2 and r.kunjungan_id = $3 and r.deleted_at is null
             order by r.group_biaya, r.kelompok_jasa_urutan nulls last, r.kelompok_jasa_nama, r.tanggal, r.id`,
            [this.scope.tenantId, this.scope.legalEntityId, visitId],
        );
        const totals = invoiceTotals(
            charges.map((charge) => ({
                serviceGroupId: charge.service_group_id,
                quantity: charge.quantity,
                value: charge.value,
                originalPrice: charge.original_price,
                discountPercent: charge.discount_percent,
                extra: charge.extra,
            })),
            await new Currency(this.db, this.scope.tenantId).precision(
                localCurrencyCode,
            ),
        );
        return {
            data: {
                visit,
                charges,
                totals: {
                    value: totals.value,
                    original_value: totals.originalValue,
                },
            },
        };
    }
}
