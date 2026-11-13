import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    isoSql,
    type Bind,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    dateSchema,
    incrementalList,
    lookupId,
} from '@core/platform/http/index.ts';
import { activeLegalEntity } from '@core/foundation/inventory/index.ts';
import {
    prescriptionLineSchema,
    prescriptionRowSchema,
    queueStatuses,
} from './prescription.schema.ts';

// Lokasi yang melayani resep: pilihan petugas farmasi di resep itu, lalu baris Lokasi layanan resep untuk section
// asalnya, lalu baris bawaan operating unit-nya. Satu pernyataan SQL dipakai antrean dan penyerahan, supaya keduanya
// tidak pernah berbeda pendapat tentang lokasi resep yang sama.
export const servingLocationSql = (
    alias: string,
) => `coalesce(${alias}.lokasi_id, (
        select m.lokasi_id from far_m_lokasi_layanan m
        where m.tenant_id = ${alias}.tenant_id and m.legal_entity_id = ${alias}.legal_entity_id
          and m.operating_unit_id = ${alias}.operating_unit_id and m.deleted_at is null
          and (m.section_id = ${alias}.section_id or m.section_id is null)
        order by m.section_id is null
        limit 1))`;

const rowSql = `select * from (
                    select r.id, r.nomor_resep as prescription_number, r.no_reg as registration_number,
                           ${isoSql('r.diterbitkan_pada')} as issued_at, ${isoSql('r.diterima_pada')} as received_at,
                           r.diterbitkan_pada as issued_order, r.nama_pasien as patient_name,
                           r.nrm as medical_record_number, r.tanggal_lahir::text as birth_date,
                           r.nama_dokter as doctor_name, r.nama_section as section_name,
                           u.name as operating_unit_name, r.catatan as notes, r.version, served.lokasi_id as location_id,
                           case when l.id is null then null
                                else json_build_object('id', l.id, 'code', l.kode, 'name', l.nama) end as location,
                           (select count(*)::int from far_tr_resep_detail d
                            where d.tenant_id = r.tenant_id and d.resep_id = r.id and d.barang_id is not null
                              and d.deleted_at is null) as item_count,
                           (r.diterbitkan_pada at time zone 'UTC' at time zone e.timezone)::date::text as issued_date,
                           case when b.status is null or b.status = 'draf' then 'menunggu' else b.status end
                               as queue_status,
                           b.status as dispensing_status, b.nomor as dispensing_number,
                           b.version as dispensing_version, ${isoSql('b.dipanggil_pada')} as called_at,
                           ${isoSql('b.diserahkan_pada')} as handed_over_at
                    from far_tr_resep r
                    join organizations u on u.tenant_id = r.tenant_id and u.id = r.operating_unit_id
                    join legal_entities e on e.tenant_id = r.tenant_id and e.organization_id = r.legal_entity_id
                    left join bill_farmasi b on b.tenant_id = r.tenant_id and b.resep_id = r.id
                         and b.deleted_at is null and b.status <> 'dibatalkan'
                    cross join lateral (select coalesce(b.lokasi_id, ${servingLocationSql('r')}) as lokasi_id) served
                    left join gd_m_lokasi l on l.tenant_id = r.tenant_id and l.id = served.lokasi_id
                    where r.tenant_id = $1 and r.legal_entity_id = $2 and r.deleted_at is null) prescriptions
                where true`;

// Resep di antrean farmasi legal entity tempat kerja. Isinya potret dari layanan kesehatan, jadi hanya dibaca.
export class Prescriptions {
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

