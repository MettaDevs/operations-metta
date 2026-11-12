import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    createBusiness,
    inventoryDuties,
    json,
    refused,
    type Business,
} from '../../../support/inventory-fixtures.ts';
import { operationsTestApp } from '../../../support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../support/tenant-fixtures.ts';

type Vendor = {
    id: string;
    number: string;
    name: string;
    tax_number: string | null;
    status: string;
    version: number;
};

const path = '/api/v1/purchasing/vendors';
const duties = [...inventoryDuties, 'core.vendor.manage'];

// Vendor per legal entity: party organisasi di buku alamat dengan peran vendor, nomor dari number sequence legal
// entity, nonaktif sebagai pengganti hapus, dan izin lihat/ubah yang terpisah.
describe.skipIf(!process.env.DB_HOST)('vendors', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let business: Business;

    beforeAll(async () => {
        business = await createBusiness(
            pool,
            browser,
            'Klinik Uji Vendor',
            duties,
        );
    });

    const create = async (body: Record<string, unknown>) =>
        (
            await json<{ data: Vendor }>(
                await business.admin.post(path, body),
                201,
            )
        ).data;

    test('a vendor is an organization party with the vendor role and a number from its legal entity', async () => {
        const vendor = await create({
            name: '  PBF Sehat Sentosa ',
            tax_number: '01.234.567.8-901.000',
        });
        expect(vendor).toMatchObject({
            name: 'PBF Sehat Sentosa',
            tax_number: '01.234.567.8-901.000',
            status: 'active',
        });
        expect(vendor.number).toMatch(/^VND-\d{8}$/);
        const [party] = await pool.unsafe<
            { type: string; name: string; roles: string[] }[]
        >(
            `select p.type, p.name, array_agg(r.role_code) as roles
             from vendors v
             join parties p on p.id = v.party_id
             join party_role_registrations r on r.party_id = p.id and r.legal_entity_id = v.legal_entity_id
             where v.id = $1
             group by p.type, p.name`,
            [vendor.id],
        );
        expect(party).toEqual({
            type: 'organization',
            name: 'PBF Sehat Sentosa',
            roles: ['vendor'],
        });
    });

    test('name, tax number, and status change on the card; an inactive vendor drops out of the active list', async () => {
        const vendor = await create({ name: 'PBF Lama' });
        const updated = await json<{ data: Vendor }>(
            await business.admin.patch(`${path}/${vendor.id}`, {
                name: 'PBF Baru',
                tax_number: null,
                status: 'inactive',
                version: vendor.version,
            }),
            200,
        );
        expect(updated.data).toMatchObject({
            name: 'PBF Baru',
            tax_number: null,
            status: 'inactive',
        });
        const active = await json<{ data: Vendor[] }>(
            await business.admin.get(`${path}?status=active&q=PBF`),
            200,
        );
        expect(active.data.map((entry) => entry.id)).not.toContain(vendor.id);
        expect(
            (
                await business.admin.patch(`${path}/${vendor.id}`, {
                    name: 'PBF Basi',
                    version: vendor.version,
                })
            ).status,
        ).toBe(409);
    });

    test('a vendor needs a name, and a second legal entity numbers its vendors from one again', async () => {
        expect(
            Object.keys(
                await refused(await business.admin.post(path, { name: ' ' })),
            ),
        ).toEqual(['name']);
        const other = await createBusiness(
            pool,
            browser,
            'Klinik Uji Vendor Dua',
            duties,
        );
        const first = (
            await json<{ data: Vendor }>(
                await other.admin.post(path, { name: 'PBF Pertama' }),
                201,
            )
        ).data;
        const secondEntity = (
            await json<{ data: { id: string } }>(
                await other.admin.post('/api/v1/organizations', {
                    classification: 'legal_entity',
                    name: 'PT Klinik Uji Vendor Dua Kedua',
                    company_code: `V${Math.floor(Math.random() * 1e6)}`,
                    country_code: 'ID',
                }),
                201,
            )
        ).data.id;
        await json(
            await other.admin.put('/api/v1/workspace-context', {
                membership_id: other.member.membershipId,
                legal_entity_id: secondEntity,
            }),
            200,
        );
        const second = (
            await json<{ data: Vendor }>(
                await other.admin.post(path, { name: 'PBF Kedua' }),
                201,
            )
        ).data;
        expect(second.number).toBe(first.number);
        expect(
            (
                await json<{ data: Vendor[] }>(await other.admin.get(path), 200)
            ).data.map((entry) => entry.name),
        ).toEqual(['PBF Kedua']);
        expect((await other.admin.get(`${path}?q=Pertama`)).status).toBe(200);
        expect(
            (
                await other.admin.patch(`${path}/${first.id}`, {
                    name: 'Diambil entitas lain',
                    version: first.version,
                })
            ).status,
        ).toBe(404);
    });

    test('reading and changing vendors are separate rights', async () => {
        const reader = await createMember(pool, business.tenantId, [
            'core.vendor.inquire',
        ]);
        await grantAllOrganizations(
            pool,
            business.tenantId,
            reader.membershipId,
        );
        const session = browser();
        await session.login(reader.email, reader.password);
        const listed = await json<{ can_manage: boolean }>(
            await session.get(path),
            200,
        );
        expect(listed.can_manage).toBe(false);
        expect((await session.post(path, { name: 'PBF Liar' })).status).toBe(
            403,
        );
    });
});
