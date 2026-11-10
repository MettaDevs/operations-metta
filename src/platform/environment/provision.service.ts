import postgres from 'postgres';
import type { DatabaseSettings } from '../config/index.ts';
import { migrate, type MigrationSource } from '../migration/index.ts';
import type { ProvisionRequest } from './provision.schema.ts';
import { recordRoute } from './route.service.ts';

// Nama role yang dibuat untuk admin pertama. Pengguna boleh menggantinya; yang menandai pemilik adalah is_owner.
const ownerRoleName = 'Pemilik';
const reservedDatabases = new Set(['postgres', 'template0', 'template1']);

function connect(settings: DatabaseSettings, database: string) {
    return postgres({
        host: settings.DB_HOST,
        port: settings.DB_PORT,
        database,
        username: settings.DB_USERNAME,
        password: settings.DB_PASSWORD,
        max: 1,
        onnotice: () => {
            // NOTICE PostgreSQL sengaja tidak dicetak.
        },
    });
}

async function createDatabase(
    settings: DatabaseSettings,
    database: string,
): Promise<void> {
    if (database === settings.DB_DATABASE || reservedDatabases.has(database))
        throw new Error(
            `Database ${database} is the runtime or a system database, not an environment database.`,
        );
    const sql = connect(settings, settings.DB_DATABASE);
    try {
        // Nama sudah lolos pola huruf kecil, angka, dan garis bawah di schema, jadi aman ditulis sebagai identifier.
        await sql.unsafe(`create database "${database}"`);
    } catch (error) {
        // Penyiapan yang diulang menemukan database dari percobaan sebelumnya.
        if ((error as { code?: string }).code !== '42P04') throw error;
    } finally {
        await sql.end();
    }
}

// Menulis customer, tenant, admin pertama, dan role pemilik yang memegang semua duty Core dalam satu transaksi.
// Tenant yang sudah ada berarti transaksi itu pernah selesai, jadi tidak ada yang ditulis lagi.
async function bootstrapTenant(
    sql: postgres.Sql,
    { client, tenant, admin }: ProvisionRequest,
): Promise<boolean> {
    return sql.begin(async (transaction) => {
        const [existing] = await transaction.unsafe<{ id: string }[]>(
            'select id from tenants where id = $1 or slug = $2 order by id = $1 desc limit 1',
            [tenant.id, tenant.slug],
        );
        if (existing?.id === tenant.id) return false;
        if (existing)
            throw new Error(
                `Tenant slug ${tenant.slug} already belongs to another tenant in this database.`,
            );
        // Di database bersama satu email hanya boleh satu pengguna, dan identitas pusat belum ada untuk
        // menyatukannya.
        const [user] = await transaction.unsafe<{ id: string }[]>(
            'select id from users where email = $1',
            [admin.email],
        );
        if (user)
            throw new Error(
                `Email ${admin.email} already belongs to a user in this database.`,
            );
        const membershipId = Bun.randomUUIDv7();
        const roleId = Bun.randomUUIDv7();
        await transaction.unsafe(
            "insert into clients (id, legal_name, slug, status, created_at, updated_at) values ($1, $2, $3, 'active', now(), now()) on conflict (id) do nothing",
            [client.id, client.legal_name, client.slug],
        );
        await transaction.unsafe(
            "insert into tenants (id, client_id, name, slug, status, created_at, updated_at) values ($1, $2, $3, $4, 'active', now(), now())",
            [tenant.id, client.id, tenant.name, tenant.slug],
        );
        await transaction.unsafe(
            "insert into users (id, name, email, password, account_type, created_at, updated_at) values ($1, $2, $3, $4, 'person', now(), now())",
            [admin.id, admin.name, admin.email, admin.password_hash],
        );
        await transaction.unsafe(
            "insert into tenant_memberships (id, tenant_id, user_id, status, created_at, updated_at) values ($1, $2, $3, 'active', now(), now())",
            [membershipId, tenant.id, admin.id],
        );
        await transaction.unsafe(
            'insert into roles (id, tenant_id, name, is_active, is_owner, created_at, updated_at) values ($1, $2, $3, true, true, now(), now())',
            [roleId, tenant.id, ownerRoleName],
        );
        await transaction.unsafe(
            "insert into security_role_duties (role_id, duty_code) select $1, code from security_duties where app_id = 'core' and tenant_id is null and status = 'active'",
            [roleId],
        );
        // valid_from bertipe timestamp(0): now() dibulatkan dan bisa jatuh di detik berikutnya, sehingga admin yang
        // login di detik yang sama belum memegang role-nya. Dipotong, bukan dibulatkan.
        await transaction.unsafe(
            "insert into role_assignments (id, membership_id, role_id, source, status, valid_from, created_at, updated_at) values ($1, $2, $3, 'automatic', 'active', date_trunc('second', now()), now(), now())",
            [Bun.randomUUIDv7(), membershipId, roleId],
        );
        return true;
    });
}

// Menyiapkan satu lingkungan sampai admin pertamanya bisa login di alamatnya: membuat database lingkungan dan
// memigrasi Core di dalamnya, menulis tenant, lalu mencatat alamatnya di database runtime. Database bersama (database
// null) dimigrasi oleh deploy runtime, bukan di sini. Module belum ikut: module dipasang dari entitlement. Aman
// diulang di setiap langkah. Mengembalikan false bila tenant itu sudah ada.
export async function provisionEnvironment(
    settings: DatabaseSettings,
    source: MigrationSource,
    request: ProvisionRequest,
): Promise<{ created: boolean }> {
    if (request.database !== null) {
        await createDatabase(settings, request.database);
    }
    const sql = connect(settings, request.database ?? settings.DB_DATABASE);
    let created: boolean;
    try {
        if (request.database !== null)
            await migrate(sql, source, { modules: [] });
        created = await bootstrapTenant(sql, request);
    } finally {
        await sql.end();
    }
    // Alamat dicatat terakhir, sesudah tenant lengkap, supaya alamat tidak pernah menunjuk lingkungan setengah jadi.
    const runtime = connect(settings, settings.DB_DATABASE);
    try {
        await recordRoute(runtime, {
            tenant_slug: request.tenant.slug,
            kind: request.environment.kind,
            tenant_id: request.tenant.id,
            name: request.environment.name,
            database_name: request.database,
        });
    } finally {
        await runtime.end();
    }
    return { created };
}
