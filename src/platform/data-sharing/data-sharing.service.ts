import { z } from 'zod';
import type { Workspace } from '../access/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Bind,
    type Database,
} from '../database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../http/index.ts';
import {
    dataSharingLegalEntitySchema,
    dataSharingPolicyInputSchema,
    dataSharingPolicyRowSchema,
    dataSharingTypeSchema,
} from './data-sharing.schema.ts';

const rowSql = `select * from (
    select p.id, p.name, json_build_object('code', t.code, 'name', t.name) as data_type, t.code as data_type_code,
           t.name as data_type_name, p.is_active, p.effective_from::text as effective_from, p.version,
           coalesce((select json_agg(json_build_object('id', o.id, 'name', o.name) order by o.name)
                     from data_sharing_policy_companies m
                     join organizations o on o.id = m.legal_entity_id
                     where m.tenant_id = p.tenant_id and m.policy_id = p.id and m.deleted_at is null),
                    '[]'::json) as legal_entities
    from data_sharing_policies p
    join data_sharing_types t on t.code = p.data_type_code
    where p.tenant_id = $1 and p.deleted_at is null) policies
    where true`;

// Jenis data yang boleh di-share tenant ini: milik Core, atau milik module yang dihak tenant dan sudah terpasang.
const typesSql = `select t.code, t.name, t.description from data_sharing_types t
    where t.app_id = 'core'
       or exists (select 1 from core_module_installations i
                  where i.tenant_id = $1 and i.module_id = t.app_id and i.status = 'installed'
                    and exists (select 1 from tenant_app_entitlements e
                                where e.tenant_id = i.tenant_id and e.app_id = i.module_id and e.status = 'active'
                                  and (e.ends_at is null or e.ends_at > current_timestamp)))
    order by t.name`;

// Perusahaan yang data jenis ini terlihat dari perusahaan itu: dirinya sendiri, ditambah anggota kebijakan aktif dan
// sudah berlaku untuk jenis data yang sama yang ia ikuti. Ini pintu yang dipakai module pemilik data saat menyaring
// datanya sendiri; Core hanya membaca kebijakan, tidak membaca tabel module.
export async function sharedLegalEntities(
    db: Database,
    tenantId: string,
    dataTypeCode: string,
    legalEntityId: string,
): Promise<string[]> {
    const rows = await db.rows(
        z.object({ legal_entity_id: z.string() }),
        `select distinct other.legal_entity_id
         from data_sharing_policy_companies own
         join data_sharing_policies policy on policy.tenant_id = own.tenant_id and policy.id = own.policy_id
              and policy.data_type_code = $3 and policy.is_active and policy.deleted_at is null
              and policy.effective_from <= current_date
         join data_sharing_policy_companies other on other.tenant_id = policy.tenant_id
              and other.policy_id = policy.id and other.deleted_at is null
         where own.tenant_id = $1 and own.legal_entity_id = $2 and own.deleted_at is null`,
        [tenantId, legalEntityId, dataTypeCode],
    );
    return [
        ...new Set([legalEntityId, ...rows.map((row) => row.legal_entity_id)]),
    ];
}

type Input = {
    name: string;
    data_type_code: string;
    is_active: boolean;
    effective_from: string;
    legal_entity_ids: string[];
};

