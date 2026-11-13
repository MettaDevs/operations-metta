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
    specialtyInputSchema,
    specialtyRowSchema,
} from './specialty.schema.ts';

type Specialty = z.infer<typeof specialtyRowSchema>;
type Line = { id: string | null; name: string };

const rowSql = `select * from (
                    select s.id, s.nama as name,
                           coalesce((select json_agg(json_build_object('id', b.id, 'name', b.nama)
                                                     order by b.created_at, b.id)
                                     from sim_m_sub_spesialisasi b
                                     where b.tenant_id = s.tenant_id and b.spesialisasi_id = s.id
                                       and b.deleted_at is null),
                                    '[]'::json) as subspecialties,
                           s.version
                    from sim_m_spesialisasi s
                    where s.tenant_id = $1 and s.deleted_at is null) specialties
                where true`;

function taken(error: unknown): void {
    if (sqlErrorCode(error) !== '23505' || !(error instanceof Error)) return;
    if (error.message.includes('sim_m_spesialisasi_nama_unique'))
        validation({ name: 'Nama ini sudah dipakai spesialis lain.' });
    if (error.message.includes('sim_m_sub_spesialisasi_nama_unique'))
        validation({
            subspecialties: 'Nama sub spesialis sudah dipakai baris lain.',
        });
}

