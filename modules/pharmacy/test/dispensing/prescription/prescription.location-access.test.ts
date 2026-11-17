import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    operationsTestApp,
    type Browser,
} from '../../../../../test/support/operations-app.ts';
import {
    createMember,
    grantAllOrganizations,
} from '../../../../../test/support/tenant-fixtures.ts';
import {
    api,
    createPharmacy,
    inventoryApi,
    json,
    pharmacyDuties,
    type Pharmacy,
} from '../../support/pharmacy-fixture.ts';

type Row = { id: string; prescription_number: string };
type Location = { id: string; code: string; name: string; version: number };
type Refusal = {
    errors: Record<string, string[]>;
    actions?: { page: string; recordId: string }[];
};

// Satu farmasi, lokasi diatur: petugas pusling yang ditugaskan hanya ke lokasi pusling melihat resep pusling saja, dan
// ditolak saat menyiapkan resep farmasi biasa begitu kedua lokasi ditandai khusus petugas. Resep tanpa lokasi tetap
// terlihat semua petugas. Butuh PostgreSQL yang sudah dimigrasi; dilewati bila DB_HOST kosong.
describe.skipIf(!process.env.DB_HOST)('prescription queue per location', () => {
    if (!process.env.DB_HOST) return;
    const { pool, browser, close } = operationsTestApp();
    afterAll(close);
    let pharmacy: Pharmacy;
    let clerk: Browser;
    let regular: { id: string };
    let mobile: { id: string };
    const numbers = { regular: '', mobile: '', unmapped: '' };
    let regularRow: Row;
    const section = (name: string) => ({ id: Bun.randomUUIDv7(), name });

    const queue = async (session: Browser) =>
        (
            await json<{ data: Row[] }>(
                await session.get(`${api}/prescriptions?status=menunggu`),
                200,
            )
        ).data;

    beforeAll(async () => {
        pharmacy = await createPharmacy(pool, browser, 'Farmasi Uji Petugas', {
            duties: [...pharmacyDuties, 'pharmacy.dispensing.manage'],
        });
        const item = await pharmacy.item('PCT-500');
        regular = await pharmacy.location('FARMASI');
        mobile = await pharmacy.location('PUSLING');
        const pusling = section('Pusling');
        numbers.regular = (
            await pharmacy.issue([{ item, quantity: '10' }], {
                section: section('Poli Umum'),
            })
        ).data.prescription_number;
        numbers.mobile = (
            await pharmacy.issue([{ item, quantity: '4' }], {
                section: pusling,
            })
        ).data.prescription_number;
        for (const [sectionId, locationId] of [
            [null, regular.id],
            [pusling.id, mobile.id],
        ])
            await json(
                await pharmacy.admin.post(`${api}/service-locations`, {
                    operating_unit_id: pharmacy.unitId,
                    section_id: sectionId,
                    location_id: locationId,
                }),
                201,
            );
        const other = await pharmacy.operatingUnit('Unit tanpa farmasi');
        numbers.unmapped = (
            await pharmacy.issue([{ item, quantity: '2' }], {
                unitId: other,
            })
        ).data.prescription_number;
        const found = (await queue(pharmacy.admin)).find(
            (row) => row.prescription_number === numbers.regular,
        );
        if (!found) throw new Error('regular prescription was not queued');
        regularRow = found;

        const account = await createMember(pool, pharmacy.tenantId, [
            'pharmacy.dispensing.manage',
        ]);
        await grantAllOrganizations(
            pool,
            pharmacy.tenantId,
            account.membershipId,
        );
        clerk = browser();
        await clerk.login(account.email, account.password);
        const locations = (
            await json<{ data: Location[] }>(
                await pharmacy.admin.get(`${inventoryApi}/locations`),
                200,
            )
        ).data;
        for (const location of locations)
            await json(
                await pharmacy.admin.patch(
                    `${inventoryApi}/locations/${location.id}`,
                    {
                        code: location.code,
                        name: location.name,
                        operating_unit_id: pharmacy.unitId,
                        restricted_to_employees: true,
                        version: location.version,
                    },
                ),
                200,
            );
        await json(
            await pharmacy.admin.post(`${inventoryApi}/warehouse-employees`, {
                location_id: mobile.id,
                user_id: account.userId,
                is_default: true,
            }),
            201,
        );
    });

    test('the pusling employee sees pusling and unlocated prescriptions only', async () => {
        expect(
            (await queue(clerk)).map((row) => row.prescription_number).sort(),
        ).toEqual([numbers.mobile, numbers.unmapped].sort());
        const metadata = await json<{
            locations: { id: string }[];
            default_location_id: string | null;
        }>(await clerk.get(`${api}/prescriptions/metadata`), 200);
        expect(metadata.locations.map((row) => row.id)).toEqual([mobile.id]);
        expect(metadata.default_location_id).toBe(mobile.id);
        expect(
            (
                await clerk.get(
                    `${api}/prescriptions/${regularRow.id}/dispensing`,
                )
            ).status,
        ).toBe(404);
    });

    test('preparing a prescription served elsewhere is refused with the location named', async () => {
        const refusal = await json<Refusal>(
            await clerk.post(
                `${api}/prescriptions/${regularRow.id}/dispensing/prepare`,
                {},
            ),
            422,
        );
        expect(refusal.errors._form?.[0]).toBe(
            'Lokasi FARMASI Lokasi FARMASI hanya untuk petugasnya, dan Anda belum terdaftar sebagai petugas di sana. Minta pengelola lokasi stok mendaftarkan Anda sebagai petugas lokasi FARMASI.',
        );
        expect(refusal.actions).toBeUndefined();
        const manager = await json<Refusal>(
            await pharmacy.admin.post(
                `${api}/prescriptions/${regularRow.id}/dispensing/prepare`,
                {},
            ),
            422,
        );
        expect(manager.actions?.[0]).toMatchObject({
            page: 'core.inventory-location',
            recordId: regular.id,
        });
    });
});
