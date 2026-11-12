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
import { icd10InputSchema, icd10RowSchema } from './icd10.schema.ts';

const rowSql = `select * from (
                    select k.id, k.kode as code, k.nama as name, k.aktif as is_active, k.version
                    from sim_m_icd10 k
                    where k.tenant_id = $1 and k.deleted_at is null) codes
                where true`;

function checked(body: unknown) {
    const parsed = icd10InputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim() ?? '';
    const name = data?.name.trim() ?? '';
    if (!code) errors.code = 'Isi kode ICD-10.';
    else if (code.length > 20) errors.code = 'Paling panjang 20 karakter.';
    if (!name) errors.name = 'Isi nama diagnosa.';
    else if (name.length > 250) errors.name = 'Paling panjang 250 karakter.';
    if (Object.keys(errors).length || !data) validation(errors);
    return { code, name, isActive: data.is_active ?? true };
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_icd10_kode_unique')
    )
        validation({ code: 'Kode ini sudah ada di daftar ICD-10.' });
}

// Kode ICD-10 milik tenant. Daftarnya dimulai kosong (keputusan pemilik produk) dan diisi lewat Setup, atau dari baris
// diagnosa pemeriksaan oleh yang boleh memeriksa.
export class Icd10Codes {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    metadata() {
        this.workspace.guard('icd10', 'read');
        const has = (action: string) =>
            this.workspace.permissions.has(`healthcare.icd10.${action}`);
        return {
            permissions: {
                create: has('create'),
                update: has('update'),
                delete: has('delete'),
            },
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('icd10', 'read');
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
            columns: { code: 'code', name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => icd10RowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(icd10RowSchema, `${rowSql} and codes.id = $2`, [
                  this.workspace.tenantId,
                  id,
              ])
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    async create(body: unknown) {
        this.workspace.guard('icd10', 'create');
        const data = checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('sim_m_icd10', {
                id,
                tenant_id: this.workspace.tenantId,
                kode: data.code,
                nama: data.name,
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
        this.workspace.guard('icd10', 'update');
        const current = await this.row(id);
        const data = checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update sim_m_icd10 set kode = $1, nama = $2, aktif = $3, updated_at = $4
                 where tenant_id = $5 and id = $6 and version = $7 and deleted_at is null`,
                [
                    data.code,
                    data.name,
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

    // Kode yang sudah dipakai diagnosa pemeriksaan tidak bisa dihapus; nonaktifkan supaya tidak dipilih lagi.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('icd10', 'delete');
        const current = await this.row(id);
        const used = await this.db.one(
            z.object({ id: z.string() }),
            'select id from sim_tr_pemeriksaan_diagnosa where tenant_id = $1 and icd10_id = $2 and deleted_at is null limit 1',
            [this.workspace.tenantId, current.id],
        );
        if (used)
            validation({
                id: 'Kode ini sudah dipakai di diagnosa pemeriksaan. Nonaktifkan saja supaya tidak dipilih lagi.',
            });
        const deleted = await this.db.execute(
            'update sim_m_icd10 set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
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
