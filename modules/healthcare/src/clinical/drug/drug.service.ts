import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import { nowSql, type Database } from '@core/platform/database/index.ts';
import {
    abort,
    expectedVersion,
    incrementalList,
    lookupId,
    validation,
} from '@core/platform/http/index.ts';
import {
    activeLegalEntity,
    createItem,
    deleteItem,
    itemUnits,
    parseInput,
    updateItem,
    type ItemInput,
    type ItemScope,
} from '@core/foundation/inventory/index.ts';
import { drugInputSchema, drugRowSchema } from './drug.schema.ts';

const rowSql = `select * from (
                    select o.id, b.kode as code, b.nama as name, b.satuan_dasar_id as base_unit_id,
                           u.nama as base_unit_name, coalesce(b.satuan_jual_id, b.satuan_dasar_id) as sales_unit_id,
                           o.bentuk_sediaan_id as dosage_form_id, f.nama as dosage_form_name,
                           o.boleh_diresepkan as is_prescribable, b.diblokir as is_blocked, b.version
                    from sim_m_obat o
                    join gd_m_barang b on b.tenant_id = o.tenant_id and b.legal_entity_id = o.legal_entity_id
                         and b.id = o.id and b.deleted_at is null
                    join gd_m_satuan u on u.tenant_id = b.tenant_id and u.id = b.satuan_dasar_id
                    left join sim_m_bentuk_sediaan f on f.tenant_id = o.tenant_id and f.id = o.bentuk_sediaan_id
                    where o.tenant_id = $1 and o.legal_entity_id = $2 and o.deleted_at is null) drugs
                where true`;

const optionSchema = z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
});

// Kartu obat menyimpan barang Core lewat fungsi persediaan dan baris perluasannya di transaksi yang sama, seperti
// table extension di BC. Barang milik legal entity, jadi obat mengikuti legal entity tempat kerja pengguna; E-Resep
// memakai obat legal entity kunjungannya, yang sama dengan tempat kerja karena kunjungan hanya terlihat di sana.
export class Drugs {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope(): ItemScope {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    async metadata() {
        this.workspace.guard('drug', 'read');
        const has = (action: string) =>
            this.workspace.permissions.has(`healthcare.drug.${action}`);
        const scope = this.scope;
        return {
            permissions: {
                create: has('create'),
                update: has('update'),
                delete: has('delete'),
            },
            units: await this.db.rows(
                optionSchema,
                `select id, kode as code, nama as name from gd_m_satuan
                 where tenant_id = $1 and legal_entity_id = $2 and deleted_at is null order by kode`,
                [scope.tenantId, scope.legalEntityId],
            ),
            // Pilihan nonaktif ikut, supaya obat yang sudah memegangnya tetap terbaca namanya.
            dosage_forms: await this.db.rows(
                optionSchema.extend({ active: z.boolean() }),
                `select id, kode as code, nama as name, aktif as active from sim_m_bentuk_sediaan
                 where tenant_id = $1 and deleted_at is null order by urutan, kode`,
                [scope.tenantId],
            ),
        };
    }

    private async withUnits(rows: z.infer<typeof drugRowSchema>[]) {
        const units = await itemUnits(
            this.db,
            this.scope,
            rows.map((row) => row.id),
        );
        return rows.map((row) => ({ ...row, units: units.get(row.id) ?? [] }));
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('drug', 'read');
        const scope = this.scope;
        const prescribable = parameters.get('prescribable');
        const filter =
            prescribable === 'true'
                ? ' and is_prescribable and not is_blocked'
                : prescribable === 'false'
                  ? ' and not (is_prescribable and not is_blocked)'
                  : '';
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings: [scope.tenantId, scope.legalEntityId],
            parameters,
            columns: {
                code: 'code',
                name: 'name',
                base_unit_name: 'base_unit_name',
                dosage_form_name: 'dosage_form_name',
            },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: await this.withUnits(
                batch.data.map((row) => drugRowSchema.parse(row)),
            ),
            next_cursor: batch.next_cursor,
        };
    }

    private async row(id: string) {
        const scope = this.scope;
        const found = lookupId(id)
            ? await this.db.one(drugRowSchema, `${rowSql} and drugs.id = $3`, [
                  scope.tenantId,
                  scope.legalEntityId,
                  id,
              ])
            : undefined;
        if (!found) abort(404, 'Not Found');
        return found;
    }

    private async shown(id: string) {
        const [row] = await this.withUnits([await this.row(id)]);
        if (!row) abort(404, 'Not Found');
        return row;
    }

