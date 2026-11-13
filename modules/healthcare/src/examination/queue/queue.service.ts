import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    nowSql,
    type Bind,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    dateSchema,
    incrementalList,
    lookupId,
    validation,
} from '@core/platform/http/index.ts';
import {
    grantedUnits,
    grantsUnit,
} from '../../patient/patient-sharing/patient-sharing.service.ts';
import {
    visitDate,
    visitVisibility,
} from '../../registration/visit/visit.service.ts';
import {
    isVisitStatus,
    refusedTransition,
} from '../../registration/visit/visit.statuses.ts';
import { referrerUnfinishedMessage } from '../discharge/discharge.behaviors.ts';
import { missingRequired } from '../medical-record/medical-record.service.ts';
import {
    callInputSchema,
    callNextInputSchema,
    queueEntrySchema,
    startInputSchema,
    type QueueEntry,
} from './queue.schema.ts';
import {
    isDestinationStatus,
    nextStatus,
    refusedMessage,
    type QueueAction,
} from './queue.statuses.ts';
import { publishVisitCompleted } from '../../registration/visit/visit.events.ts';

export const nobodyWaitingMessage =
    'Belum ada pasien yang menunggu di poli ini.';

function placeholders(start: number, count: number): string {
    return Array.from(
        { length: count },
        (_, index) => `$${start + index}`,
    ).join(',');
}

// Tujuan kunjungan `d` beserta kunjungan `r`, pasien, dan panggilan terakhirnya. Syarat ditambahkan pemanggil.
const entrySelect = `
    select d.id, d.registrasi_id as visit_id, r.tanggal::text as date, d.section_id, s.kode as section_code,
           s.nama as section_name,
           d.no_antrean as queue_number, d.kode_antrean as queue_code,
           coalesce(d.posisi_antrean, d.no_antrean) as queue_position, d.status, d.ruangan_id as room_id,
           ru.nama as room_name, d.nakes_id as practitioner_id, np.name as practitioner_name,
           r.no_reg as registration_number, d.no_bukti as examination_number,
           to_char(r.didaftarkan_pada, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as registered_at, r.status as visit_status,
           r.jenis_kunjungan as visit_kind, r.pasien_id as patient_id, k.nrm as patient_nrm, p.name as patient_name,
           p.gender, p.birth_date::text as birth_date, r.umur_tahun as age_years, r.umur_bulan as age_months,
           r.umur_hari as age_days, t.nama as patient_type_name, gp.name as guarantor_name,
           kl.kode as cluster_code, kl.nama as cluster_name, sh.nama as life_cycle_name,
           sk.nama as screening_category_name, sk.warna as screening_category_color,
           to_char(calls.called_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as called_at, calls.call_count,
           asal_s.nama as referrer_section_name,
           to_char(d.mulai_periksa_pada, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as started_at,
           to_char(d.selesai_periksa_pada, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as finished_at
    from sim_tr_registrasi_tujuan d
    join sim_tr_registrasi r on r.tenant_id = d.tenant_id and r.id = d.registrasi_id
    join sim_m_section s on s.tenant_id = d.tenant_id and s.id = d.section_id
    join sim_m_pasien k on k.tenant_id = r.tenant_id and k.id = r.pasien_id
    join parties p on p.tenant_id = k.tenant_id and p.id = k.party_id
    join sim_m_tipe_pasien t on t.tenant_id = r.tenant_id and t.id = r.tipe_pasien_id
    left join sim_m_penjamin g on g.tenant_id = r.tenant_id and g.id = r.penjamin_id
    left join parties gp on gp.tenant_id = g.tenant_id and gp.id = g.party_id
    left join sim_m_ruangan ru on ru.tenant_id = d.tenant_id and ru.id = d.ruangan_id
    left join sim_m_nakes n on n.tenant_id = d.tenant_id and n.id = d.nakes_id
    left join parties np on np.tenant_id = n.tenant_id and np.id = n.party_id
    left join sim_m_klaster kl on kl.tenant_id = r.tenant_id and kl.id = r.klaster_id
    left join sim_m_siklus_hidup sh on sh.tenant_id = r.tenant_id and sh.id = r.siklus_hidup_id
    left join sim_m_skrining_kategori sk on sk.tenant_id = r.tenant_id and sk.id = r.kategori_skrining_id
    left join sim_tr_registrasi_tujuan asal on asal.tenant_id = d.tenant_id and asal.id = d.asal_tujuan_id
    left join sim_m_section asal_s on asal_s.tenant_id = asal.tenant_id and asal_s.id = asal.section_id
    cross join lateral (
        select max(a.dilakukan_pada) as called_at, count(*)::int as call_count
        from sim_tr_antrean_panggilan a
        where a.tenant_id = d.tenant_id and a.tujuan_id = d.id and a.aksi in ('panggil', 'panggil_ulang')) calls`;

