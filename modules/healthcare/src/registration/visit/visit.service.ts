import { z } from 'zod';
import { NumberIssuer } from '@core/foundation/number-sequence/index.ts';
import type { Workspace } from '@core/platform/access/index.ts';
import { maskNumber } from '@core/platform/address-book/index.ts';
import {
    nowSql,
    type Bind,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    dateSchema,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import {
    asksPregnancy,
    classifyVisit,
    undeterminedLifeCycleMessage,
} from '../../clinical/life-cycle/life-cycle.classification.ts';
import type { LifeCycleRow } from '../../clinical/life-cycle/life-cycle.schema.ts';
import { activeLifeCycles } from '../../clinical/life-cycle/life-cycle.service.ts';
import type { PatientTypeBehavior } from '../../coverage/patient-type/patient-type.behaviors.ts';
import { moduleId } from '../../module.ts';
import {
    grantedUnits,
    grantsUnit,
    PatientSharing,
} from '../../patient/patient-sharing/patient-sharing.service.ts';
import {
    ensurePracticeSchedule,
    schedulesForRegistration,
} from '../../service/practice-schedule/practice-schedule.service.ts';
import {
    isQueueMode,
    type QueueMode,
} from '../../service/section/section.queue-modes.ts';
import {
    visitCancelInputSchema,
    visitInputSchema,
    visitListRowSchema,
    visitSchema,
    type VisitInput,
} from './visit.schema.ts';
import {
    isVisitCondition,
    isVisitStatus,
    refusedTransition,
} from './visit.statuses.ts';

export const visitNumberReference = `${moduleId}.visit-number`;
export const examinationNumberReference = `${moduleId}.examination-number`;
// Pesan sistem lama persis.
export const visitLimitMessage =
    'Pasien sudah memiliki registrasi hari ini di poli yang sama.';
export const scheduleFullMessage = 'Kuota jadwal dokter ini sudah penuh.';
const maxListDays = 366;

type Errors = Record<string, string[]>;
function add(errors: Errors, field: string, message: string): void {
    (errors[field] ??= []).push(message);
}

const optional = (value: string | null | undefined) => value?.trim() || null;

// Tinggi dan berat badan: angka positif yang muat di kolom numeric(5,1).
function measure(
    errors: Errors,
    field: string,
    value: number | string | null | undefined,
): number | null {
    if (value === null || value === undefined || value === '') return null;
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number) || number <= 0 || number >= 10000) {
        add(errors, field, 'Isi angka lebih dari 0.');
        return null;
    }
    return Math.round(number * 10) / 10;
}

function ids(values: string[] | undefined): string[] {
    return [...new Set(values ?? [])];
}

function placeholders(start: number, count: number): string {
    return Array.from(
        { length: count },
        (_, index) => `$${start + index}`,
    ).join(',');
}

const headerSql = `
    select r.id, r.version, r.no_reg as registration_number, r.legal_entity_id, r.operating_unit_id,
           unit.name as operating_unit_name, r.pasien_id as patient_id, k.nrm as patient_nrm, p.name as patient_name,
           r.tanggal::text as date, to_char(r.didaftarkan_pada, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as registered_at,
           r.tipe_pasien_id as patient_type_id, t.nama as patient_type_name, r.penjamin_id as guarantor_id,
           gp.name as guarantor_name, r.no_kartu as card_number, r.tinggi_badan as height_cm,
           r.berat_badan as weight_kg, r.status_kunjungan as visit_condition, r.umur_tahun as age_years,
           r.umur_bulan as age_months, r.umur_hari as age_days, r.jenis_kunjungan as visit_kind,
           r.kategori_skrining_id as screening_category_id, sk.nama as screening_category_name,
           sk.warna as screening_category_color, r.status_hamil as pregnant, r.siklus_hidup_id as life_cycle_id,
           sh.nama as life_cycle_name, r.klaster_id as cluster_id, kl.kode as cluster_code, kl.nama as cluster_name,
           r.status, r.batal_oleh as cancelled_by_user_id,
           to_char(r.batal_pada, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as cancelled_at, r.alasan_batal as cancel_reason,
           coalesce((select json_agg(json_build_object('id', m.id, 'name', m.nama) order by m.urutan, m.nama)
                     from sim_tr_registrasi_keadaan rk
                     join sim_m_keadaan_pasien m on m.tenant_id = rk.tenant_id and m.id = rk.keadaan_id
                     where rk.tenant_id = r.tenant_id and rk.registrasi_id = r.id and rk.deleted_at is null),
                    '[]'::json) as patient_conditions,
           coalesce((select json_agg(json_build_object('id', d.id, 'name', d.nama, 'category_id', d.kategori_id)
                                     order by c.tingkat, d.urutan, d.nama)
                     from sim_tr_registrasi_skrining rs
                     join sim_m_skrining_tanda d on d.tenant_id = rs.tenant_id and d.id = rs.tanda_id
                     join sim_m_skrining_kategori c on c.tenant_id = d.tenant_id and c.id = d.kategori_id
                     where rs.tenant_id = r.tenant_id and rs.registrasi_id = r.id and rs.deleted_at is null),
                    '[]'::json) as screening_signs,
           coalesce((select json_agg(json_build_object(
                                'id', d.id, 'sequence', d.urutan, 'section_id', d.section_id, 'section_name', s.nama,
                                'practice_schedule_id', d.jadwal_praktik_id, 'practitioner_id', d.nakes_id,
                                'practitioner_name', np.name, 'queue_number', d.no_antrean,
                                'queue_code', d.kode_antrean, 'examination_number', d.no_bukti,
                                'status', d.status, 'room_id', d.ruangan_id) order by d.urutan)
                     from sim_tr_registrasi_tujuan d
                     join sim_m_section s on s.tenant_id = d.tenant_id and s.id = d.section_id
                     left join sim_m_nakes n on n.tenant_id = d.tenant_id and n.id = d.nakes_id
                     left join parties np on np.tenant_id = n.tenant_id and np.id = n.party_id
                     where d.tenant_id = r.tenant_id and d.registrasi_id = r.id and d.deleted_at is null),
                    '[]'::json) as destinations
    from sim_tr_registrasi r
    join sim_m_pasien k on k.tenant_id = r.tenant_id and k.id = r.pasien_id
    join parties p on p.tenant_id = k.tenant_id and p.id = k.party_id
    join organizations unit on unit.id = r.operating_unit_id
    join sim_m_tipe_pasien t on t.tenant_id = r.tenant_id and t.id = r.tipe_pasien_id
    left join sim_m_penjamin g on g.tenant_id = r.tenant_id and g.id = r.penjamin_id
    left join parties gp on gp.tenant_id = g.tenant_id and gp.id = g.party_id
    left join sim_m_skrining_kategori sk on sk.tenant_id = r.tenant_id and sk.id = r.kategori_skrining_id
    left join sim_m_siklus_hidup sh on sh.tenant_id = r.tenant_id and sh.id = r.siklus_hidup_id
    left join sim_m_klaster kl on kl.tenant_id = r.tenant_id and kl.id = r.klaster_id
    where r.tenant_id = $1 and r.id = $2`;

