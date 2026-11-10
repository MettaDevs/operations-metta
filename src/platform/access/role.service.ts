import { z } from 'zod';
import { nowSql, sqlErrorCode, type Database } from '../database/index.ts';
import {
    abort,
    coded,
    expectedVersion,
    incrementalList,
    lookupId,
    staleMessage,
    validation,
} from '../http/index.ts';
import { parseRoleInput, type RoleInput } from './role.schema.ts';
import {
    activeAssignmentSql,
    assertNotLockedOut,
    rolePermissions,
    tenantAppIds,
    tenantDutyClause,
    wouldCreateCycle,
} from './security.service.ts';
import type { Workspace } from './workspace.ts';

const ids = (start: number, count: number) =>
    Array.from({ length: count }, (_, index) => `$${start + index}`).join(',');

const roleRowSchema = z.object({
    id: z.string(),
    name: z.string(),
    is_owner: z.boolean(),
    is_active: z.boolean(),
    version: z.number(),
});
const policySchema = z.object({
    code: z.string(),
    name: z.string(),
    protected_permissions: z.array(z.string()),
    requires_legal_entity: z.boolean(),
    requires_operating_unit: z.boolean(),
    allows_descendants: z.boolean(),
});
const nameTaken = 'Role dengan nama ini sudah ada.';

// Kebijakan data milik app yang boleh dipakai tenant.
export async function tenantDataPolicies(db: Database, tenantId: string) {
    const appIds = await tenantAppIds(db, tenantId);
    return db.rows(
        policySchema,
        `select code, name, protected_permissions::jsonb as protected_permissions, requires_legal_entity,
                requires_operating_unit, allows_descendants
         from app_data_policies where app_id in (${ids(1, appIds.length)}) order by code`,
        appIds,
    );
}

// Kebijakan data yang dipakai setiap role: kebijakan yang melindungi sedikitnya satu permission role itu beserta
// turunannya (AccessController::roles CoreERP). Role tanpa kebijakan berlaku di seluruh organisasi.
export async function roleDataPolicyCodes(
    db: Database,
    tenantId: string,
    roleIds: string[],
): Promise<Map<string, string[]>> {
    const [policies, permissions] = await Promise.all([
        tenantDataPolicies(db, tenantId),
        rolePermissions(db, tenantId, roleIds),
    ]);
    return new Map(
        roleIds.map((id) => {
            const held = permissions.get(id) ?? new Set<string>();
            return [
                id,
                policies
                    .filter((policy) =>
                        policy.protected_permissions.some((code) =>
                            held.has(code),
                        ),
                    )
                    .map((policy) => policy.code),
            ];
        }),
    );
}

// Role tenant, dipindah dari RoleController dan Actions/UpsertRole CoreERP. Role disusun dari duty; role Owner
// bawaan tenant tidak dapat diubah, dihapus, atau dijadikan turunan role lain. Menghapus mengisi deleted_at dan
// menonaktifkan role, sehingga ia tidak lagi memberi hak, dan penugasannya ditutup.
export class Roles {
    constructor(
        private readonly db: Database,
        private readonly workspace: Workspace,
    ) {}

    async list(parameters: URLSearchParams) {
        this.workspace.guard('access', 'read');
        const batch = await incrementalList(this.db, {
            query: `select r.id, r.name, r.is_owner, r.version,
                           (select count(distinct a.membership_id)::int from role_assignments a
                            join tenant_memberships m on m.id=a.membership_id and m.status='active'
                            where a.role_id=r.id and ${activeAssignmentSql}) as member_count,
                           (select count(*)::int from security_role_duties d where d.role_id=r.id) as duty_count
                    from roles r where r.tenant_id=$1 and r.is_active=true and r.deleted_at is null`,
            bindings: [this.workspace.tenantId],
            parameters,
            columns: {
                name: 'name',
                member_count: 'member_count',
                duty_count: 'duty_count',
            },
            searchColumns: ['name'],
            numericColumns: ['member_count', 'duty_count'],
            defaultSort: 'name',
            defaultDirection: 'asc',
        });
        const rowSchema = z.object({
            id: z.string(),
            name: z.string(),
            is_owner: z.boolean(),
            version: z.number(),
            member_count: z.number(),
            duty_count: z.number(),
        });
        return {
            data: batch.data.map((row) => rowSchema.parse(row)),
            next_cursor: batch.next_cursor,
        };
    }

