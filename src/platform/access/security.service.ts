import { z } from 'zod';
import type { Database } from '../database/index.ts';
import { validation } from '../http/index.ts';

// Aturan keamanan yang dipakai layar role dan layar staf, dipindah dari Support/ CoreERP: TenantProducts,
// RoleHierarchy, AccessGuards, dan SodConflictEvaluator. Isinya sama dengan CoreERP; bedanya hanya bentuk query.

const ids = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => `$${start + index}`).join(',');

// Assignment yang berlaku sekarang. timestamp(0) tanpa zona dibandingkan dengan current_timestamp, sama dengan
// Workspace.
export const activeAssignmentSql =
    "a.status='active' and a.valid_from<=current_timestamp and (a.valid_until is null or a.valid_until>current_timestamp)";

// TenantProducts::appIds: app yang entitlement-nya aktif, ditambah Core sendiri. Core tidak pernah dibeli, tetapi
// duty-nya tetap harus dapat disusun ke dalam role.
export async function tenantAppIds(
    db: Database,
    tenantId: string,
): Promise<string[]> {
    const rows = await db.rows(
        z.object({ app_id: z.string() }),
        "select distinct app_id from tenant_app_entitlements where tenant_id=$1 and status='active' and (ends_at is null or ends_at>current_timestamp)",
        [tenantId],
    );
    return [...new Set(['core', ...rows.map((row) => row.app_id)])];
}

// TenantProducts::duties: duty produk yang boleh dipakai tenant, dan duty buatan tenant sendiri yang aktif.
export function tenantDutyClause(
    alias: string,
    tenantPosition: number,
    appIds: string[],
    appStart: number,
): string {
    return `((${alias}.tenant_id is null and ${alias}.app_id in (${ids(appStart, appIds.length)})) or (${alias}.tenant_id=$${tenantPosition} and ${alias}.source='custom' and ${alias}.status='active'))`;
}

// RoleHierarchy::effectiveRoleIds: role itu sendiri beserta semua turunannya. Role non-aktif tidak ikut dan tidak
// menjadi jembatan ke turunannya, kecuali activeOnly dimatikan untuk pemeriksaan lingkaran.
export async function effectiveRoleIds(
    db: Database,
    tenantId: string,
    roleIds: string[],
    activeOnly = true,
): Promise<string[]> {
    if (!roleIds.length) return [];
    const active = activeOnly ? 'and r.is_active=true' : '';
    const activeChild = activeOnly ? 'and child.is_active=true' : '';
    const rows = await db.rows(
        z.object({ role_id: z.string() }),
        `with recursive reachable(role_id) as (
            select r.id from roles r where r.tenant_id=$1 ${active} and r.id in (${ids(2, roleIds.length)})
          union
            select link.child_role_id from security_role_children link
            join reachable on reachable.role_id=link.parent_role_id
            join roles child on child.id=link.child_role_id ${activeChild}
            where link.tenant_id=$1
        ) select role_id from reachable`,
        [tenantId, ...roleIds],
    );
    return rows.map((row) => row.role_id);
}

// Siklus dihitung tanpa memandang status aktif: role yang dinonaktifkan hari ini dapat diaktifkan lagi besok.
export async function wouldCreateCycle(
    db: Database,
    tenantId: string,
    parentId: string,
    childIds: string[],
): Promise<boolean> {
    if (childIds.includes(parentId)) return true;
    return (await effectiveRoleIds(db, tenantId, childIds, false)).includes(
        parentId,
    );
}

// Role -> permission yang datang dari role itu beserta seluruh turunannya, untuk semua role sekaligus. Dua query
// tetap, bukan dua query per role (AccessController::roles CoreERP).
export async function rolePermissions(
    db: Database,
    tenantId: string,
    roleIds: string[],
): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>(
        roleIds.map((id) => [id, new Set<string>()]),
    );
    if (!roleIds.length) return result;
    const reachable = await db.rows(
        z.object({ root_id: z.string(), role_id: z.string() }),
        `with recursive reachable(root_id, role_id) as (
            select r.id, r.id from roles r where r.tenant_id=$1 and r.is_active=true and r.id in (${ids(2, roleIds.length)})
          union
            select reachable.root_id, link.child_role_id from security_role_children link
            join reachable on reachable.role_id=link.parent_role_id
            join roles child on child.id=link.child_role_id and child.is_active=true
            where link.tenant_id=$1
        ) select root_id, role_id from reachable`,
        [tenantId, ...roleIds],
    );
    const all = [...new Set(reachable.map((row) => row.role_id))];
    const permissions = all.length
        ? await db.rows(
              z.object({ role_id: z.string(), permission_code: z.string() }),
              `select distinct rd.role_id, pp.permission_code from security_role_duties rd
               join security_duty_privileges dp on dp.duty_code=rd.duty_code
               join security_privilege_permissions pp on pp.privilege_code=dp.privilege_code
               where rd.role_id in (${ids(1, all.length)})`,
              all,
          )
        : [];
    const own = Map.groupBy(permissions, (row) => row.role_id);
    for (const row of reachable)
        for (const permission of own.get(row.role_id) ?? [])
            result.get(row.root_id)?.add(permission.permission_code);
    return result;
}

