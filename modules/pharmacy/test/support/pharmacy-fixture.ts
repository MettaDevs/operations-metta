import type postgres from 'postgres';
import type { z } from 'zod';
import { Database } from '../../../../src/platform/database/index.ts';
import { publishEvent } from '../../../../src/platform/events/index.ts';
import { eventContract } from '../../../../test/support/event-contracts.ts';
import type { Browser } from '../../../../test/support/operations-app.ts';
import {
    createMember,
    createTenant,
    entitle,
    grantAllOrganizations,
    recordInstallation,
} from '../../../../test/support/tenant-fixtures.ts';

// Satu puskesmas sintetis dengan module farmasi terpasang: legal entity, dua operating unit, satuan, dan pengguna yang
// memegang duty persediaan dan farmasi. Resep masuk lewat event healthcare.prescription.issued.v1 yang diterbitkan
// seperti layanan kesehatan menerbitkannya; isinya diperiksa dulu terhadap berkas kontrak, supaya fixture ini tidak
// pernah menyimpang dari kontrak.

export const api = '/api/modules/pharmacy/v1';
export const inventoryApi = '/api/v1/inventory';
export const issuedType = 'healthcare.prescription.issued.v1';

export const pharmacyDuties = [
    'core.organization.manage',
    'core.inventory-setup.manage',
    'core.inventory-item.manage',
    'core.inventory-adjustment.manage',
    'pharmacy.dispensing.inquire',
    'pharmacy.setup.manage',
];

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

type Reference = { id: string; code: string; name: string };

// Dosis baris seperti dikirim layanan kesehatan. Baris tanpa dosis meniru pesan yang terbit sebelum dosis dicatat.
export type IssuedDosage = {
    frequency_per_day: number | null;
    dose: string | null;
    dose_unit: Reference | null;
    route: { code: string; name: string } | null;
    duration_days: number | null;
};

export type IssuedLine = {
    item?: Reference | null;
    compound?: number | null;
    quantity?: string | null;
    unit?: Reference;
    quantity_per_unit?: string;
    requested_quantity?: string | null;
    signa?: string | null;
    dosage?: IssuedDosage;
};

let issuedContract: Promise<z.ZodType> | null = null;

const reference = ({ id, code, name }: Reference): Reference => ({
    id,
    code,
    name,
});

