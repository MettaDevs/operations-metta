import { z } from 'zod';
import { isoSql, nowSql, type Database } from '../database/index.ts';
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
    assertNoRedundantGrants,
    resolveScope,
    type ResolvedScope,
} from './data-policy-scope.service.ts';
import { parseMembershipInput } from './membership.schema.ts';
import { roleDataPolicyCodes, tenantDataPolicies } from './role.service.ts';
import {
    activeAssignmentSql,
    assertMayGrantRoles,
    assertNoSodConflict,
    assertNotLockedOut,
} from './security.service.ts';
import type { Workspace } from './workspace.ts';

const ids = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => `$${start + index}`).join(',');

const memberSchema = z.object({
    id: z.string(),
    version: z.number(),
    name: z.string(),
    email: z.string(),
    status: z.string(),
    last_login_at: z.string().nullable(),
});
const assignmentSchema = z.object({
    id: z.string(),
    membership_id: z.string(),
    role_id: z.string(),
    role_name: z.string(),
    is_owner: z.boolean(),
    source: z.string(),
});
const scopeSchema = z.object({
    role_assignment_id: z.string(),
    policy_code: z.string(),
    policy_name: z.string().nullable(),
    legal_entity_id: z.string().nullable(),
    organization_id: z.string().nullable(),
    hierarchy_id: z.string().nullable(),
    include_descendants: z.boolean(),
    valid_from: z.string().nullable(),
    valid_until: z.string().nullable(),
});

const scopeKey = (scope: {
    policy_code: string;
    legal_entity_id: string | null;
    organization_id: string | null;
    hierarchy_id: string | null;
    include_descendants: boolean;
}) =>
    [
        scope.policy_code,
        scope.legal_entity_id ?? '',
        scope.organization_id ?? '',
        scope.hierarchy_id ?? '',
        scope.include_descendants ? '1' : '0',
    ].join('|');

const activeScopeSql =
    's.valid_from<=current_timestamp and (s.valid_until is null or s.valid_until>current_timestamp)';

// Akses staf tenant, dipindah dari AccessController, MembershipController, dan Actions/UpdateMembership CoreERP:
// daftar anggota beserta role per organisasi, dan penggantian penugasan manual satu anggota. Membuat pengguna,
// undangan, SSO, dan 2FA milik control plane, jadi tidak ada di sini.
//
// Di CoreERP penugasan manual dihapus fisik lalu ditulis ulang setiap kali disimpan. Di sini penugasan yang dicabut
// ditutup (status inactive dan valid_until), penugasan yang diberikan lagi dihidupkan kembali, dan batas data yang
// berubah ditutup lalu ditambah, sehingga riwayatnya tetap ada.
export class Memberships {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    get canManage(): boolean {
        return this.workspace.permissions.has('core.access.update');
    }

    // Data layar akses: role aktif untuk pemilih, kebijakan data milik app tenant, dan organisasi aktif.
    async page() {
        this.workspace.guard('access', 'read');
        const tenantId = this.workspace.tenantId;
        const roles = await this.db.rows(
            z.object({
                id: z.string(),
                name: z.string(),
                is_owner: z.boolean(),
            }),
            'select id, name, is_owner from roles where tenant_id=$1 and is_active=true and deleted_at is null order by name',
            [tenantId],
        );
        const [policies, policyCodes, organizations] = await Promise.all([
            tenantDataPolicies(this.db, tenantId),
            roleDataPolicyCodes(
                this.db,
                tenantId,
                roles.map((role) => role.id),
            ),
            this.db.rows(
                z.object({
                    id: z.string(),
                    name: z.string(),
                    classification: z.enum(['legal_entity', 'operating_unit']),
                }),
                "select id, name, classification from organizations where tenant_id=$1 and status='active' order by name",
                [tenantId],
            ),
        ]);
        return {
            canManage: this.canManage,
            roles: roles.map((role) => ({
                ...role,
                data_policy_codes: policyCodes.get(role.id) ?? [],
            })),
            dataPolicies: policies.map(
                ({ protected_permissions: _, ...policy }) => policy,
            ),
            organizations,
        };
    }

