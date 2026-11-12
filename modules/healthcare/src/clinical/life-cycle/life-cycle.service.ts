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
    lifeCycleInputSchema,
    lifeCycleRowSchema,
    type LifeCycleRow,
} from './life-cycle.schema.ts';

const rowSql = `select * from (
                    select s.id, s.kode as code, s.nama as name, s.klaster_id as cluster_id, k.kode as cluster_code,
                           k.nama as cluster_name, s.umur_min_bulan as min_age_months,
                           s.umur_maks_bulan as max_age_months, s.jenis_kelamin as gender, g.name as gender_name,
                           s.syarat_hamil as requires_pregnancy, s.prioritas as priority, s.urutan as sort_order,
                           s.aktif as is_active, s.version, k.aktif as cluster_active
                    from sim_m_siklus_hidup s
                    join sim_m_klaster k on k.tenant_id = s.tenant_id and k.id = s.klaster_id
                    left join party_reference_values g on g.category = 'gender' and g.code = s.jenis_kelamin
                    where s.tenant_id = $1 and s.deleted_at is null) life_cycles
                where true`;

// Siklus hidup aktif dengan klaster aktif: aturan yang dipakai pendaftaran kunjungan.
export async function activeLifeCycles(
    db: Database,
    tenantId: string,
): Promise<LifeCycleRow[]> {
    return db.rows(
        lifeCycleRowSchema,
        `${rowSql} and is_active and cluster_active order by sort_order, name`,
        [tenantId],
    );
}

// Kode jenis kelamin party Core beserta namanya.
async function genders(db: Database) {
    return db.rows(
        z.object({ code: z.string(), name: z.string() }),
        "select code, name from party_reference_values where category = 'gender' order by name",
    );
}

function checked(body: unknown) {
    const parsed = lifeCycleInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    if (!parsed.success)
        validation(
            Object.fromEntries(
                parsed.error.issues.map((issue) => [
                    issue.path.join('.') || 'input',
                    'Isian ini tidak sah.',
                ]),
            ),
        );
    const data = parsed.data;
    const code = data.code.trim();
    const name = data.name.trim();
    if (!code) errors.code = 'Isi kode siklus hidup.';
    else if (code.length > 20) errors.code = 'Paling panjang 20 karakter.';
    if (!name) errors.name = 'Isi nama siklus hidup.';
    else if (name.length > 100) errors.name = 'Paling panjang 100 karakter.';
    if (data.min_age_months < 0 || data.min_age_months > 2400)
        errors.min_age_months = 'Isi umur 0 sampai 200 tahun.';
    if (
        data.max_age_months !== null &&
        (data.max_age_months <= data.min_age_months ||
            data.max_age_months > 2400)
    )
        errors.max_age_months =
            'Umur sampai harus lebih dari umur mulai, paling tinggi 200 tahun.';
    if (data.priority < 0 || data.priority > 999)
        errors.priority = 'Isi angka 0 sampai 999.';
    const sortOrder = data.sort_order ?? 0;
    if (sortOrder < 0 || sortOrder > 999)
        errors.sort_order = 'Isi angka 0 sampai 999.';
    if (Object.keys(errors).length) validation(errors);
    return {
        code,
        name,
        clusterId: data.cluster_id,
        minAgeMonths: data.min_age_months,
        maxAgeMonths: data.max_age_months,
        gender: data.gender?.trim() || null,
        requiresPregnancy: data.requires_pregnancy,
        priority: data.priority,
        sortOrder,
        isActive: data.is_active ?? true,
    };
}

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_siklus_hidup_kode_unique')
    )
        validation({ code: 'Kode ini sudah dipakai siklus hidup lain.' });
}

