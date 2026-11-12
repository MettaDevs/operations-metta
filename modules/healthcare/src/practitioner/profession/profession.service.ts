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
    professionInputSchema,
    professionRowSchema,
} from './profession.schema.ts';

const rowSql = `select * from (
                    select k.id, k.kode as code, k.nama as name, k.isi_tenaga_medis as fills_medical_staff,
                           k.isi_perawat as fills_nurse, k.urutan as sort_order, k.aktif as is_active, k.version
                    from sim_m_profesi k
                    where k.tenant_id = $1 and k.deleted_at is null) professions
                where true`;

function checked(body: unknown) {
    const parsed = professionInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim() ?? '';
    const name = data?.name.trim() ?? '';
    const sortOrder = data?.sort_order ?? 0;
    if (!code) errors.code = 'Isi kode profesi.';
    else if (code.length > 40) errors.code = 'Paling panjang 40 karakter.';
    if (!name) errors.name = 'Isi nama profesi.';
    else if (name.length > 150) errors.name = 'Paling panjang 150 karakter.';
    if (sortOrder < 0 || sortOrder > 999)
        errors.sort_order = 'Isi angka 0 sampai 999.';
    if (Object.keys(errors).length || !data) validation(errors);
    return {
        code,
        name,
        fillsMedicalStaff: data.fills_medical_staff ?? false,
        fillsNurse: data.fills_nurse ?? false,
        sortOrder,
        isActive: data.is_active ?? true,
    };
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_profesi_kode_unique')
    )
        validation({ code: 'Kode ini sudah dipakai profesi lain.' });
}

// Profesi tenaga kesehatan milik tenant, diisi admin di Setup. Bawaannya tujuh profesi dari migration 0022.
export class Professions {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    metadata() {
        this.workspace.guard('profession', 'read');
        return {
            permissions: {
                create: this.workspace.permissions.has(
                    'healthcare.profession.create',
                ),
                update: this.workspace.permissions.has(
                    'healthcare.profession.update',
                ),
                delete: this.workspace.permissions.has(
                    'healthcare.profession.delete',
                ),
            },
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('profession', 'read');
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
            columns: { sort_order: 'sort_order', code: 'code', name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: ['sort_order'],
            defaultSort: 'sort_order',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => professionRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  professionRowSchema,
                  `${rowSql} and professions.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('profession', 'create');
        const data = checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('sim_m_profesi', {
                id,
                tenant_id: this.workspace.tenantId,
                kode: data.code,
                nama: data.name,
                isi_tenaga_medis: data.fillsMedicalStaff,
                isi_perawat: data.fillsNurse,
                urutan: data.sortOrder,
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
        this.workspace.guard('profession', 'update');
        const current = await this.row(id);
        const data = checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update sim_m_profesi set kode = $1, nama = $2, urutan = $3, aktif = $4, updated_at = $5,
                        isi_tenaga_medis = $9, isi_perawat = $10
                 where tenant_id = $6 and id = $7 and version = $8 and deleted_at is null`,
                [
                    data.code,
                    data.name,
                    data.sortOrder,
                    data.isActive,
                    nowSql(),
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                    data.fillsMedicalStaff,
                    data.fillsNurse,
                ],
            );
        } catch (error) {
            codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Profesi yang masih dipakai nakes tidak bisa dihapus, supaya tidak ada nakes tanpa profesi.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('profession', 'delete');
        const current = await this.row(id);
        const used = await this.db.one(
            z.object({ id: z.string() }),
            'select id from sim_m_nakes where tenant_id = $1 and profesi_id = $2 and deleted_at is null limit 1',
            [this.workspace.tenantId, current.id],
        );
        if (used)
            validation({
                id: 'Profesi ini masih dipakai tenaga kesehatan. Ganti profesi nakes itu lebih dulu.',
            });
        const deleted = await this.db.execute(
            'update sim_m_profesi set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
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
