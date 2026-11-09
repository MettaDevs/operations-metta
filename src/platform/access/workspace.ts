import { z } from 'zod';
import { Database } from '../database/index.ts';
import { abort, validation } from '../http/index.ts';
import type { Session } from '../identity/index.ts';

const membershipSchema = z.object({ id: z.string(), tenant_id: z.string() });
const organizationSchema = z.object({
    id: z.string(),
    tenant_id: z.string(),
    name: z.string(),
    classification: z.enum(['legal_entity', 'operating_unit']),
});
const scopeSchema = z.object({
    policy_code: z.string(),
    legal_entity_id: z.string().nullable(),
    organization_id: z.string().nullable(),
    hierarchy_version_id: z.string().nullable(),
    include_descendants: z.boolean(),
});
type Membership = z.infer<typeof membershipSchema>;
type Organization = z.infer<typeof organizationSchema>;
type Grant = { legalEntityId: string | null; operatingUnitIds: string[] };
export type Policy = { kind: 'all' } | { kind: 'grants'; grants: Grant[] };

export class Workspace {
    private constructor(
        readonly tenantId: string,
        readonly membershipId: string,
        readonly userId: string,
        readonly legalEntityId: string | null,
        readonly orgUnitId: string | null,
        readonly permissions: Set<string>,
        readonly policy: Policy,
        readonly moduleId: string,
    ) {}

    private static async memberships(
        db: Database,
        session: Session,
    ): Promise<Membership[]> {
        const user = session.requireUser();
        const memberships = await db.rows(
            membershipSchema,
            "select m.id,m.tenant_id from tenant_memberships m where m.user_id=$1 and m.status='active' order by m.created_at",
            [user.id],
        );
        if (memberships.length) {
            const tenantIds = memberships.map(
                (membership) => membership.tenant_id,
            );
            await db.rows(
                z.object({ id: z.string() }),
                `select id from tenants where id in (${tenantIds.map((_, index) => `$${index + 1}`).join(',')})`,
                tenantIds,
            );
        }
        return memberships;
    }

    private static async policies(
        db: Database,
        membership: Membership,
    ): Promise<Map<string, Policy>> {
        const rows = await db.rows(
            scopeSchema,
            "select s.policy_code,s.legal_entity_id,s.organization_id,s.hierarchy_version_id,s.include_descendants from role_assignment_data_policy_scopes s join role_assignments a on a.id=s.role_assignment_id where s.tenant_id=$1 and a.membership_id=$2 and a.status='active' and a.valid_from<=current_timestamp and (a.valid_until is null or a.valid_until>current_timestamp) and s.valid_from<=current_timestamp and (s.valid_until is null or s.valid_until>current_timestamp)",
            [membership.tenant_id, membership.id],
        );
        const grouped = Map.groupBy(rows, (row) => row.policy_code);
        const policies = new Map<string, Policy>();
        for (const [code, scopes] of grouped) {
            if (
                scopes.some(
                    (scope) =>
                        scope.legal_entity_id === null &&
                        scope.organization_id === null,
                )
            ) {
                policies.set(code, { kind: 'all' });
                continue;
            }
            const grants: Grant[] = [];
            for (const scope of scopes) {
                const ids =
                    scope.organization_id === null
                        ? []
                        : [scope.organization_id];
                if (scope.include_descendants) {
                    ids.push(
                        ...(
                            await db.rows(
                                z.object({ id: z.string() }),
                                'select descendant_organization_id as id from organization_hierarchy_closures where version_id=$1 and ancestor_organization_id=$2',
                                [
                                    scope.hierarchy_version_id,
                                    scope.organization_id,
                                ],
                            )
                        ).map((row) => row.id),
                    );
                }
                const units = ids.length
                    ? (
                          await db.rows(
                              z.object({ id: z.string() }),
                              `select id from organizations where tenant_id=$1 and classification='operating_unit' and id in (${ids.map((_, index) => `$${index + 2}`).join(',')})`,
                              [membership.tenant_id, ...ids],
                          )
                      ).map((row) => row.id)
                    : [];
                if (scope.legal_entity_id !== null || units.length)
                    grants.push({
                        legalEntityId: scope.legal_entity_id,
                        operatingUnitIds: units,
                    });
            }
            policies.set(code, { kind: 'grants', grants });
        }
        return policies;
    }