// Kebijakan data sharing antar perusahaan. Mengikuti cross-company data sharing F&O:
// https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/sysadmin/cross-company-data-sharing
// - sysadmin memilih satu jenis data dan perusahaan mana saja yang saling melihatnya;
// - satu perusahaan hanya boleh ikut satu kebijakan aktif per jenis data ("a company and table can only be in one
//   enabled policy"), dan satu kebijakan butuh sedikitnya dua perusahaan;
// - kebijakan berlaku sejak tanggal berlaku mulai selama aktif. Perubahan tercatat lewat log_change, dan perusahaan
//   yang dilepas diarsipkan, tidak dihapus.
// Kepemilikan data tidak berubah; yang berubah hanya siapa yang melihatnya, dihitung module pemilik datanya lewat
// sharedLegalEntities.
export class DataSharingPolicies {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(parameters: URLSearchParams) {
        this.workspace.guard('data-sharing', 'read');
        const status = parameters.get('status');
        const dataType = parameters.get('data_type');
        const bindings: Bind[] = [this.workspace.tenantId];
        let filter =
            status === 'active'
                ? ' and is_active'
                : status === 'inactive'
                  ? ' and not is_active'
                  : '';
        if (dataType) {
            bindings.push(dataType);
            filter += ` and data_type_code = $${bindings.length}`;
        }
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${filter}`,
            bindings,
            parameters,
            columns: {
                name: 'name',
                data_type: 'data_type_name',
                effective_from: 'effective_from',
            },
            searchColumns: ['name', 'data_type_name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) =>
                dataSharingPolicyRowSchema.parse(row),
            ),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'core.data-sharing.update',
            ),
        };
    }

    async types() {
        this.workspace.guard('data-sharing', 'read');
        return {
            data: await this.db.rows(dataSharingTypeSchema, typesSql, [
                this.workspace.tenantId,
            ]),
        };
    }

    // Semua legal entity tenant untuk dipilih, beserta kebijakan aktif yang sudah ia ikuti untuk jenis data itu. Jumlahnya
    // kecil dan terbatas, jadi dikirim sekaligus.
    async legalEntities(dataTypeCode: string | null) {
        this.workspace.guard('data-sharing', 'read');
        const policy = (column: string) =>
            `(select p.${column} from data_sharing_policy_companies m
              join data_sharing_policies p on p.tenant_id = m.tenant_id and p.id = m.policy_id
                   and p.data_type_code = $2 and p.is_active and p.deleted_at is null
              where m.tenant_id = o.tenant_id and m.legal_entity_id = o.id and m.deleted_at is null
              limit 1)`;
        return {
            data: await this.db.rows(
                dataSharingLegalEntitySchema,
                `select o.id, o.name, l.company_code, ${policy('id')} as policy_id, ${policy('name')} as policy_name
                 from organizations o
                 join legal_entities l on l.organization_id = o.id
                 where o.tenant_id = $1 and o.classification = 'legal_entity' and o.status = 'active'
                 order by o.name`,
                [this.workspace.tenantId, dataTypeCode ?? ''],
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  dataSharingPolicyRowSchema,
                  `${rowSql} and policies.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Kebijakan data sharing tidak ditemukan.');
        return found;
    }