// Antrean poli: satu antrean per section per hari, dan ruangan dipilih di tempat memanggil. Ruangan yang lebih dulu
// memanggil mendapat pasien berikutnya ke ruangannya. Kunjungan yang terlihat dan boleh dipanggil dibatasi legal entity
// aktif dan unit dari kebijakan data pasien, sama dengan pendaftaran.
export class ExaminationQueue {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Section aktif di unit pengguna beserta ruangan aktif yang melayaninya, klaster, dan nakes berjadwal hari itu.
    async metadata() {
        this.workspace.guard('examination', 'read');
        const date = await visitDate(this.db, this.workspace);
        const tenantId = this.workspace.tenantId;
        const units = grantedUnits(this.workspace);
        const sections =
            units !== null && !units.length
                ? []
                : await this.db.rows(
                      z.object({
                          id: z.string(),
                          name: z.string(),
                          operating_unit_name: z.string(),
                          rooms: z.array(
                              z.object({
                                  id: z.string(),
                                  code: z.string(),
                                  name: z.string(),
                              }),
                          ),
                          practitioners: z.array(
                              z.object({ id: z.string(), name: z.string() }),
                          ),
                      }),
                      `select s.id, s.nama as name, o.name as operating_unit_name,
                              coalesce((select json_agg(json_build_object('id', ru.id, 'code', ru.kode, 'name', ru.nama)
                                                        order by ru.urutan, ru.kode)
                                        from sim_m_section_ruangan sr
                                        join sim_m_ruangan ru on ru.tenant_id = sr.tenant_id and ru.id = sr.ruangan_id
                                        where sr.tenant_id = s.tenant_id and sr.section_id = s.id
                                          and sr.deleted_at is null and ru.deleted_at is null and ru.aktif),
                                       '[]'::json) as rooms,
                              coalesce((select json_agg(distinct jsonb_build_object('id', n.id, 'name', np.name))
                                        from sim_tr_jadwal_praktik j
                                        join sim_m_nakes n on n.tenant_id = j.tenant_id
                                             and n.id = coalesce(j.nakes_pengganti_id, j.nakes_id)
                                        join parties np on np.tenant_id = n.tenant_id and np.id = n.party_id
                                        where j.tenant_id = s.tenant_id and j.section_id = s.id and j.tanggal = $2::date
                                          and j.deleted_at is null), '[]'::json) as practitioners
                       from sim_m_section s
                       join organizations o on o.tenant_id = s.tenant_id and o.id = s.operating_unit_id
                       where s.tenant_id = $1 and s.deleted_at is null and s.aktif
                         ${units === null ? '' : `and s.operating_unit_id in (${placeholders(3, units.length)})`}
                       order by o.name, s.nama`,
                      [tenantId, date, ...(units ?? [])],
                  );
        return {
            date,
            sections,
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
            permissions: {
                manage: this.workspace.permissions.has(
                    'healthcare.examination.manage',
                ),
            },
        };
    }

