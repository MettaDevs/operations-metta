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
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import {
    practiceSessionInputSchema,
    practiceSessionRowSchema,
} from './practice-schedule.schema.ts';

const rowSql = `select * from (
                    select s.id, s.nama as name, to_char(s.jam_mulai, 'HH24:MI') as start_time,
                           to_char(s.jam_selesai, 'HH24:MI') as end_time, s.lewat_tengah_malam as crosses_midnight,
                           s.aktif as is_active, s.version
                    from sim_m_sesi_praktik s
                    where s.tenant_id = $1 and s.deleted_at is null) sessions
                where true`;

export const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function checked(body: unknown) {
    const parsed = practiceSessionInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const name = data?.name.trim() ?? '';
    if (!name) errors.name = 'Isi nama sesi.';
    else if (name.length > 50) errors.name = 'Paling panjang 50 karakter.';
    if (!timePattern.test(data?.start_time ?? ''))
        errors.start_time = 'Jam mulai ditulis JJ:MM, misalnya 08:00.';
    if (!timePattern.test(data?.end_time ?? ''))
        errors.end_time = 'Jam selesai ditulis JJ:MM, misalnya 12:00.';
    if (Object.keys(errors).length || !data) validation(errors);
    return {
        name,
        startTime: data.start_time,
        endTime: data.end_time,
        isActive: data.is_active ?? true,
    };
}

function nameTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_sesi_praktik_nama_unique')
    )
        validation({ name: 'Nama ini sudah dipakai sesi lain.' });
}

// Sesi praktik tenant. Jam yang selesai pada atau sebelum jam mulai berarti sesi selesai besok, misalnya jaga malam
// 20:00-08:00. Jadwal bertanggal menyalin jamnya, jadi mengubah sesi tidak mengubah jadwal yang sudah dipakai.
export class PracticeSessions {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(parameters: URLSearchParams) {
        this.workspace.guard('practice-schedule', 'read');
        const bindings: (string | boolean)[] = [this.workspace.tenantId];
        const status = parameters.get('status');
        const filter =
            status === 'active' || status === 'inactive'
                ? ` and is_active = $${bindings.push(status === 'active')}`
                : '';
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: { name: 'name', start_time: 'start_time' },
            searchColumns: ['name'],
            numericColumns: [],
            defaultSort: 'start_time',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => practiceSessionRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  practiceSessionRowSchema,
                  `${rowSql} and sessions.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('practice-schedule', 'create');
        const data = checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('sim_m_sesi_praktik', {
                id,
                tenant_id: this.workspace.tenantId,
                nama: data.name,
                jam_mulai: data.startTime,
                jam_selesai: data.endTime,
                aktif: data.isActive,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            nameTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('practice-schedule', 'update');
        const current = await this.row(id);
        const data = checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update sim_m_sesi_praktik set nama = $1, jam_mulai = $2, jam_selesai = $3, aktif = $4, updated_at = $5
                 where tenant_id = $6 and id = $7 and version = $8 and deleted_at is null`,
                [
                    data.name,
                    data.startTime,
                    data.endTime,
                    data.isActive,
                    nowSql(),
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            nameTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Sesi yang masih dipakai template tidak bisa dihapus; nonaktifkan atau lepas dari templatenya dulu.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('practice-schedule', 'delete');
        const current = await this.row(id);
        const used = await this.db.one(
            z.object({ found: z.boolean() }),
            'select true as found from sim_m_jadwal_template where tenant_id = $1 and sesi_id = $2 and deleted_at is null limit 1',
            [this.workspace.tenantId, current.id],
        );
        if (used)
            validation({
                id: 'Sesi ini masih dipakai template jadwal. Hapus atau ganti sesinya di template lebih dulu.',
            });
        const stamp = nowSql();
        const deleted = await this.db.execute(
            'update sim_m_sesi_praktik set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
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
