import type postgres from 'postgres';
import { Database } from '../../src/platform/database/index.ts';
import { publishEvent } from '../../src/platform/events/index.ts';
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

// Event layanan kesehatan yang membawa kunjungan selesai dan biayanya ke kasir, masing-masing di transaksinya sendiri
// seperti layanan kesehatan mengirimnya.
export function visitCharges(
    pool: postgres.Sql,
    scope: { tenantId: string; legalEntityId: string },
) {
    async function withDatabase<T>(
        work: (db: Database) => Promise<T>,
    ): Promise<T> {
        const connection = await pool.reserve();
        try {
            return await work(
                new Database(connection, undefined, Bun.randomUUIDv7()),
            );
        } finally {
            connection.release();
        }
    }
    const publish = (type: string, data: Record<string, unknown>) =>
        withDatabase((db) =>
            db.transaction(() =>
                publishEvent(db, {
                    type: type as `${string}.${string}.${string}.v1`,
                    tenantId: scope.tenantId,
                    legalEntityId: scope.legalEntityId,
                    data: data as Record<string, string>,
                }),
            ),
        );
    // Kunjungan selesai dengan satu baris tindakan per tarif. Biayanya dikirim lebih dulu, seperti Simpan rekam medis
    // sebelum Selesai periksa; visit menambah atau mengganti isi potret kunjungan.
    async function completedVisit(
        visitId: string,
        tariffs: string[],
        visit: Record<string, unknown> = {},
    ) {
        await publish('healthcare.examination.charges-replaced.v1', {
            examination_id: Bun.randomUUIDv7(),
            visit_id: visitId,
            registration_number: `REG-${visitId.slice(-4)}`,
            lines: tariffs.map((tariff, index) => ({
                line_id: Bun.randomUUIDv7(),
                procedure_id: Bun.randomUUIDv7(),
                procedure_code: `J-${index}`,
                procedure_name: `Tindakan ${index}`,
                service_group_id: null,
                service_group_name: 'Tindakan Medis',
                service_group_order: 1,
                category_name: null,
                quantity: '1',
                tariff,
                doctor_id: null,
                doctor_name: null,
                section_id: Bun.randomUUIDv7(),
                section_name: 'Poli Umum',
                date: '2026-11-13',
                components: [],
            })),
        });
        await publish('healthcare.visit.completed.v1', {
            visit_id: visitId,
            registration_number: `REG-${visitId.slice(-4)}`,
            date: '2026-11-13',
            registered_at: '2026-11-13T01:00:00Z',
            patient: {
                id: Bun.randomUUIDv7(),
                medical_record_number: visitId.slice(-6),
                name: 'Pasien Uji',
            },
            patient_type: { id: Bun.randomUUIDv7(), name: 'UMUM' },
            guarantor: null,
            card_number: null,
            sections: [{ id: Bun.randomUUIDv7(), name: 'Poli Umum' }],
            ...visit,
        });
    }
    return { withDatabase, publish, completedVisit };
}
