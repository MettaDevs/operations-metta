import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import type { Bind, Database } from '@core/platform/database/index.ts';
import { abort, incrementalList, lookupId } from '@core/platform/http/index.ts';
import { visitVisibility } from '../../registration/visit/visit.service.ts';
import { panels } from '../medical-record/medical-record.fields.ts';
import {
    baseQuantityText,
    quantityOf,
    quantityText,
} from '../medical-record/prescription.units.ts';
import { cpptSchema, visitHistoryRowSchema, type Cppt } from './cppt.schema.ts';

const nakesName = (alias: string, column: string) =>
    `(select pt.name from sim_m_nakes n join parties pt on pt.tenant_id = n.tenant_id and pt.id = n.party_id
      where n.tenant_id = d.tenant_id and n.id = ${alias}.${column})`;

// Nama pilihan setiap isian Pemeriksaan dasar gigi, dari katalog isian panel itu.
const dentalSelect = Object.entries(panels.dental.fields)
    .map(([field, spec]) =>
        spec.kind === 'option'
            ? `(select o.nama from sim_m_pemeriksaan_pilihan o
                where o.tenant_id = g.tenant_id and o.kelompok = '${spec.group}' and o.kode = g.${spec.column}
                  and o.deleted_at is null limit 1) as ${field}`
            : `g.${spec.column} as ${field}`,
    )
    .join(', ');

const writtenPrescriptionSchema = z.object({
    number: z.string().nullable(),
    status: z.enum(['draf', 'dikirim']),
    handed_over: z.boolean(),
    lines: z.array(
        z.object({
            compound: z.number().nullable(),
            drug_name: z.string().nullable(),
            quantity: z.string().nullable(),
            unit_code: z.string().nullable(),
            conversion: z.string().nullable(),
            base_unit_code: z.string().nullable(),
            dispensed: z.string().nullable(),
            returned: z.string().nullable(),
            requested_quantity: z.number().nullable(),
            signa: z.string().nullable(),
            usage_instruction: z.string().nullable(),
            notes: z.string().nullable(),
        }),
    ),
});
type WrittenPrescription = z.infer<typeof writtenPrescriptionSchema>;
type PlanLine = Cppt['plan']['prescriptions'][number]['lines'][number];

// Baris resep di P. Resep yang sudah diserahkan menulis yang dipegang pasien dalam satuan baris bila habis dibagi
// isinya, kalau tidak dalam satuan dasar; obat yang habis diretur tidak ditulis, begitu pula kepala racikan yang semua
// komponennya habis diretur.
function planLines({
    handed_over: handedOver,
    lines,
}: WrittenPrescription): PlanLine[] {
    const shown = lines.flatMap(
        ({
            quantity,
            unit_code: unitCode,
            conversion,
            base_unit_code: baseUnitCode,
            dispensed,
            returned,
            ...line
        }): PlanLine[] => {
            if (line.drug_name === null || !unitCode || !conversion)
                return [{ ...line, quantity: null }];
            if (!handedOver)
                return [
                    {
                        ...line,
                        quantity: quantityText(
                            quantityOf(quantity ?? '0'),
                            unitCode,
                        ),
                    },
                ];
            const kept =
                quantityOf(dispensed ?? '0') - quantityOf(returned ?? '0');
            return kept > 0n
                ? [
                      {
                          ...line,
                          quantity: baseQuantityText(
                              kept,
                              {
                                  code: unitCode,
                                  quantityPerUnit: quantityOf(conversion),
                              },
                              baseUnitCode ?? '',
                          ),
                      },
                  ]
                : [];
        },
    );
    return handedOver
        ? shown.filter(
              (line) =>
                  line.drug_name !== null ||
                  shown.some(
                      (other) =>
                          other.drug_name !== null &&
                          other.compound === line.compound,
                  ),
          )
        : shown;
}

// CPPT pemeriksaan rawat jalan: S/O/A/P satu pemeriksaan disusun dari rekam medisnya, dan Riwayat kunjungan pasien.
// Yang terlihat sama dengan Riwayat diagnosa: kunjungan di legal entity dan unit kerja pengguna.
export class Cppts {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get tenantId() {
        return this.workspace.tenantId;
    }

