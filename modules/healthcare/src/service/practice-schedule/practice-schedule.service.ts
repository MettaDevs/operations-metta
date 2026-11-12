import { z } from 'zod';
import { workingTimes } from '@core/foundation/calendar/index.ts';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    dateSchema,
    expectedVersion,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import {
    generateInputSchema,
    practiceScheduleChangeSchema,
    practiceScheduleInputSchema,
    practiceScheduleRowSchema,
    registrationScheduleSchema,
    type RegistrationSchedule,
} from './practice-schedule.schema.ts';
import {
    activePractitioner,
    activeSection,
    activeSession,
    capacityError,
} from './schedule-template.service.ts';
import {
    addDays,
    daysBetween,
    holidayDay,
    isoDay,
} from './practice-schedule.days.ts';
import {
    defaultAutoGenerate,
    defaultHorizonDays,
} from './schedule-parameter.service.ts';

// Rentang terpanjang satu kali generate dan satu kali baca jadwal, dalam hari termasuk kedua ujungnya.
export const maxGenerateDays = 92;
const maxReadDays = 42;
export const holidayReason = 'Hari libur';

function checkedRange(from: string, to: string, maxDays: number): void {
    const errors: Record<string, string> = {};
    if (!dateSchema.safeParse(from).success) errors.from = 'Isi tanggal mulai.';
    if (!dateSchema.safeParse(to).success) errors.to = 'Isi tanggal selesai.';
    if (Object.keys(errors).length) validation(errors);
    const days = daysBetween(from, to) + 1;
    if (days < 1)
        validation({
            to: 'Tanggal selesai tidak boleh sebelum tanggal mulai.',
        });
    if (days > maxDays)
        validation({ to: `Rentang tanggal paling panjang ${maxDays} hari.` });
}

const templateSchema = z.object({
    id: z.string(),
    nakes_id: z.string(),
    section_id: z.string(),
    hari: z.number(),
    sesi_id: z.string(),
    jam_mulai: z.string(),
    jam_selesai: z.string(),
    lewat_tengah_malam: z.boolean(),
    kapasitas: z.number().nullable(),
    calendar_id: z.string().nullable(),
    berlaku_mulai: z.string(),
    berlaku_sampai: z.string().nullable(),
});

const storedSchema = z.object({
    id: z.string(),
    nakes_id: z.string(),
    section_id: z.string(),
    sesi_id: z.string(),
    tanggal: z.string(),
    jam_mulai: z.string(),
    jam_selesai: z.string(),
    berakhir_tanggal: z.string(),
    kapasitas: z.number().nullable(),
    sumber: z.string(),
    template_id: z.string().nullable(),
    status: z.string(),
    alasan_batal: z.string().nullable(),
    jumlah_terdaftar: z.number(),
    diubah_manual: z.boolean(),
});

// Bentuk satu baris bertanggal yang diturunkan dari template.
type Target = {
    nakes_id: string;
    section_id: string;
    sesi_id: string;
    tanggal: string;
    jam_mulai: string;
    jam_selesai: string;
    berakhir_tanggal: string;
    kapasitas: number | null;
    template_id: string;
    status: 'terjadwal' | 'batal';
    alasan_batal: string | null;
};

const keyOf = (row: {
    nakes_id: string;
    section_id: string;
    sesi_id: string;
    tanggal: string;
}) => `${row.nakes_id}|${row.section_id}|${row.sesi_id}|${row.tanggal}`;

const sameTarget = (row: z.infer<typeof storedSchema>, target: Target) =>
    row.jam_mulai === target.jam_mulai &&
    row.jam_selesai === target.jam_selesai &&
    row.berakhir_tanggal === target.berakhir_tanggal &&
    row.kapasitas === target.kapasitas &&
    row.template_id === target.template_id &&
    row.status === target.status &&
    row.alasan_batal === target.alasan_batal;

export type GenerateResult = {
    created: number;
    updated: number;
    unchanged: number;
    kept: number;
    removed: number;
};

// Kunci per tenant untuk semua yang menulis jadwal bertanggal: generate dan tambah manual.
async function lockSchedules(db: Database, tenantId: string): Promise<void> {
    await db.execute(
        "select pg_advisory_xact_lock(hashtextextended('sim_tr_jadwal_praktik:' || $1, 0))",
        [tenantId],
    );
}

