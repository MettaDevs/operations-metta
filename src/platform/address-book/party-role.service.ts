import { z } from 'zod';
import { nowSql, type Database } from '../database/index.ts';

// Registri peran party: satu peran sama per party per legal entity (constraint party_role_unique). Peran ditulis
// fitur pemiliknya saat akun bisnisnya dibuat, misalnya vendor oleh Core atau pasien oleh module layanan kesehatan,
// bukan dicentang di buku alamat. Pemilik yang tercatat harus sama dengan pemilik perannya di party_roles.
export async function registerPartyRole(
    db: Database,
    registration: {
        tenantId: string;
        partyId: string;
        roleCode: string;
        legalEntityId: string;
        owningAppId: string;
    },
): Promise<void> {
    const role = await db.one(
        z.object({ owning_app_id: z.string() }),
        'select owning_app_id from party_roles where code = $1',
        [registration.roleCode],
    );
    if (!role)
        throw new Error(
            `Peran party ${registration.roleCode} belum terdaftar di party_roles.`,
        );
    if (role.owning_app_id !== registration.owningAppId)
        throw new Error(
            `Peran party ${registration.roleCode} milik ${role.owning_app_id}, bukan ${registration.owningAppId}.`,
        );
    const owners = await db.one(
        z.object({ party: z.boolean(), legal_entity: z.boolean() }),
        `select exists (select 1 from parties where tenant_id = $1 and id = $2 and deleted_at is null) as party,
                exists (select 1 from legal_entities where tenant_id = $1 and organization_id = $3) as legal_entity`,
        [
            registration.tenantId,
            registration.partyId,
            registration.legalEntityId,
        ],
    );
    if (!owners?.party || !owners.legal_entity)
        throw new Error('Party atau legal entity tidak ada di tenant ini.');
    const stamp = nowSql();
    await db.execute(
        `insert into party_role_registrations (id, tenant_id, party_id, role_code, legal_entity_id, owning_app_id, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $7)
         on conflict (tenant_id, party_id, role_code, legal_entity_id) do nothing`,
        [
            Bun.randomUUIDv7(),
            registration.tenantId,
            registration.partyId,
            registration.roleCode,
            registration.legalEntityId,
            registration.owningAppId,
            stamp,
        ],
    );
}
