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
    diagnosisReferenceInputSchema,
    diagnosisReferenceListSchema,
    diagnosisReferenceRowSchema,
    type DiagnosisReferenceList,
} from './diagnosis-reference.schema.ts';

type Use = { table: string; column: string };

// Tabel tiap daftar dan tempat barisnya dipakai, yang menahan Delete. Kelas dan kategori operasi belum dipakai di mana
// pun sampai tarif dipindah.
const tables = {
    'diagnosis-types': {
        table: 'sim_m_diagnosa_jenis',
        uses: [{ table: 'sim_tr_pemeriksaan_diagnosa', column: 'jenis_id' }],
    },
    'diagnosis-cases': {
        table: 'sim_m_diagnosa_kasus',
        uses: [{ table: 'sim_tr_pemeriksaan_diagnosa', column: 'kasus_id' }],
    },
    prognoses: {
        table: 'sim_m_prognosa',
        uses: [{ table: 'sim_tr_pemeriksaan', column: 'prognosa_id' }],
    },
    'chronic-diseases': {
        table: 'sim_m_penyakit_kronis',
        uses: [
            {
                table: 'sim_tr_pemeriksaan_penyakit_kronis',
                column: 'penyakit_kronis_id',
            },
        ],
    },
    'dosage-forms': {
        table: 'sim_m_bentuk_sediaan',
        uses: [{ table: 'sim_m_obat', column: 'bentuk_sediaan_id' }],
    },
    'usage-instructions': {
        table: 'sim_m_aturan_pakai',
        uses: [{ table: 'sim_tr_resep_detail', column: 'aturan_pakai_id' }],
    },
    'discharge-statuses': {
        table: 'sim_m_status_pulang',
        uses: [
            { table: 'sim_tr_registrasi_tujuan', column: 'status_pulang_id' },
        ],
    },
    'care-classes': { table: 'sim_m_kelas', uses: [] },
    'operation-categories': { table: 'sim_m_kategori_operasi', uses: [] },
    'benefit-limit-categories': {
        table: 'sim_m_kategori_plafon',
        uses: [{ table: 'sim_m_tindakan', column: 'kategori_plafon_id' }],
    },
    'supporting-devices': {
        table: 'sim_m_alat_penunjang',
        uses: [{ table: 'sim_m_tindakan', column: 'alat_penunjang_id' }],
    },
} satisfies Record<DiagnosisReferenceList, { table: string; uses: Use[] }>;

function checked(body: unknown) {
    const parsed = diagnosisReferenceInputSchema.safeParse(body);
    const errors: Record<string, string> = {};
    const data = parsed.success ? parsed.data : null;
    const code = data?.code.trim() ?? '';
    const name = data?.name.trim() ?? '';
    const sortOrder = data?.sort_order ?? 0;
    if (!code) errors.code = 'Isi kode.';
    else if (code.length > 40) errors.code = 'Paling panjang 40 karakter.';
    if (!name) errors.name = 'Isi nama.';
    else if (name.length > 150) errors.name = 'Paling panjang 150 karakter.';
    if (sortOrder < 0 || sortOrder > 999)
        errors.sort_order = 'Isi angka 0 sampai 999.';
    if (Object.keys(errors).length || !data) validation(errors);
    return { code, name, sortOrder, isActive: data.is_active ?? true };
}

// Daftar pendek klinis milik tenant, diisi bawaan sistem lama oleh migration 0023 dan 0025 dan diatur admin di
// Setup → Klinis.
export class DiagnosisReferences {
    private readonly table: string;
    private readonly uses: Use[];

    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
        list: string,
    ) {
        const parsed = diagnosisReferenceListSchema.safeParse(list);
        if (!parsed.success) abort(404, 'Not Found');
        ({ table: this.table, uses: this.uses } = tables[parsed.data]);
    }

    private get rowSql() {
        return `select * from (
                    select k.id, k.kode as code, k.nama as name, k.urutan as sort_order, k.aktif as is_active, k.version
                    from ${this.table} k
                    where k.tenant_id = $1 and k.deleted_at is null) entries
                where true`;
    }

    metadata() {
        this.workspace.guard('diagnosis-reference', 'read');
        const has = (action: string) =>
            this.workspace.permissions.has(
                `healthcare.diagnosis-reference.${action}`,
            );
        return {
            permissions: {
                create: has('create'),
                update: has('update'),
                delete: has('delete'),
            },
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('diagnosis-reference', 'read');
        const bindings: (string | boolean)[] = [this.workspace.tenantId];
        const status = parameters.get('status');
        const filter =
            status === 'active' || status === 'inactive'
                ? ` and is_active = $${bindings.push(status === 'active')}`
                : '';
        const batch = await incrementalList(this.db, {
            query: `${this.rowSql}${filter}`,
            bindings,
            parameters,
            columns: { sort_order: 'sort_order', code: 'code', name: 'name' },
            searchColumns: ['code', 'name'],
            numericColumns: ['sort_order'],
            defaultSort: 'sort_order',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) =>
                diagnosisReferenceRowSchema.parse(row),
            ),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  diagnosisReferenceRowSchema,
                  `${this.rowSql} and entries.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private codeTaken(error: unknown): void {
        if (
            sqlErrorCode(error) === '23505' &&
            error instanceof Error &&
            error.message.includes(`${this.table}_kode_unique`)
        )
            validation({ code: 'Kode ini sudah dipakai baris lain.' });
    }

    async create(body: unknown) {
        this.workspace.guard('diagnosis-reference', 'create');
        const data = checked(body);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert(this.table, {
                id,
                tenant_id: this.workspace.tenantId,
                kode: data.code,
                nama: data.name,
                urutan: data.sortOrder,
                aktif: data.isActive,
                created_at: stamp,
                updated_at: stamp,
            });
        } catch (error) {
            this.codeTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('diagnosis-reference', 'update');
        const current = await this.row(id);
        const data = checked(body);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update ${this.table} set kode = $1, nama = $2, urutan = $3, aktif = $4, updated_at = $5
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
                ],
            );
        } catch (error) {
            this.codeTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Baris yang sudah dipakai tidak bisa dihapus; nonaktifkan supaya tidak dipilih lagi.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('diagnosis-reference', 'delete');
        const current = await this.row(id);
        for (const use of this.uses)
            if (
                await this.db.one(
                    z.object({ id: z.string() }),
                    `select id from ${use.table} where tenant_id = $1 and ${use.column} = $2 and deleted_at is null limit 1`,
                    [this.workspace.tenantId, current.id],
                )
            )
                validation({
                    id: 'Baris ini sudah dipakai. Nonaktifkan saja supaya tidak dipilih lagi.',
                });
        const deleted = await this.db.execute(
            `update ${this.table} set deleted_at = $1, updated_at = $1
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