// Tanggal libur setiap kalender: tanggal yang disusun dan ditutup. Tanggal yang belum disusun di kalender tidak dihitung
// libur, berbeda dari pembacaan kalender biasa: kalender yang lupa disusun tidak boleh membatalkan seluruh jadwal.
async function holidays(
    db: Database,
    tenantId: string,
    calendarIds: string[],
    from: string,
    to: string,
): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    for (const calendarId of calendarIds) {
        const days = await workingTimes(db, { tenantId, calendarId, from, to });
        result.set(
            calendarId,
            new Set(
                days
                    .filter((day) => day.composed && !day.open)
                    .map((day) => day.date),
            ),
        );
    }
    return result;
}

// Susun jadwal bertanggal dari template mingguan, pola F&O "Compose working times" dan pengganti prosedur
// GenerateJadwalDokterMingguan sistem lama. Aman diulang:
// - Tanggal yang belum punya baris mendapat baris baru dari template yang berlaku pada tanggal itu.
// - Baris dari template yang belum disentuh (tidak diubah manual dan belum ada pendaftar) diperbarui bila templatenya
//   berubah, dan diarsipkan bila tidak ada lagi template yang menurunkannya.
// - Baris manual, baris yang diubah orang, dan baris yang sudah punya pendaftar tidak pernah disentuh.
// - Pada tanggal yang ditutup kalender template, jadwal hari itu dibatalkan dengan alasan "Hari libur", kecuali ada
//   template hari libur (hari 8) dengan kalender itu untuk nakes, section, dan sesi yang sama: template itulah yang
//   dipakai.
// Hanya template, nakes, section, dan sesi yang aktif yang ikut. Jumlah query tetap, berapa pun panjang rentangnya,
// selain satu bacaan per kalender.
export async function generatePracticeSchedule(
    db: Database,
    input: {
        tenantId: string;
        from: string;
        to: string;
        sectionId?: string | null;
    },
): Promise<GenerateResult> {
    checkedRange(input.from, input.to, maxGenerateDays);
    const sectionId = input.sectionId ?? null;
    if (sectionId !== null && !lookupId(sectionId))
        validation({ section_id: 'Pilih section dari daftar.' });
    const sectionFilter = (alias: string) =>
        sectionId ? ` and ${alias}.section_id = $4` : '';
    const bindings = [
        input.tenantId,
        input.from,
        input.to,
        ...(sectionId ? [sectionId] : []),
    ];
    const templates = await db.rows(
        templateSchema,
        `select t.id, t.nakes_id, t.section_id, t.hari, t.sesi_id, to_char(s.jam_mulai, 'HH24:MI') as jam_mulai,
                to_char(s.jam_selesai, 'HH24:MI') as jam_selesai, s.lewat_tengah_malam, t.kapasitas, t.calendar_id,
                t.berlaku_mulai::text as berlaku_mulai, t.berlaku_sampai::text as berlaku_sampai
         from sim_m_jadwal_template t
         join sim_m_sesi_praktik s on s.tenant_id = t.tenant_id and s.id = t.sesi_id and s.deleted_at is null and s.aktif
         join sim_m_nakes n on n.tenant_id = t.tenant_id and n.id = t.nakes_id and n.deleted_at is null and n.aktif
         join sim_m_section c on c.tenant_id = t.tenant_id and c.id = t.section_id and c.deleted_at is null and c.aktif
         where t.tenant_id = $1 and t.deleted_at is null and t.aktif
           and t.berlaku_mulai <= $3::date and (t.berlaku_sampai is null or t.berlaku_sampai >= $2::date)
           ${sectionFilter('t')}
         order by t.id`,
        bindings,
    );
    const closed = await holidays(
        db,
        input.tenantId,
        [
            ...new Set(
                templates.flatMap((template) =>
                    template.calendar_id ? [template.calendar_id] : [],
                ),
            ),
        ],
        input.from,
        input.to,
    );
    const isHoliday = (calendarId: string | null, date: string) =>
        calendarId !== null && (closed.get(calendarId)?.has(date) ?? false);

    const targets = new Map<string, Target>();
    for (let date = input.from; date <= input.to; date = addDays(date, 1)) {
        const valid = templates.filter(
            (template) =>
                template.berlaku_mulai <= date &&
                (template.berlaku_sampai === null ||
                    template.berlaku_sampai >= date),
        );
        const target = (
            template: z.infer<typeof templateSchema>,
            cancelled: boolean,
        ): Target => ({
            nakes_id: template.nakes_id,
            section_id: template.section_id,
            sesi_id: template.sesi_id,
            tanggal: date,
            jam_mulai: template.jam_mulai,
            jam_selesai: template.jam_selesai,
            berakhir_tanggal: template.lewat_tengah_malam
                ? addDays(date, 1)
                : date,
            kapasitas: template.kapasitas,
            template_id: template.id,
            status: cancelled ? 'batal' : 'terjadwal',
            alasan_batal: cancelled ? holidayReason : null,
        });
        for (const template of valid)
            if (template.hari === isoDay(date)) {
                const row = target(
                    template,
                    isHoliday(template.calendar_id, date),
                );
                targets.set(keyOf(row), row);
            }
        for (const template of valid)
            if (
                template.hari === holidayDay &&
                isHoliday(template.calendar_id, date)
            ) {
                const row = target(template, false);
                targets.set(keyOf(row), row);
            }
    }

    return db.transaction(async () => {
        await lockSchedules(db, input.tenantId);
        const stored = await db.rows(
            storedSchema,
            `select j.id, j.nakes_id, j.section_id, j.sesi_id, j.tanggal::text as tanggal,
                    to_char(j.jam_mulai, 'HH24:MI') as jam_mulai, to_char(j.jam_selesai, 'HH24:MI') as jam_selesai,
                    j.berakhir_tanggal::text as berakhir_tanggal, j.kapasitas, j.sumber, j.template_id, j.status,
                    j.alasan_batal, j.jumlah_terdaftar, j.diubah_manual
             from sim_tr_jadwal_praktik j
             where j.tenant_id = $1 and j.deleted_at is null and j.tanggal between $2::date and $3::date
               ${sectionFilter('j')}`,
            bindings,
        );
        const result: GenerateResult = {
            created: 0,
            updated: 0,
            unchanged: 0,
            kept: 0,
            removed: 0,
        };
        const updates: (Target & { id: string })[] = [];
        const removed: string[] = [];
        for (const row of stored) {
            const key = keyOf(row);
            const target = targets.get(key);
            targets.delete(key);
            const untouched =
                row.sumber === 'template' &&
                !row.diubah_manual &&
                row.jumlah_terdaftar === 0;
            if (!untouched) result.kept++;
            else if (!target) removed.push(row.id);
            else if (sameTarget(row, target)) result.unchanged++;
            else updates.push({ ...target, id: row.id });
        }
        const inserts = [...targets.values()].map((target) => ({
            ...target,
            id: Bun.randomUUIDv7(),
        }));
        result.created = inserts.length;
        result.updated = updates.length;
        result.removed = removed.length;
        const stamp = nowSql();
        const columns = `r(id uuid, nakes_id uuid, section_id uuid, sesi_id uuid, tanggal date, jam_mulai time,
                           jam_selesai time, berakhir_tanggal date, kapasitas integer, template_id uuid, status text,
                           alasan_batal text)`;
        if (inserts.length)
            await db.execute(
                `insert into sim_tr_jadwal_praktik (id, tenant_id, tanggal, nakes_id, section_id, sesi_id, jam_mulai,
                                                    jam_selesai, berakhir_tanggal, kapasitas, sumber, template_id,
                                                    status, alasan_batal, created_at, updated_at)
                 select r.id, $1::uuid, r.tanggal, r.nakes_id, r.section_id, r.sesi_id, r.jam_mulai, r.jam_selesai,
                        r.berakhir_tanggal, r.kapasitas, 'template', r.template_id, r.status, r.alasan_batal,
                        $2::timestamp, $2::timestamp
                 from jsonb_to_recordset($3::text::jsonb) as ${columns}`,
                [input.tenantId, stamp, JSON.stringify(inserts)],
            );
        // Syarat "belum disentuh" diulang di sini, supaya baris yang berubah sejak dibaca tetap tidak ditimpa.
        if (updates.length)
            await db.execute(
                `update sim_tr_jadwal_praktik j
                 set jam_mulai = r.jam_mulai, jam_selesai = r.jam_selesai, berakhir_tanggal = r.berakhir_tanggal,
                     kapasitas = r.kapasitas, template_id = r.template_id, status = r.status,
                     alasan_batal = r.alasan_batal, updated_at = $2
                 from jsonb_to_recordset($3::text::jsonb) as ${columns}
                 where j.tenant_id = $1 and j.id = r.id and j.deleted_at is null and j.sumber = 'template'
                   and not j.diubah_manual and j.jumlah_terdaftar = 0`,
                [input.tenantId, stamp, JSON.stringify(updates)],
            );
        if (removed.length)
            await db.execute(
                `update sim_tr_jadwal_praktik set deleted_at = $2, updated_at = $2
                 where tenant_id = $1 and deleted_at is null and sumber = 'template' and not diubah_manual
                   and jumlah_terdaftar = 0
                   and id in (select value::uuid from jsonb_array_elements_text($3::text::jsonb))`,
                [input.tenantId, stamp, JSON.stringify(removed)],
            );
        return result;
    });
}