    // Tujuan kunjungan satu hari (bawaan hari ini), urut posisi antrean, dengan penghitung per status. Penghitung
    // mengikuti saringan selain status dan pencarian. Tujuan batal ikut tampil dan dihitung sendiri, tetapi tidak masuk
    // Total, seperti daftar poli sistem lama (poly/controllers/Outpatient.php:1332 dan 1480-1484). `room_id`
    // menambahkan pasien yang sedang dipanggil di ruangan itu.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('examination', 'read');
        const date =
            parameters.get('date') ||
            (await visitDate(this.db, this.workspace));
        if (!dateSchema.safeParse(date).success)
            validation({ date: 'Isi tanggal dengan format YYYY-MM-DD.' });
        const bindings: Bind[] = [this.workspace.tenantId];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const filters = [
            'd.tenant_id = $1',
            'd.deleted_at is null',
            'r.deleted_at is null',
            visitVisibility(this.workspace, bind),
            `r.tanggal = ${bind(date)}::date`,
        ];
        const section = lookupId(parameters.get('section_id') ?? '');
        if (section) filters.push(`d.section_id = ${bind(section)}`);
        const practitioner = lookupId(parameters.get('practitioner_id') ?? '');
        if (practitioner) filters.push(`d.nakes_id = ${bind(practitioner)}`);
        const cluster = lookupId(parameters.get('cluster_id') ?? '');
        if (cluster) filters.push(`r.klaster_id = ${bind(cluster)}`);
        const counts = await this.db.one(
            z.object({
                waiting: z.number(),
                called: z.number(),
                in_examination: z.number(),
                done: z.number(),
                no_show: z.number(),
                cancelled: z.number(),
                total: z.number(),
            }),
            `select count(*) filter (where d.status = 'menunggu')::int as waiting,
                    count(*) filter (where d.status = 'dipanggil')::int as called,
                    count(*) filter (where d.status = 'diperiksa')::int as in_examination,
                    count(*) filter (where d.status = 'selesai')::int as done,
                    count(*) filter (where d.status = 'tidak_datang')::int as no_show,
                    count(*) filter (where d.status = 'batal')::int as cancelled,
                    count(*) filter (where d.status <> 'batal')::int as total
             from sim_tr_registrasi_tujuan d
             join sim_tr_registrasi r on r.tenant_id = d.tenant_id and r.id = d.registrasi_id
             where ${filters.join(' and ')}`,
            bindings,
        );
        const room = lookupId(parameters.get('room_id') ?? '');
        // Parameter ruangan hanya untuk query ini; PostgreSQL menolak parameter yang tidak dipakai query lain.
        const current = room
            ? await this.db.one(
                  queueEntrySchema,
                  `${entrySelect}
                   where ${filters.join(' and ')} and d.ruangan_id = $${bindings.length + 1}
                     and d.status = 'dipanggil'
                   order by calls.called_at desc limit 1`,
                  [...bindings, room],
              )
            : undefined;
        const status = parameters.get('status') ?? '';
        const statusFilter = isDestinationStatus(status)
            ? ` and d.status = ${bind(status)}`
            : '';
        const batch = await incrementalList(this.db, {
            query: `${entrySelect} where ${filters.join(' and ')}${statusFilter}`,
            bindings,
            parameters,
            columns: {
                queue_position: 'queue_position',
                queue_code: 'queue_code',
                patient_name: 'patient_name',
                registered_at: 'registered_at',
            },
            searchColumns: [
                'patient_nrm',
                'patient_name',
                'queue_code',
                'registration_number',
            ],
            numericColumns: ['queue_position'],
            defaultSort: 'queue_position',
            defaultDirection: 'asc',
        });
        return {
            date,
            data: batch.data.map((row) => queueEntrySchema.parse(row)),
            next_cursor: batch.next_cursor,
            counts: counts ?? {
                waiting: 0,
                called: 0,
                in_examination: 0,
                done: 0,
                no_show: 0,
                cancelled: 0,
                total: 0,
            },
            current: current ?? null,
        };
    }

    async show(id: string) {
        this.workspace.guard('examination', 'read');
        return { data: await this.present(id) };
    }

    // Tujuan di alamat halaman pemeriksaan: NoReg lalu kode section, urutan poly/outpatient/form/{NoReg}/{SectionID}
    // sistem lama. Satu kunjungan bisa memegang tujuan batal dan tujuan hidup untuk section yang sama, karena rujuk
    // internal hanya menolak section yang tujuannya masih hidup; tujuan hidup didahulukan, lalu tujuan batal terakhir.
    // Section yang sudah dihapus tetap dicocokkan, supaya tautan kunjungan lamanya tetap terbuka.
    async find(registrationNumber: string, sectionCode: string) {
        this.workspace.guard('examination', 'read');
        const bindings: Bind[] = [
            this.workspace.tenantId,
            registrationNumber,
            sectionCode,
        ];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const found = await this.db.one(
            queueEntrySchema,
            `${entrySelect}
             where d.tenant_id = $1 and r.no_reg = $2 and lower(s.kode) = lower($3)
               and d.deleted_at is null and r.deleted_at is null and ${visitVisibility(this.workspace, bind)}
             order by d.status = 'batal', s.deleted_at is not null, d.batal_pada desc nulls last, d.id desc
             limit 1`,
            bindings,
        );
        if (!found) abort(404, 'Not Found');
        return { data: found };
    }

    // Tujuan yang terlihat bagi pengguna. Yang lain dijawab 404, supaya keberadaannya tidak bocor.
    private async present(id: string): Promise<QueueEntry> {
        const bindings: Bind[] = [this.workspace.tenantId, lookupId(id)];
        const bind = (value: Bind) => {
            bindings.push(value);
            return `$${bindings.length}`;
        };
        const found = bindings[1]
            ? await this.db.one(
                  queueEntrySchema,
                  `${entrySelect}
                   where d.tenant_id = $1 and d.id = $2 and d.deleted_at is null and r.deleted_at is null
                     and ${visitVisibility(this.workspace, bind)}`,
                  bindings,
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Section aktif di unit pengguna, dan ruangan aktif yang melayaninya.
    private async sectionRoom(sectionId: string, roomId: string) {
        const section = lookupId(sectionId)
            ? await this.db.one(
                  z.object({ id: z.string(), operating_unit_id: z.string() }),
                  `select id, operating_unit_id from sim_m_section
                   where tenant_id = $1 and id = $2 and aktif and deleted_at is null`,
                  [this.workspace.tenantId, sectionId],
              )
            : undefined;
        if (!section) validation({ section_id: 'Pilih poli dari daftar.' });
        if (!grantsUnit(this.workspace, section.operating_unit_id))
            abort(
                403,
                'Poli ini berada di luar unit kerja yang dapat Anda akses.',
            );
        const room = lookupId(roomId)
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  `select ru.id from sim_m_ruangan ru
                   join sim_m_section_ruangan sr on sr.tenant_id = ru.tenant_id and sr.ruangan_id = ru.id
                        and sr.section_id = $3 and sr.deleted_at is null
                   where ru.tenant_id = $1 and ru.id = $2 and ru.aktif and ru.deleted_at is null`,
                  [this.workspace.tenantId, roomId, section.id],
              )
            : undefined;
        if (!room)
            validation({ room_id: 'Pilih ruangan yang melayani poli ini.' });
        return { sectionId: section.id, roomId: room.id };
    }

    private async log(
        destinationId: string,
        roomId: string | null,
        action: QueueAction,
        stamp: string,
    ): Promise<void> {
        await this.db.insert('sim_tr_antrean_panggilan', {
            id: Bun.randomUUIDv7(),
            tenant_id: this.workspace.tenantId,
            tujuan_id: destinationId,
            ruangan_id: roomId,
            aksi: action,
            dilakukan_oleh: this.workspace.userId,
            dilakukan_pada: stamp,
        });
    }

    // Ruangan yang masih memanggil pasien lain hari itu ditolak, supaya pasien itu tidak hilang dari ruangan. Baris
    // ruangan dikunci lebih dulu, agar pemeriksaan ini tetap benar saat satu ruangan menekan Panggil dua kali.
    private async claimRoom(roomId: string, date: string): Promise<void> {
        await this.db.execute(
            'select id from sim_m_ruangan where tenant_id = $1 and id = $2 for no key update',
            [this.workspace.tenantId, roomId],
        );
        const busy = await this.db.one(
            z.object({ queue_code: z.string() }),
            `select d.kode_antrean as queue_code from sim_tr_registrasi_tujuan d
             join sim_tr_registrasi r on r.tenant_id = d.tenant_id and r.id = d.registrasi_id
             where d.tenant_id = $1 and d.ruangan_id = $2 and d.status = 'dipanggil' and r.tanggal = $3::date
               and d.deleted_at is null
             limit 1`,
            [this.workspace.tenantId, roomId, date],
        );
        if (busy)
            validation({
                room_id: `Ruangan ini masih memanggil ${busy.queue_code}. Mulai periksa, lewati, atau tandai tidak datang lebih dulu.`,
            });
    }

    // Panggil berikutnya: pasien menunggu dengan posisi terkecil di section hari ini masuk ke ruangan pemanggil. Baris
    // yang sedang dikunci ruangan lain dilewati (SKIP LOCKED), jadi dua ruangan yang memanggil bersamaan tidak pernah
    // mendapat pasien yang sama dan tidak saling menunggu.
    async callNext(body: unknown) {
        this.workspace.guard('examination', 'manage');
        const parsed = callNextInputSchema.safeParse(body);
        if (!parsed.success) validation({ room_id: 'Pilih poli dan ruangan.' });
        const date = await visitDate(this.db, this.workspace);
        const { sectionId, roomId } = await this.sectionRoom(
            parsed.data.section_id,
            parsed.data.room_id,
        );
        const id = await this.db.transaction(async () => {
            await this.claimRoom(roomId, date);
            const next = await this.db.one(
                z.object({ id: z.string() }),
                `select d.id from sim_tr_registrasi_tujuan d
                 join sim_tr_registrasi r on r.tenant_id = d.tenant_id and r.id = d.registrasi_id
                 where d.tenant_id = $1 and d.section_id = $2 and r.tanggal = $3::date and d.status = 'menunggu'
                   and d.deleted_at is null and r.deleted_at is null and r.legal_entity_id = $4
                   and not exists (select 1 from sim_tr_registrasi_tujuan a
                                   where a.tenant_id = d.tenant_id and a.id = d.asal_tujuan_id and a.status <> 'selesai')
                 order by coalesce(d.posisi_antrean, d.no_antrean), d.id
                 limit 1
                 for update of d skip locked`,
                [
                    this.workspace.tenantId,
                    sectionId,
                    date,
                    this.workspace.legalEntityId,
                ],
            );
            if (!next) validation({ section_id: nobodyWaitingMessage });
            const stamp = nowSql();
            await this.db.execute(
                `update sim_tr_registrasi_tujuan set status = 'dipanggil', ruangan_id = $3, updated_at = $4
                 where tenant_id = $1 and id = $2`,
                [this.workspace.tenantId, next.id, roomId, stamp],
            );
            await this.log(next.id, roomId, 'panggil', stamp);
            return next.id;
        });
        return { data: await this.present(id) };
    }

    // Tindakan atas satu tujuan: panggil (dari halaman pemeriksaan), panggil ulang, lewati, tidak datang, mulai periksa,
    // dan selesai periksa. Baris tujuan dan kunjungannya dikunci, jadi dua petugas yang menekan tombol berbeda bersamaan
    // mendapat satu hasil dan satu penolakan.
    async act(id: string, action: QueueAction, body: unknown) {
        this.workspace.guard('examination', 'manage');
        await this.db.transaction(async () => {
            const bindings: Bind[] = [this.workspace.tenantId, lookupId(id)];
            const bind = (value: Bind) => {
                bindings.push(value);
                return `$${bindings.length}`;
            };
            const current = bindings[1]
                ? await this.db.one(
                      z.object({
                          id: z.string(),
                          visit_id: z.string(),
                          visit_status: z.string(),
                          date: z.string(),
                          section_id: z.string(),
                          status: z.string(),
                          room_id: z.string().nullable(),
                          referrer_status: z.string().nullable(),
                          referrer_section: z.string().nullable(),
                      }),
                      `select d.id, d.registrasi_id as visit_id, r.status as visit_status, r.tanggal::text as date,
                              d.section_id, d.status, d.ruangan_id as room_id, a.status as referrer_status,
                              s.nama as referrer_section
                       from sim_tr_registrasi_tujuan d
                       join sim_tr_registrasi r on r.tenant_id = d.tenant_id and r.id = d.registrasi_id
                       left join sim_tr_registrasi_tujuan a on a.tenant_id = d.tenant_id and a.id = d.asal_tujuan_id
                       left join sim_m_section s on s.tenant_id = a.tenant_id and s.id = a.section_id
                       where d.tenant_id = $1 and d.id = $2 and d.deleted_at is null and r.deleted_at is null
                         and ${visitVisibility(this.workspace, bind)}
                       for update of d, r`,
                      bindings,
                  )
                : undefined;
            if (!current) abort(404, 'Not Found');
            if (!isDestinationStatus(current.status))
                throw new Error(
                    `Unknown destination status: ${current.status}`,
                );
            const to = nextStatus(action, current.status);
            if (!to) validation({ status: refusedMessage(current.status) });
            const stamp = nowSql();
            let roomId = current.room_id;
            let position: number | null = null;
            switch (action) {
                case 'panggil_ulang':
                case 'tidak_datang':
                    break;
                // Panggil satu pasien dari halaman pemeriksaan, seperti tombol Panggil di Status Pasien sistem lama,
                // di luar urutan Panggil berikutnya. Ruangannya ruangan pemanggil dengan aturan satu panggilan per
                // ruangan yang sama.
                case 'panggil': {
                    const parsed = callInputSchema.safeParse(body ?? {});
                    if (!parsed.success)
                        validation({
                            room_id: 'Pilih ruangan tempat memanggil.',
                        });
                    roomId = (
                        await this.sectionRoom(
                            current.section_id,
                            parsed.data.room_id,
                        )
                    ).roomId;
                    await this.claimRoom(
                        roomId,
                        await visitDate(this.db, this.workspace),
                    );
                    break;
                }
                // Pemeriksaan selesai hanya bila isian wajib periksa fisik yang tersimpan sudah terisi, di section yang
                // memakai Periksa fisik.
                case 'selesai_periksa': {
                    const missing = await missingRequired(
                        this.db,
                        this.workspace.tenantId,
                        current.id,
                        current.section_id,
                    );
                    if (Object.keys(missing).length) validation(missing);
                    break;
                }
                case 'lewati': {
                    const last = await this.db.one(
                        z.object({ position: z.number() }),
                        `select max(coalesce(d.posisi_antrean, d.no_antrean))::int as position
                         from sim_tr_registrasi_tujuan d
                         join sim_tr_registrasi r on r.tenant_id = d.tenant_id and r.id = d.registrasi_id
                         where d.tenant_id = $1 and d.section_id = $2 and r.tanggal = $3::date
                           and d.deleted_at is null`,
                        [
                            this.workspace.tenantId,
                            current.section_id,
                            current.date,
                        ],
                    );
                    position = (last?.position ?? 0) + 1;
                    break;
                }
                // Rujuk internal baru boleh diperiksa setelah pemeriksaan di poli asalnya selesai, seperti
                // statuspasien_helper::update_statuspasien.
                case 'mulai_periksa': {
                    if (
                        current.referrer_status !== null &&
                        current.referrer_status !== 'selesai'
                    )
                        validation({
                            status: referrerUnfinishedMessage(
                                current.referrer_section ?? '',
                            ),
                        });
                    if (current.status !== 'dipanggil') {
                        const parsed = startInputSchema.safeParse(body ?? {});
                        const chosen = parsed.success
                            ? (parsed.data.room_id ?? null)
                            : null;
                        const room = chosen ?? current.room_id;
                        if (!room)
                            validation({
                                room_id: 'Pilih ruangan pemeriksaan.',
                            });
                        roomId = (
                            await this.sectionRoom(current.section_id, room)
                        ).roomId;
                    }
                    await this.moveVisit(
                        current.visit_id,
                        current.visit_status,
                        'diperiksa',
                        stamp,
                    );
                    break;
                }
                default: {
                    const unknown: never = action;
                    throw new Error(`Unknown queue action: ${String(unknown)}`);
                }
            }
            await this.db.execute(
                `update sim_tr_registrasi_tujuan
                 set status = $3, ruangan_id = $4, posisi_antrean = coalesce($5, posisi_antrean), updated_at = $6,
                     mulai_periksa_pada = coalesce($7, mulai_periksa_pada),
                     selesai_periksa_pada = coalesce($8, selesai_periksa_pada)
                 where tenant_id = $1 and id = $2`,
                [
                    this.workspace.tenantId,
                    current.id,
                    to,
                    action === 'lewati' ? null : roomId,
                    position,
                    stamp,
                    action === 'mulai_periksa' ? stamp : null,
                    action === 'selesai_periksa' ? stamp : null,
                ],
            );
            await this.log(current.id, roomId, action, stamp);
            if (action === 'selesai_periksa') {
                const open = await this.db.one(
                    z.object({ id: z.string() }),
                    `select id from sim_tr_registrasi_tujuan
                     where tenant_id = $1 and registrasi_id = $2 and deleted_at is null
                       and status not in ('selesai', 'batal')
                     limit 1`,
                    [this.workspace.tenantId, current.visit_id],
                );
                if (!open)
                    await this.moveVisit(
                        current.visit_id,
                        current.visit_status,
                        'selesai',
                        stamp,
                    );
            }
        });
        return { data: await this.present(id) };
    }

    // Status kunjungan mengikuti tujuannya: tujuan pertama yang diperiksa membuat kunjungan diperiksa, dan kunjungan
    // selesai setelah semua tujuannya selesai. Kunjungan yang sudah berstatus itu tidak diubah.
    private async moveVisit(
        visitId: string,
        from: string,
        to: 'diperiksa' | 'selesai',
        stamp: string,
    ): Promise<void> {
        if (from === to) return;
        if (!isVisitStatus(from))
            throw new Error(`Unknown visit status: ${from}`);
        const refused = refusedTransition(from, to);
        if (refused) validation({ status: refused });
        await this.db.execute(
            `update sim_tr_registrasi set status = $3, updated_at = $4, selesai_pada = $5
             where tenant_id = $1 and id = $2`,
            [
                this.workspace.tenantId,
                visitId,
                to,
                stamp,
                to === 'selesai' ? stamp : null,
            ],
        );
        if (to === 'selesai')
            await publishVisitCompleted(
                this.db,
                this.workspace.tenantId,
                visitId,
            );
    }
}