    // Isian barang diteruskan ke persediaan Core, yang memeriksanya dan melaporkan kesalahan bentuk sediaan dalam
    // jawaban 422 yang sama. Bentuk sediaan nonaktif hanya boleh tetap dipakai obat yang sudah memegangnya.
    private async read(
        body: unknown,
        saved: z.infer<typeof drugRowSchema> | null,
    ) {
        const data = parseInput(drugInputSchema, body, {
            code: 'Isi kode barang.',
            name: 'Isi nama barang.',
            base_unit_id: 'Pilih satuan dasar dari daftar.',
            dosage_form_id: 'Pilih dari daftar.',
        });
        const errors: Record<string, string> = {};
        const dosageFormId = data.dosage_form_id?.trim() || null;
        if (
            dosageFormId !== null &&
            !(
                lookupId(dosageFormId) &&
                (await this.db.one(
                    z.object({ id: z.string() }),
                    `select id from sim_m_bentuk_sediaan
                     where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3)`,
                    [
                        this.workspace.tenantId,
                        dosageFormId,
                        saved?.dosage_form_id ?? null,
                    ],
                ))
            )
        )
            errors.dosage_form_id = 'Pilih dari daftar.';
        const item: ItemInput = {
            code: data.code,
            name: data.name,
            base_unit_id: data.base_unit_id ?? '',
        };
        return {
            item,
            errors,
            dosageFormId,
            prescribable: data.is_prescribable,
        };
    }

    async create(body: unknown) {
        this.workspace.guard('drug', 'create');
        const scope = this.scope;
        const { item, errors, dosageFormId, prescribable } = await this.read(
            body,
            null,
        );
        const id = await this.db.transaction(async () => {
            const created = await createItem(this.db, scope, item, errors);
            const stamp = nowSql();
            await this.db.insert('sim_m_obat', {
                id: created,
                tenant_id: scope.tenantId,
                legal_entity_id: scope.legalEntityId,
                bentuk_sediaan_id: dosageFormId,
                boleh_diresepkan: prescribable,
                created_at: stamp,
                updated_at: stamp,
            });
            return created;
        });
        return {
            status: 201,
            headers: {},
            body: { data: await this.shown(id) },
        };
    }

    // Kategori, profil pelacakan, tolak stok minus, dan blokir tidak ada di kartu obat, jadi nilainya dibawa dari barang
    // apa adanya.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('drug', 'update');
        const scope = this.scope;
        const current = await this.row(id);
        const version = expectedVersion(request, body);
        const { item, errors, dosageFormId, prescribable } = await this.read(
            body,
            current,
        );
        await this.db.transaction(async () => {
            const stored = await this.db.one(
                z.object({
                    category_id: z.string().nullable(),
                    tracking_code_id: z.string().nullable(),
                    refuse_negative_stock: z.boolean().nullable(),
                    is_blocked: z.boolean(),
                }),
                `select kategori_id as category_id, profil_pelacakan_id as tracking_code_id,
                        tolak_stok_minus as refuse_negative_stock, diblokir as is_blocked from gd_m_barang
                 where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null for update`,
                [scope.tenantId, scope.legalEntityId, current.id],
            );
            if (!stored) abort(404, 'Not Found');
            await updateItem(
                this.db,
                scope,
                current.id,
                version,
                { ...item, ...stored },
                errors,
            );
            await this.db.execute(
                `update sim_m_obat set bentuk_sediaan_id = $1, boleh_diresepkan = $2, updated_at = $3
                 where tenant_id = $4 and id = $5 and deleted_at is null`,
                [
                    dosageFormId,
                    prescribable,
                    nowSql(),
                    scope.tenantId,
                    current.id,
                ],
            );
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.shown(id) },
        };
    }

    // Obat yang sudah dipakai resep atau dicatat sebagai alergi pasien tidak bisa dihapus; matikan Boleh diresepkan
    // supaya tidak dipilih lagi. Barangnya ikut dihapus lunak lewat persediaan Core, yang menolak barang bergerak stok.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('drug', 'delete');
        const scope = this.scope;
        const current = await this.row(id);
        const used = await this.db.one(
            z.object({ id: z.string() }),
            `select id from sim_tr_resep_detail where tenant_id = $1 and obat_id = $2 and deleted_at is null
             union all
             select id from sim_m_pasien_alergi
             where tenant_id = $1 and kategori = 'obat' and obat_id = $2 and deleted_at is null
             limit 1`,
            [scope.tenantId, current.id],
        );
        if (used)
            validation({
                id: 'Obat ini sudah dipakai di resep atau alergi pasien. Matikan Boleh diresepkan saja supaya tidak dipilih lagi.',
            });
        await this.db.transaction(async () => {
            await deleteItem(
                this.db,
                scope,
                current.id,
                expectedVersion(request, body),
            );
            const stamp = nowSql();
            await this.db.execute(
                `update sim_m_obat set deleted_at = $1, updated_at = $1
                 where tenant_id = $2 and id = $3 and deleted_at is null`,
                [stamp, scope.tenantId, current.id],
            );
        });
        return { status: 204, headers: {}, body: undefined };
    }
}
