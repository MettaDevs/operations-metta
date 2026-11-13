import { z } from 'zod';
import { lockChargeForChange } from '@core/foundation/billing/index.ts';
import { NumberIssuer } from '@core/foundation/number-sequence/index.ts';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    nowSql,
    type Bind,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    dateSchema,
    HttpFailure,
    isRecord,
    lookupId,
    validation,
} from '@core/platform/http/index.ts';
import { moduleId } from '../../module.ts';
import { publishVisitReopened } from '../../registration/visit/visit.events.ts';
import {
    examinationNumberReference,
    nextQueueNumber,
    queueCode,
    takeSchedule,
    visitVisibility,
} from '../../registration/visit/visit.service.ts';
import { visitStatuses } from '../../registration/visit/visit.statuses.ts';
import {
    ensurePracticeSchedule,
    schedulesForRegistration,
} from '../../service/practice-schedule/practice-schedule.service.ts';
import { isQueueMode } from '../../service/section/section.queue-modes.ts';
import type { OptionGroup } from '../medical-record/medical-record.fields.ts';
import { practitionerId } from '../medical-record/medical-record.orders.ts';
import {
    destinationStatuses,
    recordLockedMessage,
} from '../queue/queue.statuses.ts';
import {
    duplicateReferralMessage,
    isDischargeBehavior,
    paidReferralMessage,
    type DischargeBehavior,
} from './discharge.behaviors.ts';
import {
    dischargeSchema,
    internalReferralInputSchema,
    internalReferralSchema,
    type Discharge,
} from './discharge.schema.ts';

type Errors = Record<string, string[]>;

function add(errors: Errors, field: string, message: string): void {
    (errors[field] ??= []).push(message);
}

// Kolom status pasien di sim_tr_registrasi_tujuan, semuanya kosong. Simpan mulai dari sini lalu mengisi kolom milik
// perilaku status yang dipilih, sehingga isian perilaku lain terhapus seperti statuspasien_helper::submit.
const cleared = {
    status_pulang_id: null,
    kontrol_ulang: null,
    tanggal_kontrol: null,
    dokter_konsul_id: null,
    rujuk_eksternal_tujuan: null,
    rujuk_eksternal_poli: null,
    rujuk_eksternal_alasan: null,
    waktu_meninggal: null,
    tanggal_meninggal: null,
    jam_meninggal: null,
} satisfies Record<string, Bind>;
// Keadaan pulang tidak termasuk cleared: rujuk internal mengganti status tanpa mengosongkannya.
export type DischargeValues = Record<keyof typeof cleared, Bind> & {
    keadaan_pulang_id?: Bind;
};

const statusRowSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    behavior: z.string().nullable(),
    active: z.boolean(),
});

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

function text(
    raw: unknown,
    field: string,
    max: number,
    errors: Errors,
): string | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') {
        add(errors, field, 'Isian ini tidak sah.');
        return null;
    }
    const value = raw.trim();
    if (value === '') return null;
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- dihitung per code point
    if ([...value].length > max) {
        add(errors, field, `Paling banyak ${max} karakter.`);
        return null;
    }
    return value;
}

function formatted(
    raw: unknown,
    field: string,
    schema: z.ZodType<string>,
    errors: Errors,
): string | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        add(errors, field, 'Isian ini tidak sah.');
        return null;
    }
    return parsed.data;
}

// Status pasien satu tujuan kunjungan dan rujuk internal darinya. Status ikut Simpan rekam medis; rujuk internal
// membuat tujuan baru di kunjungan yang sama saat itu juga, dengan nomor antrean dan NoBukti sendiri, seperti form
// Tambah Rujuk Internal sistem lama.
export class Discharges {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get tenantId() {
        return this.workspace.tenantId;
    }

    // Pilihan status milik tenant. Baris nonaktif ikut dikirim supaya nilai tersimpan tetap berlabel; layar hanya
    // menawarkan yang aktif.
    async statuses() {
        const rows = await this.db.rows(
            statusRowSchema,
            `select id, kode as code, nama as name, perilaku as behavior, aktif as active from sim_m_status_pulang
             where tenant_id = $1 and deleted_at is null order by urutan, kode`,
            [this.tenantId],
        );
        return rows.map((row) => ({
            ...row,
            behavior:
                row.behavior && isDischargeBehavior(row.behavior)
                    ? row.behavior
                    : null,
        }));
    }