    private static async organizations(
        db: Database,
        membership: Membership,
        policies: Map<string, Policy>,
    ): Promise<Organization[]> {
        const all = [...policies.values()].some(
            (policy) => policy.kind === 'all',
        );
        const ids = [
            ...new Set(
                [...policies.values()].flatMap((policy) =>
                    policy.kind === 'all'
                        ? []
                        : policy.grants.flatMap((grant) => [
                              ...(grant.legalEntityId
                                  ? [grant.legalEntityId]
                                  : []),
                              ...grant.operatingUnitIds,
                          ]),
                ),
            ),
        ];
        if (!all && !ids.length) return [];
        const scoped = all ? null : ids;
        return db.rows(
            organizationSchema,
            `select id,tenant_id,name,classification from organizations where tenant_id=$1 and status='active' ${scoped ? `and id in (${scoped.map((_, index) => `$${index + 2}`).join(',')})` : ''} order by name`,
            [membership.tenant_id, ...(scoped ?? [])],
        );
    }

    private static async permissions(
        db: Database,
        membership: Membership,
        moduleId: string,
    ): Promise<Set<string>> {
        const assigned = await db.rows(
            z.object({ role_id: z.string() }),
            "select a.role_id from role_assignments a join roles r on r.id=a.role_id where a.membership_id=$1 and a.status='active' and r.is_active=true and a.valid_from<=current_timestamp and (a.valid_until is null or a.valid_until>current_timestamp)",
            [membership.id],
        );
        const effective = assigned.length
            ? await db.rows(
                  z.object({ role_id: z.string() }),
                  `with recursive reachable(role_id) as (select r.id from roles r where r.tenant_id=$1 and r.is_active=true and r.id in (${assigned.map((_, index) => `$${index + 2}`).join(',')}) union select link.child_role_id from security_role_children link join reachable on reachable.role_id=link.parent_role_id join roles child on child.id=link.child_role_id and child.is_active=true where link.tenant_id=$1) select role_id from reachable`,
                  [membership.tenant_id, ...assigned.map((row) => row.role_id)],
              )
            : [];
        const permissionRows = effective.length
            ? await db.rows(
                  z.object({ code: z.string() }),
                  `select distinct p.code from security_role_duties rd join security_duty_privileges dp on dp.duty_code=rd.duty_code join security_privilege_permissions pp on pp.privilege_code=dp.privilege_code join permissions p on p.code=pp.permission_code where p.app_id=$1 and rd.role_id in (${effective.map((_, index) => `$${index + 2}`).join(',')}) order by p.code`,
                  [moduleId, ...effective.map((row) => row.role_id)],
              )
            : [];
        return new Set(permissionRows.map((row) => row.code));
    }

    static async select(db: Database, session: Session, input: unknown) {
        const parsed = z
            .object({
                membership_id: z.string(),
                legal_entity_id: z.string().nullable().optional(),
                org_unit_id: z.string().nullable().optional(),
            })
            .safeParse(input);
        if (!parsed.success)
            validation({
                membership_id: 'The membership id field is required.',
            });
        const requested = parsed.data;
        const membership = (await this.memberships(db, session)).find(
            (item) => item.id === requested.membership_id,
        );
        if (!membership)
            validation({
                membership_id: 'Tenant tidak tersedia untuk identity ini.',
            });
        const policies = await this.policies(db, membership);
        const organizations = await this.organizations(
            db,
            membership,
            policies,
        );
        const pick = (
            id: string | null | undefined,
            classification: string,
            field: string,
        ) => {
            const eligible = organizations.filter(
                (item) => item.classification === classification,
            );
            const selected = id
                ? eligible.find((item) => item.id === id)
                : eligible[0];
            if (id && !selected)
                validation({
                    [field]:
                        'Organisasi tidak tersedia dalam scope akses Anda.',
                });
            return selected?.id ?? null;
        };
        const legalEntityId = pick(
            requested.legal_entity_id,
            'legal_entity',
            'legal_entity_id',
        );
        const orgUnitId = pick(
            requested.org_unit_id,
            'operating_unit',
            'org_unit_id',
        );
        session.data.workspace = {
            membership_id: membership.id,
            ...(legalEntityId ? { legal_entity_id: legalEntityId } : {}),
            ...(orgUnitId ? { org_unit_id: orgUnitId } : {}),
        };
        return {
            data: {
                membership_id: membership.id,
                tenant_id: membership.tenant_id,
                legal_entity_id: legalEntityId,
                org_unit_id: orgUnitId,
            },
        };
    }