    async list(parameters: URLSearchParams) {
        this.workspace.guard('access', 'read');
        const bindings: string[] = [this.workspace.tenantId];
        const filters: string[] = [];
        const roleId = lookupId(parameters.get('role_id') ?? '');
        if (parameters.get('role_id')) {
            bindings.push(roleId ?? '00000000-0000-0000-0000-000000000000');
            filters.push(
                `exists (select 1 from role_assignments a where a.membership_id=m.id and a.role_id=$${bindings.length} and ${activeAssignmentSql})`,
            );
        }
        const organizationId = lookupId(
            parameters.get('organization_id') ?? '',
        );
        if (parameters.get('organization_id')) {
            bindings.push(
                organizationId ?? '00000000-0000-0000-0000-000000000000',
            );
            filters.push(
                `exists (select 1 from role_assignment_data_policy_scopes s join role_assignments a on a.id=s.role_assignment_id
                 where a.membership_id=m.id and ${activeAssignmentSql} and ${activeScopeSql}
                 and (s.organization_id=$${bindings.length} or s.legal_entity_id=$${bindings.length}))`,
            );
        }
        const status = parameters.get('status');
        if (status === 'active' || status === 'inactive') {
            bindings.push(status);
            filters.push(`m.status=$${bindings.length}`);
        }
        const batch = await incrementalList(this.db, {
            query: `select m.id, m.version, u.name, u.email, m.status, ${isoSql('u.last_login_at')} as last_login_at,
                           m.created_at
                    from tenant_memberships m join users u on u.id=m.user_id
                    where m.tenant_id=$1 ${filters.map((filter) => `and ${filter}`).join(' ')}`,
            bindings,
            parameters,
            columns: {
                name: 'name',
                email: 'email',
                status: 'status',
                created_at: 'created_at',
            },
            searchColumns: ['name', 'email'],
            numericColumns: [],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        const members = batch.data.map((row) => memberSchema.parse(row));
        return {
            data: await this.withAssignments(members),
            next_cursor: batch.next_cursor,
        };
    }

    async show(id: string) {
        this.workspace.guard('access', 'read');
        return {
            status: 200,
            headers: {},
            body: { data: await this.member(id) },
        };
    }

    private async member(id: string) {
        const found = lookupId(id)
            ? await this.db.one(
                  memberSchema,
                  `select m.id, m.version, u.name, u.email, m.status, ${isoSql('u.last_login_at')} as last_login_at
                   from tenant_memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.id=$2`,
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!found) abort(404, 'Not Found');
        const [member] = await this.withAssignments([found]);
        if (!member) abort(404, 'Not Found');
        return member;
    }

    // Penugasan yang berlaku beserta batas datanya yang berlaku, untuk satu batch anggota sekaligus.
    private async withAssignments(members: z.infer<typeof memberSchema>[]) {
        const memberIds = members.map((member) => member.id);
        const assignments = memberIds.length
            ? await this.db.rows(
                  assignmentSchema,
                  `select a.id, a.membership_id, a.role_id, r.name as role_name, r.is_owner, a.source
                   from role_assignments a join roles r on r.id=a.role_id and r.is_active=true
                   where a.membership_id in (${ids(1, memberIds.length)}) and ${activeAssignmentSql}
                   order by r.name`,
                  memberIds,
              )
            : [];
        const assignmentIds = assignments.map((assignment) => assignment.id);
        const scopes = assignmentIds.length
            ? await this.db.rows(
                  scopeSchema,
                  `select s.role_assignment_id, s.policy_code, p.name as policy_name, s.legal_entity_id, s.organization_id,
                          s.hierarchy_id, s.include_descendants, ${isoSql('s.valid_from')} as valid_from,
                          ${isoSql('s.valid_until')} as valid_until
                   from role_assignment_data_policy_scopes s left join app_data_policies p on p.code=s.policy_code
                   where s.role_assignment_id in (${ids(1, assignmentIds.length)}) and ${activeScopeSql}
                   order by s.policy_code, s.created_at`,
                  assignmentIds,
              )
            : [];
        const scopesBy = Map.groupBy(
            scopes,
            (scope) => scope.role_assignment_id,
        );
        const assignmentsBy = Map.groupBy(
            assignments,
            (assignment) => assignment.membership_id,
        );
        return members.map((member) => ({
            ...member,
            assignments: (assignmentsBy.get(member.id) ?? []).map(
                (assignment) => ({
                    role_id: assignment.role_id,
                    role_name: assignment.role_name,
                    is_owner: assignment.is_owner,
                    source: assignment.source,
                    policy_scopes: (scopesBy.get(assignment.id) ?? []).map(
                        ({ role_assignment_id: _, ...scope }) => ({
                            ...scope,
                            unrestricted:
                                scope.legal_entity_id === null &&
                                scope.organization_id === null,
                        }),
                    ),
                }),
            ),
            can_edit_access: this.canManage,
        }));
    }

    // UpdateMembership CoreERP: menggantikan seluruh penugasan manual anggota dengan daftar yang dikirim. Penugasan
    // otomatis, misalnya role Owner admin pertama, tidak disentuh.
    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('access', 'update');
        const target = await this.member(id);
        const assignments = parseMembershipInput(body);
        const version = expectedVersion(request, body);
        const tenantId = this.workspace.tenantId;
        const roleIds = [
            ...new Set(assignments.map((assignment) => assignment.role_id)),
        ];
        const roles = roleIds.every((roleId) => lookupId(roleId))
            ? roleIds.length
                ? await this.db.rows(
                      z.object({ id: z.string() }),
                      `select id from roles where tenant_id=$1 and is_active=true and deleted_at is null and id in (${ids(2, roleIds.length)})`,
                      [tenantId, ...roleIds],
                  )
                : []
            : [];
        if (roles.length !== roleIds.length)
            validation({
                role_ids:
                    'Pilih tanggung jawab bisnis yang tersedia untuk bisnis ini.',
            });
        const previous = await this.db.rows(
            z.object({ id: z.string(), role_id: z.string() }),
            `select a.id, a.role_id from role_assignments a where a.membership_id=$1 and a.source='manual' and ${activeAssignmentSql}`,
            [target.id],
        );
        const previousIds = previous.map((row) => row.role_id);
        await assertMayGrantRoles(
            this.db,
            tenantId,
            this.workspace.membershipId,
            [
                ...roleIds.filter((roleId) => !previousIds.includes(roleId)),
                ...previousIds.filter((roleId) => !roleIds.includes(roleId)),
            ],
        );
        await assertNoSodConflict(this.db, tenantId, target.id, roleIds);
        for (const assignment of assignments)
            assertNoRedundantGrants(assignment.policy_scopes);

        await this.db.transaction(async () => {
            const stamp = nowSql();
            const claimed = await this.db.execute(
                'update tenant_memberships set updated_at=$1 where tenant_id=$2 and id=$3 and version=$4',
                [stamp, tenantId, target.id, version],
            );
            if (!claimed) coded(409, 'stale_version', staleMessage);
            for (const row of previous.filter(
                (item) => !roleIds.includes(item.role_id),
            ))
                await this.close(row.id, stamp);
            for (const input of assignments) {
                const resolved: ResolvedScope[] = [];
                for (const scope of input.policy_scopes)
                    resolved.push(
                        await resolveScope(
                            this.db,
                            tenantId,
                            input.role_id,
                            scope,
                        ),
                    );
                const assignmentId = await this.open(
                    target.id,
                    input.role_id,
                    stamp,
                );
                const current = await this.db.rows(
                    z.object({
                        id: z.string(),
                        policy_code: z.string(),
                        legal_entity_id: z.string().nullable(),
                        organization_id: z.string().nullable(),
                        hierarchy_id: z.string().nullable(),
                        include_descendants: z.boolean(),
                    }),
                    `select s.id, s.policy_code, s.legal_entity_id, s.organization_id, s.hierarchy_id, s.include_descendants
                     from role_assignment_data_policy_scopes s where s.role_assignment_id=$1 and ${activeScopeSql}`,
                    [assignmentId],
                );
                const wanted = new Set(resolved.map(scopeKey));
                for (const scope of current.filter(
                    (item) => !wanted.has(scopeKey(item)),
                ))
                    await this.db.execute(
                        "update role_assignment_data_policy_scopes set valid_until=date_trunc('second', now()), updated_at=$1 where id=$2",
                        [stamp, scope.id],
                    );
                const kept = new Set(current.map(scopeKey));
                for (const scope of resolved.filter(
                    (item) => !kept.has(scopeKey(item)),
                ))
                    await this.db.execute(
                        `insert into role_assignment_data_policy_scopes
                             (id, tenant_id, role_assignment_id, policy_code, legal_entity_id, organization_id, hierarchy_id,
                              hierarchy_version_id, include_descendants, valid_from, created_at, updated_at)
                         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, date_trunc('second', now()), $10, $10)`,
                        [
                            Bun.randomUUIDv7(),
                            tenantId,
                            assignmentId,
                            scope.policy_code,
                            scope.legal_entity_id,
                            scope.organization_id,
                            scope.hierarchy_id,
                            scope.hierarchy_version_id,
                            scope.include_descendants,
                            stamp,
                        ],
                    );
            }
            await this.db.insert('access_audit_events', {
                id: Bun.randomUUIDv7(),
                tenant_id: tenantId,
                membership_id: target.id,
                action: 'access.manual-assignment.updated',
                payload: JSON.stringify({
                    actor_membership_id: this.workspace.membershipId,
                    assignments,
                }),
                created_at: stamp,
                updated_at: stamp,
            });
            await assertNotLockedOut(this.db, tenantId);
        });
        return {
            status: 200,
            headers: {},
            body: { data: await this.member(target.id) },
        };
    }

    // Penugasan manual role itu: dihidupkan kembali bila pernah dicabut, karena satu anggota memegang satu baris per
    // role dan sumber.
    private async open(
        membershipId: string,
        roleId: string,
        stamp: string,
    ): Promise<string> {
        const existing = await this.db.one(
            z.object({ id: z.string(), active: z.boolean() }),
            `select a.id, (${activeAssignmentSql}) as active from role_assignments a
             where a.membership_id=$1 and a.role_id=$2 and a.source='manual'`,
            [membershipId, roleId],
        );
        if (existing?.active) return existing.id;
        if (existing) {
            await this.db.execute(
                "update role_assignments set status='active', valid_from=date_trunc('second', now()), valid_until=null, updated_at=$1 where id=$2",
                [stamp, existing.id],
            );
            return existing.id;
        }
        const assignmentId = Bun.randomUUIDv7();
        await this.db.execute(
            `insert into role_assignments (id, membership_id, role_id, source, status, valid_from, created_at, updated_at)
             values ($1, $2, $3, 'manual', 'active', date_trunc('second', now()), $4, $4)`,
            [assignmentId, membershipId, roleId, stamp],
        );
        return assignmentId;
    }

    private async close(assignmentId: string, stamp: string) {
        await this.db.execute(
            `update role_assignment_data_policy_scopes s set valid_until=date_trunc('second', now()), updated_at=$1
             where s.role_assignment_id=$2 and (s.valid_until is null or s.valid_until>current_timestamp)`,
            [stamp, assignmentId],
        );
        await this.db.execute(
            "update role_assignments set status='inactive', valid_until=date_trunc('second', now()), updated_at=$1 where id=$2",
            [stamp, assignmentId],
        );
    }
}