    // Pilihan keadaan pulang milik tenant, dengan baris nonaktif seperti statuses.
    async conditions() {
        return this.db.rows(
            z.object({
                id: z.string(),
                code: z.string(),
                name: z.string(),
                active: z.boolean(),
            }),
            `select id, kode as code, nama as name, aktif as active from sim_m_keadaan_pulang
             where tenant_id = $1 and deleted_at is null order by urutan, kode`,
            [this.tenantId],
        );
    }

    async present(destinationId: string): Promise<Discharge> {
        const saved = await this.db.one(
            z.object({
                status_id: z.string().nullable(),
                condition_id: z.string().nullable(),
                follow_up: z.boolean().nullable(),
                follow_up_date: z.string().nullable(),
                consultant_id: z.string().nullable(),
                referral_destination: z.string().nullable(),
                referral_specialty: z.string().nullable(),
                referral_reason: z.string().nullable(),
                death_time_category: z.string().nullable(),
                death_date: z.string().nullable(),
                death_time: z.string().nullable(),
            }),
            `select status_pulang_id as status_id, keadaan_pulang_id as condition_id, kontrol_ulang as follow_up,
                    tanggal_kontrol::text as follow_up_date, dokter_konsul_id as consultant_id,
                    rujuk_eksternal_tujuan as referral_destination, rujuk_eksternal_poli as referral_specialty,
                    rujuk_eksternal_alasan as referral_reason, waktu_meninggal as death_time_category,
                    tanggal_meninggal::text as death_date, to_char(jam_meninggal, 'HH24:MI') as death_time
             from sim_tr_registrasi_tujuan where tenant_id = $1 and id = $2`,
            [this.tenantId, destinationId],
        );
        if (!saved) abort(404, 'Not Found');
        return dischargeSchema.parse({
            ...saved,
            internal_referrals: await this.referrals(destinationId),
        });
    }

    private async referrals(destinationId: string) {
        return this.db.rows(
            internalReferralSchema,
            `select d.id, s.nama as section_name, d.kode_antrean as queue_code, np.name as practitioner_name,
                    sp.nama as session_name, d.status, d.catatan_rujukan as note
             from sim_tr_registrasi_tujuan d
             join sim_m_section s on s.tenant_id = d.tenant_id and s.id = d.section_id
             left join sim_m_nakes n on n.tenant_id = d.tenant_id and n.id = d.nakes_id
             left join parties np on np.tenant_id = n.tenant_id and np.id = n.party_id
             left join sim_tr_jadwal_praktik j on j.tenant_id = d.tenant_id and j.id = d.jadwal_praktik_id
             left join sim_m_sesi_praktik sp on sp.tenant_id = j.tenant_id and sp.id = j.sesi_id
             where d.tenant_id = $1 and d.asal_tujuan_id = $2 and d.deleted_at is null
             order by d.urutan`,
            [this.tenantId, destinationId],
        );
    }

    // Status aktif tenant ini, atau status yang sudah tersimpan walau sejak itu nonaktif.
    private async status(
        raw: unknown,
        saved: string | null,
        field: string,
        errors: Errors,
    ): Promise<{ id: string; behavior: DischargeBehavior | null } | null> {
        if (raw === null || raw === undefined || raw === '') return null;
        const id = typeof raw === 'string' ? lookupId(raw) : null;
        const found = id
            ? await this.db.one(
                  z.object({ id: z.string(), behavior: z.string().nullable() }),
                  `select id, perilaku as behavior from sim_m_status_pulang
                   where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3)`,
                  [this.tenantId, id, saved],
              )
            : undefined;
        if (!found) {
            add(errors, field, 'Pilih status pasien dari daftar.');
            return null;
        }
        return {
            id: found.id,
            behavior:
                found.behavior && isDischargeBehavior(found.behavior)
                    ? found.behavior
                    : null,
        };
    }

