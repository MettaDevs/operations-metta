import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    nowSql,
    type Bind,
    type Database,
} from '@core/platform/database/index.ts';
import {
    abort,
    coded,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '@core/platform/http/index.ts';
import {
    activeLegalEntity,
    parseInput,
} from '@core/foundation/inventory/index.ts';
import { drugInputSchema, drugRowSchema } from './drug.schema.ts';

const rowSql = `select * from (
                    select b.id, b.kode as code, b.nama as name, s.nama as base_unit_name, b.diblokir as is_blocked,
                           coalesce(o.generik, false) as is_generic, coalesce(o.formularium, false) as is_formulary,
                           coalesce(o.version, 0) as version, g.id as drug_class_id, coalesce(g.kode, '') as drug_class_code,
                           case when g.id is null then null
                                else json_build_object('id', g.id, 'code', g.kode, 'name', g.nama) end as drug_class,
                           case when k.id is null then null
                                else json_build_object('id', k.id, 'name', k.nama) end as grading_group
                    from gd_m_barang b
                    join gd_m_satuan s on s.tenant_id = b.tenant_id and s.id = b.satuan_dasar_id
                    left join far_m_obat o on o.tenant_id = b.tenant_id and o.id = b.id and o.deleted_at is null
                    left join far_m_golongan_obat g on g.tenant_id = o.tenant_id and g.id = o.golongan_obat_id
                    left join far_m_kelompok_grading k on k.tenant_id = o.tenant_id and k.id = o.kelompok_grading_id
                    where b.tenant_id = $1 and b.legal_entity_id = $2 and b.deleted_at is null) drugs
                where true`;

// Data obat farmasi untuk setiap barang persediaan legal entity tempat kerja (table extension BC atas Item). Barangnya
// sendiri diubah di kartu barang Core; layar ini hanya menulis baris perluasan milik farmasi.
export class Drugs {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    private get scope() {
        return {
            tenantId: this.workspace.tenantId,
            legalEntityId: activeLegalEntity(this.workspace),
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('drug', 'read');
        const scope = this.scope;
        const bindings: Bind[] = [scope.tenantId, scope.legalEntityId];
        let filter = '';
        const drugClass = parameters.get('drug_class') ?? '';
        if (drugClass === 'none') filter += ' and drug_class_id is null';
        else if (lookupId(drugClass))
            filter += ` and drug_class_id = $${bindings.push(drugClass)}`;
        for (const [name, column] of [
            ['generic', 'is_generic'],
            ['formulary', 'is_formulary'],
        ] as const) {
            const value = parameters.get(name);
            if (value === 'true' || value === 'false')
                filter += ` and ${column} = ${value}`;
        }
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                code: 'code',
                name: 'name',
                drug_class: 'drug_class_code',
            },
            searchColumns: ['code', 'name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => drugRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has('pharmacy.drug.update'),
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

    // Baris perluasan lahir saat data farmasi barang itu pertama kali disimpan (version 0), lalu diubah dengan
    // compare-and-set versinya.
    async update(id: string, body: unknown) {
        this.workspace.guard('drug', 'update');
        const current = await this.row(id);
        const data = parseInput(drugInputSchema, body, {
            drug_class_id: 'Pilih golongan obat dari daftar.',
            grading_group_id: 'Pilih kelompok grading dari daftar.',
            is_generic: 'Pilih ya atau tidak.',
            is_formulary: 'Pilih ya atau tidak.',
            version: 'Muat ulang data obat ini, lalu ulangi perubahanmu.',
        });
        const scope = this.scope;
        const drugClassId = data.drug_class_id || null;
        if (
            drugClassId !== null &&
            !(
                lookupId(drugClassId) &&
                (await this.db.one(
                    z.object({ id: z.string() }),
                    `select id from far_m_golongan_obat
                     where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null`,
                    [scope.tenantId, scope.legalEntityId, drugClassId],
                ))
            )
        )
            validation({ drug_class_id: 'Pilih golongan obat dari daftar.' });
        // Kelompok nonaktif hanya boleh tetap dipegang obat yang sudah memegangnya.
        const gradingGroupId =
            data.grading_group_id === undefined
                ? (current.grading_group?.id ?? null)
                : data.grading_group_id || null;
        if (
            gradingGroupId !== null &&
            !(
                lookupId(gradingGroupId) &&
                (await this.db.one(
                    z.object({ id: z.string() }),
                    `select id from far_m_kelompok_grading
                     where tenant_id = $1 and legal_entity_id = $2 and id = $3 and deleted_at is null
                       and (aktif or id = $4::uuid)`,
                    [
                        scope.tenantId,
                        scope.legalEntityId,
                        gradingGroupId,
                        current.grading_group?.id ?? null,
                    ],
                ))
            )
        )
            validation({
                grading_group_id: 'Pilih kelompok grading dari daftar.',
            });
        const stamp = nowSql();
        const written =
            data.version === 0
                ? await this.db.execute(
                      `insert into far_m_obat (id, tenant_id, legal_entity_id, golongan_obat_id, generik, formularium,
                                               kelompok_grading_id, created_at, updated_at)
                       values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
                       on conflict (id) do nothing`,
                      [
                          current.id,
                          scope.tenantId,
                          scope.legalEntityId,
                          drugClassId,
                          data.is_generic,
                          data.is_formulary,
                          gradingGroupId,
                          stamp,
                      ],
                  )
                : await this.db.execute(
                      `update far_m_obat set golongan_obat_id = $1, generik = $2, formularium = $3,
                              kelompok_grading_id = $4, updated_at = $5
                       where tenant_id = $6 and id = $7 and version = $8`,
                      [
                          drugClassId,
                          data.is_generic,
                          data.is_formulary,
                          gradingGroupId,
                          stamp,
                          scope.tenantId,
                          current.id,
                          data.version,
                      ],
                  );
        if (!written) coded(409, 'stale_version', staleMessage);
        return { data: await this.row(current.id) };
    }
}
