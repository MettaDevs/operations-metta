import { z } from 'zod';
import type { Workspace } from '@core/platform/access/index.ts';
import {
    nowSql,
    sqlErrorCode,
    type Bind,
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
    sharingLegalEntitySchema,
    sharingPolicyInputSchema,
    sharingPolicyRowSchema,
} from './sharing-policy.schema.ts';

const rowSql = `select * from (
    select p.id, p.nama as name, p.aktif as is_active, p.berlaku_mulai::text as effective_from, p.version,
           coalesce((select json_agg(json_build_object('id', o.id, 'name', o.name) order by o.name)
                     from sim_m_kebijakan_berbagi_perusahaan m
                     join organizations o on o.id = m.legal_entity_id
                     where m.tenant_id = p.tenant_id and m.kebijakan_id = p.id and m.deleted_at is null),
                    '[]'::json) as legal_entities
    from sim_m_kebijakan_berbagi p where p.tenant_id = $1 and p.deleted_at is null) policies
    where true`;

type Input = {
    name: string;
    is_active: boolean;
    effective_from: string;
    legal_entity_ids: string[];
};

// Kebijakan berbagi pasien antar legal entity. Mengikuti cross-company data sharing F&O:
// https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/sysadmin/cross-company-data-sharing
// - sysadmin memilih legal entity mana saja yang saling melihat pasien;
// - satu legal entity hanya boleh ikut satu kebijakan aktif ("a company and table can only be in one enabled policy");
// - kebijakan berlaku sejak tanggal berlaku_mulai selama aktif. Perubahan tercatat lewat log_change, dan legal entity
//   yang dilepas diarsipkan, tidak dihapus.
// Kepemilikan pasien tidak berubah; yang berubah hanya siapa yang melihatnya (PatientSharing).
export class SharingPolicies {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(parameters: URLSearchParams) {
        this.workspace.guard('patient-sharing', 'read');
        const status = parameters.get('status');
        const batch = await incrementalList(this.db, {
            query: `${rowSql}${status === 'active' ? ' and is_active' : status === 'inactive' ? ' and not is_active' : ''}`,
            bindings: [this.workspace.tenantId],
            parameters,
            columns: { name: 'name', effective_from: 'effective_from' },
            searchColumns: ['name'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        return {
            data: batch.data.map((row) => sharingPolicyRowSchema.parse(row)),
            next_cursor: batch.next_cursor,
            can_manage: this.workspace.permissions.has(
                'healthcare.patient-sharing.update',
            ),
        };
    }

    // Semua legal entity tenant untuk dipilih. Jumlahnya kecil dan terbatas, jadi dikirim sekaligus.
    async legalEntities() {
        this.workspace.guard('patient-sharing', 'read');
        return {
            data: await this.db.rows(
                sharingLegalEntitySchema,
                `select o.id, o.name, l.company_code,
                        (select p.id from sim_m_kebijakan_berbagi_perusahaan m
                         join sim_m_kebijakan_berbagi p on p.tenant_id = m.tenant_id and p.id = m.kebijakan_id
                              and p.aktif and p.deleted_at is null
                         where m.tenant_id = o.tenant_id and m.legal_entity_id = o.id and m.deleted_at is null
                         limit 1) as policy_id,
                        (select p.nama from sim_m_kebijakan_berbagi_perusahaan m
                         join sim_m_kebijakan_berbagi p on p.tenant_id = m.tenant_id and p.id = m.kebijakan_id
                              and p.aktif and p.deleted_at is null
                         where m.tenant_id = o.tenant_id and m.legal_entity_id = o.id and m.deleted_at is null
                         limit 1) as policy_name
                 from organizations o
                 join legal_entities l on l.organization_id = o.id
                 where o.tenant_id = $1 and o.classification = 'legal_entity' and o.status = 'active'
                 order by o.name`,
                [this.workspace.tenantId],
            ),
        };
    }

    private async row(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  sharingPolicyRowSchema,
                  `${rowSql} and policies.id = $2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Kebijakan berbagi tidak ditemukan.');
        return found;
    }

    private async checked(body: unknown): Promise<Input> {
        const parsed = sharingPolicyInputSchema.safeParse(body);
        const data = parsed.success ? parsed.data : null;
        const errors: Record<string, string> = {};
        const name = data?.name.trim() ?? '';
        if (!name) errors.name = 'Isi nama kebijakan.';
        else if (name.length > 100)
            errors.name = 'Nama kebijakan paling banyak 100 karakter.';
        const effectiveFrom = data?.effective_from ?? '';
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) ||
            Number.isNaN(Date.parse(`${effectiveFrom}T00:00:00Z`))
        )
            errors.effective_from = 'Isi tanggal berlaku mulai.';
        const ids = [...new Set(data?.legal_entity_ids ?? [])];
        if (ids.length < 2)
            errors.legal_entity_ids =
                'Pilih sedikitnya dua perusahaan yang saling berbagi pasien.';
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
            is_active: data.is_active ?? true,
            effective_from: effectiveFrom,
            legal_entity_ids: ids,
        };
    }

    // Satu legal entity hanya ikut satu kebijakan aktif. Dijalankan di bawah kunci per tenant, supaya dua admin yang
    // menyimpan bersamaan tidak sama-sama lolos.
    private async checkSingleActivePolicy(
        policyId: string,
        input: Input,
    ): Promise<void> {
        await this.db.execute(
            "select pg_advisory_xact_lock(hashtextextended('sim_m_kebijakan_berbagi:' || $1, 0))",
            [this.workspace.tenantId],
        );
        if (!input.is_active) return;
        const bindings: Bind[] = [this.workspace.tenantId, policyId];
        const conflicts = await this.db.rows(
            z.object({
                legal_entity_name: z.string(),
                policy_name: z.string(),
            }),
            `select o.name as legal_entity_name, p.nama as policy_name
             from sim_m_kebijakan_berbagi_perusahaan m
             join sim_m_kebijakan_berbagi p on p.tenant_id = m.tenant_id and p.id = m.kebijakan_id
                  and p.aktif and p.deleted_at is null and p.id <> $2
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
                        `${conflict.legal_entity_name} sudah ikut kebijakan aktif "${conflict.policy_name}". Satu perusahaan hanya boleh ikut satu kebijakan aktif; nonaktifkan kebijakan itu atau lepaskan perusahaannya lebih dulu.`,
                ),
            });
    }