// Satu angka yang naik setiap kali master yang dibaca generate ditambah atau diubah: jumlah baris ditambah jumlah versi.
// Hapus lunak juga menaikkan versi. Kalender libur tidak ikut; perubahannya sampai pada generate hari berikutnya.
const masterFingerprint = [
    'sim_m_jadwal_template',
    'sim_m_sesi_praktik',
    'sim_m_nakes',
    'sim_m_section',
]
    .map(
        (table) =>
            `(select count(*) + coalesce(sum(version), 0) from ${table} where tenant_id = $1)`,
    )
    .join(' + ');

// Generate otomatis dari parameter jadwal, dijalankan saat jadwal dibaca karena repo ini belum punya penjadwal per
// tenant. Rentangnya hari ini (zona waktu legal entity aktif, UTC bila tidak ada) sampai horizon. Dilewati bila
// setelannya mati, atau bila rentang itu sudah digenerate dan master belum berubah sejak itu, sehingga pada hari yang
// sama generate hanya berjalan lagi setelah template, sesi, nakes, atau section berubah.
export async function ensurePracticeSchedule(
    db: Database,
    input: { tenantId: string; legalEntityId: string | null },
): Promise<void> {
    const state = await db.one(
        z.object({
            today: z.string(),
            enabled: z.boolean().nullable(),
            horizon_days: z.number().nullable(),
            generated_until: z.string().nullable(),
            generated_fingerprint: z.string().nullable(),
            fingerprint: z.string(),
        }),
        `select (now() at time zone coalesce(l.timezone, 'UTC'))::date::text as today,
                p.generate_otomatis as enabled, p.horizon_hari as horizon_days,
                g.tanggal_sampai::text as generated_until, g.sidik_master::text as generated_fingerprint,
                (${masterFingerprint})::text as fingerprint
         from (select 1) one
         left join legal_entities l on l.tenant_id = $1 and l.organization_id = $2
         left join sim_m_parameter_jadwal p on p.tenant_id = $1
         left join sim_tr_jadwal_generate g on g.tenant_id = $1`,
        [input.tenantId, input.legalEntityId],
    );
    if (!state || !(state.enabled ?? defaultAutoGenerate)) return;
    const to = addDays(
        state.today,
        (state.horizon_days ?? defaultHorizonDays) - 1,
    );
    if (
        state.generated_until !== null &&
        state.generated_until >= to &&
        state.generated_fingerprint === state.fingerprint
    )
        return;
    await generatePracticeSchedule(db, {
        tenantId: input.tenantId,
        from: state.today,
        to,
    });
    await db.execute(
        `insert into sim_tr_jadwal_generate (tenant_id, tanggal_sampai, sidik_master, updated_at)
         values ($1, $2::date, $3::bigint, $4)
         on conflict (tenant_id) do update
         set tanggal_sampai = excluded.tanggal_sampai, sidik_master = excluded.sidik_master,
             updated_at = excluded.updated_at`,
        [input.tenantId, to, state.fingerprint, nowSql()],
    );
}

