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
    procedureCategoryInputSchema,
    procedureCategoryRowSchema,
} from './procedure-category.schema.ts';

const rowSql = `select * from (
                    select c.id, c.kelompok_id as group_id, k.nama as group_name, c.kode as code, c.nama as name,
                           c.nama_internasional as international_name, c.aktif as is_active, c.version
                    from sim_m_tindakan_kategori c
                    join sim_m_tindakan_kelompok k on k.tenant_id = c.tenant_id and k.id = c.kelompok_id
                    where c.tenant_id = $1 and c.deleted_at is null) categories
                where true`;

const found = z.object({ found: z.number() });

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_tindakan_kategori_kode_unique')
    )
        validation({ code: 'Kode ini sudah dipakai kategori lain.' });
}

// Kategori tindakan milik tenant, di bawah satu kelompok tindakan seperti Kategori jasa di Setup Jasa sistem lama.
// Tindakan hanya boleh memakai kategori milik kelompoknya, jadi kelompok kategori yang sudah dipakai tidak diganti.
export class ProcedureCategories {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // `group` menyaring satu kelompok, `active=1` hanya kategori aktif.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('procedure', 'read');
        const bindings: (string | boolean)[] = [this.workspace.tenantId];
        const filters: string[] = [];
        const group = lookupId(parameters.get('group') ?? '');
        if (group) filters.push(`group_id = $${bindings.push(group)}`);
        if (parameters.get('active') === '1') filters.push('is_active');
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filters.map((filter) => ` and ${filter}`).join('')}`,
            bindings,
            parameters,
            columns: { group_name: 'group_name', name: 'name' },
            searchColumns: ['code', 'name', 'group_name'],
            numericColumns: [],
            defaultSort: 'group_name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) =>
                procedureCategoryRowSchema.parse(row),
            ),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const row = lookupId(id)
            ? await this.db.one(
                  procedureCategoryRowSchema,
                  `${rowSql} and categories.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!row) abort(404, 'Not Found');
        return row;
    }

    private async used(id: string): Promise<boolean> {
        return (
            (await this.db.one(
                found,
                'select 1 as found from sim_m_tindakan where tenant_id = $1 and kategori_id = $2 and deleted_at is null limit 1',
                [this.workspace.tenantId, id],
            )) !== undefined
        );
    }

    // Kelompok nonaktif hanya boleh tetap dipakai kategori yang sudah memegangnya.
    private async checked(
        body: unknown,
        current: { id: string; group_id: string } | null,
    ) {
        const parsed = procedureCategoryInputSchema.safeParse(body);
        const errors: Record<string, string> = {};
        const data = parsed.success ? parsed.data : null;
        const code = data?.code.trim() ?? '';
        const name = data?.name.trim() ?? '';
        const internationalName = data?.international_name?.trim() || null;
        const groupId = data?.group_id?.trim() || null;
        if (!code) errors.code = 'Isi kode kategori.';
        else if (code.length > 20) errors.code = 'Paling panjang 20 karakter.';
        if (!name) errors.name = 'Isi nama kategori.';
        else if (name.length > 150)
            errors.name = 'Paling panjang 150 karakter.';
        if (internationalName !== null && internationalName.length > 150)
            errors.international_name = 'Paling panjang 150 karakter.';
        if (groupId === null) errors.group_id = 'Pilih kelompok tindakan.';
        else if (
            !(lookupId(groupId)
                ? await this.db.one(
                      found,
                      `select 1 as found from sim_m_tindakan_kelompok
                       where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3)`,
                      [
                          this.workspace.tenantId,
                          groupId,
                          current?.group_id ?? null,
                      ],
                  )
                : undefined)
        )
            errors.group_id = 'Pilih dari daftar.';
        else if (
            current &&
            groupId !== current.group_id &&
            (await this.used(current.id))
        )
            errors.group_id =
                'Kategori ini sudah dipakai tindakan, jadi kelompoknya tidak bisa diganti. Buat kategori baru di kelompok lain.';
        if (Object.keys(errors).length || !data || groupId === null)
            validation(errors);
        return {
            code,
            name,
            internationalName,
            groupId,
            isActive: data.is_active ?? true,
        };
    }

    async create(body: unknown) {
        this.workspace.guard('procedure', 'update');
        const data = await this.checked(body, null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('sim_m_tindakan_kategori', {
                id,
                tenant_id: this.workspace.tenantId,
                kelompok_id: data.groupId,
                kode: data.code,
                nama: data.name,
                nama_internasional: data.internationalName,
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
        const data = await this.checked(body, current);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update sim_m_tindakan_kategori set kelompok_id = $1, kode = $2, nama = $3, nama_internasional = $4,
                        aktif = $5, updated_at = $6
                 where tenant_id = $7 and id = $8 and version = $9 and deleted_at is null`,
                [
                    data.groupId,
                    data.code,
                    data.name,
                    data.internationalName,
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

    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('procedure', 'delete');
        const current = await this.row(id);
        if (await this.used(current.id))
            validation({
                _form: 'Kategori ini masih dipakai tindakan. Nonaktifkan saja supaya tidak dipilih lagi.',
            });
        const deleted = await this.db.execute(
            `update sim_m_tindakan_kategori set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null`,
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