    // Keadaan pulang aktif tenant ini, atau yang sudah tersimpan walau sejak itu nonaktif.
    private async condition(
        raw: unknown,
        saved: string | null,
        errors: Errors,
    ): Promise<string | null> {
        if (raw === null || raw === undefined || raw === '') return null;
        const id = typeof raw === 'string' ? lookupId(raw) : null;
        const found = id
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  `select id from sim_m_keadaan_pulang
                   where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3)`,
                  [this.tenantId, id, saved],
              )
            : undefined;
        if (!found)
            add(
                errors,
                'discharge.condition_id',
                'Pilih keadaan pulang dari daftar.',
            );
        return found?.id ?? null;
    }

    // Kiriman panel Status Pasien. Hanya isian milik perilaku status yang dipilih yang dibaca; sisanya dikosongkan.
    // Keadaan pulang dibaca apa pun statusnya.
    async read(
        raw: unknown,
        saved: {
            status_id: string | null;
            condition_id: string | null;
            consultant_id: string | null;
        },
        options: ReadonlyMap<OptionGroup, ReadonlySet<string>>,
        errors: Errors,
    ): Promise<DischargeValues> {
        const values: DischargeValues = { ...cleared };
        if (raw === null || raw === undefined) return values;
        if (!isRecord(raw)) {
            add(errors, 'discharge', 'Isian ini tidak sah.');
            return values;
        }
        values.keadaan_pulang_id = await this.condition(
            raw.condition_id,
            saved.condition_id,
            errors,
        );
        const status = await this.status(
            raw.status_id,
            saved.status_id,
            'discharge.status_id',
            errors,
        );
        if (!status) return values;
        values.status_pulang_id = status.id;
        switch (status.behavior) {
            case null:
            case 'rujuk_internal':
                break;
            case 'rawat_jalan': {
                if (
                    raw.follow_up !== null &&
                    raw.follow_up !== undefined &&
                    typeof raw.follow_up !== 'boolean'
                )
                    add(errors, 'discharge.follow_up', 'Isian ini tidak sah.');
                const followUp = raw.follow_up === true;
                values.kontrol_ulang = followUp;
                if (followUp) {
                    values.tanggal_kontrol = formatted(
                        raw.follow_up_date,
                        'discharge.follow_up_date',
                        dateSchema,
                        errors,
                    );
                    if (
                        values.tanggal_kontrol === null &&
                        !errors['discharge.follow_up_date']
                    )
                        add(
                            errors,
                            'discharge.follow_up_date',
                            'Isi tanggal check up kembali.',
                        );
                }
                break;
            }
            case 'rawat_inap':
                values.dokter_konsul_id = await practitionerId(
                    this.db,
                    this.tenantId,
                    raw.consultant_id,
                    'isi_tenaga_medis',
                    saved.consultant_id,
                    'discharge.consultant_id',
                    errors,
                );
                break;
            case 'rujuk_eksternal':
                values.rujuk_eksternal_tujuan = text(
                    raw.referral_destination,
                    'discharge.referral_destination',
                    200,
                    errors,
                );
                values.rujuk_eksternal_poli = text(
                    raw.referral_specialty,
                    'discharge.referral_specialty',
                    150,
                    errors,
                );
                values.rujuk_eksternal_alasan = text(
                    raw.referral_reason,
                    'discharge.referral_reason',
                    1000,
                    errors,
                );
                break;
            case 'meninggal': {
                const category = text(
                    raw.death_time_category,
                    'discharge.death_time_category',
                    40,
                    errors,
                );
                if (category && !options.get('waktu_meninggal')?.has(category))
                    add(
                        errors,
                        'discharge.death_time_category',
                        'Pilih dari daftar.',
                    );
                else values.waktu_meninggal = category;
                values.tanggal_meninggal = formatted(
                    raw.death_date,
                    'discharge.death_date',
                    dateSchema,
                    errors,
                );
                values.jam_meninggal = formatted(
                    raw.death_time,
                    'discharge.death_time',
                    timeSchema,
                    errors,
                );
                break;
            }
            default: {
                const unknown: never = status.behavior;
                throw new Error(
                    `Unknown discharge behavior: ${String(unknown)}`,
                );
            }
        }
        return values;
    }

    async write(
        destinationId: string,
        values: DischargeValues,
        stamp: string,
    ): Promise<void> {
        const columns = Object.keys(values);
        await this.db.execute(
            `update sim_tr_registrasi_tujuan
             set ${columns.map((column, index) => `${column} = $${index + 3}`).join(', ')}, updated_at = $${columns.length + 3}
             where tenant_id = $1 and id = $2`,
            [this.tenantId, destinationId, ...Object.values(values), stamp],
        );
    }

    // Tujuan yang terlihat bagi pengguna beserta kunjungannya. Yang lain dijawab 404.
    private async destination(id: string, lock: boolean) {
        const bindings: Bind[] = [this.tenantId, lookupId(id)];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const found = bindings[1]
            ? await this.db.one(
                  z.object({
                      id: z.string(),
                      status: z.enum(destinationStatuses),
                      visit_id: z.string(),
                      visit_status: z.enum(visitStatuses),
                      date: z.string(),
                      operating_unit_id: z.string(),
                  }),
                  `select d.id, d.status, r.id as visit_id, r.status as visit_status, r.tanggal::text as date,
                          r.operating_unit_id
                   from sim_tr_registrasi_tujuan d
                   join sim_tr_registrasi r on r.tenant_id = d.tenant_id and r.id = d.registrasi_id
                   where d.tenant_id = $1 and d.id = $2 and d.deleted_at is null and r.deleted_at is null
                     and ${visitVisibility(this.workspace, bind)}
                   ${lock ? 'for update of d, r' : ''}`,
                  bindings,
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Poli tujuan rujuk internal: section aktif di unit kunjungan yang belum ada di kunjungan ini, beserta jadwal praktik
    // hari kunjungan, seperti pilihan Poli / Ruangan dan Dokter / Tenaga Medis form Tambah Rujuk Internal.
    async referralOptions(destinationId: string) {
        this.workspace.guard('examination', 'read');
        const destination = await this.destination(destinationId, false);
        await ensurePracticeSchedule(this.db, {
            tenantId: this.tenantId,
            legalEntityId: this.workspace.legalEntityId,
        });
        const sections = await this.db.rows(
            z.object({ id: z.string(), name: z.string() }),
            `select s.id, s.nama as name from sim_m_section s
             where s.tenant_id = $1 and s.operating_unit_id = $2 and s.aktif and s.deleted_at is null
               and not exists (select 1 from sim_tr_registrasi_tujuan d
                               where d.tenant_id = s.tenant_id and d.registrasi_id = $3 and d.section_id = s.id
                                 and d.status <> 'batal' and d.deleted_at is null)
             order by s.nama`,
            [
                this.tenantId,
                destination.operating_unit_id,
                destination.visit_id,
            ],
        );
        const data = [];
        for (const section of sections)
            data.push({
                ...section,
                schedules: (
                    await schedulesForRegistration(this.db, {
                        tenantId: this.tenantId,
                        sectionId: section.id,
                        date: destination.date,
                    })
                ).map((schedule) => ({
                    id: schedule.id,
                    practitioner_name: schedule.practitioner_name,
                    session_name: schedule.session_name,
                    start_time: schedule.start_time,
                    end_time: schedule.end_time,
                    full: schedule.full,
                })),
            });
        return { data };
    }

    // Rujuk internal dari kunjungan yang semua polinya sudah selesai membuka kunjungan itu kembali; sistem lama tidak
    // memeriksa status saat merujuk (statuspasien_helper::RujukInternalFormSubmit). Hanya sebelum dibayar: kunci kasir
    // menolak kunjungan yang sudah dibayar. Kasir mendapat healthcare.visit.reopened.v1, jadi kunjungan ini keluar dari
    // Daftar Pembayaran sampai poli rujukan Selesai periksa dan kunjungan selesai lagi.
    private async reopen(visitId: string, stamp: string): Promise<void> {
        try {
            await lockChargeForChange(this.db, {
                tenantId: this.tenantId,
                sourceModule: moduleId,
                visitId,
            });
        } catch (error) {
            // Pesan kunci kasir menyebut tarif, BHP, dan resep; pengguna yang merujuk perlu tahu jalan keluarnya.
            if (error instanceof HttpFailure)
                validation({ status: paidReferralMessage });
            throw error;
        }
        await this.db.execute(
            `update sim_tr_registrasi set status = 'diperiksa', selesai_pada = null, updated_at = $3
             where tenant_id = $1 and id = $2`,
            [this.tenantId, visitId, stamp],
        );
        await publishVisitReopened(this.db, this.tenantId, visitId);
    }

    // Tambah Rujuk Internal: tujuan baru di kunjungan yang sama, dengan nomor antrean dari penghitung poli tujuan dan
    // NoBukti sendiri, menunjuk tujuan ini sebagai asalnya. Boleh selama rekam medis tujuan ini boleh diubah, juga sesudah
    // Selesai periksa. Poli yang sudah ada di kunjungan ditolak dengan pesan sistem lama. Status pasien tujuan ini menjadi
    // status rujuk internal yang dipilih, dan isian perilaku lain dikosongkan.
    async refer(destinationId: string, body: unknown): Promise<void> {
        this.workspace.guard('examination', 'manage');
        const parsed = internalReferralInputSchema.safeParse(body ?? {});
        if (!parsed.success) validation({ section_id: 'Isian ini tidak sah.' });
        const input = parsed.data;
        await this.db.transaction(async () => {
            const destination = await this.destination(destinationId, true);
            const locked = recordLockedMessage(destination.status);
            if (locked) validation({ status: locked });
            const stamp = nowSql();
            if (destination.visit_status === 'selesai')
                await this.reopen(destination.visit_id, stamp);
            const errors: Errors = {};
            const status = await this.status(
                input.status_id,
                null,
                'status_id',
                errors,
            );
            if (status && status.behavior !== 'rujuk_internal')
                add(errors, 'status_id', 'Pilih status rujuk internal.');
            const note = text(input.note, 'note', 1000, errors);
            const sectionId = lookupId(input.section_id ?? '');
            const section = sectionId
                ? await this.db.one(
                      z.object({
                          id: z.string(),
                          operating_unit_id: z.string(),
                          queue_mode: z.string(),
                          queue_prefix: z.string().nullable(),
                          document_code: z.string().nullable(),
                      }),
                      `select id, operating_unit_id, mode_antrean as queue_mode, awalan_antrean as queue_prefix,
                              kode_no_bukti as document_code
                       from sim_m_section
                       where tenant_id = $1 and id = $2 and operating_unit_id = $3 and aktif and deleted_at is null`,
                      [this.tenantId, sectionId, destination.operating_unit_id],
                  )
                : undefined;
            if (!section) add(errors, 'section_id', 'Pilih poli dari daftar.');
            if (Object.keys(errors).length || !section || !status)
                validation(errors);
            const duplicate = await this.db.one(
                z.object({ id: z.string() }),
                `select id from sim_tr_registrasi_tujuan
                 where tenant_id = $1 and registrasi_id = $2 and section_id = $3 and status <> 'batal'
                   and deleted_at is null
                 limit 1`,
                [this.tenantId, destination.visit_id, section.id],
            );
            if (duplicate) validation({ section_id: duplicateReferralMessage });
            if (!isQueueMode(section.queue_mode))
                throw new Error(`Unknown queue mode: ${section.queue_mode}`);
            const schedule = await takeSchedule(
                this.db,
                this.tenantId,
                section.id,
                input.practice_schedule_id?.trim() || null,
                destination.date,
            );
            const queue = await nextQueueNumber(
                this.db,
                this.tenantId,
                section.id,
                destination.date,
                section.queue_mode,
                schedule?.id ?? null,
            );
            const id = Bun.randomUUIDv7();
            const examinationNumber = await new NumberIssuer(this.db, {
                tenantId: this.tenantId,
                moduleId,
            }).issue({
                reference: examinationNumberReference,
                key: `examination:${id}`,
                documentDate: destination.date,
                operatingUnitId: section.operating_unit_id,
                ...(section.document_code
                    ? { values: { section: section.document_code } }
                    : {}),
            });
            const last = await this.db.one(
                z.object({ position: z.number() }),
                `select max(urutan)::int as position from sim_tr_registrasi_tujuan
                 where tenant_id = $1 and registrasi_id = $2`,
                [this.tenantId, destination.visit_id],
            );
            await this.db.insert('sim_tr_registrasi_tujuan', {
                id,
                tenant_id: this.tenantId,
                registrasi_id: destination.visit_id,
                urutan: (last?.position ?? 0) + 1,
                section_id: section.id,
                jadwal_praktik_id: schedule?.id ?? null,
                nakes_id: schedule?.practitionerId ?? null,
                no_antrean: queue,
                kode_antrean: queueCode(section.queue_prefix, queue),
                no_bukti: examinationNumber,
                status: 'menunggu',
                asal_tujuan_id: destination.id,
                catatan_rujukan: note,
                didaftarkan_pada: stamp,
                created_at: stamp,
                updated_at: stamp,
            });
            await this.write(
                destination.id,
                { ...cleared, status_pulang_id: status.id },
                stamp,
            ); // Rujukan mengubah isi rekam medis tujuan ini, jadi versi pemeriksaan ikut naik: layar yang masih memuat isi
            // lama dipasang ulang dari respons, dan Simpan dengan versi lama ditolak.
            await this.db.execute(
                `update sim_tr_pemeriksaan set updated_at = $3
                 where tenant_id = $1 and tujuan_id = $2 and deleted_at is null`,
                [this.tenantId, destination.id, stamp],
            );
        });
    }
}