const practitionerName = (alias: string) =>
    `(select p.name from sim_m_nakes n join parties p on p.tenant_id = n.tenant_id and p.id = n.party_id
      where n.tenant_id = j.tenant_id and n.id = ${alias})`;

const rowSql = `select j.id, j.tanggal::text as date, j.berakhir_tanggal::text as ends_on, j.nakes_id as practitioner_id,
                       ${practitionerName('j.nakes_id')} as practitioner_name,
                       j.nakes_pengganti_id as substitute_practitioner_id,
                       ${practitionerName('j.nakes_pengganti_id')} as substitute_practitioner_name,
                       j.section_id, j.sesi_id as session_id, s.nama as session_name,
                       to_char(j.jam_mulai, 'HH24:MI') as start_time, to_char(j.jam_selesai, 'HH24:MI') as end_time,
                       j.kapasitas as capacity, j.jumlah_terdaftar as registered, j.sumber as source, j.template_id,
                       j.status, j.alasan_batal as cancel_reason, j.diubah_manual as manually_changed, j.version
                from sim_tr_jadwal_praktik j
                join sim_m_sesi_praktik s on s.tenant_id = j.tenant_id and s.id = j.sesi_id
                where j.tenant_id = $1 and j.deleted_at is null`;

// Jadwal yang ditawarkan pendaftaran kunjungan untuk satu section pada satu tanggal: baris terjadwal di section aktif,
// dengan nakes yang benar-benar praktik, yaitu pengganti bila ada, dan nakes itu masih aktif. `full` menandai jadwal
// yang kapasitasnya sudah habis; jadwal tanpa kapasitas tidak pernah penuh.
export async function schedulesForRegistration(
    db: Database,
    input: { tenantId: string; sectionId: string; date: string },
): Promise<RegistrationSchedule[]> {
    if (!lookupId(input.sectionId) || !dateSchema.safeParse(input.date).success)
        return [];
    return db.rows(
        registrationScheduleSchema,
        `select j.id, j.tanggal::text as date, j.berakhir_tanggal::text as ends_on, n.id as practitioner_id,
                p.name as practitioner_name, j.nakes_id as scheduled_practitioner_id,
                j.nakes_pengganti_id is not null as is_substitute, j.sesi_id as session_id, s.nama as session_name,
                to_char(j.jam_mulai, 'HH24:MI') as start_time, to_char(j.jam_selesai, 'HH24:MI') as end_time,
                j.kapasitas as capacity, j.jumlah_terdaftar as registered,
                coalesce(j.jumlah_terdaftar >= j.kapasitas, false) as full
         from sim_tr_jadwal_praktik j
         join sim_m_section c on c.tenant_id = j.tenant_id and c.id = j.section_id and c.deleted_at is null and c.aktif
         join sim_m_nakes n on n.tenant_id = j.tenant_id and n.id = coalesce(j.nakes_pengganti_id, j.nakes_id)
              and n.deleted_at is null and n.aktif
         join parties p on p.tenant_id = n.tenant_id and p.id = n.party_id
         join sim_m_sesi_praktik s on s.tenant_id = j.tenant_id and s.id = j.sesi_id
         where j.tenant_id = $1 and j.section_id = $2 and j.tanggal = $3::date and j.deleted_at is null
           and j.status = 'terjadwal'
         order by j.jam_mulai, p.name`,
        [input.tenantId, input.sectionId, input.date],
    );
}

