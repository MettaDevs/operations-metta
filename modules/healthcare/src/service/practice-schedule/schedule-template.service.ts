import { z } from 'zod';
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
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import {
    schedulePractitionerSchema,
    scheduleTemplateInputSchema,
    scheduleTemplateRowSchema,
} from './practice-schedule.schema.ts';
import { holidayDay } from './practice-schedule.days.ts';

const rowSql = `select t.id, t.nakes_id as practitioner_id, p.name as practitioner_name, t.section_id, t.hari as day,
                       t.sesi_id as session_id, s.nama as session_name, to_char(s.jam_mulai, 'HH24:MI') as start_time,
                       to_char(s.jam_selesai, 'HH24:MI') as end_time, s.lewat_tengah_malam as crosses_midnight,
                       t.kapasitas as capacity, t.calendar_id, c.name as calendar_name,
                       t.berlaku_mulai::text as valid_from, t.berlaku_sampai::text as valid_to, t.aktif as is_active,
                       t.version
                from sim_m_jadwal_template t
                join sim_m_nakes n on n.tenant_id = t.tenant_id and n.id = t.nakes_id
                join parties p on p.tenant_id = n.tenant_id and p.id = n.party_id
                join sim_m_sesi_praktik s on s.tenant_id = t.tenant_id and s.id = t.sesi_id
                left join working_time_calendars c on c.tenant_id = t.tenant_id and c.id = t.calendar_id
                     and c.deleted_at is null
                where t.tenant_id = $1 and t.deleted_at is null`;

const found = z.object({ id: z.string() });

// Pilihan layar jadwal praktik: section aktif beserta unitnya, sesi, kalender Core, dan izin. Section dan kalender
// dibaca langsung karena daftarnya dijaga izin lain yang tidak dipegang penyusun jadwal. Jumlahnya kecil per tenant.
export async function practiceScheduleMetadata(
    db: Database,
    workspace: Workspace,
) {
    workspace.guard('practice-schedule', 'read');
    const tenant = [workspace.tenantId];
    return {
        sections: await db.rows(
            z.object({
                id: z.string(),
                name: z.string(),
                operating_unit_name: z.string(),
            }),
            `select s.id, s.nama as name, o.name as operating_unit_name from sim_m_section s
             join organizations o on o.tenant_id = s.tenant_id and o.id = s.operating_unit_id
             where s.tenant_id = $1 and s.deleted_at is null and s.aktif order by o.name, s.nama`,
            tenant,
        ),
        sessions: await db.rows(
            z.object({
                id: z.string(),
                name: z.string(),
                start_time: z.string(),
                end_time: z.string(),
                is_active: z.boolean(),
            }),
            `select id, nama as name, to_char(jam_mulai, 'HH24:MI') as start_time,
                    to_char(jam_selesai, 'HH24:MI') as end_time, aktif as is_active
             from sim_m_sesi_praktik where tenant_id = $1 and deleted_at is null order by jam_mulai, nama`,
            tenant,
        ),
        calendars: await db.rows(
            z.object({ id: z.string(), code: z.string(), name: z.string() }),
            `select id, code, name from working_time_calendars
             where tenant_id = $1 and deleted_at is null order by code`,
            tenant,
        ),
        permissions: {
            create: workspace.permissions.has(
                'healthcare.practice-schedule.create',
            ),
            update: workspace.permissions.has(
                'healthcare.practice-schedule.update',
            ),
            delete: workspace.permissions.has(
                'healthcare.practice-schedule.delete',
            ),
        },
    };
}

// Nakes aktif untuk pemilih di template dan jadwal, dibaca dengan izin jadwal praktik, bukan izin master nakes.
export async function schedulePractitioners(
    db: Database,
    workspace: Workspace,
    parameters: URLSearchParams,
) {
    workspace.guard('practice-schedule', 'read');
    const batch = await incrementalList(db, {
        query: `select * from (
                    select n.id, p.name, pr.nama as profession from sim_m_nakes n
                    join parties p on p.tenant_id = n.tenant_id and p.id = n.party_id
                    join sim_m_profesi pr on pr.tenant_id = n.tenant_id and pr.id = n.profesi_id
                    where n.tenant_id = $1 and n.deleted_at is null and n.aktif) practitioners
                where true`,
        bindings: [workspace.tenantId],
        parameters,
        columns: { name: 'name' },
        searchColumns: ['name'],
        numericColumns: [],
        defaultSort: 'name',
        defaultDirection: 'asc',
    });
    return {
        data: batch.data.map((row) => schedulePractitionerSchema.parse(row)),
        next_cursor: batch.next_cursor,
    };
}

// Nakes aktif milik tenant, atau kesalahan validasi pada field yang disebut.
export async function activePractitioner(
    db: Database,
    tenantId: string,
    id: string,
    field: string,
): Promise<string> {
    const row = lookupId(id)
        ? await db.one(
              found,
              'select id from sim_m_nakes where tenant_id = $1 and id = $2 and deleted_at is null and aktif',
              [tenantId, id],
          )
        : undefined;
    if (!row) validation({ [field]: 'Pilih nakes aktif dari daftar.' });
    return row.id;
}

// Section aktif di unit yang masih aktif.
export async function activeSection(
    db: Database,
    tenantId: string,
    id: string,
): Promise<string> {
    const row = lookupId(id)
        ? await db.one(
              found,
              `select s.id from sim_m_section s
               join organizations o on o.tenant_id = s.tenant_id and o.id = s.operating_unit_id and o.status = 'active'
               where s.tenant_id = $1 and s.id = $2 and s.deleted_at is null and s.aktif`,
              [tenantId, id],
          )
        : undefined;
    if (!row) validation({ section_id: 'Pilih section aktif dari daftar.' });
    return row.id;
}

