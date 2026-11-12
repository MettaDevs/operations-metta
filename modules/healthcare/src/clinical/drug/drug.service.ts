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
import { drugInputSchema, drugRowSchema } from './drug.schema.ts';

const rowSql = `select * from (
                    select o.id, o.kode as code, o.nama as name, o.satuan_id as unit_id, s.nama as unit_name,
                           o.bentuk_sediaan_id as dosage_form_id, b.nama as dosage_form_name, o.aktif as is_active,
                           o.version
                    from sim_m_obat o
                    join sim_m_satuan_obat s on s.tenant_id = o.tenant_id and s.id = o.satuan_id
                    left join sim_m_bentuk_sediaan b on b.tenant_id = o.tenant_id and b.id = o.bentuk_sediaan_id
                    where o.tenant_id = $1 and o.deleted_at is null) drugs
                where true`;

const optionSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    active: z.boolean(),
});

type ReferenceTable = 'sim_m_satuan_obat' | 'sim_m_bentuk_sediaan';

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_obat_kode_unique')
    )
        validation({ code: 'Kode ini sudah ada di daftar obat.' });
}

// Obat milik tenant, diisi lewat Setup atau dari baris E-Resep oleh yang boleh memeriksa. Module farmasi kelak
// mengambil alih master ini; stok belum ada.
export class Drugs {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Pilihan nonaktif ikut, supaya obat yang sudah memegangnya tetap terbaca namanya.
    private options(table: ReferenceTable) {
        return this.db.rows(
            optionSchema,
            `select id, kode as code, nama as name, aktif as active from ${table}
             where tenant_id = $1 and deleted_at is null order by urutan, kode`,
            [this.workspace.tenantId],
        );
    }

    async metadata() {
        this.workspace.guard('drug', 'read');
        const has = (action: string) =>
            this.workspace.permissions.has(`healthcare.drug.${action}`);
        return {
            permissions: {
                create: has('create'),
                update: has('update'),
                delete: has('delete'),
            },
            units: await this.options('sim_m_satuan_obat'),
            dosage_forms: await this.options('sim_m_bentuk_sediaan'),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('drug', 'read');
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
                unit_name: 'unit_name',
                dosage_form_name: 'dosage_form_name',
            },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => drugRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(drugRowSchema, `${rowSql} and drugs.id = $2`, [
                  this.workspace.tenantId,
                  id,
              ])
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    // Pilihan nonaktif hanya boleh tetap dipakai obat yang sudah memegangnya.
    private async known(
        table: ReferenceTable,
        id: string,
        saved: string | null,
    ) {
        if (!lookupId(id)) return false;
        const found = await this.db.one(
            z.object({ id: z.string() }),
            `select id from ${table}
             where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3)`,
            [this.workspace.tenantId, id, saved],
        );
        return found !== undefined;
    }

    private async checked(
        body: unknown,
        saved: z.infer<typeof drugRowSchema> | null,
    ) {
        const parsed = drugInputSchema.safeParse(body);
        const errors: Record<string, string> = {};
        const data = parsed.success ? parsed.data : null;
        const code = data?.code?.trim() || null;
        const name = data?.name.trim() ?? '';
        const unitId = data?.unit_id?.trim() || null;
        const dosageFormId = data?.dosage_form_id?.trim() || null;
        if (code !== null && code.length > 30)
            errors.code = 'Paling panjang 30 karakter.';
        if (!name) errors.name = 'Isi nama obat.';
        else if (name.length > 200)
            errors.name = 'Paling panjang 200 karakter.';
        if (unitId === null) errors.unit_id = 'Pilih satuan.';
        else if (
            !(await this.known(
                'sim_m_satuan_obat',
                unitId,
                saved?.unit_id ?? null,
            ))
        )
            errors.unit_id = 'Pilih dari daftar.';
        if (
            dosageFormId !== null &&
            !(await this.known(
                'sim_m_bentuk_sediaan',
                dosageFormId,
                saved?.dosage_form_id ?? null,
            ))
        )
            errors.dosage_form_id = 'Pilih dari daftar.';
        if (Object.keys(errors).length || !data || unitId === null)
            validation(errors);
        return {
            code,
            name,
            unitId,
            dosageFormId,
            isActive: data.is_active ?? true,
        };
    }

    async create(body: unknown) {
        this.workspace.guard('drug', 'create');
        const data = await this.checked(body, null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.insert('sim_m_obat', {
                id,
                tenant_id: this.workspace.tenantId,
                kode: data.code,
                nama: data.name,
                satuan_id: data.unitId,
                bentuk_sediaan_id: data.dosageFormId,
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
        this.workspace.guard('drug', 'update');
        const current = await this.row(id);
        const data = await this.checked(body, current);
        let updated = 0;
        try {
            updated = await this.db.execute(
                `update sim_m_obat set kode = $1, nama = $2, satuan_id = $3, bentuk_sediaan_id = $4, aktif = $5,
                     updated_at = $6
                 where tenant_id = $7 and id = $8 and version = $9 and deleted_at is null`,
                [
                    data.code,
                    data.name,
                    data.unitId,
                    data.dosageFormId,
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

    // Obat yang sudah dipakai resep atau dicatat sebagai alergi pasien tidak bisa dihapus; nonaktifkan supaya tidak
    // dipilih lagi.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('drug', 'delete');
        const current = await this.row(id);
        const used = await this.db.one(
            z.object({ id: z.string() }),
            `select id from sim_tr_resep_detail where tenant_id = $1 and obat_id = $2 and deleted_at is null
             union all
             select id from sim_m_pasien_alergi_obat where tenant_id = $1 and obat_id = $2 and deleted_at is null
             limit 1`,
            [this.workspace.tenantId, current.id],
        );
        if (used)
            validation({
                id: 'Obat ini sudah dipakai di resep atau alergi pasien. Nonaktifkan saja supaya tidak dipilih lagi.',
            });
        const deleted = await this.db.execute(
            'update sim_m_obat set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
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
