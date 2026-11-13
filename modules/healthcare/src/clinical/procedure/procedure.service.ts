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
    isProcedureFlag,
    isProcedureOptionCode,
    procedureFlags,
    type ProcedureOption,
} from './procedure.options.ts';
import {
    procedureInputSchema,
    procedureRowSchema,
} from './procedure.schema.ts';

const flagEntries = Object.entries(procedureFlags).flatMap(
    ([flag, { column }]) => (isProcedureFlag(flag) ? [{ flag, column }] : []),
);

const rowSql = `select * from (
                    select t.id, t.kode as code, t.nama as name, t.nama_internasional as international_name,
                           t.kelompok_id as group_id, k.nama as group_name,
                           t.kategori_id as category_id, c.nama as category_name,
                           t.cost_rs_persen::text as hospital_cost_percent,
                           t.cost_rs_rupiah::text as hospital_cost_amount,
                           t.kelompok_posting as posting_group, t.sumber_insentif as incentive_source,
                           t.poliklinik as polyclinic,
                           ${flagEntries.map(({ flag, column }) => `t.${column} as ${flag}`).join(', ')},
                           coalesce((select json_agg(json_build_object('id', s.id, 'name', s.nama) order by s.nama, s.id)
                                     from sim_m_tindakan_section ts
                                     join sim_m_section s on s.tenant_id = ts.tenant_id and s.id = ts.section_id
                                     where ts.tenant_id = t.tenant_id and ts.tindakan_id = t.id and ts.deleted_at is null),
                                    '[]'::json) as sections,
                           t.aktif as is_active, t.version
                    from sim_m_tindakan t
                    left join sim_m_tindakan_kelompok k on k.tenant_id = t.tenant_id and k.id = t.kelompok_id
                    left join sim_m_tindakan_kategori c on c.tenant_id = t.tenant_id and c.id = t.kategori_id
                    where t.tenant_id = $1 and t.deleted_at is null) procedures
                where true`;

const found = z.object({ found: z.number() });

function codeTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('sim_m_tindakan_kode_unique')
    )
        validation({ code: 'Kode ini sudah ada di daftar tindakan.' });
}

// Angka Cost RS dari layar sudah berupa teks desimal (12.5). Kosong berarti 0, seperti nilai bawaan kolomnya.
function decimal(
    raw: string | number | undefined,
    limit: number,
): string | null {
    const text = raw === undefined ? '0' : String(raw).trim() || '0';
    if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) >= limit) return null;
    return text;
}

type Saved = {
    group_id: string | null;
    category_id: string | null;
    sections: { id: string }[];
};