// Klaster yang dilayani section `s`. Kosong berarti section melayani semua klaster.
const sectionClustersSql = `coalesce((select json_agg(c.klaster_id) from sim_m_section_klaster c
                                      where c.tenant_id = s.tenant_id and c.section_id = s.id
                                        and c.deleted_at is null), '[]'::json)`;

function presentLifeCycle(rule: LifeCycleRow) {
    return {
        id: rule.id,
        code: rule.code,
        name: rule.name,
        cluster_id: rule.cluster_id,
        cluster_code: rule.cluster_code,
        cluster_name: rule.cluster_name,
    };
}

// Hari ini menurut zona waktu legal entity aktif, karena klinik bekerja di jam setempat.
export async function visitDate(
    db: Database,
    workspace: Workspace,
): Promise<string> {
    const legalEntityId = workspace.legalEntityId;
    if (!legalEntityId)
        validation({
            legal_entity_id:
                'Pilih legal entity di tempat kerja sebelum melanjutkan.',
        });
    const found = await db.one(
        z.object({ date: z.string() }),
        `select (now() at time zone l.timezone)::date::text as date from legal_entities l
         where l.tenant_id = $1 and l.organization_id = $2`,
        [workspace.tenantId, legalEntityId],
    );
    if (!found) abort(404, 'Not Found');
    return found.date;
}

// Syarat SQL kunjungan `r` yang terlihat: legal entity aktif, lalu unit dari kebijakan data pasien. Batas
// "seluruh organisasi" tidak membatasi unit.
export function visitVisibility(
    workspace: Workspace,
    bind: (value: Bind) => string,
): string {
    const units = grantedUnits(workspace);
    if (!workspace.legalEntityId || units?.length === 0) return 'false';
    const company = `r.legal_entity_id = ${bind(workspace.legalEntityId)}`;
    if (units === null) return company;
    return `${company} and r.operating_unit_id in (${units.map((id) => bind(id)).join(',')})`;
}

// Pendaftaran kunjungan rawat jalan: kepala kunjungan dan satu tujuan per section, dengan NoReg, NoBukti, dan nomor
// antrean yang diterbitkan server di dalam satu transaksi. Kunjungan milik operating unit section tujuannya dan legal
// entity aktif pendaftar; yang melihat dan mendaftarkannya dibatasi unit yang diberikan lewat kebijakan data pasien.
export class Visits {
    private readonly sharing: PatientSharing;

    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {
        this.sharing = new PatientSharing(db, workspace.tenantId);
    }

    private async today(): Promise<string> {
        return visitDate(this.db, this.workspace);
    }

    private visibility(bind: (value: Bind) => string): string {
        return visitVisibility(this.workspace, bind);
    }

    private async present(id: string) {
        const visit = await this.db.one(visitSchema, headerSql, [
            this.workspace.tenantId,
            id,
        ]);
        if (!visit) abort(404, 'Not Found');
        return visit;
    }

