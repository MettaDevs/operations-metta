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
import { isTreatmentGroup } from './procedure-group.options.ts';
import {
    procedureGroupInputSchema,
    procedureGroupRowSchema,
} from './procedure-group.schema.ts';

const rowSql = `select * from (
                    select k.id, k.kode as code, k.nama as name, k.nama_internasional as international_name,
                           k.kelompok_perawatan as treatment_group, k.urutan as sort_order, k.aktif as is_active,
                           k.version
                    from sim_m_tindakan_kelompok k
                    where k.tenant_id = $1 and k.deleted_at is null) procedure_groups
                where true`;

const uses = [
    {
        table: 'sim_m_tindakan',
        message:
            'Kelompok ini masih dipakai tindakan. Nonaktifkan saja supaya tidak dipilih lagi.',
    },
    {
        table: 'sim_m_tindakan_kategori',
        message:
            'Kelompok ini masih dipakai kategori tindakan. Nonaktifkan saja supaya tidak dipilih lagi.',
    },
];

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_tindakan_kelompok_kode_unique')
    )
        validation({ code: 'Kode ini sudah dipakai kelompok lain.' });
}

function checked(body: unknown) {
    const parsed = procedureGroupInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim() ?? '';
    const name = data?.name.trim() ?? '';
    const internationalName = data?.international_name?.trim() || null;
    const treatmentGroup = data?.treatment_group ?? 'ALL';
    const sortOrder = data?.sort_order ?? 0;
    if (!code) errors.code = 'Isi kode kelompok.';
    else if (code.length > 40) errors.code = 'Paling panjang 40 karakter.';
    if (!name) errors.name = 'Isi nama kelompok.';
    else if (name.length > 150) errors.name = 'Paling panjang 150 karakter.';
    if (internationalName !== null && internationalName.length > 200)
        errors.international_name = 'Paling panjang 200 karakter.';
    if (!isTreatmentGroup(treatmentGroup))
        errors.treatment_group = 'Pilih dari daftar.';
    if (sortOrder < 0 || sortOrder > 999)
        errors.sort_order = 'Isi angka 0 sampai 999.';
    if (Object.keys(errors).length || !data) validation(errors);
    return {
        kode: code,
        nama: name,
        nama_internasional: internationalName,
        kelompok_perawatan: treatmentGroup,
        urutan: sortOrder,
        aktif: data.is_active ?? true,
    };
}

// Kelompok tindakan milik tenant, isian form Group Jasa sistem lama. Bagian dari setup tindakan, jadi izinnya izin
// tindakan. Menambah butuh izin ubah, bukan izin tambah, karena pemeriksa memegang izin tambah tindakan untuk Baru di
// Biaya Tindakan dan tidak boleh menambah kelompok.
export class ProcedureGroups {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(parameters: URLSearchParams) {
        this.workspace.guard('procedure', 'read');
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
            columns: {
                code: 'code',
                name: 'name',
                treatment_group: 'treatment_group',
                sort_order: 'sort_order',
            },
            searchColumns: ['code', 'name'],
            numericColumns: ['sort_order'],
            defaultSort: 'code',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => procedureGroupRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const row = lookupId(id)
            ? await this.db.one(
                  procedureGroupRowSchema,
                  `${rowSql} and procedure_groups.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!row) abort(404, 'Not Found');
        return row;
    }

    async create(body: unknown) {
        this.workspace.guard('procedure', 'update');
        const values = checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('sim_m_tindakan_kelompok', {
                id,
                tenant_id: this.workspace.tenantId,
                ...values,
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
        const values = checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update sim_m_tindakan_kelompok
                 set kode = $1, nama = $2, nama_internasional = $3, kelompok_perawatan = $4, urutan = $5, aktif = $6,
                     updated_at = $7
                 where tenant_id = $8 and id = $9 and version = $10 and deleted_at is null`,
                [
                    values.kode,
                    values.nama,
                    values.nama_internasional,
                    values.kelompok_perawatan,
                    values.urutan,
                    values.aktif,
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
        for (const use of uses)
            if (
                await this.db.one(
                    z.object({ id: z.string() }),
                    `select id from ${use.table} where tenant_id = $1 and kelompok_id = $2 and deleted_at is null limit 1`,
                    [this.workspace.tenantId, current.id],
                )
            )
                validation({ _form: use.message });
        const deleted = await this.db.execute(
            `update sim_m_tindakan_kelompok set deleted_at = $1, updated_at = $1
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
