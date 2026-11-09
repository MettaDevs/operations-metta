import type postgres from 'postgres';

// Data awal tenant untuk test yang memakai database, ditulis lewat SQL langsung: control plane yang kelak membuat
// tenant dan pemiliknya, dan repo ini belum punya alurnya. Semua nama dan email sintetis dan unik per pemanggilan,
// jadi test boleh berjalan berulang di database yang sama.

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
export async function createMember(
    sql: postgres.Sql,
    tenantId: string,
    duties: string[] = [],
) {
    const userId = Bun.randomUUIDv7();
    const membershipId = Bun.randomUUIDv7();
    const email = `anggota-${userId}@example.com`;
    await sql.unsafe(
        "insert into users (id, name, email, password, account_type, created_at, updated_at) values ($1, 'Anggota uji', $2, $3, 'person', now(), now())",
        [userId, email, await passwordHash],
    );
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
