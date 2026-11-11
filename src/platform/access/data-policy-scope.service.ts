import { z } from 'zod';
import type { Database } from '../database/index.ts';
import { lookupId, validation } from '../http/index.ts';
import type { PolicyScopeInput } from './membership.schema.ts';
import { effectiveRoleIds } from './security.service.ts';

const ids = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => `$${start + index}`).join(',');

export type ResolvedScope = {
    policy_code: string;
    legal_entity_id: string | null;
    organization_id: string | null;
    hierarchy_id: string | null;
    hierarchy_version_id: string | null;
    include_descendants: boolean;
};

const policySchema = z.object({
    code: z.string(),
    protected_permissions: z.array(z.string()),
    requires_legal_entity: z.boolean(),
    requires_operating_unit: z.boolean(),
    allows_descendants: z.boolean(),
});

// DataPolicyScopeResolver CoreERP: memeriksa satu batas data penugasan terhadap kebijakan data yang dipakai role-nya,
// lalu mengisi versi hierarchy yang berlaku bila batas itu menyertakan turunan.
export async function resolveScope(
    db: Database,
    tenantId: string,
    roleId: string,
    data: PolicyScopeInput,
): Promise<ResolvedScope> {
    const policy = await db.one(
        policySchema,
        `select code, protected_permissions::jsonb as protected_permissions, requires_legal_entity,
                requires_operating_unit, allows_descendants
         from app_data_policies where code=$1`,
        [data.policy_code],
    );
    if (!policy || !(await roleUsesPolicy(db, tenantId, roleId, policy)))
        validation({
            policy_code:
                'Policy data tidak tersedia untuk tanggung jawab bisnis yang dipilih.',
        });

    // Grant tanpa dimensi berarti seluruh organisasi; dimensi wajib policy sengaja dilewati karena tidak ada batas
    // yang dipasang.
    if (data.unrestricted)
        return {
            policy_code: policy.code,
            legal_entity_id: null,
            organization_id: null,
            hierarchy_id: null,
            hierarchy_version_id: null,
            include_descendants: false,
        };

    const legalEntityId = await legalEntity(
        db,
        tenantId,
        data.legal_entity_id,
        policy.requires_legal_entity,
    );
    const organization = await organizationFor(
        db,
        tenantId,
        data.organization_id,
        policy.requires_operating_unit,
    );
    if (
        organization?.classification === 'legal_entity' &&
        legalEntityId !== null &&
        organization.id !== legalEntityId
    )
        validation({
            organization_id:
                'Node legal entity harus sama dengan legal entity pada batas akses.',
        });
    if (data.include_descendants && !policy.allows_descendants)
        validation({
            include_descendants:
                'Policy data ini tidak mendukung akses ke organisasi turunan.',
        });
    if (!data.include_descendants)
        return {
            policy_code: policy.code,
            legal_entity_id: legalEntityId,
            organization_id: organization?.id ?? null,
            hierarchy_id: null,
            hierarchy_version_id: null,
            include_descendants: false,
        };
    if (!organization)
        validation({
            organization_id: 'Pilih organisasi sebelum menyertakan turunannya.',
        });
    const hierarchyId = data.hierarchy_id ? lookupId(data.hierarchy_id) : null;
    const version = hierarchyId
        ? await db.one(
              z.object({ id: z.string() }),
              `select v.id from organization_hierarchy_versions v
               join organization_hierarchies h on h.id=v.hierarchy_id
               where h.tenant_id=$1 and h.status='active' and h.id=$2 and v.status='published'
               and v.effective_from<=current_timestamp
               order by v.effective_from desc, v.version_number desc limit 1`,
              [tenantId, hierarchyId],
          )
        : undefined;
    const contains = version
        ? await db.one(
              z.object({ found: z.boolean() }),
              'select true as found from organization_hierarchy_nodes where version_id=$1 and organization_id=$2 and deleted_at is null limit 1',
              [version.id, organization.id],
          )
        : undefined;
    if (!hierarchyId || !version || !contains)
        validation({
            hierarchy_id:
                'Pilih susunan organisasi aktif yang memuat organisasi tersebut.',
        });
    return {
        policy_code: policy.code,
        legal_entity_id: legalEntityId,
        organization_id: organization.id,
        hierarchy_id: hierarchyId,
        hierarchy_version_id: version.id,
        include_descendants: true,
    };
}

