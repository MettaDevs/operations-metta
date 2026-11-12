import type postgres from 'postgres';
import { z } from 'zod';
import type { DatabaseSettings } from '../config/index.ts';
import { assertEnvironmentDatabase, connect } from './provision.service.ts';

export const syncIdentitiesRequestSchema = z.strictObject({
    tenant_id: z.uuid(),
    // null berarti database bersama (database runtime), dipisah tenant_id.
    database: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,62}$/)
        .nullable(),
    identities: z.array(
        z.strictObject({
            issuer: z.string().min(1).max(255),
            subject: z.string().min(1).max(255),
            email: z.string().max(255).nullable(),
            name: z.string().max(255).nullable(),
            // Pengguna yang sudah ada di lingkungan ini, misalnya admin pertama dari penyiapan. null berarti pengguna
            // baru dibuat untuk identitas ini.
            user_id: z.uuid().nullable(),
        }),
    ),
});
export type SyncIdentitiesRequest = z.infer<typeof syncIdentitiesRequestSchema>;
type Identity = SyncIdentitiesRequest['identities'][number];

// Memberi tahu lingkungan identitas SSO mana milik pengguna mana. Hanya menambah: tautan yang sudah ada, termasuk yang
// dipasang pengguna sendiri dari profilnya, tidak pernah dilepas atau dinonaktifkan. Identitas yang sudah tertaut di
// lingkungan ini dilewati, jadi aman diulang. Identitas tanpa user_id mendapat pengguna baru tanpa kata sandi, dengan
// keanggotaan aktif di tenant dan tanpa role. Tidak ada yang ditautkan karena emailnya sama: email yang sudah dipakai
// pengguna lain menggagalkan operasi.
export async function syncIdentities(
    settings: DatabaseSettings,
    request: SyncIdentitiesRequest,
    step: (name: string) => Promise<unknown>,
): Promise<void> {
    if (request.database !== null)
        assertEnvironmentDatabase(settings, request.database);
    const sql = connect(settings, request.database ?? settings.DB_DATABASE);
    try {
        const [tenant] =
            await sql`select id from tenants where id = ${request.tenant_id}`;
        if (!tenant)
            throw new Error(
                `Tenant ${request.tenant_id} tidak ada di database lingkungan ini.`,
            );
        for (const identity of request.identities) {
            await step(`identitas ${identity.subject}`.slice(0, 60));
            await sql.begin((transaction) =>
                link(transaction, request.tenant_id, identity),
            );
        }
    } finally {
        await sql.end();
    }
}

async function link(
    sql: postgres.TransactionSql,
    tenantId: string,
    identity: Identity,
): Promise<void> {
    const [linked] = await sql`select 1 from external_identities
        where issuer = ${identity.issuer} and subject = ${identity.subject} and deleted_at is null`;
    if (linked) return;
    let userId: string;
    if (identity.user_id !== null) {
        userId = identity.user_id;
        const [member] = await sql`select 1 from users u
            join tenant_memberships m on m.user_id = u.id and m.tenant_id = ${tenantId} and m.status = 'active'
            where u.id = ${userId} and u.account_type = 'person'`;
        if (!member)
            throw new Error(
                `Pengguna ${userId} tidak ada atau bukan anggota tenant ini, jadi identitas ${identity.subject} tidak bisa ditautkan kepadanya.`,
            );
        const [other] = await sql<
            { subject: string }[]
        >`select subject from external_identities
            where user_id = ${userId} and issuer = ${identity.issuer} and deleted_at is null`;
        if (other)
            throw new Error(
                `Pengguna ${userId} sudah tertaut ke identitas lain (${other.subject}) di penyedia ${identity.issuer}.`,
            );
    } else {
        const email = identity.email?.trim().toLowerCase();
        if (!email)
            throw new Error(
                `Identitas ${identity.subject} tidak membawa email, jadi pengguna baru tidak bisa dibuat untuknya.`,
            );
        const [taken] =
            await sql`select 1 from users where lower(email) = ${email}`;
        if (taken)
            throw new Error(
                `Email ${email} sudah dipakai pengguna lain di lingkungan ini. Identitas SSO tidak ditautkan lewat email, jadi sebutkan pengguna yang dituju atau ganti emailnya.`,
            );
        userId = Bun.randomUUIDv7();
        await sql`insert into users (id, name, email, password, account_type, created_at, updated_at)
            values (${userId}, ${identity.name?.trim() || email}, ${email}, null, 'person', now(), now())`;
        await sql`insert into tenant_memberships (id, tenant_id, user_id, status, created_at, updated_at)
            values (${Bun.randomUUIDv7()}, ${tenantId}, ${userId}, 'active', now(), now())`;
    }
    await sql`insert into external_identities (id, user_id, issuer, subject, email_at_link, created_at, updated_at)
        values (${Bun.randomUUIDv7()}, ${userId}, ${identity.issuer}, ${identity.subject},
            ${identity.email?.trim().toLowerCase() || null}, now(), now())`;
}