// Tindakan milik tenant, diisi lewat Setup atau dari baris Biaya Tindakan oleh yang boleh memeriksa. Tarif belum ada.
export class Procedures {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    // Kelompok, kategori, dan section nonaktif ikut, supaya tindakan yang sudah memegangnya tetap terbaca namanya.
    async metadata() {
        this.workspace.guard('procedure', 'read');
        const has = (action: string) =>
            this.workspace.permissions.has(`healthcare.procedure.${action}`);
        const tenant = [this.workspace.tenantId];
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
                tenant,
            ),
            categories: await this.db.rows(
                z.object({
                    id: z.string(),
                    group_id: z.string(),
                    name: z.string(),
                    active: z.boolean(),
                }),
                `select id, kelompok_id as group_id, nama as name, aktif as active from sim_m_tindakan_kategori
                 where tenant_id = $1 and deleted_at is null order by nama, id`,
                tenant,
            ),
            sections: await this.db.rows(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    operating_unit_name: z.string(),
                    active: z.boolean(),
                }),
                `select s.id, s.nama as name, o.name as operating_unit_name, s.aktif as active
                 from sim_m_section s
                 join organizations o on o.tenant_id = s.tenant_id and o.id = s.operating_unit_id
                 where s.tenant_id = $1 and s.deleted_at is null order by o.name, s.nama`,
                tenant,
            ),
        };
    }

    // `section` hanya tindakan yang ditawarkan di section itu, seperti pilihan Biaya Tindakan sistem lama.
    async list(parameters: URLSearchParams) {
        this.workspace.guard('procedure', 'read');
        const bindings: (string | boolean)[] = [this.workspace.tenantId];
        const filters: string[] = [];
        const group = lookupId(parameters.get('group') ?? '');
        if (group) filters.push(`group_id = $${bindings.push(group)}`);
        const section = parameters.get('section');
        const sectionId = section === null ? null : lookupId(section);
        if (sectionId)
            filters.push(
                `exists (select 1 from sim_m_tindakan_section ts
                         where ts.tenant_id = $1 and ts.tindakan_id = procedures.id and ts.deleted_at is null
                           and ts.section_id = $${bindings.push(sectionId)})`,
            );
        else if (section !== null) filters.push('false');
        const status = parameters.get('status');
        if (status === 'active' || status === 'inactive')
            filters.push(`is_active = $${bindings.push(status === 'active')}`);
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filters.map((filter) => ` and ${filter}`).join('')}`,
            bindings,
            parameters,
            columns: { code: 'code', name: 'name', group_name: 'group_name' },
            searchColumns: ['code', 'name', 'international_name'],
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
        const row = lookupId(id)
            ? await this.db.one(
                  procedureRowSchema,
                  `${rowSql} and procedures.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!row) abort(404, 'Not Found');
        return row;
    }

    // Kelompok, kategori, dan section nonaktif hanya boleh tetap dipakai tindakan yang sudah memegangnya. Kategori harus
    // milik kelompok tindakan, seperti pilihan kategori kartu Jasa sistem lama yang disaring menurut kelompoknya.
    private async checked(body: unknown, saved: Saved | null) {
        const parsed = procedureInputSchema.safeParse(body);
        const errors: Record<string, string> = {};
        const data = parsed.success ? parsed.data : null;
        const tenantId = this.workspace.tenantId;
        const code = data?.code.trim() ?? '';
        const name = data?.name.trim() ?? '';
        const internationalName = data?.international_name?.trim() || null;
        const groupId = data?.group_id?.trim() || null;
        const categoryId = data?.category_id?.trim() || null;
        if (!code) errors.code = 'Isi kode tindakan.';
        else if (code.length > 20) errors.code = 'Paling panjang 20 karakter.';
        if (!name) errors.name = 'Isi nama tindakan.';
        else if (name.length > 200)
            errors.name = 'Paling panjang 200 karakter.';
        if (internationalName !== null && internationalName.length > 200)
            errors.international_name = 'Paling panjang 200 karakter.';
        if (groupId !== null) {
            const group = lookupId(groupId)
                ? await this.db.one(
                      found,
                      `select 1 as found from sim_m_tindakan_kelompok
                       where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3)`,
                      [tenantId, groupId, saved?.group_id ?? null],
                  )
                : undefined;
            if (!group) errors.group_id = 'Pilih dari daftar.';
        }
        if (categoryId !== null) {
            const category = lookupId(categoryId)
                ? await this.db.one(
                      z.object({ group_id: z.string() }),
                      `select kelompok_id as group_id from sim_m_tindakan_kategori
                       where tenant_id = $1 and id = $2 and deleted_at is null and (aktif or id = $3)`,
                      [tenantId, categoryId, saved?.category_id ?? null],
                  )
                : undefined;
            if (!category) errors.category_id = 'Pilih dari daftar.';
            else if (category.group_id !== groupId)
                errors.category_id =
                    'Pilih kategori dari kelompok tindakan ini.';
        }
        const hospitalCostPercent = decimal(data?.hospital_cost_percent, 1000);
        if (hospitalCostPercent === null)
            errors.hospital_cost_percent =
                'Isi angka 0 atau lebih, paling banyak dua angka di belakang koma.';
        const hospitalCostAmount = decimal(data?.hospital_cost_amount, 1e16);
        if (hospitalCostAmount === null)
            errors.hospital_cost_amount =
                'Isi angka 0 atau lebih, paling banyak dua angka di belakang koma.';
        const option = (name: ProcedureOption, fallback: string) => {
            const value = data?.[name] ?? fallback;
            if (!isProcedureOptionCode(name, value))
                errors[name] = 'Pilih dari daftar.';
            return value;
        };
        const postingGroup = option('posting_group', 'GROUP JASA');
        const incentiveSource = option('incentive_source', 'NONE');
        const polyclinic = option('polyclinic', 'NONE');
        const sectionIds =
            data?.section_ids === undefined
                ? null
                : [...new Set(data.section_ids)];
        if (sectionIds !== null) {
            const held = new Set((saved?.sections ?? []).map((row) => row.id));
            const valid = sectionIds.filter((id) => lookupId(id));
            const known = valid.length
                ? await this.db.rows(
                      z.object({ id: z.string(), active: z.boolean() }),
                      `select id, aktif as active from sim_m_section
                       where tenant_id = $1 and deleted_at is null and id = any($2::uuid[])`,
                      [tenantId, `{${valid.join(',')}}`],
                  )
                : [];
            if (
                sectionIds.some(
                    (id) =>
                        !known.some(
                            (row) =>
                                row.id === id && (row.active || held.has(id)),
                        ),
                )
            )
                errors.section_ids = 'Pilih section dari daftar.';
        }
        if (
            Object.keys(errors).length ||
            !data ||
            hospitalCostPercent === null ||
            hospitalCostAmount === null
        )
            validation(errors);
        const flagValues: Record<string, boolean> = {};
        for (const { flag, column } of flagEntries)
            flagValues[column] = data[flag] ?? false;
        return {
            values: {
                kode: code,
                nama: name,
                nama_internasional: internationalName,
                kelompok_id: groupId,
                kategori_id: categoryId,
                cost_rs_persen: hospitalCostPercent,
                cost_rs_rupiah: hospitalCostAmount,
                kelompok_posting: postingGroup,
                sumber_insentif: incentiveSource,
                poliklinik: polyclinic,
                aktif: data.is_active ?? true,
                ...flagValues,
            },
            sectionIds,
        };
    }

    // Section yang tidak dipilih lagi dilepas lewat deleted_at, yang baru ditambah.
    private async writeSections(
        procedureId: string,
        sectionIds: string[],
        stamp: string,
    ): Promise<void> {
        const tenantId = this.workspace.tenantId;
        await this.db.execute(
            `update sim_m_tindakan_section set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and tindakan_id = $3 and deleted_at is null
               and not (section_id = any($4::uuid[]))`,
            [stamp, tenantId, procedureId, `{${sectionIds.join(',')}}`],
        );
        for (const sectionId of sectionIds)
            await this.db.execute(
                `insert into sim_m_tindakan_section (id, tenant_id, tindakan_id, section_id, created_at, updated_at)
                 select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamp, $5::timestamp
                 where not exists (select 1 from sim_m_tindakan_section where tenant_id = $2 and tindakan_id = $3
                                   and section_id = $4 and deleted_at is null)`,
                [Bun.randomUUIDv7(), tenantId, procedureId, sectionId, stamp],
            );
    }

    async create(body: unknown) {
        this.workspace.guard('procedure', 'create');
        const data = await this.checked(body, null);
        const id = Bun.randomUUIDv7();
        const stamp = nowSql();
        try {
            await this.db.transaction(async () => {
                await this.db.insert('sim_m_tindakan', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    ...data.values,
                    created_at: stamp,
                    updated_at: stamp,
                });
                if (data.sectionIds)
                    await this.writeSections(id, data.sectionIds, stamp);
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
        const stamp = nowSql();
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                const columns = Object.entries(data.values);
                updated = await this.db.execute(
                    `update sim_m_tindakan
                     set ${columns.map(([column], index) => `${column} = $${index + 1}`).join(', ')},
                         updated_at = $${columns.length + 1}
                     where tenant_id = $${columns.length + 2} and id = $${columns.length + 3}
                       and version = $${columns.length + 4} and deleted_at is null`,
                    [
                        ...columns.map(([, value]) => value),
                        stamp,
                        this.workspace.tenantId,
                        current.id,
                        expectedVersion(request, body),
                    ],
                );
                if (updated && data.sectionIds)
                    await this.writeSections(
                        current.id,
                        data.sectionIds,
                        stamp,
                    );
            });
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