// DataPolicyScopeResolver::assertNoRedundantGrants: batas yang sama atau sudah tercakup tidak boleh dua kali pada
// role yang sama, dan seluruh organisasi tidak boleh digabung dengan batas lain.
export function assertNoRedundantGrants(scopes: PolicyScopeInput[]): void {
    scopes.forEach((scope, index) => {
        for (const other of scopes.slice(index + 1)) {
            if (scope.policy_code !== other.policy_code) continue;
            if (scope.unrestricted || other.unrestricted)
                validation({
                    assignments:
                        'Batas data seluruh organisasi tidak boleh digabung dengan batas data lain pada role yang sama.',
                });
            if (
                scope.legal_entity_id !== other.legal_entity_id ||
                scope.organization_id !== other.organization_id
            )
                continue;
            const sameGrant =
                (!scope.include_descendants && !other.include_descendants) ||
                (scope.include_descendants &&
                    other.include_descendants &&
                    scope.hierarchy_id === other.hierarchy_id);
            const directGrantCovered =
                scope.include_descendants !== other.include_descendants;
            if (sameGrant || directGrantCovered)
                validation({
                    assignments:
                        'Batas data yang sama atau sudah tercakup tidak boleh ditambahkan dua kali pada role yang sama.',
                });
        }
    });
}

async function legalEntity(
    db: Database,
    tenantId: string,
    id: string | null,
    required: boolean,
): Promise<string | null> {
    if (id === null) {
        if (required)
            validation({
                legal_entity_id: 'Pilih legal entity untuk batas akses ini.',
            });
        return null;
    }
    const found = lookupId(id)
        ? await db.one(
              z.object({ id: z.string() }),
              "select id from organizations where tenant_id=$1 and status='active' and classification='legal_entity' and id=$2",
              [tenantId, id],
          )
        : undefined;
    if (!found)
        validation({
            legal_entity_id: 'Legal entity tidak tersedia pada bisnis aktif.',
        });
    return found.id;
}

async function organizationFor(
    db: Database,
    tenantId: string,
    id: string | null,
    requiresOperatingUnit: boolean,
) {
    if (id === null) {
        if (requiresOperatingUnit)
            validation({
                organization_id:
                    'Pilih unit atau node organisasi untuk batas akses ini.',
            });
        return null;
    }
    const found = lookupId(id)
        ? await db.one(
              z.object({ id: z.string(), classification: z.string() }),
              "select id, classification from organizations where tenant_id=$1 and status='active' and id=$2",
              [tenantId, id],
          )
        : undefined;
    if (!found)
        validation({
            organization_id: 'Organisasi tidak tersedia pada bisnis aktif.',
        });
    if (requiresOperatingUnit && found.classification !== 'operating_unit')
        validation({
            organization_id:
                'Pilih unit kerja, bukan legal entity, untuk batas akses ini.',
        });
    return found;
}

async function roleUsesPolicy(
    db: Database,
    tenantId: string,
    roleId: string,
    policy: z.infer<typeof policySchema>,
): Promise<boolean> {
    const roleIds = await effectiveRoleIds(db, tenantId, [roleId]);
    if (!roleIds.length || !policy.protected_permissions.length) return false;
    const found = await db.one(
        z.object({ found: z.boolean() }),
        `select true as found from security_role_duties rd
         join security_duty_privileges dp on dp.duty_code=rd.duty_code
         join security_privilege_permissions pp on pp.privilege_code=dp.privilege_code
         where rd.role_id in (${ids(1, roleIds.length)})
         and pp.permission_code in (${ids(roleIds.length + 1, policy.protected_permissions.length)})
         limit 1`,
        [...roleIds, ...policy.protected_permissions],
    );
    return Boolean(found);
}