export async function activeSession(
    db: Database,
    tenantId: string,
    id: string,
): Promise<string> {
    const row = lookupId(id)
        ? await db.one(
              found,
              'select id from sim_m_sesi_praktik where tenant_id = $1 and id = $2 and deleted_at is null and aktif',
              [tenantId, id],
          )
        : undefined;
    if (!row) validation({ session_id: 'Pilih sesi aktif dari daftar.' });
    return row.id;
}

// Kapasitas kosong berarti tanpa batas; angka yang diisi bilangan bulat paling kecil 1.
export function capacityError(capacity: number | null): string | null {
    if (capacity === null) return null;
    return Number.isInteger(capacity) && capacity >= 1 && capacity <= 10000
        ? null
        : 'Isi kapasitas 1 sampai 10.000, atau kosongkan bila tanpa batas.';
}

function checked(body: unknown) {
    const parsed = scheduleTemplateInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const capacity = data?.capacity ?? null;
    const calendarId = data?.calendar_id || null;
    const validTo = data?.valid_to || null;
    if (!data) validation({ section_id: 'Isian template tidak lengkap.' });
    if (!Number.isInteger(data.day) || data.day < 1 || data.day > holidayDay)
        errors.day = 'Pilih hari dari daftar.';
    else if (data.day === holidayDay && !calendarId)
        errors.calendar_id =
            'Template hari libur butuh kalender, supaya tahu tanggal mana yang libur.';
    const capacityProblem = capacityError(capacity);
    if (capacityProblem) errors.capacity = capacityProblem;
    if (!dateSchema.safeParse(data.valid_from).success)
        errors.valid_from = 'Isi tanggal mulai berlaku.';
    if (validTo !== null && !dateSchema.safeParse(validTo).success)
        errors.valid_to = 'Tanggal akhir berlaku tidak sah.';
    else if (validTo !== null && validTo < data.valid_from)
        errors.valid_to = 'Tanggal akhir tidak boleh sebelum tanggal mulai.';
    if (Object.keys(errors).length) validation(errors);
    return {
        practitionerId: data.practitioner_id,
        sectionId: data.section_id,
        day: data.day,
        sessionId: data.session_id,
        capacity,
        calendarId,
        validFrom: data.valid_from,
        validTo,
        isActive: data.is_active ?? true,
    };
}

function duplicate(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_jadwal_template_unique')
    )
        validation({
            session_id:
                'Nakes ini sudah punya template aktif di section, hari, dan sesi yang sama.',
        });
}

// Template jadwal mingguan per section. Mengubahnya tidak langsung mengubah jadwal bertanggal; "Generate jadwal"
// berikutnya membawa perubahan ke hari yang belum disentuh.
export class ScheduleTemplates {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Semua template satu section. Satu section paling banyak memuat beberapa puluh baris, seperti satu dokumen.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('practice-schedule', 'read');
        const sectionId = lookupId(parameters.get('section_id') ?? '');
        if (!sectionId) return { data: [] };
        return {
            data: await this.db.rows(
                scheduleTemplateRowSchema,
                `${rowSql} and t.section_id = $2 order by t.hari, s.jam_mulai, p.name limit 500`,
                [this.workspace.tenantId, sectionId],
            ),
        };
    }

    private async row(id: string) {
        const row = lookupId(id)
            ? await this.db.one(
                  scheduleTemplateRowSchema,
                  `${rowSql} and t.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!row) abort(404, 'Not Found');
        return row;
    }

    private async references(data: ReturnType<typeof checked>) {
        const tenantId = this.workspace.tenantId;
        await activeSection(this.db, tenantId, data.sectionId);
        await activePractitioner(
            this.db,
            tenantId,
            data.practitionerId,
            'practitioner_id',
        );
        await activeSession(this.db, tenantId, data.sessionId);
        if (data.calendarId) {
            const calendar = lookupId(data.calendarId)
                ? await this.db.one(
                      found,
                      'select id from working_time_calendars where tenant_id = $1 and id = $2 and deleted_at is null',
                      [tenantId, data.calendarId],
                  )
                : undefined;
            if (!calendar)
                validation({ calendar_id: 'Pilih kalender dari daftar.' });
        }
    }

    async create(body: unknown) {
        this.workspace.guard('practice-schedule', 'create');
        const data = checked(body);
        await this.references(data);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('sim_m_jadwal_template', {
                id,
                tenant_id: this.workspace.tenantId,
                nakes_id: data.practitionerId,
                section_id: data.sectionId,
                hari: data.day,
                sesi_id: data.sessionId,
                kapasitas: data.capacity,
                calendar_id: data.calendarId,
                berlaku_mulai: data.validFrom,
                berlaku_sampai: data.validTo,
                aktif: data.isActive,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            duplicate(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('practice-schedule', 'update');
        const current = await this.row(id);
        const data = checked(body);
        await this.references(data);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update sim_m_jadwal_template set nakes_id = $1, section_id = $2, hari = $3, sesi_id = $4, kapasitas = $5,
                        calendar_id = $6, berlaku_mulai = $7, berlaku_sampai = $8, aktif = $9, updated_at = $10
                 where tenant_id = $11 and id = $12 and version = $13 and deleted_at is null`,
                [
                    data.practitionerId,
                    data.sectionId,
                    data.day,
                    data.sessionId,
                    data.capacity,
                    data.calendarId,
                    data.validFrom,
                    data.validTo,
                    data.isActive,
                    nowSql(),
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            duplicate(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('practice-schedule', 'delete');
        const current = await this.row(id);
        const stamp = nowSql();
        const deleted = await this.db.execute(
            'update sim_m_jadwal_template set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
            [
                stamp,
                this.workspace.tenantId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