    private async destination(id: string) {
        const bindings: Bind[] = [this.tenantId, lookupId(id)];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const found = bindings[1]
            ? await this.db.one(
                  z.object({ id: z.string(), patient_id: z.string() }),
                  `select d.id, r.pasien_id as patient_id
                   from sim_tr_registrasi_tujuan d
                   join sim_tr_registrasi r on r.tenant_id = d.tenant_id and r.id = d.registrasi_id
                   where d.tenant_id = $1 and d.id = $2 and d.deleted_at is null and r.deleted_at is null
                     and ${visitVisibility(this.workspace, bind)}`,
                  bindings,
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async show(destinationId: string): Promise<{ data: Cppt }> {
        this.workspace.guard('examination', 'read');
        const { id } = await this.destination(destinationId);
        const tenantId = this.tenantId;
        const row = await this.db.one(
            z.object({
                record_id: z.string().nullable(),
                date: z.string(),
                section_name: z.string(),
                registration_number: z.string(),
                examination_number: z.string(),
                status: z.string(),
                doctor_name: z.string().nullable(),
                nurse_name: z.string().nullable(),
                chief_complaint: z.string().nullable(),
                additional_complaint: z.string().nullable(),
                history_none: z.boolean().nullable(),
                present_history: z.string().nullable(),
                past_history: z.string().nullable(),
                family_history: z.string().nullable(),
                consciousness: z.string().nullable(),
                systolic: z.number().nullable(),
                diastolic: z.number().nullable(),
                height: z.number().nullable(),
                weight: z.number().nullable(),
                waist_circumference: z.number().nullable(),
                pulse_rate: z.number().nullable(),
                respiratory_rate: z.number().nullable(),
                oxygen_saturation: z.number().nullable(),
                temperature: z.number().nullable(),
                pain_scale: z.number().nullable(),
                unsteady_gait: z.boolean().nullable(),
                uses_support: z.boolean().nullable(),
                drug_therapy: z.string().nullable(),
                non_drug_therapy: z.string().nullable(),
            }),
            `select p.id as record_id, r.tanggal::text as date, s.nama as section_name,
                    r.no_reg as registration_number, d.no_bukti as examination_number, d.status,
                    ${nakesName('p', 'dokter_id')} as doctor_name, ${nakesName('p', 'perawat_id')} as nurse_name,
                    p.keluhan_utama as chief_complaint, p.keluhan_tambahan as additional_complaint,
                    rp.tidak_ada as history_none, rp.riwayat_sekarang as present_history,
                    rp.riwayat_dahulu as past_history, rp.riwayat_keluarga as family_history,
                    kz.nama as consciousness, f.sistole as systolic, f.diastole as diastolic,
                    f.tinggi_badan::float8 as height, f.berat_badan::float8 as weight,
                    f.lingkar_perut::float8 as waist_circumference, f.detak_nadi as pulse_rate,
                    f.nafas as respiratory_rate, f.saturasi as oxygen_saturation, f.suhu::float8 as temperature,
                    ny.skala as pain_scale, rj.cara_berjalan as unsteady_gait, rj.penopang as uses_support,
                    l.terapi_obat as drug_therapy, l.terapi_non_obat as non_drug_therapy
             from sim_tr_registrasi_tujuan d
             join sim_tr_registrasi r on r.tenant_id = d.tenant_id and r.id = d.registrasi_id
             join sim_m_section s on s.tenant_id = d.tenant_id and s.id = d.section_id
             left join sim_tr_pemeriksaan p on p.tenant_id = d.tenant_id and p.tujuan_id = d.id and p.deleted_at is null
             left join sim_tr_pemeriksaan_riwayat_penyakit rp
                  on rp.tenant_id = p.tenant_id and rp.pemeriksaan_id = p.id and rp.deleted_at is null
             left join sim_tr_pemeriksaan_fisik f
                  on f.tenant_id = p.tenant_id and f.pemeriksaan_id = p.id and f.deleted_at is null
             left join sim_m_pemeriksaan_pilihan kz
                  on kz.tenant_id = f.tenant_id and kz.kelompok = 'kesadaran' and kz.kode = f.kesadaran
                     and kz.deleted_at is null
             left join sim_tr_pemeriksaan_nyeri ny
                  on ny.tenant_id = p.tenant_id and ny.pemeriksaan_id = p.id and ny.deleted_at is null
             left join sim_tr_pemeriksaan_risiko_jatuh rj
                  on rj.tenant_id = p.tenant_id and rj.pemeriksaan_id = p.id and rj.deleted_at is null
             left join sim_tr_pemeriksaan_lainnya l
                  on l.tenant_id = p.tenant_id and l.pemeriksaan_id = p.id and l.deleted_at is null
             where d.tenant_id = $1 and d.id = $2`,
            [tenantId, id],
        );
        if (!row) abort(404, 'Not Found');
        const recordId = row.record_id;
        const dental = recordId
            ? await this.db.one(
                  z.record(z.string(), z.string().nullable()),
                  `select ${dentalSelect} from sim_tr_pemeriksaan_gigi_dasar g
                   where g.tenant_id = $1 and g.pemeriksaan_id = $2 and g.deleted_at is null`,
                  [tenantId, recordId],
              )
            : undefined;
        const assessment = recordId
            ? await this.db.rows(
                  cpptSchema.shape.assessment.element,
                  `select i.kode as icd10_code, i.nama as icd10_name, j.nama as type_name, k.nama as case_name
                   from sim_tr_pemeriksaan_diagnosa dg
                   join sim_m_icd10 i on i.tenant_id = dg.tenant_id and i.id = dg.icd10_id
                   join sim_m_diagnosa_jenis j on j.tenant_id = dg.tenant_id and j.id = dg.jenis_id
                   join sim_m_diagnosa_kasus k on k.tenant_id = dg.tenant_id and k.id = dg.kasus_id
                   where dg.tenant_id = $1 and dg.pemeriksaan_id = $2 and dg.deleted_at is null
                   order by dg.urutan`,
                  [tenantId, recordId],
              )
            : [];
        const procedures = recordId
            ? await this.db.rows(
                  cpptSchema.shape.plan.shape.procedures.element,
                  `select t.nama as name, pt.jumlah as quantity
                   from sim_tr_pemeriksaan_tindakan pt
                   join sim_m_tindakan t on t.tenant_id = pt.tenant_id and t.id = pt.tindakan_id
                   where pt.tenant_id = $1 and pt.pemeriksaan_id = $2 and pt.deleted_at is null
                   order by pt.urutan`,
                  [tenantId, recordId],
              )
            : [];
        const prescriptions = recordId
            ? await this.db.rows(
                  writtenPrescriptionSchema,
                  `select rs.nomor as number, rs.status, rs.diserahkan_pada is not null as handed_over,
                          coalesce((select json_agg(json_build_object(
                                        'compound', rd.racikan_ke, 'drug_name', ob.nama,
                                        'quantity', rd.jumlah::text, 'unit_code', so.kode,
                                        'conversion', rd.konversi::text, 'base_unit_code', bu.kode,
                                        'dispensed', rd.jumlah_diserahkan::text, 'returned', rd.jumlah_diretur::text,
                                        'requested_quantity', rd.jumlah_permintaan::float8, 'signa', rd.signa,
                                        'usage_instruction', ap.nama, 'notes', rd.keterangan) order by rd.urutan)
                                    from sim_tr_resep_detail rd
                                    left join gd_m_barang ob on ob.tenant_id = rd.tenant_id and ob.id = rd.obat_id
                                    left join gd_m_satuan so on so.tenant_id = rd.tenant_id and so.id = rd.satuan_id
                                    left join gd_m_satuan bu on bu.tenant_id = ob.tenant_id and bu.id = ob.satuan_dasar_id
                                    left join sim_m_aturan_pakai ap
                                         on ap.tenant_id = rd.tenant_id and ap.id = rd.aturan_pakai_id
                                    where rd.tenant_id = rs.tenant_id and rd.resep_id = rs.id
                                      and rd.deleted_at is null), '[]'::json) as lines
                   from sim_tr_resep rs
                   where rs.tenant_id = $1 and rs.pemeriksaan_id = $2 and rs.deleted_at is null
                     and rs.status <> 'dibatalkan'
                   order by rs.created_at, rs.id`,
                  [tenantId, recordId],
              )
            : [];
        return {
            data: cpptSchema.parse({
                destination_id: id,
                date: row.date,
                section_name: row.section_name,
                registration_number: row.registration_number,
                examination_number: row.examination_number,
                status: row.status,
                doctor_name: row.doctor_name,
                nurse_name: row.nurse_name,
                subjective: {
                    chief_complaint: row.chief_complaint,
                    additional_complaint: row.additional_complaint,
                    history_none: row.history_none,
                    present_history: row.present_history,
                    past_history: row.past_history,
                    family_history: row.family_history,
                },
                objective: {
                    consciousness: row.consciousness,
                    systolic: row.systolic,
                    diastolic: row.diastolic,
                    height: row.height,
                    weight: row.weight,
                    waist_circumference: row.waist_circumference,
                    pulse_rate: row.pulse_rate,
                    respiratory_rate: row.respiratory_rate,
                    oxygen_saturation: row.oxygen_saturation,
                    temperature: row.temperature,
                    pain_scale: row.pain_scale,
                    unsteady_gait: row.unsteady_gait,
                    uses_support: row.uses_support,
                    dental: dental ?? null,
                },
                assessment,
                plan: {
                    drug_therapy: row.drug_therapy,
                    non_drug_therapy: row.non_drug_therapy,
                    procedures,
                    prescriptions: prescriptions.map((prescription) => ({
                        number: prescription.number,
                        status: prescription.status,
                        handed_over: prescription.handed_over,
                        lines: planLines(prescription),
                    })),
                },
            }),
        };
    }

    // Riwayat kunjungan: pemeriksaan lain pasien ini yang sudah dimulai, terbaru dulu, dimuat bertahap. CPPT-nya dibuka
    // per baris.
    async history(destinationId: string, parameters: URLSearchParams) {
        this.workspace.guard('examination', 'read');
        const destination = await this.destination(destinationId);
        const bindings: Bind[] = [
            this.tenantId,
            destination.patient_id,
            destination.id,
        ];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const batch = await incrementalList(this.db, {
            query: `select * from (
                        select d.id, r.tanggal::text as date, s.nama as section_name,
                               d.no_bukti as examination_number, ${nakesName('p', 'dokter_id')} as doctor_name,
                               (select string_agg(i.kode, ', ' order by dg.urutan)
                                from sim_tr_pemeriksaan_diagnosa dg
                                join sim_m_icd10 i on i.tenant_id = dg.tenant_id and i.id = dg.icd10_id
                                where dg.tenant_id = p.tenant_id and dg.pemeriksaan_id = p.id
                                  and dg.deleted_at is null) as diagnoses
                        from sim_tr_pemeriksaan p
                        join sim_tr_registrasi_tujuan d on d.tenant_id = p.tenant_id and d.id = p.tujuan_id
                        join sim_tr_registrasi r on r.tenant_id = d.tenant_id and r.id = d.registrasi_id
                        join sim_m_section s on s.tenant_id = d.tenant_id and s.id = d.section_id
                        where p.tenant_id = $1 and p.pasien_id = $2 and p.tujuan_id <> $3
                          and p.deleted_at is null and d.deleted_at is null and r.deleted_at is null
                          and ${visitVisibility(this.workspace, bind)}) history
                    where true`,
            bindings,
            parameters,
            columns: { date: 'date', examination_number: 'examination_number' },
            searchColumns: ['section_name', 'examination_number', 'diagnoses'],
            numericColumns: [],
            defaultSort: 'date',
            defaultDirection: 'desc',
        });
        return {
            data: batch.data.map((row) => visitHistoryRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }
}
