import type postgres from 'postgres';
import type { Browser } from './operations-app.ts';
import {
    createMember,
    createTenant,
    grantAllOrganizations,
} from './tenant-fixtures.ts';

// Satu bisnis sintetis untuk test kasir: legal entity dibuat lewat API organisasi oleh anggota yang memegang duty yang
// disebut, sehingga legal entity itu menjadi tempat kerja aktifnya.

export async function json<T>(response: Response, status: number): Promise<T> {
    const text = await response.text();
    if (response.status !== status)
        throw new Error(`Expected ${status}, got ${response.status}: ${text}`);
    return JSON.parse(text) as T;
}

export async function refused(response: Response) {
    return (await json<{ errors: Record<string, string[]> }>(response, 422))
        .errors;
}

export async function legalEntity(admin: Browser, name: string) {
    const created = await json<{ data: { id: string } }>(
        await admin.post('/api/v1/organizations', {
            classification: 'legal_entity',
            name,
            company_code: `K${Math.floor(Math.random() * 1e6)}`,
            country_code: 'ID',
        }),
        201,
    );
    return created.data.id;
}

// Pindah tempat kerja anggota ke legal entity lain.
export async function selectLegalEntity(
    admin: Browser,
    membershipId: string,
    legalEntityId: string,
) {
    await json(
        await admin.put('/api/v1/workspace-context', {
            membership_id: membershipId,
            legal_entity_id: legalEntityId,
        }),
        200,
    );
}

export async function createBillingBusiness(
    pool: postgres.Sql,
    browser: () => Browser,
    name: string,
    duties: string[],
) {
    const tenantId = await createTenant(pool, name);
    const member = await createMember(pool, tenantId, [
        'core.organization.manage',
        ...duties,
    ]);
    await grantAllOrganizations(pool, tenantId, member.membershipId);
    const admin = browser();
    await admin.login(member.email, member.password);
    const legalEntityId = await legalEntity(admin, `PT ${name}`);
    return { tenantId, member, admin, legalEntityId };
}