    // Kunjungan tenant ini yang terlihat bagi pengguna. Yang lain dijawab 404, supaya keberadaannya tidak bocor.
    private async require(id: string, lock = false) {
        const bindings: Bind[] = [this.workspace.tenantId, lookupId(id)];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const found = bindings[1]
            ? await this.db.one(
                  z.object({
                      id: z.string(),
                      version: z.number(),
                      status: z.string(),
                  }),
                  `select r.id, r.version, r.status from sim_tr_registrasi r
                   where r.tenant_id = $1 and r.id = $2 and r.deleted_at is null and ${this.visibility(bind)}
                   ${lock ? 'for update' : ''}`,
                  bindings,
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async show(id: string) {
        this.workspace.guard('visit', 'read');
        const found = await this.require(id);
        return { data: await this.present(found.id) };
    }

    // Data form pendaftaran: tipe pasien beserta perilaku dan penjaminnya, keadaan pasien, kategori dan tanda
    // skrining, serta section di unit pengguna beserta jadwal praktik hari ini dan kuotanya.
    async metadata() {
        this.workspace.guard('visit', 'read');
        const date = await this.today();
        const tenantId = this.workspace.tenantId;
        await ensurePracticeSchedule(this.db, {
            tenantId,
            legalEntityId: this.workspace.legalEntityId,
        });
        const units = grantedUnits(this.workspace);
        const sections =
            units !== null && !units.length
                ? []
                : await this.db.rows(
                      z.object({
                          id: z.string(),
                          name: z.string(),
                          kind: z.string(),
                          queue_mode: z.string(),
                          operating_unit_id: z.string(),
                          operating_unit_name: z.string(),
                          cluster_ids: z.array(z.string()),
                      }),
                      `select s.id, s.nama as name, s.jenis as kind, s.mode_antrean as queue_mode,
                              s.operating_unit_id, o.name as operating_unit_name, ${sectionClustersSql} as cluster_ids
                       from sim_m_section s
                       join organizations o on o.tenant_id = s.tenant_id and o.id = s.operating_unit_id
                       where s.tenant_id = $1 and s.deleted_at is null and s.aktif
                         ${units === null ? '' : `and s.operating_unit_id in (${placeholders(2, units.length)})`}
                       order by o.name, s.nama`,
                      [tenantId, ...(units ?? [])],
                  );
        return {
            date,
            // Siklus hidup yang boleh dipilih petugas, beserta klasternya.
            life_cycles: (await activeLifeCycles(this.db, tenantId)).map(
                presentLifeCycle,
            ),
            // Saringan Klaster di daftar kunjungan. Klaster nonaktif ikut, karena kunjungan lama tetap mencatatnya.
            clusters: await this.db.rows(
                z.object({
                    id: z.string(),
                    code: z.string(),
                    name: z.string(),
                }),
                `select id, kode as code, nama as name from sim_m_klaster
                 where tenant_id = $1 and deleted_at is null order by urutan, kode`,
                [tenantId],
            ),
            patient_types: await this.db.rows(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    behaviors: z.array(z.string()),
                    max_visits_per_section_per_day: z.number(),
                    is_default: z.boolean(),
                    guarantors: z.array(
                        z.object({
                            id: z.string(),
                            name: z.string(),
                            is_default: z.boolean(),
                        }),
                    ),
                }),
                `select t.id, t.nama as name, t.maks_kunjungan_per_poli_per_hari as max_visits_per_section_per_day,
                        t.bawaan as is_default,
                        coalesce((select json_agg(b.perilaku order by b.perilaku) from sim_m_tipe_pasien_perilaku b
                                  where b.tenant_id = t.tenant_id and b.tipe_pasien_id = t.id and b.deleted_at is null),
                                 '[]'::json) as behaviors,
                        coalesce((select json_agg(json_build_object('id', g.id, 'name', gp.name, 'is_default', g.bawaan)
                                                  order by gp.name)
                                  from sim_m_penjamin g
                                  join parties gp on gp.tenant_id = g.tenant_id and gp.id = g.party_id
                                  where g.tenant_id = t.tenant_id and g.tipe_pasien_id = t.id and g.aktif
                                    and g.deleted_at is null), '[]'::json) as guarantors
                 from sim_m_tipe_pasien t
                 where t.tenant_id = $1 and t.aktif and t.deleted_at is null
                 order by t.nama`,
                [tenantId],
            ),
            patient_conditions: await this.db.rows(
                z.object({ id: z.string(), name: z.string() }),
                `select id, nama as name from sim_m_keadaan_pasien
                 where tenant_id = $1 and aktif and deleted_at is null order by urutan, nama`,
                [tenantId],
            ),
            screening_categories: await this.db.rows(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    severity: z.number(),
                    color: z.string(),
                    signs: z.array(
                        z.object({ id: z.string(), name: z.string() }),
                    ),
                }),
                `select c.id, c.nama as name, c.tingkat as severity, c.warna as color,
                        coalesce((select json_agg(json_build_object('id', d.id, 'name', d.nama) order by d.urutan, d.nama)
                                  from sim_m_skrining_tanda d
                                  where d.tenant_id = c.tenant_id and d.kategori_id = c.id and d.aktif
                                    and d.deleted_at is null), '[]'::json) as signs
                 from sim_m_skrining_kategori c
                 where c.tenant_id = $1 and c.aktif and c.deleted_at is null
                 order by c.tingkat, c.nama`,
                [tenantId],
            ),
            sections: await Promise.all(
                sections.map(async (section) => ({
                    ...section,
                    schedules: await schedulesForRegistration(this.db, {
                        tenantId,
                        sectionId: section.id,
                        date,
                    }),
                })),
            ),
            permissions: {
                create: this.workspace.permissions.has(
                    'healthcare.visit.create',
                ),
                cancel: this.workspace.permissions.has(
                    'healthcare.visit.cancel',
                ),
            },
        };
    }

    // Daftar bertahap dengan penghitung status. Saring rentang tanggal (bawaan hari ini), section, nakes, tipe pasien,
    // pasien, dan status; cari NRM, nama pasien, atau NoReg. Penghitung mengikuti saringan selain status dan pencarian,
    // supaya angka setiap status tetap terlihat saat satu status dipilih.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('visit', 'read');
        const today = await this.today();
        const from = parameters.get('from') || today;
        const to = parameters.get('to') || from;
        if (!dateSchema.safeParse(from).success)
            validation({ from: 'Isi tanggal dengan format YYYY-MM-DD.' });
        if (!dateSchema.safeParse(to).success)
            validation({ to: 'Isi tanggal dengan format YYYY-MM-DD.' });
        const days =
            (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
            86_400_000;
        if (days < 0)
            validation({
                to: 'Tanggal akhir tidak boleh sebelum tanggal awal.',
            });
        if (days >= maxListDays)
            validation({ to: `Rentang paling panjang ${maxListDays} hari.` });
        const bindings: Bind[] = [this.workspace.tenantId];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const filters = [
            'r.tenant_id = $1',
            'r.deleted_at is null',
            this.visibility(bind),
            `r.tanggal between ${bind(from)}::date and ${bind(to)}::date`,
        ];
        const section = lookupId(parameters.get('section_id') ?? '');
        if (section) filters.push(`d.section_id = ${bind(section)}`);
        const practitioner = lookupId(parameters.get('practitioner_id') ?? '');
        if (practitioner) filters.push(`d.nakes_id = ${bind(practitioner)}`);
        const patientType = lookupId(parameters.get('patient_type_id') ?? '');
        if (patientType)
            filters.push(`r.tipe_pasien_id = ${bind(patientType)}`);
        const patient = lookupId(parameters.get('patient_id') ?? '');
        if (patient) filters.push(`r.pasien_id = ${bind(patient)}`);
        const cluster = lookupId(parameters.get('cluster_id') ?? '');
        if (cluster) filters.push(`r.klaster_id = ${bind(cluster)}`);
        const base = `
            from sim_tr_registrasi r
            join lateral (select * from sim_tr_registrasi_tujuan x
                          where x.tenant_id = r.tenant_id and x.registrasi_id = r.id and x.deleted_at is null
                          order by x.urutan limit 1) d on true
            where ${filters.join(' and ')}`;
        const counts = await this.db.one(
            z.object({
                waiting: z.coerce.number(),
                in_examination: z.coerce.number(),
                done: z.coerce.number(),
                cancelled: z.coerce.number(),
                total: z.coerce.number(),
            }),
            `select count(*) filter (where r.status = 'terdaftar') as waiting,
                    count(*) filter (where r.status = 'diperiksa') as in_examination,
                    count(*) filter (where r.status = 'selesai') as done,
                    count(*) filter (where r.status = 'batal') as cancelled,
                    count(*) as total
             ${base}`,
            bindings,
        );
        const status = parameters.get('status') ?? '';
        const statusFilter = isVisitStatus(status)
            ? ` and r.status = ${bind(status)}`
            : '';
        const batch = await incrementalList(this.db, {
            query: `
                select r.id, r.no_reg as registration_number, r.tanggal::text as date,
                       to_char(r.didaftarkan_pada, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as registered_at, r.status,
                       r.jenis_kunjungan as visit_kind, r.pasien_id as patient_id, k.nrm as patient_nrm,
                       p.name as patient_name, p.gender, p.birth_date::text as birth_date, p.birth_place,
                       r.umur_tahun as age_years, nik.number as nik, k.no_dokumen_rm as document_number,
                       k.nrm_lama as old_number, address.formatted as address, r.status_kunjungan as visit_condition,
                       t.nama as patient_type_name, gp.name as guarantor_name, r.no_kartu as card_number,
                       d.section_id, s.nama as section_name, d.nakes_id as practitioner_id,
                       np.name as practitioner_name, d.kode_antrean as queue_code, d.no_bukti as examination_number,
                       sk.nama as screening_category_name, sk.warna as screening_category_color,
                       sh.nama as life_cycle_name, r.klaster_id as cluster_id, kl.kode as cluster_code,
                       kl.nama as cluster_name
                from sim_tr_registrasi r
                join lateral (select * from sim_tr_registrasi_tujuan x
                              where x.tenant_id = r.tenant_id and x.registrasi_id = r.id and x.deleted_at is null
                              order by x.urutan limit 1) d on true
                join sim_m_pasien k on k.tenant_id = r.tenant_id and k.id = r.pasien_id
                join parties p on p.tenant_id = k.tenant_id and p.id = k.party_id
                left join party_identifications nik on nik.tenant_id = k.tenant_id and nik.party_id = k.party_id
                    and nik.type_code = 'nik' and nik.deleted_at is null
                left join lateral (
                    select pa.formatted from party_locations pl
                    join postal_addresses pa on pa.location_id = pl.location_id
                    join party_location_purposes plp on plp.party_location_id = pl.id and plp.deleted_at is null
                    where pl.tenant_id = k.tenant_id and pl.party_id = k.party_id and pl.deleted_at is null
                      and not pl.is_private and plp.purpose_code in ('identity_card', 'domicile')
                    order by plp.purpose_code = 'domicile' desc limit 1) address on true
                join sim_m_tipe_pasien t on t.tenant_id = r.tenant_id and t.id = r.tipe_pasien_id
                join sim_m_section s on s.tenant_id = d.tenant_id and s.id = d.section_id
                left join sim_m_penjamin g on g.tenant_id = r.tenant_id and g.id = r.penjamin_id
                left join parties gp on gp.tenant_id = g.tenant_id and gp.id = g.party_id
                left join sim_m_nakes n on n.tenant_id = d.tenant_id and n.id = d.nakes_id
                left join parties np on np.tenant_id = n.tenant_id and np.id = n.party_id
                left join sim_m_skrining_kategori sk on sk.tenant_id = r.tenant_id and sk.id = r.kategori_skrining_id
                left join sim_m_siklus_hidup sh on sh.tenant_id = r.tenant_id and sh.id = r.siklus_hidup_id
                left join sim_m_klaster kl on kl.tenant_id = r.tenant_id and kl.id = r.klaster_id
                where ${filters.join(' and ')}${statusFilter}`,
            bindings,
            parameters,
            columns: {
                registered_at: 'registered_at',
                registration_number: 'registration_number',
                patient_name: 'patient_name',
                queue_code: 'queue_code',
            },
            searchColumns: [
                'patient_nrm',
                'patient_name',
                'registration_number',
            ],
            numericColumns: [],
            defaultSort: 'registered_at',
            defaultDirection: 'desc',
        });
        // NIK disamarkan seperti di daftar pasien bagi yang tidak memegang izin Core Lihat nomor identitas utuh.
        const full = (
            await this.workspace.holds(this.db, [
                'core.party-identification.read',
            ])
        ).has('core.party-identification.read');
        return {
            data: batch.data.map((row) => {
                const parsed = visitListRowSchema.parse(row);
                return parsed.nik !== null && !full
                    ? { ...parsed, nik: maskNumber(parsed.nik) }
                    : parsed;
            }),
            next_cursor: batch.next_cursor,
            counts: counts ?? {
                waiting: 0,
                in_examination: 0,
                done: 0,
                cancelled: 0,
                total: 0,
            },
        };
    }

    private parse(body: unknown): VisitInput {
        const parsed = visitInputSchema.safeParse(body);
        if (parsed.success) return parsed.data;
        return validation(
            Object.fromEntries(
                parsed.error.issues.map((issue) => [
                    issue.path.join('.') || 'input',
                    'Isian ini tidak sah.',
                ]),
            ),
        );
    }

    // Pasien yang terlihat bagi pengguna dan masih aktif. Saat mendaftar barisnya dikunci sampai transaksi selesai.
    // Kunci ini membuat batas kunjungan per poli dan jenis kunjungan baru/lama tetap benar saat pasien yang sama
    // didaftarkan serentak.
    private async patient(patientId: string, date: string, lock: boolean) {
        const bindings: Bind[] = [
            this.workspace.tenantId,
            lookupId(patientId),
            date,
        ];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const found = bindings[1]
            ? await this.db.one(
                  z.object({
                      id: z.string(),
                      is_active: z.boolean(),
                      age_years: z.number().nullable(),
                      age_months: z.number().nullable(),
                      age_days: z.number().nullable(),
                      gender: z.string().nullable(),
                      birth_date: z.string().nullable(),
                  }),
                  `select k.id, k.aktif as is_active, p.gender, p.birth_date::text as birth_date,
                          extract(year from age($3::date, p.birth_date))::int as age_years,
                          extract(month from age($3::date, p.birth_date))::int as age_months,
                          extract(day from age($3::date, p.birth_date))::int as age_days
                   from sim_m_pasien k
                   join parties p on p.tenant_id = k.tenant_id and p.id = k.party_id
                   where k.tenant_id = $1 and k.id = $2 and k.deleted_at is null
                     and ${await this.sharing.visible(this.workspace, bind)}
                   ${lock ? 'for update of k' : ''}`,
                  bindings,
              )
            : undefined;
        if (!found) validation({ patient_id: 'Pilih pasien dari daftar.' });
        if (!found.is_active)
            validation({ patient_id: 'Pasien ini tidak aktif.' });
        return found;
    }

    // Siklus hidup kunjungan selalu hasil aturan Siklus hidup, tidak pernah dipilih petugas (aplikasi lama menghitung
    // klaster di server saat simpan). Status hamil hanya berlaku bila ditanyakan untuk pasien itu.
    private async lifeCycle(
        patient: { gender: string | null; birth_date: string | null },
        date: string,
        pregnant: boolean,
    ): Promise<{ rule: LifeCycleRow; pregnant: boolean }> {
        const rules = await activeLifeCycles(this.db, this.workspace.tenantId);
        const subject = {
            gender: patient.gender,
            birthDate: patient.birth_date,
            visitDate: date,
        };
        if (pregnant && !asksPregnancy(rules, subject))
            validation({
                pregnant: 'Status hamil tidak berlaku untuk pasien ini.',
            });
        const rule = classifyVisit(rules, { ...subject, pregnant });
        if (!rule) validation({ life_cycle_id: undeterminedLifeCycleMessage });
        return { rule, pregnant };
    }

    // Pratinjau pendaftaran: siklus hidup dan klaster hasil aturan untuk pasien, dan apakah status hamil ditanyakan.
    // Hasil yang tidak dapat ditentukan dijawab sebagai pesan, bukan penolakan, karena petugas masih bisa memilih.
    async classification(parameters: URLSearchParams) {
        this.workspace.guard('visit', 'read');
        const date = await this.today();
        const patient = await this.patient(
            parameters.get('patient_id') ?? '',
            date,
            false,
        );
        const rules = await activeLifeCycles(this.db, this.workspace.tenantId);
        const subject = {
            gender: patient.gender,
            birthDate: patient.birth_date,
            visitDate: date,
        };
        const asks = asksPregnancy(rules, subject);
        const rule = classifyVisit(rules, {
            ...subject,
            pregnant: asks && parameters.get('pregnant') === 'true',
        });
        return {
            asks_pregnancy: asks,
            life_cycle: rule ? presentLifeCycle(rule) : null,
            message: rule ? null : undeterminedLifeCycleMessage,
        };
    }

    // Tipe pasien, penjamin, dan nomor kartu. Wajib tidaknya penjamin dan nomor kartu datang dari perilaku tipe
    // pasien; penjamin harus terdaftar untuk tipe itu.
    private async payer(input: VisitInput, errors: Errors) {
        const type = lookupId(input.patient_type_id)
            ? await this.db.one(
                  z.object({
                      id: z.string(),
                      behaviors: z.array(z.string()),
                      max_visits: z.number(),
                  }),
                  `select t.id, t.maks_kunjungan_per_poli_per_hari as max_visits,
                          coalesce((select json_agg(b.perilaku) from sim_m_tipe_pasien_perilaku b
                                    where b.tenant_id = t.tenant_id and b.tipe_pasien_id = t.id
                                      and b.deleted_at is null), '[]'::json) as behaviors
                   from sim_m_tipe_pasien t
                   where t.tenant_id = $1 and t.id = $2 and t.aktif and t.deleted_at is null`,
                  [this.workspace.tenantId, input.patient_type_id],
              )
            : undefined;
        if (!type) {
            add(errors, 'patient_type_id', 'Pilih tipe pasien dari daftar.');
            return null;
        }
        const requires = (behavior: PatientTypeBehavior) =>
            type.behaviors.includes(behavior);
        const guarantorId = optional(input.guarantor_id);
        const cardNumber = optional(input.card_number);
        if (guarantorId) {
            const guarantor = lookupId(guarantorId)
                ? await this.db.one(
                      z.object({ id: z.string() }),
                      `select id from sim_m_penjamin
                       where tenant_id = $1 and id = $2 and tipe_pasien_id = $3 and aktif and deleted_at is null`,
                      [this.workspace.tenantId, guarantorId, type.id],
                  )
                : undefined;
            if (!guarantor)
                add(
                    errors,
                    'guarantor_id',
                    'Pilih penjamin yang terdaftar untuk tipe pasien ini.',
                );
        } else if (requires('requires_guarantor'))
            add(errors, 'guarantor_id', 'Pilih penjamin.');
        if (cardNumber && cardNumber.length > 50)
            add(errors, 'card_number', 'Paling panjang 50 karakter.');
        if (!cardNumber && requires('requires_card_number'))
            add(errors, 'card_number', 'Isi nomor kartu.');
        return {
            patientTypeId: type.id,
            maxVisits: type.max_visits,
            guarantorId,
            cardNumber,
        };
    }

    // Baris acuan aktif milik tenant. Yang tidak dikenal ditolak, supaya klien tidak menulis id sembarang.
    private async references(
        table: 'sim_m_keadaan_pasien' | 'sim_m_skrining_tanda',
        values: string[],
        field: string,
        errors: Errors,
    ): Promise<void> {
        if (!values.length) return;
        if (values.some((value) => !lookupId(value))) {
            add(errors, field, 'Pilih dari daftar.');
            return;
        }
        const found = await this.db.rows(
            z.object({ id: z.string() }),
            `select id from ${table}
             where tenant_id = $1 and aktif and deleted_at is null and id in (${placeholders(2, values.length)})`,
            [this.workspace.tenantId, ...values],
        );
        if (found.length !== values.length)
            add(errors, field, 'Pilih dari daftar.');
    }

    private async section(sectionId: string) {
        const section = lookupId(sectionId)
            ? await this.db.one(
                  z.object({
                      id: z.string(),
                      operating_unit_id: z.string(),
                      queue_mode: z.string(),
                      queue_prefix: z.string().nullable(),
                      document_code: z.string().nullable(),
                      cluster_ids: z.array(z.string()),
                  }),
                  `select s.id, s.operating_unit_id, s.mode_antrean as queue_mode, s.awalan_antrean as queue_prefix,
                          s.kode_no_bukti as document_code, ${sectionClustersSql} as cluster_ids
                   from sim_m_section s where s.tenant_id = $1 and s.id = $2 and s.aktif and s.deleted_at is null`,
                  [this.workspace.tenantId, sectionId],
              )
            : undefined;
        if (!section) validation({ section_id: 'Pilih section dari daftar.' });
        if (!grantsUnit(this.workspace, section.operating_unit_id))
            abort(
                403,
                'Section ini berada di luar unit kerja yang dapat Anda akses.',
            );
        if (!isQueueMode(section.queue_mode))
            throw new Error(`Unknown queue mode: ${section.queue_mode}`);
        return { ...section, queue_mode: section.queue_mode };
    }

    // Jadwal praktik yang dipilih, dikunci sampai transaksi selesai sehingga kuota tidak pernah terlampaui. Section
    // yang tidak punya jadwal apa pun pada tanggal itu boleh didaftarkan tanpa nakes, misalnya section penunjang.
    private async schedule(
        sectionId: string,
        scheduleId: string | null,
        date: string,
    ): Promise<{ id: string; practitionerId: string } | null> {
        const message =
            'Pilih nakes dari jadwal praktik hari ini di section ini.';
        if (!scheduleId) {
            const scheduled = await this.db.one(
                z.object({ id: z.string() }),
                `select id from sim_tr_jadwal_praktik
                 where tenant_id = $1 and section_id = $2 and tanggal = $3::date and deleted_at is null limit 1`,
                [this.workspace.tenantId, sectionId, date],
            );
            if (scheduled) validation({ practice_schedule_id: message });
            return null;
        }
        const found = lookupId(scheduleId)
            ? await this.db.one(
                  z.object({
                      id: z.string(),
                      section_id: z.string(),
                      date: z.string(),
                      status: z.string(),
                      capacity: z.number().nullable(),
                      registered: z.number(),
                      practitioner_id: z.string(),
                      practitioner_active: z.boolean(),
                  }),
                  `select j.id, j.section_id, j.tanggal::text as date, j.status, j.kapasitas as capacity,
                          j.jumlah_terdaftar as registered, n.id as practitioner_id,
                          (n.aktif and n.deleted_at is null) as practitioner_active
                   from sim_tr_jadwal_praktik j
                   join sim_m_nakes n on n.tenant_id = j.tenant_id and n.id = coalesce(j.nakes_pengganti_id, j.nakes_id)
                   where j.tenant_id = $1 and j.id = $2 and j.deleted_at is null
                   for update of j`,
                  [this.workspace.tenantId, scheduleId],
              )
            : undefined;
        if (!found) validation({ practice_schedule_id: message });
        if (
            found.section_id !== sectionId ||
            found.date !== date ||
            found.status !== 'terjadwal' ||
            !found.practitioner_active
        )
            validation({ practice_schedule_id: message });
        if (found.capacity !== null && found.registered >= found.capacity)
            validation({ practice_schedule_id: scheduleFullMessage });
        await this.db.execute(
            `update sim_tr_jadwal_praktik set jumlah_terdaftar = jumlah_terdaftar + 1, updated_at = $3
             where tenant_id = $1 and id = $2`,
            [this.workspace.tenantId, found.id, nowSql()],
        );
        return { id: found.id, practitionerId: found.practitioner_id };
    }

    // Nomor antrean berikutnya dari penghitung, satu per section per hari atau satu per jadwal praktik. Upsert
    // mengunci baris penghitung sampai transaksi selesai, jadi nomornya tidak pernah kembar.
    private async queueNumber(
        sectionId: string,
        date: string,
        mode: QueueMode,
        scheduleId: string | null,
    ): Promise<number> {
        let key: string | null;
        switch (mode) {
            case 'bersama':
                key = null;
                break;
            case 'per_jadwal':
                key = scheduleId;
                break;
            default: {
                const unknown: never = mode;
                throw new Error(`Unknown queue mode: ${String(unknown)}`);
            }
        }
        const stamp = nowSql();
        const counter = await this.db.one(
            z.object({ number: z.number() }),
            `insert into sim_tr_antrean_penghitung
                 (id, tenant_id, section_id, tanggal, jadwal_praktik_id, nomor_terakhir, created_at, updated_at)
             values ($1, $2, $3, $4::date, $5, 1, $6, $6)
             on conflict (tenant_id, section_id, tanggal, jadwal_praktik_id)
             do update set nomor_terakhir = sim_tr_antrean_penghitung.nomor_terakhir + 1, updated_at = excluded.updated_at
             returning nomor_terakhir as number`,
            [
                Bun.randomUUIDv7(),
                this.workspace.tenantId,
                sectionId,
                date,
                key,
                stamp,
            ],
        );
        if (!counter) throw new Error('Queue counter returned no row.');
        return counter.number;
    }

    async create(request: Request, body: unknown) {
        this.workspace.guard('visit', 'create');
        const input = this.parse(body);
        const legalEntityId = this.workspace.legalEntityId;
        const date = await this.today();
        if (!legalEntityId)
            validation({
                legal_entity_id:
                    'Pilih legal entity di tempat kerja sebelum melanjutkan.',
            });
        const header = request.headers.get('idempotency-key');
        const key =
            header && /^[A-Za-z0-9._:-]{8,120}$/.test(header)
                ? header
                : Bun.randomUUIDv7();
        const replay = await this.db.one(
            z.object({ id: z.string() }),
            'select id from sim_tr_registrasi where tenant_id = $1 and creation_key = $2',
            [this.workspace.tenantId, key],
        );
        if (replay)
            return {
                status: 200,
                headers: {},
                body: { data: await this.present(replay.id) },
            };
        const errors: Errors = {};
        if (!isVisitCondition(input.visit_condition))
            add(errors, 'visit_condition', 'Pilih sakit atau sehat.');
        const height = measure(errors, 'height_cm', input.height_cm);
        const weight = measure(errors, 'weight_kg', input.weight_kg);
        const conditions = ids(input.patient_condition_ids);
        const signs = ids(input.screening_sign_ids);
        await this.references(
            'sim_m_keadaan_pasien',
            conditions,
            'patient_condition_ids',
            errors,
        );
        await this.references(
            'sim_m_skrining_tanda',
            signs,
            'screening_sign_ids',
            errors,
        );
        const payer = await this.payer(input, errors);
        if (Object.keys(errors).length || !payer) validation(errors);
        const section = await this.section(input.section_id);
        const id = Bun.randomUUIDv7();
        await this.db.transaction(async () => {
            const patient = await this.patient(input.patient_id, date, true);
            const lifeCycle = await this.lifeCycle(
                patient,
                date,
                input.pregnant === true,
            );
            if (
                section.cluster_ids.length &&
                !section.cluster_ids.includes(lifeCycle.rule.cluster_id)
            )
                validation({
                    section_id: `Poli ini tidak melayani klaster ${lifeCycle.rule.cluster_name}.`,
                });
            if (payer.maxVisits > 0) {
                const today = await this.db.one(
                    z.object({ count: z.coerce.number() }),
                    `select count(*) as count from sim_tr_registrasi r
                     where r.tenant_id = $1 and r.pasien_id = $2 and r.tanggal = $3::date and r.status <> 'batal'
                       and r.deleted_at is null
                       and exists (select 1 from sim_tr_registrasi_tujuan d
                                   where d.tenant_id = r.tenant_id and d.registrasi_id = r.id and d.section_id = $4
                                     and d.deleted_at is null)`,
                    [this.workspace.tenantId, patient.id, date, section.id],
                );
                if ((today?.count ?? 0) >= payer.maxVisits)
                    validation({ section_id: visitLimitMessage });
            }
            const schedule = await this.schedule(
                section.id,
                optional(input.practice_schedule_id),
                date,
            );
            const queue = await this.queueNumber(
                section.id,
                date,
                section.queue_mode,
                schedule?.id ?? null,
            );
            const issuer = new NumberIssuer(this.db, {
                tenantId: this.workspace.tenantId,
                moduleId,
            });
            const registrationNumber = await issuer.issue({
                reference: visitNumberReference,
                key: `visit:${key}`,
                documentDate: date,
                operatingUnitId: section.operating_unit_id,
            });
            // Kode nomor bukti section tersedia sebagai segmen konteks `section` bagi admin yang memakainya di format.
            const examinationNumber = await issuer.issue({
                reference: examinationNumberReference,
                key: `examination:${key}:1`,
                documentDate: date,
                operatingUnitId: section.operating_unit_id,
                ...(section.document_code
                    ? { values: { section: section.document_code } }
                    : {}),
            });
            const returning = await this.db.one(
                z.object({ returning: z.boolean() }),
                `select exists (select 1 from sim_tr_registrasi
                                where tenant_id = $1 and pasien_id = $2 and status <> 'batal' and deleted_at is null
                                  and date_trunc('month', tanggal) = date_trunc('month', $3::date)) as returning`,
                [this.workspace.tenantId, patient.id, date],
            );
            const category = signs.length
                ? await this.db.one(
                      z.object({ id: z.string() }),
                      `select c.id from sim_m_skrining_tanda d
                       join sim_m_skrining_kategori c on c.tenant_id = d.tenant_id and c.id = d.kategori_id
                       where d.tenant_id = $1 and d.id in (${placeholders(2, signs.length)})
                       order by c.tingkat limit 1`,
                      [this.workspace.tenantId, ...signs],
                  )
                : undefined;
            const stamp = nowSql();
            await this.db.insert('sim_tr_registrasi', {
                id,
                tenant_id: this.workspace.tenantId,
                no_reg: registrationNumber,
                creation_key: key,
                legal_entity_id: legalEntityId,
                operating_unit_id: section.operating_unit_id,
                pasien_id: patient.id,
                tanggal: date,
                didaftarkan_pada: stamp,
                tipe_pasien_id: payer.patientTypeId,
                penjamin_id: payer.guarantorId,
                no_kartu: payer.cardNumber,
                tinggi_badan: height,
                berat_badan: weight,
                status_kunjungan: input.visit_condition,
                umur_tahun: patient.age_years,
                umur_bulan: patient.age_months,
                umur_hari: patient.age_days,
                jenis_kunjungan: returning?.returning ? 'lama' : 'baru',
                kategori_skrining_id: category?.id ?? null,
                status_hamil: lifeCycle.pregnant,
                siklus_hidup_id: lifeCycle.rule.id,
                klaster_id: lifeCycle.rule.cluster_id,
                status: 'terdaftar',
                created_at: stamp,
                updated_at: stamp,
            });
            await this.db.insert('sim_tr_registrasi_tujuan', {
                id: Bun.randomUUIDv7(),
                tenant_id: this.workspace.tenantId,
                registrasi_id: id,
                urutan: 1,
                section_id: section.id,
                jadwal_praktik_id: schedule?.id ?? null,
                nakes_id: schedule?.practitionerId ?? null,
                no_antrean: queue,
                kode_antrean:
                    (section.queue_prefix ? `${section.queue_prefix}-` : '') +
                    String(queue).padStart(3, '0'),
                no_bukti: examinationNumber,
                status: 'menunggu',
                created_at: stamp,
                updated_at: stamp,
            });
            for (const condition of conditions)
                await this.db.insert('sim_tr_registrasi_keadaan', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.workspace.tenantId,
                    registrasi_id: id,
                    keadaan_id: condition,
                    created_at: stamp,
                    updated_at: stamp,
                });
            for (const sign of signs)
                await this.db.insert('sim_tr_registrasi_skrining', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: this.workspace.tenantId,
                    registrasi_id: id,
                    tanda_id: sign,
                    created_at: stamp,
                    updated_at: stamp,
                });
            await this.copyPayerToPatient(patient.id, payer, stamp);
        });
        return {
            status: 201,
            headers: {},
            body: { data: await this.present(id) },
        };
    }

    // Cara bayar kunjungan menjadi cara bayar utama pasien, seperti sistem lama yang menimpa tipe pasien, penjamin,
    // dan nomor kartu di mPasien setiap pendaftaran (registrations/helpers/registration_helper.php).
    private async copyPayerToPatient(
        patientId: string,
        payer: {
            patientTypeId: string;
            guarantorId: string | null;
            cardNumber: string | null;
        },
        stamp: string,
    ): Promise<void> {
        const updated = await this.db.execute(
            `update sim_m_pasien_cara_bayar
             set tipe_pasien_id = $3, penjamin_id = $4, nomor_kartu = $5, updated_at = $6
             where tenant_id = $1 and pasien_id = $2 and utama and deleted_at is null
               and (tipe_pasien_id, penjamin_id, nomor_kartu) is distinct from ($3::uuid, $4::uuid, $5::varchar)`,
            [
                this.workspace.tenantId,
                patientId,
                payer.patientTypeId,
                payer.guarantorId,
                payer.cardNumber,
                stamp,
            ],
        );
        if (updated) return;
        const primary = await this.db.one(
            z.object({ id: z.string() }),
            `select id from sim_m_pasien_cara_bayar
             where tenant_id = $1 and pasien_id = $2 and utama and deleted_at is null`,
            [this.workspace.tenantId, patientId],
        );
        if (primary) return;
        await this.db.insert('sim_m_pasien_cara_bayar', {
            id: Bun.randomUUIDv7(),
            tenant_id: this.workspace.tenantId,
            pasien_id: patientId,
            tipe_pasien_id: payer.patientTypeId,
            penjamin_id: payer.guarantorId,
            nomor_kartu: payer.cardNumber,
            utama: true,
            urutan: 0,
            created_at: stamp,
            updated_at: stamp,
        });
    }

    // Batal hanya dari status terdaftar, dengan alasan. Kuota jadwal yang dipakai kunjungan dikembalikan. Aturan batal
    // setelah dibayar menyusul bersama kasir.
    async cancel(request: Request, id: string, body: unknown) {
        this.workspace.guard('visit', 'cancel');
        const parsed = visitCancelInputSchema.safeParse(body);
        const reason = parsed.success ? parsed.data.reason.trim() : '';
        if (!reason) validation({ reason: 'Isi alasan batal.' });
        if (reason.length > 200)
            validation({ reason: 'Paling panjang 200 karakter.' });
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const current = await this.require(id, true);
            if (current.version !== version)
                coded(409, 'stale_version', staleMessage);
            if (!isVisitStatus(current.status))
                throw new Error(`Unknown visit status: ${current.status}`);
            const refused = refusedTransition(current.status, 'batal');
            if (refused) validation({ status: refused });
            const stamp = nowSql();
            await this.db.execute(
                `update sim_tr_registrasi
                 set status = 'batal', batal_oleh = $3, batal_pada = $4, alasan_batal = $5, updated_at = $4
                 where tenant_id = $1 and id = $2`,
                [
                    this.workspace.tenantId,
                    current.id,
                    this.workspace.userId,
                    stamp,
                    reason,
                ],
            );
            const destinations = await this.db.rows(
                z.object({ schedule_id: z.string().nullable() }),
                `update sim_tr_registrasi_tujuan set status = 'batal', updated_at = $3
                 where tenant_id = $1 and registrasi_id = $2 and deleted_at is null and status <> 'batal'
                 returning jadwal_praktik_id as schedule_id`,
                [this.workspace.tenantId, current.id, stamp],
            );
            for (const destination of destinations)
                if (destination.schedule_id)
                    await this.db.execute(
                        `update sim_tr_jadwal_praktik set jumlah_terdaftar = jumlah_terdaftar - 1, updated_at = $3
                         where tenant_id = $1 and id = $2 and jumlah_terdaftar > 0`,
                        [
                            this.workspace.tenantId,
                            destination.schedule_id,
                            stamp,
                        ],
                    );
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.present(id) },
        };
    }
}