export async function createPharmacy(
    pool: postgres.Sql,
    browser: () => Browser,
    name: string,
    options: { installed?: boolean; duties?: string[] } = {},
) {
    const tenantId = await createTenant(pool, name);
    await entitle(pool, tenantId, 'pharmacy');
    if (options.installed !== false)
        await recordInstallation(pool, tenantId, 'pharmacy');
    const member = await createMember(
        pool,
        tenantId,
        options.duties ?? pharmacyDuties,
    );
    await grantAllOrganizations(pool, tenantId, member.membershipId);
    const admin = browser();
    await admin.login(member.email, member.password);
    const created = async <T = Reference>(
        path: string,
        body: Record<string, unknown>,
    ) => (await json<{ data: T }>(await admin.post(path, body), 201)).data;
    const suffix = String(Math.floor(Math.random() * 1e6));
    const legalEntityId = (
        await created('/api/v1/organizations', {
            classification: 'legal_entity',
            name: `PT ${name}`,
            company_code: `K${suffix}`,
            country_code: 'ID',
        })
    ).id;
    const operatingUnit = async (unitName: string) =>
        (
            await created('/api/v1/organizations', {
                classification: 'operating_unit',
                name: unitName,
                operating_unit_type: 'department',
                operating_unit_number: `U${Math.floor(Math.random() * 1e6)}`,
            })
        ).id;
    const unitId = await operatingUnit(`Puskesmas ${name}`);
    const uom = await created(`${inventoryApi}/units-of-measure`, {
        code: 'TAB',
        name: 'Tablet',
    });
    const location = (code: string, body: Record<string, unknown> = {}) =>
        created(`${inventoryApi}/locations`, {
            code,
            name: `Lokasi ${code}`,
            operating_unit_id: unitId,
            ...body,
        });
    const item = (code: string, body: Record<string, unknown> = {}) =>
        created(`${inventoryApi}/items`, {
            code,
            name: `Obat ${code}`,
            base_unit_id: uom.id,
            ...body,
        });

    // Resep yang dikirim dokter: envelope seperti yang ditulis healthcare ke outbox, diterbitkan di transaksinya sendiri.
    async function issue(
        lines: IssuedLine[],
        overrides: {
            unitId?: string;
            section?: { id: string; name: string };
            legalEntityId?: string;
            data?: Record<string, unknown>;
            validate?: boolean;
        } = {},
    ) {
        const prescriptionId = Bun.randomUUIDv7();
        const data = {
            prescription_id: prescriptionId,
            prescription_number: `RSP-${prescriptionId.slice(-8)}`,
            registration_number: `REG-${prescriptionId.slice(-8)}`,
            issued_at: '2026-11-13T02:15:00Z',
            notes: null,
            patient: {
                id: Bun.randomUUIDv7(),
                medical_record_number: `00.00.${prescriptionId.slice(-2)}`,
                name: `Pasien ${prescriptionId.slice(-4)}`,
                birth_date: '1990-05-01',
            },
            doctor: { id: Bun.randomUUIDv7(), name: 'dr. Uji' },
            section: overrides.section ?? {
                id: '00000000-0000-7000-8000-000000000001',
                name: 'Poli Umum',
            },
            lines: lines.map((line, index) => ({
                id: Bun.randomUUIDv7(),
                order: index + 1,
                item: line.item
                    ? {
                          id: line.item.id,
                          code: line.item.code,
                          name: line.item.name,
                      }
                    : null,
                compound: line.compound ?? null,
                quantity: line.quantity ?? null,
                unit: line.item ? reference(line.unit ?? uom) : null,
                quantity_per_unit: line.item
                    ? (line.quantity_per_unit ?? '1')
                    : null,
                base_unit: line.item ? reference(uom) : null,
                base_quantity: line.item
                    ? String(
                          Number(line.quantity ?? 0) *
                              Number(line.quantity_per_unit ?? 1),
                      )
                    : null,
                requested_quantity: line.requested_quantity ?? null,
                signa: line.signa ?? null,
                usage_instruction: line.item ? 'Setelah Makan' : null,
                ...(line.dosage && {
                    ...line.dosage,
                    dose_unit: line.dosage.dose_unit
                        ? reference(line.dosage.dose_unit)
                        : null,
                }),
                notes: null,
            })),
            ...overrides.data,
        };
        const connection = await pool.reserve();
        try {
            const db = new Database(connection, undefined, Bun.randomUUIDv7());
            const envelope = await db.transaction(() =>
                publishEvent(db, {
                    type: issuedType,
                    tenantId,
                    legalEntityId: overrides.legalEntityId ?? legalEntityId,
                    orgUnitId: overrides.unitId ?? unitId,
                    data,
                }),
            );
            if (overrides.validate !== false) {
                issuedContract ??= eventContract(issuedType);
                (await issuedContract).parse(envelope);
            }
            return { envelope, prescriptionId, data };
        } finally {
            connection.release();
        }
    }

    // Antrean resep satu resep, dibaca langsung dari tabel farmasi, bukan dari API yang sedang diuji.
    async function queued(prescriptionId: string) {
        const rows = await pool.unsafe<
            { id: string; nomor_resep: string; lines: number }[]
        >(
            `select r.id, r.nomor_resep,
                    (select count(*)::int from far_tr_resep_detail d where d.resep_id = r.id) as lines
             from far_tr_resep r where r.tenant_id = $1 and r.resep_sumber_id = $2`,
            [tenantId, prescriptionId],
        );
        return [...rows];
    }

    return {
        tenantId,
        legalEntityId,
        unitId,
        admin,
        member,
        uom,
        created,
        operatingUnit,
        location,
        item,
        issue,
        queued,
    };
}

export type Pharmacy = Awaited<ReturnType<typeof createPharmacy>>;
