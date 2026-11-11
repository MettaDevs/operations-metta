import { z } from 'zod';
import type { Workspace } from '../../platform/access/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Bind,
    type Database,
} from '../../platform/database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../../platform/http/index.ts';
import {
    workingTimeTemplateInputSchema,
    workingTimeTemplateRowSchema,
    type WorkingTimeInterval,
} from './calendar.schema.ts';
import {
    intervalsKey,
    normalizeIntervals,
    type NormalizedInterval,
} from './working-times.service.ts';

const rowSql = `select * from (
    select t.id, t.code, t.name, t.version,
           coalesce((select json_agg(json_build_object('day_of_week', l.day_of_week,
                                                       'from', to_char(l.from_time, 'HH24:MI'),
                                                       'to', to_char(l.to_time, 'HH24:MI'),
                                                       'ends_next_day', l.ends_next_day)
                                     order by l.day_of_week, l.from_time)
                     from working_time_lines l
                     where l.tenant_id = t.tenant_id and l.working_time_template_id = t.id and l.deleted_at is null
                       and l.from_time is not null and l.to_time is not null),
                    '[]'::json) as lines
    from working_time_templates t
    where t.tenant_id = $1 and t.deleted_at is null) templates
    where true`;

type Line = NormalizedInterval & { day_of_week: number };
type Input = { code: string; name: string; lines: Line[] };

// Template jam kerja (Sys Admin → Kalender → Template jam kerja), pola "Working time templates" F&O: rentang jam kerja
// untuk setiap hari dalam seminggu, dipakai "Susun jam kerja" pada kalender. Hari tanpa rentang berarti tutup.
// Kalender tidak merujuk template; hasil penyusunan tetap ada walau templatenya diubah atau dihapus.
export class WorkingTimeTemplates {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(parameters: URLSearchParams) {
        this.workspace.guard('calendar', 'read');
        const batch = await incrementalList(this.db, {
            query: rowSql,
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { code: 'code', name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) =>
                workingTimeTemplateRowSchema.parse(row),
            ),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has('core.calendar.update'),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  workingTimeTemplateRowSchema,
                  `${rowSql} and templates.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Template jam kerja tidak ditemukan.');
        return found;
    }

    private checked(body: unknown): Input {
        const parsed = workingTimeTemplateInputSchema.safeParse(body);
        const data = parsed.success ? parsed.data : null;
        const errors: Record<string, string> = {};
        const code = data?.code.trim().toUpperCase() ?? '';
        if (!code) errors.code = 'Isi kode template.';
        else if (code.length > 50)
            errors.code = 'Kode template paling banyak 50 karakter.';
        const name = data?.name.trim() ?? '';
        if (!name) errors.name = 'Isi nama template.';
        else if (name.length > 150)
            errors.name = 'Nama template paling banyak 150 karakter.';
        const lines = (data?.lines ?? []).map((line, index) => ({
            ...line,
            index,
        }));
        const normalized: Line[] = [];
        for (const line of lines)
            if (
                !Number.isInteger(line.day_of_week) ||
                line.day_of_week < 0 ||
                line.day_of_week > 6
            )
                errors[`lines.${line.index}.day_of_week`] =
                    'Pilih hari dari daftar.';
        for (let day = 0; day < 7; day++)
            normalized.push(
                ...normalizeIntervals(
                    lines.filter((line) => line.day_of_week === day),
                    'lines',
                    errors,
                ).map((line) => ({ ...line, day_of_week: day })),
            );
        if (Object.keys(errors).length || !data) validation(errors);
        return { code, name, lines: normalized };
    }

    private async writeLines(templateId: string, lines: Line[]) {
        const current = await this.db.rows(
            z.object({
                day_of_week: z.number(),
                from: z.string(),
                to: z.string(),
                ends_next_day: z.boolean(),
            }),
            `select day_of_week, to_char(from_time, 'HH24:MI') as "from", to_char(to_time, 'HH24:MI') as "to",
                    ends_next_day
             from working_time_lines
             where tenant_id = $1 and working_time_template_id = $2 and deleted_at is null`,
            [this.workspace.tenantId, templateId],
        );
        const key = (rows: (WorkingTimeInterval & { day_of_week: number })[]) =>
            [0, 1, 2, 3, 4, 5, 6]
                .map((day) =>
                    intervalsKey(rows.filter((row) => row.day_of_week === day)),
                )
                .join('|');
        if (key(current) === key(lines)) return;
        const stamp = nowSql();
        await this.db.execute(
            'update working_time_lines set deleted_at = $1, updated_at = $1 where tenant_id = $2 and working_time_template_id = $3 and deleted_at is null',
            [stamp, this.workspace.tenantId, templateId],
        );
        if (!lines.length) return;
        await this.db.execute(
            `insert into working_time_lines (id, tenant_id, working_time_template_id, day_of_week, from_time, to_time,
                                             ends_next_day, hours, created_at, updated_at)
             select r.id, $1::uuid, $2::uuid, r.day_of_week, r.from_time::time, r.to_time::time, r.ends_next_day,
                    r.hours, $3::timestamp, $3::timestamp
             from jsonb_to_recordset($4::text::jsonb)
                  as r(id uuid, day_of_week smallint, from_time text, to_time text, ends_next_day boolean, hours numeric)`,
            [
                this.workspace.tenantId,
                templateId,
                stamp,
                JSON.stringify(
                    lines.map((line) => ({
                        id: Bun.randomUUIDv7(),
                        day_of_week: line.day_of_week,
                        from_time: line.from,
                        to_time: line.to,
                        ends_next_day: line.ends_next_day,
                        hours: line.hours,
                    })),
                ),
            ],
        );
    }

    async create(body: unknown) {
        this.workspace.guard('calendar', 'update');
        const input = this.checked(body);
        const id = Bun.randomUUIDv7();
        try {
            await this.db.transaction(async () => {
                const stamp = nowSql();
                await this.db.insert('working_time_templates', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    code: input.code,
                    name: input.name,
                    created_at: stamp,
                    updated_at: stamp,
                });
                await this.writeLines(id, input.lines);
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('calendar', 'update');
        const current = await this.row(id);
        const input = this.checked(body);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                // Baris template selalu diperbarui, supaya versinya naik juga saat yang berubah hanya jam kerjanya.
                updated = await this.db.execute(
                    `update working_time_templates set code = $1, name = $2, updated_at = $3
                     where tenant_id = $4 and id = $5 and version = $6 and deleted_at is null`,
                    [
                        input.code,
                        input.name,
                        nowSql(),
                        this.workspace.tenantId,
                        current.id,
                        version,
                    ],
                );
                if (updated) await this.writeLines(current.id, input.lines);
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Menghapus mengisi deleted_at pada template dan jam kerjanya. Jam kerja yang sudah disusun ke kalender tidak berubah.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('calendar', 'update');
        const current = await this.row(id);
        const stamp = nowSql();
        let deleted = 0;
        const bindings: Bind[] = [stamp, this.workspace.tenantId, current.id];
        await this.db.transaction(async () => {
            deleted = await this.db.execute(
                'update working_time_templates set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
                [...bindings, expectedVersion(request, body)],
            );
            if (deleted)
                await this.db.execute(
                    'update working_time_lines set deleted_at = $1, updated_at = $1 where tenant_id = $2 and working_time_template_id = $3 and deleted_at is null',
                    bindings,
                );
        });
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('working_time_templates_code_unique')
    )
        validation({ code: 'Kode ini sudah dipakai template lain.' });
}