    static async resolve(
        db: Database,
        session: Session,
        moduleId: string,
        policyCode: string,
    ): Promise<Workspace> {
        const user = session.requireUser();
        const memberships = await this.memberships(db, session);
        const membership =
            memberships.find(
                (item) => item.id === session.data.workspace?.membership_id,
            ) ?? memberships[0];
        if (!membership) {
            delete session.data.workspace;
            abort(403, 'Tidak ada tenant aktif untuk permintaan ini.');
        }
        const permissions = await this.permissions(db, membership, moduleId);
        if (!permissions.size) abort(403, 'Tidak ada izin untuk module ini.');
        const policies = await this.policies(db, membership);
        const organizations = await this.organizations(
            db,
            membership,
            policies,
        );
        const selected = session.data.workspace;
        const companies = organizations.filter(
            (item) => item.classification === 'legal_entity',
        );
        const units = organizations.filter(
            (item) => item.classification === 'operating_unit',
        );
        const company =
            companies.find((item) => item.id === selected?.legal_entity_id) ??
            companies[0];
        const unit =
            units.find((item) => item.id === selected?.org_unit_id) ?? units[0];
        session.data.workspace = {
            ...selected,
            membership_id: membership.id,
            ...(company ? { legal_entity_id: company.id } : {}),
            ...(unit ? { org_unit_id: unit.id } : {}),
        };
        return new Workspace(
            membership.tenant_id,
            membership.id,
            user.id,
            company?.id ?? null,
            unit?.id ?? null,
            permissions,
            policies.get(policyCode) ?? {
                kind: 'grants',
                grants: [],
            },
            moduleId,
        );
    }

    guard(resource: string, action: string): void {
        if (!this.permissions.has(`${this.moduleId}.${resource}.${action}`))
            abort(403, 'Tidak diizinkan.');
    }

    allows(legalEntityId: string, orgUnitId: string | null): boolean {
        if (legalEntityId !== this.legalEntityId) return false;
        return (
            this.policy.kind === 'all' ||
            this.policy.grants.some(
                (grant) =>
                    grant.legalEntityId === legalEntityId &&
                    orgUnitId !== null &&
                    grant.operatingUnitIds.includes(orgUnitId),
            )
        );
    }

    require(legalEntityId: string, orgUnitId: string | null): void {
        if (!this.legalEntityId)
            validation({
                legal_entity_id:
                    'Pilih perusahaan di tempat kerja sebelum melanjutkan.',
            });
        if (legalEntityId !== this.legalEntityId)
            validation({
                legal_entity_id:
                    'Perusahaan transaksi harus sama dengan perusahaan aktif. Ganti tempat kerja terlebih dahulu.',
            });
        if (!this.allows(legalEntityId, orgUnitId))
            abort(
                403,
                'Data ini berada di luar unit kerja yang dapat Anda akses.',
            );
    }

    filter(
        alias: string,
        start: number,
    ): { clause: string; bindings: (string | null)[] } {
        const bindings: (string | null)[] = [this.tenantId, this.legalEntityId];
        const base = `${alias}.tenant_id=$${start} and ${alias}.legal_entity_id=$${start + 1}`;
        if (this.policy.kind === 'all') return { clause: base, bindings };
        const clauses: string[] = [];
        for (const grant of this.policy.grants) {
            if (!grant.legalEntityId || !grant.operatingUnitIds.length)
                continue;
            const companyPosition = start + bindings.length;
            bindings.push(grant.legalEntityId);
            const unitPositions = grant.operatingUnitIds.map((id) => {
                const position = start + bindings.length;
                bindings.push(id);
                return `$${position}`;
            });
            clauses.push(
                `(${alias}.legal_entity_id=$${companyPosition} and ${alias}.responsible_org_unit_id in (${unitPositions.join(',')}))`,
            );
        }
        return {
            clause: `${base} and (${clauses.join(' or ') || 'false'})`,
            bindings,
        };
    }
}