    async show(id: string) {
        this.workspace.guard('access', 'read');
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    // Satu role lengkap: duty, role turunan dan induk, serta kebijakan data yang dipakainya.
    async row(id: string) {
        const role = lookupId(id)
            ? await this.db.one(
                  roleRowSchema,
                  'select id, name, is_owner, is_active, version from roles where tenant_id=$1 and id=$2 and deleted_at is null',
                  [this.workspace.tenantId, id],
              )
            : undefined;
        if (!role) abort(404, 'Not Found');
        const [duties, children, parents, policies] = await Promise.all([
            this.db.rows(
                z.object({
                    code: z.string(),
                    name: z.string(),
                    app_id: z.string().nullable(),
                }),
                'select d.code, d.name, d.app_id from security_role_duties rd join security_duties d on d.code=rd.duty_code where rd.role_id=$1 order by d.name, d.code',
                [role.id],
            ),
            this.db.rows(
                z.object({ id: z.string(), name: z.string() }),
                'select r.id, r.name from security_role_children l join roles r on r.id=l.child_role_id where l.tenant_id=$1 and l.parent_role_id=$2 and r.deleted_at is null order by r.name',
                [this.workspace.tenantId, role.id],
            ),
            this.db.rows(
                z.object({ id: z.string(), name: z.string() }),
                'select r.id, r.name from security_role_children l join roles r on r.id=l.parent_role_id where l.tenant_id=$1 and l.child_role_id=$2 and r.deleted_at is null order by r.name',
                [this.workspace.tenantId, role.id],
            ),
            roleDataPolicyCodes(this.db, this.workspace.tenantId, [role.id]),
        ]);
        return {
            ...role,
            duty_codes: duties.map((duty) => duty.code),
            duties,
            child_roles: children,
            parent_roles: parents,
            data_policy_codes: policies.get(role.id) ?? [],
        };
    }

    async create(body: unknown) {
        this.workspace.guard('access', 'update');
        const input = parseRoleInput(body);
        const id = await this.upsert(input, null, null);
        return {
            status: 201,
            headers: { location: `/api/v1/roles/${id}` },
            body: { data: await this.row(id) },
        };
    }

    async update(request: Request, id: string, body: unknown) {
        this.workspace.guard('access', 'update');
        const role = await this.row(id);
        // Role Owner memegang semua duty yang sah secara otomatis; menyuntingnya tidak mengubah apa pun selain
        // membingungkan jejaknya.
        if (role.is_owner)
            validation({
                name: 'Role Owner diatur otomatis dan selalu memegang semua duty, jadi tidak dapat diubah.',
            });
        const input = parseRoleInput(body);
        await this.upsert(input, role.id, expectedVersion(request, body));
        return { status: 200, headers: {}, body: { data: await this.row(id) } };
    }

    async delete(request: Request, id: string, body: unknown) {
        this.workspace.guard('access', 'update');
        const role = await this.row(id);
        if (role.is_owner)
            validation({ role: 'Role Owner tidak dapat dihapus.' });
        const version = expectedVersion(request, body);
        await this.db.transaction(async () => {
            const stamp = nowSql();
            await this.claim(role.id, version, {
                deleted_at: stamp,
                is_active: false,
            });
            // Di CoreERP baris penugasan dan susunan role ikut terhapus fisik. Di sini penugasan ditutup, dan hanya
            // tautan susunan role yang dilepas.
            await this.db.execute(
                `update role_assignment_data_policy_scopes s set valid_until=date_trunc('second', now()), updated_at=$1
                 from role_assignments a where a.id=s.role_assignment_id and a.role_id=$2
                 and (s.valid_until is null or s.valid_until>current_timestamp)`,
                [stamp, role.id],
            );
            await this.db.execute(
                `update role_assignments set status='inactive', valid_until=date_trunc('second', now()), updated_at=$1
                 where role_id=$2 and status='active'`,
                [stamp, role.id],
            );
            await this.db.execute(
                'delete from security_role_children where tenant_id=$1 and (parent_role_id=$2 or child_role_id=$2)',
                [this.workspace.tenantId, role.id],
            );
            await assertNotLockedOut(this.db, this.workspace.tenantId);
        });
        return { status: 204, headers: {}, body: undefined };
    }

    private async upsert(
        input: RoleInput,
        roleId: string | null,
        version: number | null,
    ): Promise<string> {
        const tenantId = this.workspace.tenantId;
        const appIds = await tenantAppIds(this.db, tenantId);
        const requested = [...new Set(input.duty_codes)];
        const duties = await this.db.rows(
            z.object({ code: z.string() }),
            `select d.code from security_duties d where d.code in (${ids(appIds.length + 2, requested.length)})
             and ${tenantDutyClause('d', 1, appIds, 2)}`,
            [tenantId, ...appIds, ...requested],
        );
        if (duties.length !== requested.length)
            validation({
                duty_codes:
                    'Tanggung jawab harus berasal dari produk yang boleh digunakan tenant.',
            });
        const childIds = [...new Set(input.child_role_ids)];
        if (childIds.length) {
            const children = childIds.every((child) => lookupId(child))
                ? await this.db.rows(
                      z.object({ id: z.string(), is_owner: z.boolean() }),
                      `select id, is_owner from roles where tenant_id=$1 and deleted_at is null and id in (${ids(2, childIds.length)})`,
                      [tenantId, ...childIds],
                  )
                : [];
            if (children.length !== childIds.length)
                validation({
                    child_role_ids:
                        'Role turunan harus berasal dari tenant yang sama.',
                });
            // Role induk mewarisi semua duty turunannya. Owner sebagai turunan akan membuat role mana pun setara Owner.
            if (children.some((child) => child.is_owner))
                validation({
                    child_role_ids:
                        'Role Owner tidak dapat dijadikan turunan role lain.',
                });
        }
        try {
            return await this.db.transaction(async () => {
                const stamp = nowSql();
                let id = roleId;
                if (id === null) {
                    id = Bun.randomUUIDv7();
                    await this.db.insert('roles', {
                        id,
                        tenant_id: tenantId,
                        name: input.name,
                        is_active: true,
                        is_owner: false,
                        created_at: stamp,
                        updated_at: stamp,
                    });
                } else {
                    await this.claim(id, version ?? 0, {
                        name: input.name,
                        is_active: true,
                    });
                }
                await this.db.execute(
                    'delete from security_role_duties where role_id=$1',
                    [id],
                );
                for (const code of requested)
                    await this.db.insert('security_role_duties', {
                        role_id: id,
                        duty_code: code,
                    });
                // Lingkaran membuat hak tidak dapat dihitung. Ia ditolak sebelum tersimpan, bukan disaring saat dibaca.
                if (await wouldCreateCycle(this.db, tenantId, id, childIds))
                    validation({
                        child_role_ids:
                            'Susunan role tidak boleh membentuk lingkaran.',
                    });
                await this.db.execute(
                    'delete from security_role_children where tenant_id=$1 and parent_role_id=$2',
                    [tenantId, id],
                );
                for (const child of childIds)
                    await this.db.insert('security_role_children', {
                        tenant_id: tenantId,
                        parent_role_id: id,
                        child_role_id: child,
                        created_at: stamp,
                        updated_at: stamp,
                    });
                await assertNotLockedOut(this.db, tenantId);
                return id;
            });
        } catch (error) {
            if (
                sqlErrorCode(error) === '23505' &&
                error instanceof Error &&
                error.message.includes('roles_tenant_id_name_unique')
            )
                validation({ name: nameTaken });
            throw error;
        }
    }

    private async claim(
        id: string,
        version: number,
        values: { name?: string; is_active: boolean; deleted_at?: string },
    ) {
        const claimed = await this.db.execute(
            `update roles set name=coalesce($5, name), is_active=$6, deleted_at=coalesce($7::timestamp, deleted_at), updated_at=$1
             where tenant_id=$2 and id=$3 and version=$4 and deleted_at is null`,
            [
                nowSql(),
                this.workspace.tenantId,
                id,
                version,
                values.name ?? null,
                values.is_active,
                values.deleted_at ?? null,
            ],
        );
        if (!claimed) coded(409, 'stale_version', staleMessage);
    }
}