// Siklus hidup milik tenant, diisi admin di Setup. Bawaannya lima siklus hidup ILP dari migration.
export class LifeCycles {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Pilihan klaster dan jenis kelamin, serta izin layar. Klaster nonaktif ikut, supaya yang sudah terpasang tetap
    // terbaca namanya.
    async metadata() {
        this.workspace.guard('life-cycle', 'read');
        return {
            clusters: await this.db.rows(
                z.object({
                    id: z.string(),
                    code: z.string(),
                    name: z.string(),
                    is_active: z.boolean(),
                }),
                `select id, kode as code, nama as name, aktif as is_active from sim_m_klaster
                 where tenant_id = $1 and deleted_at is null order by urutan, kode`,
                [this.workspace.tenantId],
            ),
            genders: await genders(this.db),
            permissions: {
                create: this.workspace.permissions.has(
                    'healthcare.life-cycle.create',
                ),
                update: this.workspace.permissions.has(
                    'healthcare.life-cycle.update',
                ),
                delete: this.workspace.permissions.has(
                    'healthcare.life-cycle.delete',
                ),
            },
        };
    }

    // Daftar bertahap. Saring per klaster (`cluster_id`) dan status (`active`/`inactive`).
    async list(parameters: URLSearchParams) {
        this.workspace.guard('life-cycle', 'read');
        const bindings: (string | boolean)[] = [this.workspace.tenantId];
        const filters: string[] = [];
        const cluster = lookupId(parameters.get('cluster_id') ?? '');
        if (cluster) filters.push(`cluster_id = $${bindings.push(cluster)}`);
        const status = parameters.get('status');
        if (status === 'active' || status === 'inactive')
            filters.push(`is_active = $${bindings.push(status === 'active')}`);
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filters.map((filter) => ` and ${filter}`).join('')}`,
            bindings,
            parameters,
            columns: {
                sort_order: 'sort_order',
                code: 'code',
                name: 'name',
                cluster_code: 'cluster_code',
                priority: 'priority',
            },
            searchColumns: ['code', 'name', 'cluster_name'],
            numericColumns: ['sort_order', 'priority'],
            defaultSort: 'sort_order',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => lifeCycleRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  lifeCycleRowSchema,
                  `${rowSql} and life_cycles.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Klaster tenant yang belum dihapus, dan kode jenis kelamin yang dikenal Core.
    private async references(data: ReturnType<typeof checked>) {
        const cluster = lookupId(data.clusterId)
            ? await this.db.one(
                  z.object({ id: z.string() }),
                  'select id from sim_m_klaster where tenant_id = $1 and id = $2 and deleted_at is null',
                  [this.workspace.tenantId, data.clusterId],
              )
            : undefined;
        if (!cluster) validation({ cluster_id: 'Pilih klaster dari daftar.' });
        if (
            data.gender !== null &&
            !(await genders(this.db)).some((row) => row.code === data.gender)
        )
            validation({ gender: 'Pilih jenis kelamin dari daftar.' });
    }

    async create(body: unknown) {
        this.workspace.guard('life-cycle', 'create');
        const data = checked(body);
        await this.references(data);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('sim_m_siklus_hidup', {
                id,
                tenant_id: this.workspace.tenantId,
                klaster_id: data.clusterId,
                kode: data.code,
                nama: data.name,
                umur_min_bulan: data.minAgeMonths,
                umur_maks_bulan: data.maxAgeMonths,
                jenis_kelamin: data.gender,
                syarat_hamil: data.requiresPregnancy,
                prioritas: data.priority,
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
        this.workspace.guard('life-cycle', 'update');
        const current = await this.row(id);
        const data = checked(body);
        await this.references(data);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update sim_m_siklus_hidup
                 set klaster_id = $1, kode = $2, nama = $3, umur_min_bulan = $4, umur_maks_bulan = $5,
                     jenis_kelamin = $6, syarat_hamil = $7, prioritas = $8, urutan = $9, aktif = $10, updated_at = $11
                 where tenant_id = $12 and id = $13 and version = $14 and deleted_at is null`,
                [
                    data.clusterId,
                    data.code,
                    data.name,
                    data.minAgeMonths,
                    data.maxAgeMonths,
                    data.gender,
                    data.requiresPregnancy,
                    data.priority,
                    data.sortOrder,
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

    // Kunjungan yang sudah mencatat siklus hidup ini tetap membacanya; yang dihapus hanya tidak dipakai lagi.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('life-cycle', 'delete');
        const current = await this.row(id);
        const deleted = await this.db.execute(
            'update sim_m_siklus_hidup set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
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