// AccessGuards::holdsOwnerRole.
export async function holdsOwnerRole(
    db: Database,
    membershipId: string,
): Promise<boolean> {
    const found = await db.one(
        z.object({ found: z.boolean() }),
        `select true as found from role_assignments a
         join tenant_memberships m on m.id=a.membership_id and m.status='active'
         join roles r on r.id=a.role_id and r.is_owner=true and r.is_active=true
         where a.membership_id=$1 and ${activeAssignmentSql} limit 1`,
        [membershipId],
    );
    return Boolean(found);
}

// AccessGuards::assertMayGrantRoles: role Owner hanya diberikan dan dicabut oleh pemegang role Owner. Padanan D365:
// hanya System administrator yang boleh memberikan role System administrator.
export async function assertMayGrantRoles(
    db: Database,
    tenantId: string,
    actorMembershipId: string,
    roleIds: string[],
): Promise<void> {
    if (!roleIds.length) return;
    const touchesOwner = await db.one(
        z.object({ found: z.boolean() }),
        `select true as found from roles where tenant_id=$1 and is_owner=true and id in (${ids(2, roleIds.length)}) limit 1`,
        [tenantId, ...roleIds],
    );
    if (touchesOwner && !(await holdsOwnerRole(db, actorMembershipId)))
        validation({
            role_ids:
                'Hanya pemegang role Owner yang dapat memberikan atau mencabut role Owner.',
        });
}

// AccessGuards::assertNotLockedOut: sesudah perubahan harus tetap ada anggota aktif yang memegang `core.access.update`,
// supaya tenant tidak terkunci dari layar aksesnya sendiri. Dipanggil di dalam transaksi, sesudah perubahan ditulis.
export async function assertNotLockedOut(
    db: Database,
    tenantId: string,
): Promise<void> {
    const found = await db.one(
        z.object({ found: z.boolean() }),
        `with recursive reachable(role_id) as (
            select a.role_id from role_assignments a
            join tenant_memberships m on m.id=a.membership_id and m.tenant_id=$1 and m.status='active'
            join roles r on r.id=a.role_id and r.is_active=true
            where ${activeAssignmentSql}
          union
            select link.child_role_id from security_role_children link
            join reachable on reachable.role_id=link.parent_role_id
            join roles child on child.id=link.child_role_id and child.is_active=true
            where link.tenant_id=$1
        )
        select true as found from reachable
        join security_role_duties rd on rd.role_id=reachable.role_id
        join security_duty_privileges dp on dp.duty_code=rd.duty_code
        join security_privilege_permissions pp on pp.privilege_code=dp.privilege_code
        where pp.permission_code='core.access.update' limit 1`,
        [tenantId],
    );
    if (!found)
        validation({
            access: 'Perubahan ini membuat tidak ada lagi anggota yang dapat mengelola akses. Sisakan minimal satu anggota aktif yang memegang duty Kelola akses.',
        });
}

// SodConflictEvaluator::assertManualAssignmentAllowed: duty efektif dari assignment otomatis yang berlaku ditambah role
// manual yang akan dipasang tidak boleh memuat dua duty dari satu aturan pemisahan tugas yang aktif.
export async function assertNoSodConflict(
    db: Database,
    tenantId: string,
    membershipId: string,
    manualRoleIds: string[],
): Promise<void> {
    const automatic = await db.rows(
        z.object({ role_id: z.string() }),
        `select a.role_id from role_assignments a where a.membership_id=$1 and a.source<>'manual' and ${activeAssignmentSql}`,
        [membershipId],
    );
    const roleIds = await effectiveRoleIds(db, tenantId, [
        ...new Set([...automatic.map((row) => row.role_id), ...manualRoleIds]),
    ]);
    if (!roleIds.length) return;
    const conflict = await db.one(
        z.object({ risk: z.string() }),
        `with duties as (select duty_code from security_role_duties where role_id in (${ids(2, roleIds.length)}))
         select risk from sod_rules where tenant_id=$1 and is_active=true
         and first_duty_code in (select duty_code from duties) and second_duty_code in (select duty_code from duties)
         limit 1`,
        [tenantId, ...roleIds],
    );
    if (conflict)
        validation({
            assignments: `Role ini memberi dua tugas yang tidak boleh dipegang bersama: ${conflict.risk}`,
        });
}