    // Legal entity kebijakan diganti: yang tidak dipilih lagi diarsipkan, yang baru ditambah.
    private async writeMembers(policyId: string, ids: string[]) {
        const stamp = nowSql();
        await this.db.execute(
            `update sim_m_kebijakan_berbagi_perusahaan set deleted_at = $1, updated_at = $1
             where tenant_id = $2 and kebijakan_id = $3 and deleted_at is null
               and legal_entity_id not in (${ids.map((_, index) => `$${index + 4}`).join(',')})`,
            [stamp, this.workspace.tenantId, policyId, ...ids],
        );
        for (const legalEntityId of ids)
            await this.db.execute(
                `insert into sim_m_kebijakan_berbagi_perusahaan (id, tenant_id, kebijakan_id, legal_entity_id, created_at, updated_at)
                 select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamp, $5::timestamp
                 where not exists (select 1 from sim_m_kebijakan_berbagi_perusahaan where tenant_id = $2
                                   and kebijakan_id = $3 and legal_entity_id = $4::uuid and deleted_at is null)`,
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
        this.workspace.guard('patient-sharing', 'update');
        const input = await this.checked(body);
        const id = Bun.randomUUIDv7();
        try {
            await this.db.transaction(async () => {
                await this.checkSingleActivePolicy(id, input);
                const stamp = nowSql();
                await this.db.insert('sim_m_kebijakan_berbagi', {
                    id,
                    tenant_id: this.workspace.tenantId,
                    nama: input.name,
                    aktif: input.is_active,
                    berlaku_mulai: input.effective_from,
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
        this.workspace.guard('patient-sharing', 'update');
        const current = await this.row(id);
        const input = await this.checked(body);
        const version = expectedVersion(request, body);
        let updated = 0;
        try {
            await this.db.transaction(async () => {
                await this.checkSingleActivePolicy(current.id, input);
                updated = await this.db.execute(
                    `update sim_m_kebijakan_berbagi set nama = $1, aktif = $2, berlaku_mulai = $3, updated_at = $4
                     where tenant_id = $5 and id = $6 and version = $7 and deleted_at is null`,
                    [
                        input.name,
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

    // Menghapus berarti mengisi deleted_at pada kebijakan beserta legal entity-nya. Pasien tidak berubah; legal entity
    // yang tadinya berbagi kembali hanya melihat pasiennya sendiri.
    async destroy(request: Request, id: string, body: unknown) {
        this.workspace.guard('patient-sharing', 'update');
        const current = await this.row(id);
        const stamp = nowSql();
        let deleted = 0;
        await this.db.transaction(async () => {
            deleted = await this.db.execute(
                'update sim_m_kebijakan_berbagi set deleted_at = $1, updated_at = $1 where tenant_id = $2 and id = $3 and version = $4 and deleted_at is null',
                [
                    stamp,
                    this.workspace.tenantId,
                    current.id,
                    expectedVersion(request, body),
                ],
            );
            if (deleted)
                await this.db.execute(
                    'update sim_m_kebijakan_berbagi_perusahaan set deleted_at = $1, updated_at = $1 where tenant_id = $2 and kebijakan_id = $3 and deleted_at is null',
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
        error.message.includes('sim_m_kebijakan_berbagi_nama_unique')
    )
        validation({ name: 'Nama ini sudah dipakai kebijakan lain.' });
}