    // Lokasi yang melayani resep di legal entity ini, untuk pilihan lokasi di layar antrean: yang diatur di Lokasi
    // layanan resep dan yang pernah dipilih petugas pada resep.
    async metadata() {
        this.workspace.guard('prescription', 'read');
        const scope = this.scope;
        return {
            locations: await this.db.rows(
                z.object({
                    id: z.string(),
                    code: z.string(),
                    name: z.string(),
                }),
                `select l.id, l.kode as code, l.nama as name from gd_m_lokasi l
                 where l.tenant_id = $1 and l.legal_entity_id = $2 and l.deleted_at is null
                   and (exists (select 1 from far_m_lokasi_layanan m
                                where m.tenant_id = l.tenant_id and m.lokasi_id = l.id and m.deleted_at is null)
                        or exists (select 1 from far_tr_resep r
                                   where r.tenant_id = l.tenant_id and r.lokasi_id = l.id and r.deleted_at is null))
                 order by l.kode`,
                [scope.tenantId, scope.legalEntityId],
            ),
            permissions: {
                prepare: this.workspace.permissions.has(
                    'pharmacy.dispensing.prepare',
                ),
                hand_over: this.workspace.permissions.has(
                    'pharmacy.dispensing.hand-over',
                ),
            },
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('prescription', 'read');
        const scope = this.scope;
        const bindings: Bind[] = [scope.tenantId, scope.legalEntityId];
        let filter = '';
        const location = parameters.get('location') ?? '';
        if (location === 'none') filter += ' and location_id is null';
        else if (lookupId(location))
            filter += ` and location_id = $${bindings.push(location)}`;
        const date = parameters.get('date') ?? '';
        if (dateSchema.safeParse(date).success)
            filter += ` and issued_date = $${bindings.push(date)}`;
        // Jumlah per status mengikuti lokasi dan tanggal yang dipilih, sebelum status dan pencarian.
        const counted = await this.db.rows(
            z.object({ status: z.enum(queueStatuses), total: z.number() }),
            `select queue_status as status, count(*)::int as total from (${rowSql}${filter}) counted
             group by queue_status`,
            bindings,
        );
        const status = z
            .enum(queueStatuses)
            .safeParse(parameters.get('status'));
        if (status.success)
            filter += ` and queue_status = $${bindings.push(status.data)}`;
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                issued_at: 'issued_order',
                patient_name: 'patient_name',
                prescription_number: 'prescription_number',
            },
            searchColumns: [
                'prescription_number',
                'registration_number',
                'patient_name',
                'medical_record_number',
                'doctor_name',
            ],
            numericColumns: [],
            defaultSort: 'issued_at',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => prescriptionRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            counts: queueStatuses.map((value) => ({
                status: value,
                total: counted.find((row) => row.status === value)?.total ?? 0,
            })),
        };
    }

    async show(id: string) {
        this.workspace.guard('prescription', 'read');
        const scope = this.scope;
        const header = lookupId(id)
            ? await this.db.one(
                  prescriptionRowSchema.extend({
                      notes: z.string().nullable(),
                  }),
                  `${rowSql} and prescriptions.id = $3`,
                  [scope.tenantId, scope.legalEntityId, id],
              )
            : undefined;
        if (!header) abort(404, 'Not Found');
        const lines = await this.db.rows(
            prescriptionLineSchema,
            `select d.id, d.urutan as "order", d.racikan_ke as compound, trim_scale(d.jumlah)::text as quantity,
                    trim_scale(d.jumlah_permintaan)::text as requested_quantity, d.signa,
                    d.aturan_pakai as usage_instruction, d.keterangan as notes,
                    case when d.barang_id is null then null else json_build_object(
                        'id', d.barang_id, 'code', d.kode_barang, 'name', d.nama_barang) end as item,
                    case when d.satuan_id is null then null else json_build_object(
                        'id', d.satuan_id, 'code', d.kode_satuan, 'name', d.nama_satuan) end as unit,
                    trim_scale(d.konversi)::text as quantity_per_unit, d.frekuensi as frequency_per_day,
                    trim_scale(d.dosis)::text as dose,
                    case when ds.id is null then null else json_build_object(
                        'id', ds.id, 'code', ds.kode, 'name', ds.nama) end as dose_unit,
                    case when d.rute_kode is null then null else json_build_object(
                        'code', d.rute_kode, 'name', d.rute_nama) end as route,
                    d.lama_hari as duration_days, d.dtd,
                    case when d.bentuk_sediaan_kode is null then null else json_build_object(
                        'code', d.bentuk_sediaan_kode, 'name', d.bentuk_sediaan_nama) end as dosage_form
             from far_tr_resep_detail d
             left join gd_m_satuan ds on ds.tenant_id = d.tenant_id and ds.id = d.dosis_satuan_id
             where d.tenant_id = $1 and d.resep_id = $2 and d.deleted_at is null
             order by d.urutan, d.id`,
            [scope.tenantId, header.id],
        );
        return { data: { ...header, lines } };
    }
}
