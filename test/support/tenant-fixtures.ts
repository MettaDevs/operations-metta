import type postgres from 'postgres';

// Data awal tenant untuk test yang memakai database, ditulis lewat SQL langsung supaya setiap test memegang duty yang
// ia butuhkan saja. Tenant sungguhan disiapkan provisionEnvironment. Semua nama dan email sintetis dan unik per
// pemanggilan, jadi test boleh berjalan berulang di database yang sama.

export const testPassword = 'kata-sandi-uji-yang-panjang';
const passwordHash = Bun.password.hash(testPassword, {
    algorithm: 'bcrypt',
    cost: 4,
});

export async function createTenant(sql: postgres.Sql, name = 'Tenant uji') {
    const clientId = Bun.randomUUIDv7();
    const tenantId = Bun.randomUUIDv7();
    const slug = `uji-${tenantId}`;
    await sql.unsafe(
        "insert into clients (id, legal_name, slug, status, created_at, updated_at) values ($1, $2, $3, 'active', now(), now())",
        [clientId, name, slug],
    );
    await sql.unsafe(
        "insert into tenants (id, client_id, name, slug, status, created_at, updated_at) values ($1, $2, $3, $4, 'active', now(), now())",
        [tenantId, clientId, name, slug],
    );
    return tenantId;
}

// Anggota aktif tenant dengan satu role yang memegang duty yang disebut, misalnya `core.organization.manage`.
// Tanpa duty, anggota itu tidak punya role sama sekali.
// Pengguna yang bisa login, belum menjadi anggota tenant mana pun.
export async function createUser(sql: postgres.Sql, name = 'Anggota uji') {
    const userId = Bun.randomUUIDv7();
    const email = `anggota-${userId}@example.com`;
    await sql.unsafe(
        "insert into users (id, name, email, password, account_type, created_at, updated_at) values ($1, $2, $3, $4, 'person', now(), now())",
        [userId, name, email, await passwordHash],
    );
    return { userId, email, password: testPassword };
}

export async function createMember(
    sql: postgres.Sql,
    tenantId: string,
    duties: string[] = [],
) {
    const { userId, email } = await createUser(sql);
    const membershipId = Bun.randomUUIDv7();
    await sql.unsafe(
        "insert into tenant_memberships (id, tenant_id, user_id, status, created_at, updated_at) values ($1, $2, $3, 'active', now(), now())",
        [membershipId, tenantId, userId],
    );
    let roleId: string | null = null;
    if (duties.length) {
        roleId = Bun.randomUUIDv7();
        await sql.unsafe(
            'insert into roles (id, tenant_id, name, is_active, created_at, updated_at) values ($1, $2, $3, true, now(), now())',
            [roleId, tenantId, `Role uji ${roleId}`],
        );
        for (const duty of duties)
            await sql.unsafe(
                'insert into security_role_duties (role_id, duty_code) values ($1, $2)',
                [roleId, duty],
            );
        await sql.unsafe(
            "insert into role_assignments (id, membership_id, role_id, source, status, valid_from, created_at, updated_at) values ($1, $2, $3, 'manual', 'active', now() - interval '1 day', now(), now())",
            [Bun.randomUUIDv7(), membershipId, roleId],
        );
    }
    return { userId, membershipId, roleId, email, password: testPassword };
}

// Kebijakan data tanpa batas organisasi untuk role anggota itu, sehingga setiap legal entity dan operating unit aktif
// tenant terjangkau olehnya, termasuk di pemilih tempat kerja.
export async function grantAllOrganizations(
    sql: postgres.Sql,
    tenantId: string,
    membershipId: string,
) {
    await sql.unsafe(
        `insert into app_data_policies (code, app_id, name, protected_permissions, allows_descendants, created_at, updated_at)
         values ('uji.semua-organisasi', 'core', 'Semua organisasi (uji)', '[]', false, now(), now())
         on conflict (code) do nothing`,
    );
    await sql.unsafe(
        `insert into role_assignment_data_policy_scopes
             (id, tenant_id, role_assignment_id, policy_code, include_descendants, valid_from, created_at, updated_at)
         select $1, $2, id, 'uji.semua-organisasi', false, now() - interval '1 day', now(), now()
         from role_assignments where membership_id = $3`,
        [Bun.randomUUIDv7(), tenantId, membershipId],
    );
}
