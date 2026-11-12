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
    procedureInputSchema,
    procedureRowSchema,
} from './procedure.schema.ts';

const rowSql = `select * from (
                    select t.id, t.kode as code, t.nama as name, t.kelompok_id as group_id, k.nama as group_name,
                           t.aktif as is_active, t.version
                    from sim_m_tindakan t
                    left join sim_m_tindakan_kelompok k on k.tenant_id = t.tenant_id and k.id = t.kelompok_id
                    where t.tenant_id = $1 and t.deleted_at is null) procedures
                where true`;

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_tindakan_kode_unique')
    )
        validation({ code: 'Kode ini sudah ada di daftar tindakan.' });
}

// Tindakan milik tenant, diisi lewat Setup atau dari baris Biaya Tindakan oleh yang boleh memeriksa. Tarif belum ada.
export class Procedures {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Kelompok nonaktif ikut, supaya tindakan yang sudah memegangnya tetap terbaca namanya.
    async metadata() {
        this.workspace.guard('procedure', 'read');
        const has = (action: string) =>
            this.workspace.permissions.has(`healthcare.procedure.${action}`);
        return {
            permissions: {
                create: has('create'),
                update: has('update'),
                delete: has('delete'),
            },
            groups: await this.db.rows(
                z.object({
                    id: z.string(),
                    code: z.string(),
                    name: z.string(),
                    active: z.boolean(),
                }),
                `select id, kode as code, nama as name, aktif as active from sim_m_tindakan_kelompok
                 where tenant_id = $1 and deleted_at is null order by urutan, kode`,
                [this.workspace.tenantId],
            ),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('procedure', 'read');
        const bindings: (string | boolean)[] = [this.workspace.tenantId];
        const filters: string[] = [];
        const group = lookupId(parameters.get('group') ?? '');
        if (group) filters.push(`group_id = $${bindings.push(group)}`);
        const status = parameters.get('status');
        if (status === 'active' || status === 'inactive')
            filters.push(`is_active = $${bindings.push(status === 'active')}`);
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filters.map((filter) => ` and ${filter}`).join('')}`,
            bindings,
            parameters,
            columns: { code: 'code', name: 'name', group_name: 'group_name' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => procedureRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  procedureRowSchema,
                  `${rowSql} and procedures.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Kelompok nonaktif hanya boleh tetap dipakai tindakan yang sudah memegangnya.
    private async checked(body: unknown, savedGroupId: string | null) {
        const parsed = procedureInputSchema.safeParse(body);
        const errors: Record<string, string> = {};
        const data = parsed.success ? parsed.data : null;
        const code = data?.code.trim() ?? '';
        const name = data?.name.trim() ?? '';
        const groupId = data?.group_id?.trim() || null;
        if (!code) errors.code = 'Isi kode tindakan.';
        else if (code.length > 20) errors.code = 'Paling panjang 20 karakter.';
        if (!name) errors.name = 'Isi nama tindakan.';
        else if (name.length > 200)
            errors.name = 'Paling panjang 200 karakter.';
        if (groupId !== null) {
            const group = lookupId(groupId)
                ? await this.db.one(
                      z.object({ id: z.string() }),
                      `select id from sim_m_tindakan_kelompok
                       where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3)`,
                      [this.workspace.tenantId, groupId, savedGroupId],
                  )
                : undefined;
            if (!group) errors.group_id = 'Pilih dari daftar.';
        }
        if (Object.keys(errors).length || !data) validation(errors);
        return { code, name, groupId, isActive: data.is_active ?? true };
    }

    async create(body: unknown) {
        this.workspace.guard('procedure', 'create');
        const data = await this.checked(body, null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('sim_m_tindakan', {
                id,
                tenant_id: this.workspace.tenantId,
                kode: data.code,
                nama: data.name,
                kelompok_id: data.groupId,
                aktif: data.isActive,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('procedure', 'update');
        const current = await this.row(id);
        const data = await this.checked(body, current.group_id);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update sim_m_tindakan set kode = $1, nama = $2, kelompok_id = $3, aktif = $4, updated_at = $5
                 where tenant_id = $6 and id = $7 and version = $8 and deleted_at is null`,
                [
                    data.code,
                    data.name,
                    data.groupId,
                    data.isActive,
                    nowSql(),
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Tindakan yang sudah dipakai pemeriksaan tidak bisa dihapus; nonaktifkan supaya tidak dipilih lagi.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('procedure', 'delete');
        const current = await this.row(id);
        const used = await this.db.one(
            z.object({ id: z.string() }),
            'select id from sim_tr_pemeriksaan_tindakan where tenant_id = $1 and tindakan_id = $2 and deleted_at is null limit 1',
            [this.workspace.tenantId, current.id],
        );
        if (used)
            validation({
                id: 'Tindakan ini sudah dipakai di pemeriksaan. Nonaktifkan saja supaya tidak dipilih lagi.',
            });
        const deleted = await this.db.execute(
            'update sim_m_tindakan set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
            [
                nowSql(),
                this.workspace.tenantId,
                current.id,
                expectedVersion(request, body),
            ],
        );
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}