    private async checked(body: unknown): Promise<Input> {
        const parsed = dataSharingPolicyInputSchema.safeParse(body);
        const data = parsed.success ? parsed.data : null;
        const errors: Record<string, string> = {};
        const name = data?.name.trim() ?? '';
        if (!name) errors.name = 'Isi nama kebijakan.';
        else if (name.length > 100)
            errors.name = 'Nama kebijakan paling banyak 100 karakter.';
        const types = await this.db.rows(dataSharingTypeSchema, typesSql, [
            this.workspace.tenantId,
        ]);
        const dataTypeCode = data?.data_type_code ?? '';
        if (!types.some((type) => type.code === dataTypeCode))
            errors.data_type_code = 'Pilih data yang di-share dari daftar.';
        const effectiveFrom = data?.effective_from ?? '';
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) ||
            Number.isNaN(Date.parse(`${effectiveFrom}T00:00:00Z`))
        )
            errors.effective_from = 'Isi tanggal berlaku mulai.';
        const ids = [...new Set(data?.legal_entity_ids ?? [])];
        if (ids.length < 2)
            errors.legal_entity_ids =
                'Pilih sedikitnya dua perusahaan yang saling sharing data ini.';
        else if (!ids.every((id) => lookupId(id)))
            errors.legal_entity_ids = 'Pilih perusahaan dari daftar.';
        if (Object.keys(errors).length || !data) validation(errors);
        const known = await this.db.rows(
            z.object({ id: z.string() }),
            `select id from organizations where tenant_id = $1 and classification = 'legal_entity'
               and id in (${ids.map((_, index) => `$${index + 2}`).join(',')})`,
            [this.workspace.tenantId, ...ids],
        );
        if (known.length !== ids.length)
            validation({ legal_entity_ids: 'Pilih perusahaan dari daftar.' });
        return {
            name,
            data_type_code: dataTypeCode,
            is_active: data.is_active ?? true,
            effective_from: effectiveFrom,
            legal_entity_ids: ids,
        };
    }

    // Satu perusahaan hanya ikut satu kebijakan aktif per jenis data. Dijalankan di bawah kunci per tenant, supaya dua
    // admin yang menyimpan bersamaan tidak sama-sama lolos.
    private async checkSingleActivePolicy(
        policyId: string,
        input: Input,
    ): Promise<void> {
        await this.db.execute(
            "select pg_advisory_xact_lock(hashtextextended('data_sharing_policies:' || $1, 0))",
            [this.workspace.tenantId],
        );
        if (!input.is_active) return;
        const bindings: Bind[] = [
            this.workspace.tenantId,
            policyId,
            input.data_type_code,
        ];
        const conflicts = await this.db.rows(
            z.object({
                legal_entity_name: z.string(),
                policy_name: z.string(),
            }),
            `select o.name as legal_entity_name, p.name as policy_name
             from data_sharing_policy_companies m
             join data_sharing_policies p on p.tenant_id = m.tenant_id and p.id = m.policy_id
                  and p.is_active and p.deleted_at is null and p.id <> $2 and p.data_type_code = $3
             join organizations o on o.id = m.legal_entity_id
             where m.tenant_id = $1 and m.deleted_at is null
               and m.legal_entity_id in (${input.legal_entity_ids
                   .map((id) => {
                       bindings.push(id);
                       return `$${bindings.length}`;
                   })
                   .join(',')})
             order by o.name`,
            bindings,
        );
        if (conflicts.length)
            validation({
                legal_entity_ids: conflicts.map(
                    (conflict) =>
                        `${conflict.legal_entity_name} sudah ikut kebijakan aktif "${conflict.policy_name}" untuk data yang sama. Satu perusahaan hanya boleh ikut satu kebijakan aktif per data; nonaktifkan kebijakan itu atau lepaskan perusahaannya lebih dulu.`,
                ),
            });
    }

    // Perusahaan kebijakan diganti: yang tidak dipilih lagi diarsipkan, yang baru ditambah.
    private async writeMembers(policyId: string, ids: string[]) {
        const stamp = nowSql();
        await this.db.execute(
            `update data_sharing_policy_companies set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and policy_id = $3 and deleted_at is null
               and legal_entity_id not in (${ids.map((_, index) => `$${index + 4}`).join(',')})`,
            [stamp, this.workspace.tenantId, policyId, ...ids],
        );
        for (const legalEntityId of ids)
            await this.db.execute(
                `insert into data_sharing_policy_companies (id, tenant_id, policy_id, legal_entity_id, created_at, updated_at)
                 select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamp, $5::timestamp
                 where not exists (select 1 from data_sharing_policy_companies where tenant_id = $2
                                   and policy_id = $3 and legal_entity_id = $4::uuid and deleted_at is null)`,
                [
                    Bun.randomUUIDv7(),
                    this.workspace.tenantId,
                    policyId,
                    legalEntityId,
                    stamp,
                ],
            );
    }

    async create(body: unknown) {
        this.workspace.guard('data-sharing', 'update');
        const input = await this.checked(body);
        const id = Bun.randomUUIDv7();
        try {
            await this.db.transaction(async () => {
                await this.checkSingleActivePolicy(id, input);
                const stamp = nowSql();
                await this.db.insert('data_sharing_policies', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    name: input.name,
                    data_type_code: input.data_type_code,
                    is_active: input.is_active,
                    effective_from: input.effective_from,
                    created_at: stamp,
                    updated_at: stamp,
                });
                await this.writeMembers(id, input.legal_entity_ids);
            });
        } catch (error) {
            nameTaken(error);
            throw error;
        }
        return { status: 201, headers: {}, body: { data: await this.row(id) } };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('data-sharing', 'update');
        const current = await this.row(id);
        const input = await this.checked(body);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                await this.checkSingleActivePolicy(current.id, input);
                updated = await this.db.execute(
                    `update data_sharing_policies set name = $1, data_type_code = $2, is_active = $3, effective_from = $4,
                            updated_at = $5
                     where tenant_id = $6 and id = $7 and version = $8 and deleted_at is null`,
                    [
                        input.name,
                        input.data_type_code,
                        input.is_active,
                        input.effective_from,
                        nowSql(),
                        this.workspace.tenantId,
                        current.id,
                        version,
                    ],
                );
                if (updated)
                    await this.writeMembers(current.id, input.legal_entity_ids);
            });
        } catch (error) {
            nameTaken(error);
            throw error;
        }
        if (!updated) coded(409, 'stale_version', staleMessage);
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Menghapus berarti mengisi deleted_at pada kebijakan beserta perusahaannya. Data tidak berubah; perusahaan yang
    // tadinya sharing kembali hanya melihat datanya sendiri.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('data-sharing', 'update');
        const current = await this.row(id);
        const stamp = nowSql();
        let deleted = 0;
        await this.db.transaction(async () => {
            deleted = await this.db.execute(
                'update data_sharing_policies set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
                [
                    stamp,
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
            if (deleted)
                await this.db.execute(
                    'update data_sharing_policy_companies set deleted_at = $1, updated_at = $1 where tenant_id = $2 and policy_id = $3 and deleted_at is null',
                    [stamp, this.workspace.tenantId, current.id],
                );
        });
        if (!deleted) coded(409, 'stale_version', staleMessage);
        return { status: 204, headers: {}, body: undefined };
    }
}

function nameTaken(error: unknown): void {
    if (
        sqlErrorCode(error) === '23505' &&
        error instanceof Error &&
        error.message.includes('data_sharing_policies_name_unique')
    )
        validation({ name: 'Nama ini sudah dipakai kebijakan lain.' });
}