// Spesialis milik tenant, diisi admin di Setup → Tenaga kesehatan. Nama spesialis unik per tenant dan nama sub spesialis
// unik di spesialisnya, karena tarif kelak mencocokkan spesialis dokter dengan baris tarif seperti sistem lama
// mencocokkan namanya.
export class Specialties {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    metadata() {
        this.workspace.guard('specialty', 'read');
        const has = (action: string) =>
            this.workspace.permissions.has(`healthcare.specialty.${action}`);
        return {
            permissions: {
                create: has('create'),
                update: has('update'),
                delete: has('delete'),
            },
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('specialty', 'read');
        const batch = await incrementalList(this.db, {
            query: rowSql,
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { name: 'name' },
            searchColumns: ['name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => specialtyRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  specialtyRowSchema,
                  `${rowSql} and specialties.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Sub spesialis yang dibuang dari kartu tidak boleh masih dipegang nakes, supaya nakes tidak menunjuk baris terhapus.
    private async checked(body: unknown, current: Specialty | null) {
        const parsed = specialtyInputSchema.safeParse(body);
        const errors: Record<string, string> = {};
        const data = parsed.success ? parsed.data : null;
        const name = data?.name.trim() ?? '';
        if (!name) errors.name = 'Isi nama spesialis.';
        else if (name.length > 200)
            errors.name = 'Paling panjang 200 karakter.';
        const lines: Line[] | null =
            data?.subspecialties?.map((line) => ({
                id: line.id?.trim() || null,
                name: line.name.trim(),
            })) ?? null;
        const held = new Set(
            (current?.subspecialties ?? []).map((line) => line.id),
        );
        const seen = new Set<string>();
        lines?.forEach((line, index) => {
            const field = `subspecialties.${index}.name`;
            if (!line.name) errors[field] = 'Isi nama sub spesialis.';
            else if (line.name.length > 200)
                errors[field] = 'Paling panjang 200 karakter.';
            else if (seen.has(line.name.toLowerCase()))
                errors[field] = 'Nama ini sudah ada di baris lain.';
            else if (line.id !== null && !held.has(line.id))
                errors[field] =
                    'Baris ini tidak ada di spesialis ini. Muat ulang kartu.';
            seen.add(line.name.toLowerCase());
        });
        const removed =
            lines === null
                ? []
                : [...held].filter(
                      (id) => !lines.some((line) => line.id === id),
                  );
        if (removed.length) {
            const used = await this.db.rows(
                z.object({ name: z.string() }),
                `select b.nama as name from sim_m_sub_spesialisasi b
                 where b.tenant_id = $1 and b.id = any($2::uuid[])
                   and exists (select 1 from sim_m_nakes n where n.tenant_id = b.tenant_id
                               and n.sub_spesialisasi_id = b.id and n.deleted_at is null)
                 order by b.nama`,
                [this.workspace.tenantId, `{${removed.join(',')}}`],
            );
            if (used.length)
                errors.subspecialties = `Sub spesialis ${used.map((row) => row.name).join(', ')} masih dipakai tenaga kesehatan. Ganti sub spesialis nakes itu lebih dulu.`;
        }
        if (Object.keys(errors).length || !data) validation(errors);
        return { name, lines, removed };
    }

    // Baris yang dibuang diberi deleted_at, yang namanya berubah diperbarui, dan yang baru ditambah.
    private async writeLines(
        specialtyId: string,
        lines: Line[],
        removed: string[],
        stamp: string,
    ): Promise<void> {
        const tenantId = this.workspace.tenantId;
        if (removed.length)
            await this.db.execute(
                `update sim_m_sub_spesialisasi set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and spesialisasi_id = $3 and id = any($4::uuid[]) and deleted_at is null`,
                [stamp, tenantId, specialtyId, `{${removed.join(',')}}`],
            );
        for (const line of lines)
            if (line.id === null)
                await this.db.insert('sim_m_sub_spesialisasi', {
                    id: Bun.randomUUIDv7(),
                    tenant_id: tenantId,
                    spesialisasi_id: specialtyId,
                    nama: line.name,
                    created_at: stamp,
                    updated_at: stamp,
                });
            else
                await this.db.execute(
                    `update sim_m_sub_spesialisasi set nama = $1, updated_at = $2
                     where tenant_id = $3 and spesialisasi_id = $4 and id = $5 and deleted_at is null
                       and nama is distinct from $1`,
                    [line.name, stamp, tenantId, specialtyId, line.id],
                );
    }

    async create(body: unknown) {
        this.workspace.guard('specialty', 'create');
        const data = await this.checked(body, null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.transaction(async () => {
                await this.db.insert('sim_m_spesialisasi', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    nama: data.name,
                    created_at: stamp,
                    updated_at: stamp,
                });
                await this.writeLines(id, data.lines ?? [], [], stamp);
            });
        } catch (error) {
            taken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('specialty', 'update');
        const current = await this.row(id);
        const data = await this.checked(body, current);
        const stamp = nowSql();
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                updated = await this.db.execute(
                    `update sim_m_spesialisasi set nama = $1, updated_at = $2
                     where tenant_id = $3 and id = $4 and version = $5 and deleted_at is null`,
                    [
                        data.name,
                        stamp,
                        this.workspace.tenantId,
                        current.id,
                        expectedVersion(request, body),
                    ],
                );
                if (updated && data.lines)
                    await this.writeLines(
                        current.id,
                        data.lines,
                        data.removed,
                        stamp,
                    );
            });
        } catch (error) {
            taken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Spesialis yang masih dipakai nakes tidak bisa dihapus. Sub spesialisnya ikut dihapus.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('specialty', 'delete');
        const current = await this.row(id);
        const used = await this.db.one(
            z.object({ id: z.string() }),
            'select id from sim_m_nakes where tenant_id = $1 and spesialisasi_id = $2 and deleted_at is null limit 1',
            [this.workspace.tenantId, current.id],
        );
        if (used)
            validation({
                id: 'Spesialis ini masih dipakai tenaga kesehatan. Ganti spesialis nakes itu lebih dulu.',
            });
        const stamp = nowSql();
        let deleted = 0;
        await this.db.transaction(async () => {
            deleted = await this.db.execute(
                `update sim_m_spesialisasi set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
                [
                    stamp,
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
            if (deleted)
                await this.db.execute(
                    `update sim_m_sub_spesialisasi set deleted_at = $1, updated_at = $1
                     where tenant_id = $2 and spesialisasi_id = $3 and deleted_at is null`,
                    [stamp, this.workspace.tenantId, current.id],
                );
        });
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