const optional = (value: string | null | undefined) => value?.trim() || null;

// Jadwal bertanggal per section: dibaca per minggu di layar, ditambah manual, dan diubah satu per satu. Setiap
// perubahan menandai baris diubah manual, sehingga generate berikutnya tidak menimpanya.
export class PracticeSchedules {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(parameters: URLSearchParams) {
        this.workspace.guard('practice-schedule', 'read');
        const from = parameters.get('from') ?? '';
        const to = parameters.get('to') ?? '';
        checkedRange(from, to, maxReadDays);
        const sectionId = lookupId(parameters.get('section_id') ?? '');
        if (!sectionId) return { data: [] };
        await ensurePracticeSchedule(this.db, {
            tenantId: this.workspace.tenantId,
            legalEntityId: this.workspace.legalEntityId,
        });
        return {
            data: await this.db.rows(
                practiceScheduleRowSchema,
                `${rowSql} and j.section_id = $2 and j.tanggal between $3::date and $4::date
                 order by j.tanggal, j.jam_mulai, practitioner_name`,
                [this.workspace.tenantId, sectionId, from, to],
            ),
        };
    }

    private async row(id: string) {
        const row = lookupId(id)
            ? await this.db.one(
                  practiceScheduleRowSchema,
                  `${rowSql} and j.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!row) abort(404, 'Not Found');
        return row;
    }

    async generate(body: unknown) {
        this.workspace.guard('practice-schedule', 'create');
        this.workspace.guard('practice-schedule', 'update');
        const parsed = generateInputSchema.safeParse(body);
        if (!parsed.success)
            validation({ from: 'Isi tanggal mulai dan selesai.' });
        const result = await generatePracticeSchedule(this.db, {
            tenantId: this.workspace.tenantId,
            from: parsed.data.from,
            to: parsed.data.to,
            sectionId: parsed.data.section_id || null,
        });
        return { status: 200, headers: {}, body: { data: result } };
    }

    // Jadwal di luar template, misalnya praktik tambahan satu hari. Jam disalin dari sesinya.
    async create(body: unknown) {
        this.workspace.guard('practice-schedule', 'create');
        const parsed = practiceScheduleInputSchema.safeParse(body);
        if (!parsed.success)
            validation({ section_id: 'Isian jadwal tidak lengkap.' });
        const data = parsed.data;
        const capacity = data.capacity ?? null;
        const errors: Record<string, string> = {};
        if (!dateSchema.safeParse(data.date).success)
            errors.date = 'Isi tanggal praktik.';
        const capacityProblem = capacityError(capacity);
        if (capacityProblem) errors.capacity = capacityProblem;
        if (Object.keys(errors).length) validation(errors);
        const tenantId = this.workspace.tenantId;
        await activeSection(this.db, tenantId, data.section_id);
        await activePractitioner(
            this.db,
            tenantId,
            data.practitioner_id,
            'practitioner_id',
        );
        await activeSession(this.db, tenantId, data.session_id);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.transaction(async () => {
                await lockSchedules(this.db, tenantId);
                await this.db.execute(
                    `insert into sim_tr_jadwal_praktik (id, tenant_id, tanggal, nakes_id, section_id, sesi_id, jam_mulai,
                                                        jam_selesai, berakhir_tanggal, kapasitas, sumber, status,
                                                        created_at, updated_at)
                     select $1::uuid, $2::uuid, $3::date, $4::uuid, $5::uuid, s.id, s.jam_mulai, s.jam_selesai,
                            $3::date + (case when s.lewat_tengah_malam then 1 else 0 end), $6::integer, 'manual',
                            'terjadwal', $7::timestamp, $7::timestamp
                     from sim_m_sesi_praktik s where s.tenant_id = $2::uuid and s.id = $8::uuid`,
                    [
                        id,
                        tenantId,
                        data.date,
                        data.practitioner_id,
                        data.section_id,
                        capacity,
                        stamp,
                        data.session_id,
                    ],
                );
            });
        } catch (error) {
            if (
                sqlErrorCode(error) === '23505' &&
                error instanceof Error &&
                error.message.includes('sim_tr_jadwal_praktik_unique')
            )
                validation({
                    session_id:
                        'Nakes ini sudah punya jadwal di sesi itu pada tanggal tersebut. Ubah jadwal yang ada.',
                });
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    // Batalkan atau jadwalkan lagi, ganti nakes, dan ubah kapasitas. Batal tidak menghapus baris.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('practice-schedule', 'update');
        const current = await this.row(id);
        const parsed = practiceScheduleChangeSchema.safeParse(body);
        if (!parsed.success) validation({ status: 'Isian jadwal tidak sah.' });
        const change = parsed.data;
        const errors: Record<string, string> = {};
        const status = change.status ?? current.status;
        const reason =
            status === 'batal'
                ? change.cancel_reason === undefined
                    ? current.cancel_reason
                    : optional(change.cancel_reason)
                : null;
        if (status === 'batal' && !reason)
            errors.cancel_reason = 'Isi alasan pembatalan.';
        else if (reason && reason.length > 200)
            errors.cancel_reason = 'Paling panjang 200 karakter.';
        const capacity =
            change.capacity === undefined ? current.capacity : change.capacity;
        const capacityProblem = capacityError(capacity);
        if (capacityProblem) errors.capacity = capacityProblem;
        else if (capacity !== null && capacity < current.registered)
            errors.capacity = `Sudah ada ${current.registered} pasien terdaftar. Kapasitas tidak boleh lebih kecil.`;
        let substitute =
            change.substitute_practitioner_id === undefined
                ? current.substitute_practitioner_id
                : change.substitute_practitioner_id || null;
        if (substitute === current.practitioner_id) substitute = null;
        if (Object.keys(errors).length) validation(errors);
        if (
            substitute !== null &&
            substitute !== current.substitute_practitioner_id
        )
            await activePractitioner(
                this.db,
                this.workspace.tenantId,
                substitute,
                'substitute_practitioner_id',
            );
        const updated = await this.db.execute(
            `update sim_tr_jadwal_praktik set status = $1, alasan_batal = $2, kapasitas = $3, nakes_pengganti_id = $4,
                    diubah_manual = true, updated_at = $5
             where tenant_id = $6 and id = $7 and version = $8 and deleted_at is null`,
            [
                status,
                reason,
                capacity,
                substitute,
                nowSql(),
                this.workspace.tenantId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }
}
